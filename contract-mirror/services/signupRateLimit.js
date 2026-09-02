/**
 * D-HOLD-1 · rate limit durable de POST /auth/register.
 *
 * Privacidad y cardinalidad por construcción:
 *   - NO guarda IP, email, user-agent ni token crudo/digest individual;
 *   - cada autoridad CON clave cae por HMAC en uno de 64 shards FIJOS;
 *   - una segunda clave es el contador global sin identidad;
 *   - una tercera, reservada, es el bucket de los requests SIN clave;
 *   - la tabla puede contener como máximo 66 claves del runtime v1.
 *
 * 🔴 C2b · QUÉ LLAVEA CADA COSA, Y QUÉ PROTEGE.
 * Hasta C2 la única autoridad era la invitación, y todo lo que no fuera un
 * token bien formado caía en UNA constante compartida. Con el alta pública
 * abierta (`PUBLIC_SIGNUP_ENABLED`) eso dejó de ser inocuo: TODAS las altas sin
 * invitación compartían bucket, así que el alta pública quedaba capada en
 * `shardMax` por ventana para toda la plataforma y cualquiera podía saturarla
 * mandando basura en `invitation_token`. Ahora:
 *
 *   token válido (20..200)  → shard de la INVITACIÓN. Protege que un token no
 *                             se martille ni se reintente en masa.
 *   sin token (o malformado)→ shard del EMAIL normalizado. Protege que una
 *                             identidad no se martille, y separa a las altas
 *                             públicas entre sí.
 *   sin ninguno de los dos  → clave RESERVADA propia, FUERA de los 64 shards.
 *                             Sólo la alcanzan requests que no pueden crear
 *                             cuenta (el DTO las rechaza después).
 *
 * 🔴 Por qué la reservada no puede ser «una constante hasheada como las demás»:
 * si se la mete por el mismo `% 64`, cae EN uno de los 64 shards y comparte
 * bucket con ~1/64 de las altas legítimas —emails públicos e invitaciones—, así
 * que diez requests con el cuerpo vacío dejan en 429 a esa fracción durante la
 * ventana. Lo midió la revisión diferencial de C2b sobre la primera versión de
 * este archivo, que decía «bucket propio» y no lo era.
 *
 * ⚠️ Lo que esto NO hace, dicho sin adornos: el email lo elige quien llama, así
 * que la clave sigue siendo elegible —sin IP ni señal del cliente no existe una
 * que no lo sea—. Lo que cambia es que ya NO hay una clave compartida por toda
 * la puerta pública. El radio que queda:
 *   · saturar la clave de una VÍCTIMA cuyo email se conozca la deja en 429
 *     durante la ventana (10 intentos / 60 s por defecto), y de paso a los
 *     emails que caen en su mismo shard: es daño a un tercero elegido, no
 *     autolesión;
 *   · el contador GLOBAL (`globalMax`, 120/min) sigue siendo el techo de
 *     plataforma y esta orden no lo relaja. Lo alcanza incluso un atacante de
 *     UNA sola fuente con emails al azar: la clave durable no tiene dimensión
 *     de IP, y el limiter por IP de server.js es en memoria y por réplica.
 *   · la capa de shards no protege por sí sola: si alguien sube `globalMax`,
 *     640 requests/min de basura saturan los 64.
 * Todo eso está declarado como riesgo aceptado en CHANGELOG_v2.83.0.md.
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
const SIN_CLAVE = 'payme/signup-rate-limit/sin-clave/v1';
const SIN_CLAVE_DIGEST = tokenHash(SIN_CLAVE);

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

/**
 * Email en forma canónica para llavear. Deliberadamente NO valida formato: el
 * limiter corre antes del DTO y su trabajo es contar, no decidir si el alta es
 * válida. Exceder el largo NO se recorta —un techo que recorta acepta una clave
 * que nadie mandó—: se descarta y cae a la clave reservada.
 *
 * 🔴 El techo es el MISMO que acepta el DTO (`z.string().email().max(255)` en
 * schemas/index.js) y el mismo que admite `users.email VARCHAR(255)`. No es
 * cosmético: con 254 acá, un email de exactamente 255 caracteres —que el alta
 * ACEPTA y crea— caía en la clave reservada, y esa clase de altas volvía a
 * compartir un solo bucket. Lo encontró la revisión diferencial de C2b. Si
 * alguien baja el DTO a los 254 de RFC 5321, este número baja con él.
 */
const LARGO_MAXIMO_EMAIL = 255;

function emailParaShard(raw) {
  if (typeof raw !== 'string') return null;
  const canonico = raw.trim().toLowerCase();
  if (!canonico || canonico.length > LARGO_MAXIMO_EMAIL) return null;
  return canonico;
}

/**
 * La clave de la que sale el shard. Los dos espacios llevan dominio propio, de
 * forma que un email con forma de token no puede fabricar la clave de una
 * invitación ajena ni al revés.
 */
function claveDeAlta({ token, email } = {}) {
  const invitacion = typeof token === 'string' && token.length >= 20 && token.length <= 200
    ? token
    : null;
  if (invitacion) return `invitacion\0${invitacion}`;
  const correo = emailParaShard(email);
  if (correo) return `alta\0${correo}`;
  return SIN_CLAVE;
}

/** Shard de una autoridad CON clave; `null` cuando no hay ninguna. */
function shardParaAlta(autoridad, secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('signup_rate_limit_secret_invalid');
  }
  const clave = claveDeAlta(autoridad);
  if (clave === SIN_CLAVE) return null;
  const mac = createHmac('sha256', secret)
    .update('payme/signup-rate-limit/shard/v1\0')
    .update(clave)
    .digest();
  return mac.readUInt16BE(0) % SHARD_COUNT;
}

/** Bucket que consume una autoridad: uno de los 64, o la clave reservada. */
function digestDeAlta(autoridad, secret) {
  const shard = shardParaAlta(autoridad, secret);
  return shard === null ? SIN_CLAVE_DIGEST : shardDigest(shard);
}

/** Compatibilidad: el shard de una invitación suelta. */
function tokenShardForSignup(raw, secret) {
  return shardParaAlta({ token: raw }, secret);
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
  email,
  config = signupRateLimitConfig(),
  secret = process.env.JWT_SECRET,
}) {
  const buckets = [
    { scope: SCOPES.GLOBAL, digest: GLOBAL_DIGEST, maximum: config.globalMax },
    {
      scope: SCOPES.SHARD,
      digest: digestDeAlta({ token, email }, secret),
      maximum: config.shardMax,
    },
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
        // C2b · sin invitación, la identidad que se limita es el email
        // declarado. El cuerpo ya está parseado acá: el limiter se monta
        // después de express.json y antes del handler, en los dos caminos.
        email: req.body?.email,
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
  shardParaAlta,
  digestDeAlta,
  claveDeAlta,
  SIN_CLAVE_DIGEST,
  LARGO_MAXIMO_EMAIL,
  shardDigest,
  consumeSignupRateLimit,
  signupRateLimitMiddleware,
};
