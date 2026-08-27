/** Identidades externas neutrales: nunca autoridad por email del proveedor. */
'use strict';

const bcrypt = require('bcrypt');
const pool = require('../db/pool');
const { generatePaymeId } = require('../utils/userId');
const signupInvitations = require('./signupInvitations');
const paymeSessions = require('./paymeSessions');

function codedError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

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

async function registerWithExternalIdentity({
  invitationToken, invitationTokenHash, evidence, firstName, lastName, birthDate,
}) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const paymeId = await generatePaymeId(firstName, lastName);
    try {
      return await pool.tx(async (client) => {
        const invitation = invitationTokenHash
          ? await signupInvitations.bloquearInvitacionPorHash(client, {
            tokenHashValue: invitationTokenHash,
          })
          : await signupInvitations.bloquearInvitacionPorToken(client, {
            token: invitationToken,
          });
        if (!invitation) throw registrationUnavailable();
        await assertSubjectAllowed(client, evidence);
        await consumeCredential(client, evidence, 'register');
        const { rows: [user] } = await client.query(
          `INSERT INTO users
             (payme_id,email,email_normalized,phone,password_hash,
              first_name,last_name,birth_date)
           VALUES ($1,$2,$2,NULL,NULL,$3,$4,$5)
           RETURNING id,payme_id,email,first_name,last_name`,
          [paymeId, invitation.email_normalized, firstName, lastName, birthDate ?? null]
        );
        await insertBinding(client, { userId: user.id, evidence });
        const session = await paymeSessions.createSession({ userId: user.id, client });
        await signupInvitations.marcarConsumida(client, {
          invitationId: invitation.id,
          userId: user.id,
        });
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
      await consumeCredential(client, evidence, 'link');
      await insertBinding(client, { userId, evidence });
      return { linked: true, provider: evidence.provider };
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
  consumeCredential,
};
