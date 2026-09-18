/** Identidades externas neutrales: nunca autoridad por email del proveedor. */
'use strict';

const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { generatePaymeId } = require('../utils/userId');
const { normalizarEmailDeContrato } = require('../schemas');
const signupInvitations = require('./signupInvitations');
const paymeSessions = require('./paymeSessions');
const legal = require('./legal');
const { tokenHash } = require('../utils/tokens');
const { normalizarNombre } = require('../utils/profileNames');

function codedError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

/** Proveedores que pueden dar de alta una cuenta; espejan el CHECK de users.signup_method. */
const METODOS_DE_ALTA_SOCIAL = new Set(['google', 'facebook']);

function registrationUnavailable() {
  return codedError('registration_not_available', 403);
}

function authFailed() {
  return codedError('social_auth_failed', 401);
}

async function assertSubjectAllowed(client, evidence) {
  if (!evidence.subject_control_digest) return;
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
    [evidence.subject_control_digest]
  );
  const { rowCount } = await client.query(
    `SELECT 1 FROM external_identity_subject_controls
      WHERE provider=$1 AND subject_namespace=$2 AND subject_digest=$3`,
    [evidence.provider, evidence.subject_namespace, evidence.subject_control_digest]
  );
  if (rowCount !== 0) throw authFailed();
}

async function consumeCredential(client, evidence, purpose) {
  const { rowCount } = await client.query(
    `INSERT INTO external_auth_credentials
       (provider,credential_hash,purpose,expires_at,consumed_at)
     SELECT $1,$2,$3,$4,NOW()
      WHERE $4 > NOW()
     ON CONFLICT (provider,credential_hash) DO NOTHING`,
    [evidence.provider, evidence.credential_hash, purpose, evidence.credential_expires_at]
  );
  if (rowCount !== 1) throw authFailed();
}

async function insertBinding(client, { userId, evidence }) {
  await client.query(
    `INSERT INTO external_identity_bindings
       (user_id,provider,subject_namespace,subject,status)
     VALUES ($1,$2,$3,$4,'active')`,
    [userId, evidence.provider, evidence.subject_namespace, evidence.subject]
  );
}

/**
 * C2 · el email de la cuenta social tiene UNA autoridad por modo, nunca el
 * proveedor: con invitación manda la invitación (y un `email` del cuerpo que
 * no coincida es el mismo 403 opaco); sin invitación —sólo posible con el alta
 * pública abierta— manda el `email` del cuerpo, con el mismo parser que el alta
 * directa y el mismo estatus: sin verificar, que es lo ratificado. Sin ninguna
 * de las dos fuentes no hay de dónde sacarlo, y se falla cerrado.
 */
function emailDeLaCuenta(invitation, email) {
  if (invitation) {
    if (email !== undefined && normalizarEmailDeContrato(email) !== invitation.email_normalized) {
      throw registrationUnavailable();
    }
    return invitation.email_normalized;
  }
  const normalized = normalizarEmailDeContrato(email);
  if (!normalized) throw registrationUnavailable();
  return normalized;
}

async function registerWithExternalIdentity({
  invitationToken, invitationTokenHash, evidence, firstName, lastName, birthDate, email,
}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const paymeId = await generatePaymeId(firstName, lastName);
    try {
      return await pool.tx(async (client) => {
        // C2 · misma puerta única que el alta directa (Google usa el mismo gate).
        const invitation = await signupInvitations.autoridadDeAlta(client, {
          token: invitationToken, tokenHashValue: invitationTokenHash,
        });
        const accountEmail = emailDeLaCuenta(invitation, email);
        await assertSubjectAllowed(client, evidence);
        await consumeCredential(client, evidence, 'register');
        // v2.82.0 · `signup_method` = el proveedor con el que la cuenta NACE.
        // Se escribe en el INSERT y falla cerrado si el proveedor no es uno de
        // los métodos de alta social conocidos: la base lo rechaza por CHECK y
        // acá se rechaza antes, sin crear la fila.
        if (!METODOS_DE_ALTA_SOCIAL.has(evidence.provider)) throw registrationUnavailable();
        const { rows: [user] } = await client.query(
          `INSERT INTO users
             (payme_id,email,email_normalized,phone,password_hash,
              first_name,last_name,birth_date,signup_method)
           VALUES ($1,$2,$2,NULL,NULL,$3,$4,$5,$6)
           RETURNING id,payme_id,email,first_name,last_name`,
          [paymeId, accountEmail, firstName, lastName, birthDate ?? null,
            evidence.provider]
        );
        await insertBinding(client, { userId: user.id, evidence });
        const session = await paymeSessions.createSession({ userId: user.id, client });
        if (invitation) {
          await signupInvitations.marcarConsumida(client, {
            invitationId: invitation.id,
            userId: user.id,
          });
        }
        // Firma antes del COMMIT: una configuración JWT inválida no deja una
        // cuenta creada sin la respuesta que acredita su sesión.
        return paymeSessions.sessionResponse(user, session);
      });
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'users_payme_id_key' && attempt < 9) {
        continue;
      }
      if (error.code === 'registration_not_available') throw error;
      if (error.code === 'social_auth_failed') throw registrationUnavailable();
      if (error.code === '23505' || error.code === '23514') throw registrationUnavailable();
      throw error;
    }
  }
  throw registrationUnavailable();
}

async function loginWithExternalIdentity(evidence) {
  try {
    const response = await pool.tx(async (client) => {
      await assertSubjectAllowed(client, evidence);
      await consumeCredential(client, evidence, 'login');
      const { rows } = await client.query(
        `SELECT u.id,u.payme_id,u.email,u.first_name,u.last_name,u.status
           FROM external_identity_bindings b
           JOIN users u ON u.id=b.user_id
          WHERE b.provider=$1 AND b.subject_namespace=$2 AND b.subject=$3
            AND b.status='active'
          FOR UPDATE OF b,u`,
        [evidence.provider, evidence.subject_namespace, evidence.subject]
      );
      const user = rows.length === 1 && rows[0].status === 'active' ? rows[0] : null;
      // El digest anti-replay sí confirma aun cuando no haya binding. No hay
      // escritura de cuenta/sesión, pero el mismo bearer no puede martillar el
      // lookup indefinidamente ni volverse válido después por una carrera.
      if (!user) return null;
      delete user.status;
      const session = await paymeSessions.createSession({ userId: user.id, client });
      return paymeSessions.sessionResponse(user, session);
    });
    if (!response) throw authFailed();
    return response;
  } catch (error) {
    if (error.code === 'social_auth_failed') throw error;
    if (error.code === '23505' || error.code === '23514') throw authFailed();
    throw error;
  }
}

/**
 * v2.91.0 · APP-LINKED-PROVIDERS-AB-05 · vocabulario CERRADO de proveedores
 * que el dueño publica al cliente como "vinculados a tu cuenta". Un proveedor
 * que no esté acá no se publica aunque exista una fila: el cliente espeja este
 * conjunto y no tiene que interpretar nombres que no conoce.
 */
const PROVEEDORES_PUBLICABLES = Object.freeze(['facebook', 'google']);

/**
 * Proveedores con binding ACTIVO de la cuenta `userId`, y nada más.
 *
 * Sólo el NOMBRE del proveedor: ni `subject`, ni namespace, ni fechas, ni
 * email del proveedor. El filtro por `user_id` es la única frontera entre "mis
 * identidades" y "las de otro": sin él, esta lectura sería un oráculo de
 * vinculaciones ajenas (lo fija un test con dos usuarios y su mutante).
 */
async function proveedoresVinculados(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT DISTINCT provider FROM external_identity_bindings
      WHERE user_id=$1 AND status='active'`,
    [userId]
  );
  const activos = new Set(rows.map((r) => r.provider));
  return PROVEEDORES_PUBLICABLES.filter((p) => activos.has(p));
}

async function linkExternalIdentity({ userId, currentPassword, evidence }) {
  const { rows } = await pool.query(
    `SELECT password_hash,status FROM users WHERE id=$1`, [userId]
  );
  const snapshot = rows.length === 1 ? rows[0] : null;
  const validPassword = snapshot?.password_hash
    ? await bcrypt.compare(currentPassword, snapshot.password_hash)
    : false;
  if (!snapshot || snapshot.status !== 'active' || !validPassword) {
    throw codedError('reauthentication_failed', 403);
  }
  try {
    return await pool.tx(async (client) => {
      const { rows: locked } = await client.query(
        `SELECT password_hash,status FROM users WHERE id=$1 FOR UPDATE`, [userId]
      );
      if (locked.length !== 1 || locked[0].status !== 'active'
          || locked[0].password_hash !== snapshot.password_hash) {
        throw codedError('reauthentication_failed', 403);
      }
      await assertSubjectAllowed(client, evidence);
      // La credencial se consume SIEMPRE, también en el camino idempotente: un
      // id_token ya usado sigue siendo 401 aunque el binding sea propio.
      await consumeCredential(client, evidence, 'link');
      // v2.91.0 · idempotencia sólo para el MISMO usuario. ON CONFLICT DO
      // NOTHING cubre las dos unicidades (subject tomado; usuario que ya tiene
      // otro subject de este proveedor) y, ante un INSERT concurrente, espera
      // su COMMIT. Después se lee el binding de ESTE subject: si es activo y de
      // este usuario, la respuesta es la misma vinculación ya hecha; cualquier
      // otro caso —de otra cuenta, revocado, u otro subject propio— conserva
      // el social_auth_failed opaco de siempre, sin escribir nada.
      const { rowCount } = await client.query(
        `INSERT INTO external_identity_bindings
           (user_id,provider,subject_namespace,subject,status)
         VALUES ($1,$2,$3,$4,'active')
         ON CONFLICT DO NOTHING`,
        [userId, evidence.provider, evidence.subject_namespace, evidence.subject]
      );
      if (rowCount === 1) {
        return { linked: true, provider: evidence.provider, already_linked: false };
      }
      const { rows: existing } = await client.query(
        `SELECT user_id,status FROM external_identity_bindings
          WHERE provider=$1 AND subject_namespace=$2 AND subject=$3`,
        [evidence.provider, evidence.subject_namespace, evidence.subject]
      );
      const propio = existing.length === 1
        && existing[0].user_id === userId
        && existing[0].status === 'active';
      if (!propio) throw authFailed();
      return { linked: true, provider: evidence.provider, already_linked: true };
    });
  } catch (error) {
    if (error.code === 'reauthentication_failed') throw error;
    if (error.code === '23505' || error.code === '23514'
        || error.code === 'social_auth_failed') throw authFailed();
    throw error;
  }
}

/*
 * ─── v2.92.0 · «Continuar con Google» en un toque ──────────────────────────
 * APP-GOOGLE-CONTINUE-AB-07 · raíz v2.43 (enmienda acotada a la guarda 8 del
 * acta de identidad social del 26/08). Una verificación y un consumo de la
 * credencial por pedido, dentro de UNA transacción:
 *   · vínculo activo            → sesión (200, created:false);
 *   · sin vínculo, alta posible → cuenta nueva con nombre y correo VERIFICADO
 *                                 del proveedor copiados UNA vez (201);
 *   · correo ya registrado      → registration_not_available opaco: nunca se
 *                                 vincula ni se fusiona por email;
 *   · sin vínculo ni alta       → el mismo social_auth_failed 401 de login.
 * Los rechazos que ocurren DESPUÉS del consumo se devuelven como resultado, no
 * se lanzan: así la transacción confirma el consumo y el mismo id_token no
 * vuelve a servir. Lo que falla ANTES (subject bloqueado, credencial ya usada)
 * se lanza y no deja nada, igual que login.
 */
const CONTINUE_FALLA_LOGIN = Object.freeze({ status: 401, body: { error: 'social_auth_failed' } });
const CONTINUE_FALLA_ALTA = Object.freeze({ status: 403, body: { error: 'registration_not_available' } });
const CONTINUE_CANAL = 'google_continue';
/** Addendum 1 · vida y tope de errores del intento de conexión por contraseña. */
const LINK_INTENT_TTL_SECONDS = 600;
const LINK_INTENT_MAX_FAILED = 5;
const AVISO = 'aviso_privacidad';

function normalizarONull(value) {
  if (typeof value !== 'string') return null;
  try { return normalizarNombre(value); } catch { return null; }
}

/**
 * Nombre y apellido de la cuenta nueva, en este orden de fuentes:
 *   1. given_name + family_name del proveedor, los dos válidos;
 *   2. `name` del proveedor partido en el ÚLTIMO espacio (necesita dos partes);
 *   3. first_name + last_name declarados por la persona en un reintento.
 * Sin ninguna fuente utilizable → null, y la respuesta es `profile_required`.
 */
function nombresParaAlta(profile, declared) {
  const given = normalizarONull(profile.given_name);
  const family = normalizarONull(profile.family_name);
  if (given && family) return { firstName: given, lastName: family };
  const full = normalizarONull(profile.name);
  if (full) {
    const corte = full.lastIndexOf(' ');
    if (corte > 0) {
      const first = normalizarONull(full.slice(0, corte));
      const last = normalizarONull(full.slice(corte + 1));
      if (first && last) return { firstName: first, lastName: last };
    }
  }
  const dFirst = normalizarONull(declared.firstName);
  const dLast = normalizarONull(declared.lastName);
  if (dFirst && dLast) return { firstName: dFirst, lastName: dLast };
  return null;
}

async function crearCuentaDesdeContinue(client, { evidence, email, nombres, invitation, vigente }) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const paymeId = await generatePaymeId(nombres.firstName, nombres.lastName);
    await client.query('SAVEPOINT continue_alta');
    try {
      const { rows: [user] } = await client.query(
        `INSERT INTO users
           (payme_id,email,email_normalized,phone,password_hash,
            first_name,last_name,birth_date,signup_method)
         VALUES ($1,$2,$2,NULL,NULL,$3,$4,NULL,$5)
         RETURNING id,payme_id,email,first_name,last_name`,
        [paymeId, email, nombres.firstName, nombres.lastName, evidence.provider]
      );
      await client.query('RELEASE SAVEPOINT continue_alta');
      await insertBinding(client, { userId: user.id, evidence });
      await client.query(
        `INSERT INTO signup_notice_acceptances
           (user_id,notice_kind,notice_version,notice_hash,channel)
         VALUES ($1,$2,$3,$4,$5)`,
        [user.id, vigente.kind, vigente.version, vigente.hash, CONTINUE_CANAL]
      );
      if (invitation) {
        await signupInvitations.marcarConsumida(client, {
          invitationId: invitation.id,
          userId: user.id,
        });
      }
      const session = await paymeSessions.createSession({ userId: user.id, client });
      return { user, session };
    } catch (error) {
      if (error.code === '23505' && error.constraint === 'users_payme_id_key' && attempt < 9) {
        await client.query('ROLLBACK TO SAVEPOINT continue_alta');
        continue;
      }
      if (error.code === '23505' && /email/.test(error.constraint || '')) {
        // Carrera con otra alta del mismo correo: opaco, sin vincular.
        await client.query('ROLLBACK TO SAVEPOINT continue_alta');
        return null;
      }
      throw error;
    }
  }
  return null;
}

async function continueWithExternalIdentity({
  evidence,
  profile,
  invitationToken,
  acceptedNoticeVersion,
  declaredFirstName,
  declaredLastName,
  registrationAvailable,
  linkingAvailable,
  consumeSignupRateLimit,
}) {
  if (!METODOS_DE_ALTA_SOCIAL.has(evidence.provider)) throw authFailed();
  try {
    return await pool.tx(async (client) => {
      // Dos «continuar» simultáneos con la misma identidad se serializan acá:
      // el segundo espera, ve el binding del primero y entra como login.
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
        [`external_identity:${evidence.provider}:${evidence.subject_namespace}:${evidence.subject}`]
      );
      await assertSubjectAllowed(client, evidence);
      const { rows } = await client.query(
        `SELECT u.id,u.payme_id,u.email,u.first_name,u.last_name,
                u.status AS user_status,b.status AS binding_status
           FROM external_identity_bindings b
           JOIN users u ON u.id=b.user_id
          WHERE b.provider=$1 AND b.subject_namespace=$2 AND b.subject=$3
          FOR UPDATE OF b,u`,
        [evidence.provider, evidence.subject_namespace, evidence.subject]
      );
      if (rows.length === 1) {
        await consumeCredential(client, evidence, 'login');
        const row = rows[0];
        if (row.binding_status !== 'active' || row.user_status !== 'active') {
          return { ...CONTINUE_FALLA_LOGIN, outcome: 'failed' };
        }
        const user = {
          id: row.id, payme_id: row.payme_id, email: row.email,
          first_name: row.first_name, last_name: row.last_name,
        };
        const session = await paymeSessions.createSession({ userId: user.id, client });
        return {
          status: 200,
          body: { ...paymeSessions.sessionResponse(user, session), created: false },
          outcome: 'login',
          userId: user.id,
        };
      }

      if (!registrationAvailable) {
        await consumeCredential(client, evidence, 'login');
        return { ...CONTINUE_FALLA_LOGIN, outcome: 'failed' };
      }
      let invitation;
      try {
        invitation = await signupInvitations.autoridadDeAlta(client, { token: invitationToken });
      } catch (error) {
        if (error.code !== 'registration_not_available') throw error;
        // Sin autoridad de alta (cerrada y sin invitación válida) es, para esta
        // persona, lo mismo que alta no habilitada: el 401 de login.
        await consumeCredential(client, evidence, 'login');
        return { ...CONTINUE_FALLA_LOGIN, outcome: 'failed' };
      }

      await consumeCredential(client, evidence, 'register');
      const publicacion = await legal.getRequiredPublicationStatus({ client });
      if (!publicacion.ready) {
        return { status: 503, body: { error: 'registration_unavailable' }, outcome: 'failed' };
      }
      const vigente = await legal.getVigente(AVISO, client);
      if (!vigente || vigente.version !== acceptedNoticeVersion) {
        return { ...CONTINUE_FALLA_ALTA, outcome: 'failed' };
      }
      const email = normalizarEmailDeContrato(profile.email);
      if (!email) return { ...CONTINUE_FALLA_ALTA, outcome: 'failed' };
      if (invitation && invitation.email_normalized !== email) {
        return { ...CONTINUE_FALLA_ALTA, outcome: 'failed' };
      }
      // El limitador va antes de mirar si el correo existe: cualquier respuesta
      // que dependa de eso queda acotada por correo.
      const limite = await consumeSignupRateLimit(client, { token: invitationToken, email });
      if (!limite.allowed) {
        return {
          status: 429, body: { error: 'too_many_signup_attempts' }, outcome: 'failed',
          retryAt: limite.retryAt,
        };
      }
      const { rows: destinos } = await client.query(
        `SELECT id,status,password_hash FROM users
          WHERE email_normalized=$1 OR lower(email)=$1 LIMIT 2`,
        [email]
      );
      // Copia única y conexión: las dos exigen un correo VERIFICADO. Sin él, la
      // existencia de una cuenta no se revela nunca.
      if (profile.email_verified !== true) return { ...CONTINUE_FALLA_ALTA, outcome: 'failed' };
      if (destinos.length > 0) {
        // Addendum 1 · decisión de Mati: correo ya registrado. Nunca se vincula
        // por email: se emite un intento que SÓLO la contraseña de esa cuenta
        // completa. Sin contraseña utilizable, cuenta inactiva, vinculación
        // apagada o correo ambiguo: el opaco de siempre.
        const destino = destinos.length === 1 ? destinos[0] : null;
        if (!linkingAvailable || !destino || destino.status !== 'active'
            || !destino.password_hash) {
          return { ...CONTINUE_FALLA_ALTA, outcome: 'failed' };
        }
        const linkIntent = randomBytes(32).toString('base64url');
        await client.query(
          `INSERT INTO google_continue_link_intents
             (intent_hash,user_id,provider,subject_namespace,subject,expires_at)
           VALUES ($1,$2,$3,$4,$5,NOW() + make_interval(secs => $6))`,
          [tokenHash(linkIntent), destino.id, evidence.provider,
            evidence.subject_namespace, evidence.subject, LINK_INTENT_TTL_SECONDS]
        );
        return {
          status: 409,
          body: { error: 'link_required', link_intent: linkIntent },
          outcome: 'link_required',
          userId: destino.id,
        };
      }
      const nombres = nombresParaAlta(profile, {
        firstName: declaredFirstName, lastName: declaredLastName,
      });
      if (!nombres) {
        return { status: 422, body: { error: 'profile_required' }, outcome: 'failed' };
      }

      const creada = await crearCuentaDesdeContinue(client, {
        evidence, email, nombres, invitation, vigente,
      });
      if (!creada) return { ...CONTINUE_FALLA_ALTA, outcome: 'failed' };
      return {
        status: 201,
        body: { ...paymeSessions.sessionResponse(creada.user, creada.session), created: true },
        outcome: 'created',
        userId: creada.user.id,
      };
    });
  } catch (error) {
    if (error.code === 'social_auth_failed') throw error;
    if (error.code === '23505' || error.code === '23514') throw authFailed();
    throw error;
  }
}

/**
 * Addendum 1 · `POST /api/auth/google/continue/link`. Completa el intento con
 * la contraseña de la cuenta destino. Serializado por la fila del intento:
 * dos pedidos con el mismo intento no pueden vincular dos veces.
 *   · intento inexistente, vencido o ya usado      → 401 social_auth_failed;
 *   · contraseña incorrecta                         → 403 reauthentication_failed,
 *     y el intento se quema al llegar a LINK_INTENT_MAX_FAILED errores;
 *   · contraseña correcta                           → vínculo + sesión (200).
 * El contador se confirma aun en el error: por eso no se lanza, se devuelve.
 */
async function linkFromContinueIntent({ linkIntent, password }) {
  const intentHash = tokenHash(linkIntent);
  try {
    return await pool.tx(async (client) => {
      const { rows: intents } = await client.query(
        `SELECT id,user_id,provider,subject_namespace,subject,failed_attempts
           FROM google_continue_link_intents
          WHERE intent_hash=$1 AND consumed_at IS NULL AND expires_at > NOW()
          FOR UPDATE`,
        [intentHash]
      );
      if (intents.length !== 1) return { ...CONTINUE_FALLA_LOGIN, outcome: 'failed' };
      const intent = intents[0];
      const { rows: users } = await client.query(
        `SELECT id,payme_id,email,first_name,last_name,status,password_hash
           FROM users WHERE id=$1 FOR UPDATE`,
        [intent.user_id]
      );
      const user = users.length === 1 ? users[0] : null;
      if (!user || user.status !== 'active' || !user.password_hash) {
        await client.query(
          `UPDATE google_continue_link_intents SET consumed_at=NOW() WHERE id=$1`, [intent.id]
        );
        return { ...CONTINUE_FALLA_LOGIN, outcome: 'failed' };
      }
      const valida = await bcrypt.compare(password, user.password_hash);
      if (!valida) {
        const fallidos = intent.failed_attempts + 1;
        await client.query(
          `UPDATE google_continue_link_intents
              SET failed_attempts=$2::int,
                  consumed_at=CASE WHEN $2::int >= $3::int THEN NOW() ELSE consumed_at END
            WHERE id=$1`,
          [intent.id, fallidos, LINK_INTENT_MAX_FAILED]
        );
        return {
          status: 403, body: { error: 'reauthentication_failed' }, outcome: 'failed',
        };
      }
      await client.query(
        `UPDATE google_continue_link_intents SET consumed_at=NOW() WHERE id=$1`, [intent.id]
      );
      const evidence = {
        provider: intent.provider,
        subject_namespace: intent.subject_namespace,
        subject: intent.subject,
      };
      await assertSubjectAllowed(client, evidence);
      const { rowCount } = await client.query(
        `INSERT INTO external_identity_bindings
           (user_id,provider,subject_namespace,subject,status)
         VALUES ($1,$2,$3,$4,'active')
         ON CONFLICT DO NOTHING`,
        [user.id, evidence.provider, evidence.subject_namespace, evidence.subject]
      );
      if (rowCount !== 1) {
        // Idempotente sólo si el subject ya es de ESTA cuenta y está activo.
        const { rows: existing } = await client.query(
          `SELECT user_id,status FROM external_identity_bindings
            WHERE provider=$1 AND subject_namespace=$2 AND subject=$3`,
          [evidence.provider, evidence.subject_namespace, evidence.subject]
        );
        if (!(existing.length === 1 && existing[0].user_id === user.id
              && existing[0].status === 'active')) {
          return { ...CONTINUE_FALLA_LOGIN, outcome: 'failed' };
        }
      }
      const publico = {
        id: user.id, payme_id: user.payme_id, email: user.email,
        first_name: user.first_name, last_name: user.last_name,
      };
      const session = await paymeSessions.createSession({ userId: user.id, client });
      return {
        status: 200,
        body: { ...paymeSessions.sessionResponse(publico, session), created: false, linked: true },
        outcome: 'linked',
        userId: user.id,
      };
    });
  } catch (error) {
    if (error.code === 'social_auth_failed') throw error;
    if (error.code === '23505' || error.code === '23514') throw authFailed();
    throw error;
  }
}

module.exports = {
  registerWithExternalIdentity,
  loginWithExternalIdentity,
  linkExternalIdentity,
  proveedoresVinculados,
  continueWithExternalIdentity,
  linkFromContinueIntent,
  LINK_INTENT_MAX_FAILED,
  nombresParaAlta,
  PROVEEDORES_PUBLICABLES,
  consumeCredential,
};
