/**
 * D-HOLD-1 · rate limit durable de POST /auth/register.
 *
 * Privacidad y cardinalidad por construcción:
 *   - NO guarda IP, email, user-agent ni token crudo/digest individual;
 *   - cada autoridad cae por HMAC en uno de 64 shards FIJOS;
 *   - una segunda clave es el contador global sin identidad;
 *   - la tabla puede contener como máximo 65 claves del runtime v1.
 *
 * El MemoryStore por IP de server.js sigue como barrera barata. Éste cierra el
 * reinicio/múltiples réplicas y falla 503 si PostgreSQL no puede acreditar el
 * límite antes del bcrypt o de cualquier escritura de alta.
 */
'use strict';

const { createHmac } = require('node:crypto');
const { tokenHash } = require('../utils/tokens');
const logger = require('../utils/logger');

const SHARD_COUNT = 64;
const PG_INT_MAX_CONFIG = 2_147_483_646;
const SCOPES = Object.freeze({
  GLOBAL: 'signup-global-v1',
  SHARD: 'signup-shard-v1',
});
const GLOBAL_DIGEST = tokenHash('payme/signup-rate-limit/global/v1');
const MALFORMED = 'payme/signup-rate-limit/malformed/v1';

function positivePgInt(name, fallback, env) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be an integer between 1 and ${PG_INT_MAX_CONFIG}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > PG_INT_MAX_CONFIG) {
    throw new Error(`${name} must be an integer between 1 and ${PG_INT_MAX_CONFIG}`);
  }
  return value;
}

function signupRateLimitConfig(env = process.env) {
  return Object.freeze({
    windowMs: positivePgInt('RATE_LIMIT_SIGNUP_WINDOW_MS', 60_000, env),
    shardMax: positivePgInt('RATE_LIMIT_SIGNUP_SHARD_MAX', 10, env),
    globalMax: positivePgInt('RATE_LIMIT_SIGNUP_GLOBAL_MAX', 120, env),
  });
}

function canonicalToken(raw) {
  return typeof raw === 'string' && raw.length >= 20 && raw.length <= 200
    ? raw
    : MALFORMED;
}

function tokenShardForSignup(raw, secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('signup_rate_limit_secret_invalid');
  }
  const mac = createHmac('sha256', secret)
    .update('payme/signup-rate-limit/shard/v1\0')
    .update(canonicalToken(raw))
    .digest();
  return mac.readUInt16BE(0) % SHARD_COUNT;
}

function shardDigest(shard) {
  return tokenHash(`payme/signup-rate-limit/shard/v1:${shard}`);
}

/**
 * Consume dos buckets en UNA sentencia. PostgreSQL serializa cada upsert sobre
 * su PK; ordenar las claves fija el orden entre procesos y evita deadlocks.
 * El máximo de configuración queda uno debajo de la saturación, por lo que un
 * contador saturado siempre es bloqueante.
 */
async function consumeSignupRateLimit({
  db,
  token,
  config = signupRateLimitConfig(),
  secret = process.env.JWT_SECRET,
}) {
  const shard = tokenShardForSignup(token, secret);
  const buckets = [
    { scope: SCOPES.GLOBAL, digest: GLOBAL_DIGEST, maximum: config.globalMax },
    { scope: SCOPES.SHARD, digest: shardDigest(shard), maximum: config.shardMax },
  ].sort((a, b) => `${a.scope}:${a.digest}`.localeCompare(`${b.scope}:${b.digest}`));

  const { rows } = await db.query(
    `WITH requested AS (
       SELECT * FROM unnest($1::varchar(64)[], $2::char(64)[], $3::integer[])
         AS b(scope,key_digest,maximum)
     ), consumed AS (
       INSERT INTO signup_rate_limit_counters
         (scope,key_digest,hits,reset_at,updated_at)
       SELECT scope,key_digest,1,
              statement_timestamp() + ($4::bigint * INTERVAL '1 millisecond'),
              statement_timestamp()
         FROM requested
        ORDER BY scope,key_digest
       ON CONFLICT (scope,key_digest) DO UPDATE
         SET hits = CASE
               WHEN signup_rate_limit_counters.reset_at <= statement_timestamp() THEN 1
               ELSE LEAST(signup_rate_limit_counters.hits::bigint + 1, 2147483647)::integer
             END,
             reset_at = CASE
               WHEN signup_rate_limit_counters.reset_at <= statement_timestamp()
                 THEN statement_timestamp() + ($4::bigint * INTERVAL '1 millisecond')
               ELSE signup_rate_limit_counters.reset_at
             END,
             updated_at = statement_timestamp()
       RETURNING scope,key_digest,hits,reset_at
     )
     SELECT c.scope,c.hits,c.reset_at,r.maximum
       FROM consumed c
       JOIN requested r USING (scope,key_digest)
      ORDER BY c.scope`,
    [
      buckets.map((b) => b.scope),
      buckets.map((b) => b.digest),
      buckets.map((b) => b.maximum),
      config.windowMs,
    ]
  );
  if (rows.length !== buckets.length) {
    throw new Error('signup_rate_limit_incomplete_consumption');
  }
  const exceeded = rows.filter((row) => row.hits > row.maximum);
  const retryAt = exceeded.reduce((latest, row) => {
    const ms = new Date(row.reset_at).getTime();
    return Number.isFinite(ms) ? Math.max(latest, ms) : latest;
  }, 0);
  return {
    allowed: exceeded.length === 0,
    retryAt: exceeded.length ? retryAt : null,
  };
}

function signupRateLimitMiddleware({ db, env = process.env } = {}) {
  if (!db || typeof db.query !== 'function') {
    throw new Error('signup_rate_limit_db_required');
  }
  const config = signupRateLimitConfig(env);
  const secret = env.JWT_SECRET;
  return async function durableSignupRateLimit(req, res, next) {
    try {
      const outcome = await consumeSignupRateLimit({
        db,
        token: req.body?.invitation_token,
        config,
        secret,
      });
      if (!outcome.allowed) {
        const seconds = Math.max(1, Math.ceil((outcome.retryAt - Date.now()) / 1_000));
        res.setHeader('Retry-After', seconds);
        return res.status(429).json({ error: 'too_many_signup_attempts' });
      }
    } catch (err) {
      logger.error('signup_rate_limit_unavailable', {
        code: err.code,
        correlation_id: req.correlationId,
      });
      return res.status(503).json({ error: 'rate_limit_unavailable' });
    }
    return next();
  };
}

module.exports = {
  SHARD_COUNT,
  PG_INT_MAX_CONFIG,
  SCOPES,
  signupRateLimitConfig,
  tokenShardForSignup,
  shardDigest,
  consumeSignupRateLimit,
  signupRateLimitMiddleware,
};
