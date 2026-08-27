/**
 * APP-BE-SOCIAL-AUTH-01 · recuperación PayMe independiente del proveedor.
 *
 * El transporte es una frontera inyectable. En este release no existe un
 * transporte real: sin uno instalado la capability permanece OFF. El raw token
 * se entrega una sola vez a esa frontera; PostgreSQL sólo recibe SHA-256.
 */
'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const logger = require('../utils/logger');
const { generateToken, tokenHash, normalizeEmail } = require('../utils/tokens');

const FLAG = 'AUTH_RECOVERY_EMAIL_ENABLED';
const TTL_SECONDS = 15 * 60;
const RATE_WINDOW_SECONDS = 15 * 60;
const RATE_LIMITS = Object.freeze({ global: 500, shard: 50, user: 3 });
let transport = null;

function capability(env = process.env) {
  return { enabled: env[FLAG] === 'true' && typeof transport === 'function' };
}

function codedError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function installTransportForTests(candidate) {
  if (process.env.NODE_ENV !== 'test' || typeof candidate !== 'function') {
    throw new Error('auth_recovery_test_transport_forbidden');
  }
  transport = candidate;
}

function resetTransportForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('auth_recovery_test_transport_forbidden');
  transport = null;
}

function digestFor(scope, value) {
  return tokenHash(`payme/auth-recovery/v1/${scope}/${value}`);
}

async function takeRateLimit(client, { scope, digest, maximum }) {
  const { rows: [row] } = await client.query(
    `INSERT INTO auth_recovery_rate_limits
       (scope,key_digest,hits,reset_at)
     VALUES ($1,$2,1,NOW() + ($4::int * INTERVAL '1 second'))
     ON CONFLICT (scope,key_digest) DO UPDATE
       SET hits = CASE
           WHEN auth_recovery_rate_limits.reset_at <= NOW() THEN 1
          ELSE LEAST(auth_recovery_rate_limits.hits::bigint + 1, 2147483647)::integer
         END,
           reset_at = CASE
           WHEN auth_recovery_rate_limits.reset_at <= NOW()
             THEN NOW() + ($4::int * INTERVAL '1 second')
           ELSE auth_recovery_rate_limits.reset_at
         END,
           updated_at = NOW()
     RETURNING hits <= $3 AS allowed`,
    [scope, digest, maximum, RATE_WINDOW_SECONDS]
  );
  return row?.allowed === true;
}

async function requestRecovery(email, { env = process.env } = {}) {
  if (!capability(env).enabled) throw codedError('recovery_not_available', 404);
  const normalized = normalizeEmail(email);
  const shard = tokenHash(normalized || 'invalid').slice(0, 2);

  const issuance = await pool.tx(async (client) => {
    // Orden global → shard → user: todas las requests toman los mismos locks
    // en el mismo orden y una cuenta concreta nunca puede invertirlos.
    const globalAllowed = await takeRateLimit(client, {
      scope: 'global', digest: digestFor('global', 'all'), maximum: RATE_LIMITS.global,
    });
    const shardAllowed = await takeRateLimit(client, {
      scope: 'shard', digest: digestFor('shard', shard), maximum: RATE_LIMITS.shard,
    });

    const { rows } = await client.query(
      `SELECT u.id,u.email,u.status
         FROM users u
        WHERE (u.email_normalized=$1 OR LOWER(BTRIM(u.email))=$1)
        LIMIT 2
        FOR UPDATE OF u`,
      [normalized]
    );
    let user = rows.length === 1 ? rows[0] : null;
    if (user) {
      const { rows: [suspension] } = await client.query(
        `SELECT status FROM account_auth_suspensions WHERE user_id=$1 FOR UPDATE`,
        [user.id]
      );
      const eligible = user.status === 'active'
        ? suspension?.status !== 'pending_deletion'
        : user.status === 'suspended' && suspension?.status === 'pending_recovery';
      if (!eligible) user = null;
    }
    let userAllowed = true;
    if (user) {
      userAllowed = await takeRateLimit(client, {
        scope: 'user', digest: digestFor('user', user.id), maximum: RATE_LIMITS.user,
      });
    }
    if (!user || !globalAllowed || !shardAllowed || !userAllowed) return null;

    const rawToken = generateToken(32);
    const hash = tokenHash(rawToken);
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
    await client.query(
      `UPDATE auth_recovery_tokens
          SET status='cancelled', cancelled_at=NOW()
        WHERE user_id=$1 AND status='issued'`,
      [user.id]
    );
    await client.query(
      `INSERT INTO auth_recovery_tokens
         (user_id,token_hash,status,expires_at)
       VALUES ($1,$2,'issued',$3)`,
      [user.id, hash, expiresAt]
    );
    return { userId: user.id, email: user.email, rawToken, hash, expiresAt };
  });

  if (issuance) {
    try {
      // Único punto al que llega el raw token. Nunca se serializa ni se loguea.
      await transport({
        email: issuance.email,
        token: issuance.rawToken,
        expires_at: issuance.expiresAt,
      });
    } catch (_) {
      await pool.query(
        `UPDATE auth_recovery_tokens
            SET status='cancelled', cancelled_at=NOW()
          WHERE token_hash=$1 AND status='issued'`,
        [issuance.hash]
      );
      logger.warn('auth_recovery_delivery_failed', { user_id: issuance.userId });
    }
  }
  return { accepted: true };
}

async function completeRecovery(rawToken, newPassword) {
  // Completar una operación ya emitida no depende de que el transporte siga
  // listo. El cambio de capability impide EMITIR tokens nuevos, pero no deja
  // varado un token durable y vigente después de una caída del proveedor.
  const hash = typeof rawToken === 'string' && rawToken.length >= 20 && rawToken.length <= 200
    ? tokenHash(rawToken)
    : '0'.repeat(64);
  // Trabajo caro fuera de la transacción; la fila y su estado se validan de
  // nuevo bajo lock antes de persistir el hash.
  const passwordHash = await bcrypt.hash(newPassword, 10);

  return pool.tx(async (client) => {
    const { rows: [candidate] } = await client.query(
      `SELECT id,user_id FROM auth_recovery_tokens WHERE token_hash=$1`,
      [hash]
    );
    if (!candidate) throw codedError('recovery_not_available', 403);
    const { rows: [user] } = await client.query(
      `SELECT status FROM users WHERE id=$1 FOR UPDATE`, [candidate.user_id]
    );
    const { rows: [token] } = await client.query(
      `SELECT id,user_id,status,expires_at
         FROM auth_recovery_tokens
        WHERE id=$1 AND user_id=$2
        FOR UPDATE`,
      [candidate.id, candidate.user_id]
    );
    const row = token && user ? { ...token, user_status: user.status } : null;
    const { rows: [suspension] } = row
      ? await client.query(
        `SELECT status FROM account_auth_suspensions WHERE user_id=$1 FOR UPDATE`,
        [row.user_id]
      )
      : { rows: [] };
    const suspensionStatus = suspension?.status ?? null;
    const recoverableStatus = row?.user_status === 'active'
      ? suspensionStatus !== 'pending_deletion'
      : row?.user_status === 'suspended' && suspensionStatus === 'pending_recovery';
    if (!row || row.status !== 'issued' || !recoverableStatus
        || new Date(row.expires_at) <= new Date()) {
      throw codedError('recovery_not_available', 403);
    }

    const consumed = await client.query(
      `UPDATE auth_recovery_tokens
          SET status='consumed', consumed_at=NOW()
        WHERE id=$1 AND status='issued' AND expires_at > NOW()`,
      [row.id]
    );
    if (consumed.rowCount !== 1) throw codedError('recovery_not_available', 403);
    await client.query(
      `UPDATE users SET password_hash=$2,status='active' WHERE id=$1`,
      [row.user_id, passwordHash]
    );
    await client.query(
      `UPDATE account_auth_suspensions
          SET status='resolved',resolved_at=NOW(),updated_at=NOW()
        WHERE user_id=$1 AND status='pending_recovery'`,
      [row.user_id]
    );
    await client.query(
      `UPDATE user_sessions
          SET status='revoked', revoked_at=NOW(),
              revoked_reason=COALESCE(revoked_reason,'password_recovery')
        WHERE user_id=$1 AND status='active'`,
      [row.user_id]
    );
    logger.audit('password_recovered', { user_id: row.user_id });
    return { completed: true };
  });
}

module.exports = {
  capability,
  requestRecovery,
  completeRecovery,
  installTransportForTests,
  resetTransportForTests,
  TTL_SECONDS,
  RATE_LIMITS,
};
