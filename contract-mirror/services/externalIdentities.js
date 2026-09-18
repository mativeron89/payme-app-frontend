/** Identidades externas neutrales: nunca autoridad por email del proveedor. */
'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { generatePaymeId } = require('../utils/userId');
const { normalizarEmailDeContrato } = require('../schemas');
const signupInvitations = require('./signupInvitations');
const paymeSessions = require('./paymeSessions');

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

module.exports = {
  registerWithExternalIdentity,
  loginWithExternalIdentity,
  linkExternalIdentity,
  proveedoresVinculados,
  PROVEEDORES_PUBLICABLES,
  consumeCredential,
};
