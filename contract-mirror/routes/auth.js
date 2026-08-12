/**
 * routes/auth.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P2 #10: POST /refresh AHORA ROTA el refresh_token + reuse detection.
 *     · Cada refresh genera un nuevo raw refresh token, guarda su hash en
 *       refresh_token_hash y mueve el hash anterior a prev_refresh_token_hash.
 *     · El refresh token viejo deja de servir (ya no matchea refresh_token_hash).
 *     · REUSE DETECTION (1 nivel): si llega un token cuyo hash matchea
 *       prev_refresh_token_hash (el inmediatamente anterior, ya rotado), se
 *       interpreta como replay → se revoca la session
 *       (status='revoked', revoked_reason='refresh_reuse_detected') → 401.
 *
 * v2.5.1 (se mantiene):
 *   - P1 #6: login/register crean session con jti; logout revoca.
 *   - P1 #7: email normalizado (ahora además normalizado en el schema, P1 #4).
 */
'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const schemas = require('../schemas');
// `hashIp` ya no se importa: nadie hashea IPs acá desde que user_sessions dejó
// de guardarlas — y desde el mismo día tampoco EXISTE, porque era su último
// consumidor. Ver utils/tokens.js.
const { generateToken, tokenHash, normalizeEmail } = require('../utils/tokens');
const { generatePaymeId } = require('../utils/userId');
const logger = require('../utils/logger');
const { loadActiveSession } = require('../middleware/auth');
const { walletRailEnabled } = require('../services/walletRail');
const signupInvitations = require('../services/signupInvitations');
const legal = require('../services/legal');

const router = express.Router();
const { validateBody } = schemas;

const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS) || (7 * 24 * 60 * 60);   // 7d
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS) || (30 * 24 * 60 * 60); // 30d
const REFRESH_CONCURRENT_GRACE_SECONDS = 5;
const JWT_ISS = process.env.JWT_ISSUER || 'payme.mx';
const JWT_AUD = process.env.JWT_AUDIENCE || 'payme-app';
// Hash bcrypt válido de costo 10 para normalizar el trabajo del login cuando
// el email no existe. No representa una cuenta ni una credencial utilizable.
const DUMMY_PASSWORD_HASH = '$2b$10$/ydJ9mGw8xoJfSyW9XQUP.BweuZ9D/ddrClj4M1ST.StKd.AyaqJW';

// 🔴 `user_agent` e `ip_hash` DEJARON DE ESCRIBIRSE (2026-08-10). Se escribían
// en cada alta y en cada login, y el barrido midió que NINGÚN código de runtime
// los leía nunca: eran dos datos personales acumulándose sin un solo consumidor.
// El IP hasheado sigue siendo dato personal — un hash sin sal sobre un espacio
// tan chico como el de las IPv4 se revierte por fuerza bruta.
//
// Mismo tratamiento que `phone`: LAS COLUMNAS SE CONSERVAN, con sus filas
// históricas, y lo que se apaga es la escritura nueva. Quedan en NULL por
// omisión en el INSERT. Volver a llenarlas exige declarar antes quién las lee.
async function createSession({ userId, client = pool }) {
  const jti = randomUUID();
  const rawRefresh = generateToken(32);
  const refreshHash = tokenHash(rawRefresh);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await client.query(
    `INSERT INTO user_sessions
       (user_id, jti, refresh_token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, jti, refreshHash, expiresAt]
  );

  return { jti, rawRefresh, expiresAt };
}

function issueAccessToken({ userId, jti }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, jti, iss: JWT_ISS, aud: JWT_AUD, nbf: now, iat: now },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL_SECONDS, algorithm: 'HS256' }
  );
}

// ─── POST /register ────────────────────────────────────────
// El schema se elige EN CADA REQUEST (gate de rollout de PQ-2, v2.28): en modo
// de compatibilidad birth_date es opcional; con PQ2_BIRTH_DATE_REQUIRED=true
// pasa a obligatoria. Sin esta indirección, el flip sería un release.
function validateRegister(req, res, next) {
  return validateBody(schemas.registerSchema())(req, res, next);
}

async function requirePrivacyNotice(req, res, next) {
  try {
    const status = await legal.getRequiredPublicationStatus();
    if (!status.ready) {
      logger.error('registration_legal_not_ready', {
        states: status.required.map((x) => `${x.kind}:${x.state}`),
        correlation_id: req.correlationId,
      });
      return res.status(503).json({ error: 'registration_unavailable' });
    }
    return next();
  } catch (err) {
    logger.error('registration_legal_check_failed', {
      code: err.code,
      correlation_id: req.correlationId,
    });
    return res.status(503).json({ error: 'registration_unavailable' });
  }
}

router.post('/register', requirePrivacyNotice, validateRegister, async (req, res, next) => {
  try {
    // req.body.email ya viene normalizado por el schema (P1 #4), pero
    // normalizeEmail es idempotente y lo dejamos por claridad.
    const { email, password, first_name, last_name, birth_date, invitation_token } = req.body;
    const normalized = normalizeEmail(email);

    const hash = await bcrypt.hash(password, 10);
    let created = null;
    for (let attempt = 0; attempt < 10 && !created; attempt += 1) {
      const paymeId = await generatePaymeId(first_name, last_name);
      try {
        created = await pool.tx(async (client) => {
        let signupInvitation = null;
        if (signupInvitations.invitacionRequerida()) {
          signupInvitation = await signupInvitations.bloquearInvitacion(client, {
            token: invitation_token,
            email: normalized,
          });
          if (!signupInvitation) throw signupInvitations.registroNoDisponible();
        }
        const { rows } = await client.query(
          `INSERT INTO users (payme_id, email, email_normalized, phone, password_hash,
                             first_name, last_name, birth_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, payme_id, email, first_name, last_name`,
          // `?? null` explícito: en modo de compatibilidad birth_date llega undefined.
          // pg ya lo mapearía a NULL, pero acá el NULL es la conducta ratificada
          // (cuenta sin fecha = gate de menores cerrado), no un efecto del driver.
          [paymeId, email, normalized, null, hash, first_name, last_name, birth_date ?? null]
        );
        const createdUser = rows[0];
        // ORDEN 1A · el alta ya no acuña wallet. NO es un 410: registrarse es
        // card-only legítimo y tiene que seguir funcionando; lo que se apaga es
        // que nazca una fila de dinero electrónico sin que nadie la pida.
        // La fila no se borra para las cuentas que ya la tienen.
        if (walletRailEnabled()) {
          await client.query(`INSERT INTO wallets (user_id, balance_cents) VALUES ($1, 0)`, [createdUser.id]);
        }
        const createdSession = await createSession({ userId: createdUser.id, client });
        if (signupInvitation) {
          await signupInvitations.marcarConsumida(client, {
            invitationId: signupInvitation.id,
            userId: createdUser.id,
          });
        }
          return { user: createdUser, session: createdSession };
        });
      } catch (err) {
        // La constraint es la fuente de verdad ante registros concurrentes.
        if (err.code === '23505' && (err.constraint === 'uq_users_email_normalized' ||
            err.constraint === 'users_email_key')) {
          // D-FF-1: email ya registrado NO se distingue de token inexistente,
          // usado, vencido o ligado a otro email. Una sola forma pública.
          if (signupInvitations.invitacionRequerida()) {
            const opaque = signupInvitations.registroNoDisponible();
            return res.status(opaque.status).json({ error: opaque.code });
          }
          // Compatibilidad exclusiva del seam de tests históricos. Producción
          // no puede abrir el alta y jamás alcanza esta rama.
          return res.status(409).json({ error: 'email_already_registered' });
        }
        // generatePaymeId reduce la colisión, pero la UNIQUE constraint cierra
        // la carrera entre procesos; un rollback deja cero escrituras parciales.
        if (err.code === '23505' && err.constraint === 'users_payme_id_key' && attempt < 9) {
          continue;
        }
        if (err.code === signupInvitations.ERROR_PUBLICO) {
          return res.status(err.status).json({ error: err.code });
        }
        throw err;
      }
    }
    if (!created) throw new Error('payme_id_collision_retry_exhausted');
    const { user, session } = created;
    const accessToken = issueAccessToken({ userId: user.id, jti: session.jti });

    logger.audit('user_registered', { user_id: user.id, payme_id: user.payme_id });

    res.status(201).json({
      user,
      access_token: accessToken,
      refresh_token: session.rawRefresh,
      expires_in: JWT_TTL_SECONDS,
    });
  } catch (err) { next(err); }
});

// ─── POST /login ───────────────────────────────────────────
router.post('/login', validateBody(schemas.login), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalized = normalizeEmail(email);

    const { rows } = await pool.query(
      `SELECT id, payme_id, email, first_name, last_name, password_hash, status
         FROM users
        WHERE email_normalized = $1 OR LOWER(TRIM(email)) = $1
        LIMIT 2`,
      [normalized]
    );
    // Dos filas legacy que colisionan al normalizar no pueden elegirse por el
    // orden físico de pg. Se falla cerrado y la identidad requiere remediación.
    const user = rows.length === 1 ? rows[0] : null;
    // Exactamente una verificación bcrypt por request: no filtra existencia ni
    // estado por timing. La suspensión sólo se revela tras acreditar el secreto.
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !ok) return res.status(401).json({ error: 'invalid_credentials' });
    if (user.status !== 'active') return res.status(403).json({ error: 'user_suspended' });

    await pool.query(
      `UPDATE users SET email_normalized = $1 WHERE id = $2 AND email_normalized IS NULL`,
      [normalized, user.id]
    );

    const session = await createSession({ userId: user.id });
    const accessToken = issueAccessToken({ userId: user.id, jti: session.jti });

    logger.audit('user_login', { user_id: user.id });

    res.json({
      // G-02 (v2.20): mismo shape de user que register — quien se loguea (no
      // registra) también conoce su nombre/payme_id sin round-trip extra.
      user: {
        id: user.id, payme_id: user.payme_id, email: user.email,
        first_name: user.first_name, last_name: user.last_name,
      },
      access_token: accessToken,
      refresh_token: session.rawRefresh,
      expires_in: JWT_TTL_SECONDS,
    });
  } catch (err) { next(err); }
});

// ─── POST /refresh (v2.5.2 P2 #10: rotación + reuse detection) ──
router.post('/refresh', validateBody(schemas.refreshToken), async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    const incomingHash = tokenHash(refresh_token);
    const outcome = await pool.tx(async (client) => {
      // FOR UPDATE serializa tanto la rotación como la clasificación del token
      // previo. refresh_rotated_at solo cambia al rotar, nunca por tráfico normal.
      const { rows } = await client.query(
        `SELECT id, user_id, jti, status, expires_at, refresh_token_hash,
                prev_refresh_token_hash, refresh_rotated_at
           FROM user_sessions
          WHERE refresh_token_hash = $1 OR prev_refresh_token_hash = $1
          ORDER BY CASE WHEN refresh_token_hash = $1 THEN 0 ELSE 1 END
          LIMIT 1 FOR UPDATE`, [incomingHash]
      );
      const session = rows[0];
      if (!session || session.status !== 'active' || new Date(session.expires_at) <= new Date() ||
          !session.user_id || !session.jti) {
        return { kind: 'invalid' };
      }

      if (session.refresh_token_hash !== incomingHash) {
        const { rows: graceRows } = await client.query(
          `SELECT refresh_rotated_at >= NOW() - ($2::int * INTERVAL '1 second') AS within_grace
             FROM user_sessions WHERE id = $1`, [session.id, REFRESH_CONCURRENT_GRACE_SECONDS]
        );
        if (graceRows[0]?.within_grace) return { kind: 'concurrent' };
        await client.query(
          `UPDATE user_sessions SET status='revoked', revoked_at=NOW(),
             revoked_reason='refresh_reuse_detected' WHERE id=$1 AND status='active'`, [session.id]
        );
        return { kind: 'reuse', session };
      }

      const newRawRefresh = generateToken(32);
      const newRefreshHash = tokenHash(newRawRefresh);
      // Firmar antes de consumir el token evita perderlo si la firma/config falla.
      const accessToken = issueAccessToken({ userId: session.user_id, jti: session.jti });
      const { rowCount } = await client.query(
        `UPDATE user_sessions
            SET prev_refresh_token_hash=refresh_token_hash, refresh_token_hash=$2,
                refresh_rotated_at=NOW(), last_seen_at=NOW()
          WHERE id=$1 AND refresh_token_hash=$3 AND status='active' AND jti=$4`,
        [session.id, newRefreshHash, incomingHash, session.jti]
      );
      if (rowCount !== 1) return { kind: 'invalid' };
      return { kind: 'rotated', session, accessToken, newRawRefresh };
    });

    if (outcome.kind === 'concurrent') {
      return res.status(409).json({ error: 'refresh_in_progress' });
    }
    if (outcome.kind === 'reuse') {
      logger.warn('refresh_reuse_detected', { session_id: outcome.session.id, user_id: outcome.session.user_id });
      return res.status(401).json({ error: 'refresh_reuse_detected' });
    }
    if (outcome.kind !== 'rotated') return res.status(401).json({ error: 'invalid_refresh_token' });

    logger.audit('token_refreshed', { session_id: outcome.session.id, user_id: outcome.session.user_id });

    res.json({
      access_token: outcome.accessToken,
      refresh_token: outcome.newRawRefresh,
      expires_in: JWT_TTL_SECONDS,
    });
  } catch (err) { next(err); }
});

// ─── POST /logout ──────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'auth_required' });
    }
    const token = header.slice(7);

    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
    catch (_) { return res.status(401).json({ error: 'invalid_token' }); }

    // Conserva compatibilidad con tokens viejos sin claims, pero no permite que
    // un token que sí declara issuer/audience ajenos revoque una sesión válida.
    if ((payload.iss && payload.iss !== JWT_ISS) || (payload.aud && payload.aud !== JWT_AUD)) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    if (!payload.jti && !payload.session_id) {
      return res.json({ revoked: false, reason: 'legacy_token_no_session' });
    }

    const subject = payload.sub || payload.user_id;
    if (!subject) return res.status(401).json({ error: 'invalid_token' });

    // Usa la misma resolución fail-closed que requireAuth. Esto conserva los
    // tokens legacy cuyo session_id era el UUID de la fila (o su jti), liga la
    // sesión al sujeto y rechaza claims jti/session_id contradictorios.
    const session = await loadActiveSession({
      jti: payload.jti,
      sessionId: payload.session_id,
    });
    if (!session || session.user_id !== subject) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    const { rowCount } = await pool.query(
      `UPDATE user_sessions
          SET status='revoked', revoked_at=NOW(),
              revoked_reason = COALESCE(revoked_reason, 'user_logout')
        WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [session.id, subject]
    );

    logger.audit('user_logout', {
      user_id: subject, session_id: session.id, revoked: rowCount > 0,
    });

    res.json({ revoked: rowCount > 0 });
  } catch (err) { next(err); }
});

module.exports = router;
