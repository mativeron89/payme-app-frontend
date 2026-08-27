/** Callbacks Meta dark: signed_request, deauth recuperable y deletion honesta/durable. */
'use strict';

const { createHmac, timingSafeEqual } = require('crypto');
const pool = require('../db/pool');
const facebook = require('./facebookIdentity');
const { generateToken, tokenHash } = require('../utils/tokens');

function invalidRequest() {
  return Object.assign(new Error('facebook_callback_invalid'), {
    code: 'facebook_callback_invalid', status: 400,
  });
}

function decodeBase64UrlCanonical(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidRequest();
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw invalidRequest();
  return decoded;
}

function verifySignedRequest(raw, { env = process.env } = {}) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 8192) throw invalidRequest();
  const parts = raw.split('.');
  if (parts.length !== 2) throw invalidRequest();
  const config = facebook.configForCallbacks(env);
  const received = decodeBase64UrlCanonical(parts[0]);
  const expected = createHmac('sha256', config.appSecret).update(parts[1]).digest();
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw invalidRequest();
  }
  let payload;
  try {
    payload = JSON.parse(decodeBase64UrlCanonical(parts[1]).toString('utf8'));
  } catch (_) {
    throw invalidRequest();
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || payload.algorithm !== 'HMAC-SHA256'
      || typeof payload.user_id !== 'string'
      || !/^[A-Za-z0-9._:-]{1,255}$/.test(payload.user_id)) {
    throw invalidRequest();
  }
  return { config, subject: payload.user_id };
}

async function findBindingForUpdate(client, config, subject) {
  const { rows } = await client.query(
    `SELECT b.id AS binding_id,b.user_id,b.status AS binding_status,
            u.status AS user_status,u.password_hash
       FROM external_identity_bindings b
       JOIN users u ON u.id=b.user_id
      WHERE b.provider='facebook' AND b.subject_namespace=$1 AND b.subject=$2
      FOR UPDATE OF b,u`,
    [`facebook:${config.appId}`, subject]
  );
  return rows.length === 1 ? rows[0] : null;
}

async function recordSubjectControl(client, config, subject, status) {
  const control = facebook.subjectControl(config, subject);
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
    [control.subject_digest]
  );
  await client.query(
    `INSERT INTO external_identity_subject_controls
       (provider,subject_namespace,subject_digest,status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (provider,subject_namespace,subject_digest) DO UPDATE
       SET status=CASE
             WHEN external_identity_subject_controls.status='deletion_suppressed'
               THEN 'deletion_suppressed'
             ELSE EXCLUDED.status
           END,
           updated_at=NOW()`,
    [control.provider, control.subject_namespace, control.subject_digest, status]
  );
  return control;
}

async function revokeSessions(client, userId, reason) {
  await client.query(
    `UPDATE user_sessions
        SET status='revoked', revoked_at=NOW(),
            revoked_reason=COALESCE(revoked_reason,$2)
      WHERE user_id=$1 AND status='active'`,
    [userId, reason]
  );
}

async function suspendForRecovery(client, row) {
  const { rows: [methods] } = await client.query(
    `SELECT EXISTS(
       SELECT 1 FROM external_identity_bindings
        WHERE user_id=$1 AND status='active'
     ) AS has_binding`,
    [row.user_id]
  );
  if (row.user_status === 'deleted' || row.password_hash || methods.has_binding) return;
  await client.query(`UPDATE users SET status='suspended' WHERE id=$1`, [row.user_id]);
  await client.query(
    `INSERT INTO account_auth_suspensions
       (user_id,provider,reason,status,suspended_at,resolved_at,updated_at)
     VALUES ($1,'facebook','facebook_deauthorization','pending_recovery',NOW(),NULL,NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET provider='facebook', reason='facebook_deauthorization',
           status='pending_recovery', suspended_at=NOW(), resolved_at=NULL, updated_at=NOW()
       WHERE account_auth_suspensions.status <> 'pending_deletion'`,
    [row.user_id]
  );
}

async function deauthorize(signedRequest, options = {}) {
  const { config, subject } = verifySignedRequest(signedRequest, options);
  return pool.tx(async (client) => {
    await recordSubjectControl(client, config, subject, 'remote_revoked');
    const row = await findBindingForUpdate(client, config, subject);
    if (!row) return { accepted: true };
    if (row.binding_status !== 'active') return { accepted: true, userId: row.user_id };
    await client.query(
      `UPDATE external_identity_bindings
          SET status='revoked',revoked_at=NOW()
        WHERE id=$1`,
      [row.binding_id]
    );
    await revokeSessions(client, row.user_id, 'facebook_deauthorization');
    await suspendForRecovery(client, row);
    return { accepted: true, userId: row.user_id };
  });
}

async function requestDataDeletion(signedRequest, options = {}) {
  const { config, subject } = verifySignedRequest(signedRequest, options);
  const confirmationCode = generateToken(24);
  const confirmationHash = tokenHash(confirmationCode);

  const result = await pool.tx(async (client) => {
    const control = await recordSubjectControl(
      client, config, subject, 'deletion_suppressed'
    );
    const subjectHash = control.subject_digest;
    const row = await findBindingForUpdate(client, config, subject);
    if (!row) {
      const { rows: existing } = await client.query(
        `SELECT status
           FROM facebook_data_deletion_requests
          WHERE subject_hash=$1
          ORDER BY requested_at DESC,id DESC
          LIMIT 1
          FOR UPDATE`,
        [subjectHash]
      );
      if (existing.length === 1) {
        const status = existing[0].status;
        await client.query(
          `INSERT INTO facebook_data_deletion_requests
             (user_id,subject_hash,confirmation_hash,status,completed_at)
           VALUES (NULL,$1,$2,$3,$4)`,
          [
            subjectHash,
            confirmationHash,
            status,
            status === 'pending_quiescence' ? null : new Date(),
          ]
        );
        return {
          userId: null,
          status: status === 'pending_quiescence' ? 'pending' : 'completed',
        };
      }
      await client.query(
        `INSERT INTO facebook_data_deletion_requests
           (user_id,subject_hash,confirmation_hash,status,completed_at)
         VALUES (NULL,$1,$2,'completed_no_data',NOW())`,
        [subjectHash, confirmationHash]
      );
      return { userId: null, status: 'completed' };
    }

    await client.query(`DELETE FROM external_identity_bindings WHERE id=$1`, [row.binding_id]);
    await revokeSessions(client, row.user_id, 'facebook_data_deletion');
    await client.query(
      `UPDATE auth_recovery_tokens
          SET status='cancelled',cancelled_at=NOW()
        WHERE user_id=$1 AND status='issued'`,
      [row.user_id]
    );
    if (row.user_status !== 'deleted') {
      await client.query(`UPDATE users SET status='suspended' WHERE id=$1`, [row.user_id]);
      await client.query(
        `INSERT INTO account_auth_suspensions
           (user_id,provider,reason,status,suspended_at,resolved_at,updated_at)
         VALUES ($1,'facebook','facebook_data_deletion','pending_deletion',NOW(),NULL,NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET provider='facebook', reason='facebook_data_deletion',
               status='pending_deletion', suspended_at=NOW(), resolved_at=NULL, updated_at=NOW()`,
        [row.user_id]
      );
    }
    await client.query(
      `INSERT INTO facebook_data_deletion_requests
         (user_id,subject_hash,confirmation_hash,status)
       VALUES ($1,$2,$3,'pending_quiescence')`,
      [row.user_id, subjectHash, confirmationHash]
    );
    return { userId: row.user_id, status: 'pending' };
  });

  return {
    confirmation_code: confirmationCode,
    url: `${config.deletionStatusBaseUrl}${encodeURIComponent(confirmationCode)}`,
    status: result.status,
    userId: result.userId,
  };
}

async function deletionStatus(confirmationCode) {
  const digest = typeof confirmationCode === 'string'
    && confirmationCode.length >= 20 && confirmationCode.length <= 200
    ? tokenHash(confirmationCode) : '0'.repeat(64);
  const { rows } = await pool.query(
    `SELECT status FROM facebook_data_deletion_requests WHERE confirmation_hash=$1`,
    [digest]
  );
  if (rows.length !== 1) {
    throw Object.assign(new Error('not_found'), { code: 'not_found', status: 404 });
  }
  return {
    status: rows[0].status === 'pending_quiescence' ? 'pending' : 'completed',
  };
}

module.exports = {
  verifySignedRequest,
  deauthorize,
  requestDataDeletion,
  deletionStatus,
};
