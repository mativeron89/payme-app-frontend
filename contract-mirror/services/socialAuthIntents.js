/** Intents OAuth server-owned: state raw sale una vez; PostgreSQL sólo ve SHA-256. */
'use strict';

const pool = require('../db/pool');
const logger = require('../utils/logger');
const { generateToken, tokenHash } = require('../utils/tokens');

const TTL_SECONDS = 10 * 60;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const PURPOSES = new Set(['register', 'login']);
let cleanupInterval = null;

function unavailable() {
  return Object.assign(new Error('social_auth_failed'), {
    code: 'social_auth_failed', status: 401,
  });
}

function registrationContext(input) {
  if (!input || typeof input.invitationToken !== 'string'
      || input.invitationToken.length < 20 || input.invitationToken.length > 200
      || typeof input.firstName !== 'string' || !input.firstName.trim()
      || input.firstName.length > 100
      || typeof input.lastName !== 'string' || !input.lastName.trim()
      || input.lastName.length > 100) throw unavailable();
  return {
    invitationTokenHash: tokenHash(input.invitationToken),
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    birthDate: input.birthDate ?? null,
  };
}

async function cleanupExpiredIntents() {
  const { rowCount } = await pool.query(
    `UPDATE external_auth_intents
        SET status='consumed',consumed_at=NOW(),signup_invitation_token_hash=NULL,
            first_name=NULL,last_name=NULL,birth_date=NULL
      WHERE status='issued' AND expires_at <= NOW()`
  );
  return rowCount;
}

function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    cleanupExpiredIntents().catch((error) => {
      logger.error('social_auth_intent_cleanup_failed', { code: error.code });
    });
  }, CLEANUP_INTERVAL_MS);
  cleanupInterval.unref?.();
}

function stopCleanup() {
  if (cleanupInterval) clearInterval(cleanupInterval);
  cleanupInterval = null;
}

async function issueIntent({ provider, purpose, registration = null }) {
  if (provider !== 'facebook' || !PURPOSES.has(purpose)) throw unavailable();
  const context = purpose === 'register' ? registrationContext(registration) : null;
  const state = generateToken(32);
  const stateHash = tokenHash(state);
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
  await cleanupExpiredIntents();
  await pool.query(
    `INSERT INTO external_auth_intents
       (provider,state_hash,purpose,status,expires_at,
        signup_invitation_token_hash,first_name,last_name,birth_date)
     VALUES ($1,$2,$3,'issued',$4,$5,$6,$7,$8)`,
    [
      provider, stateHash, purpose, expiresAt,
      context?.invitationTokenHash ?? null,
      context?.firstName ?? null,
      context?.lastName ?? null,
      context?.birthDate ?? null,
    ]
  );
  return { state, expiresAt };
}

async function consumeIntent({ provider, purpose, state }) {
  if (provider !== 'facebook' || !PURPOSES.has(purpose)
      || typeof state !== 'string' || state.length < 20 || state.length > 200) {
    throw unavailable();
  }
  return pool.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT id,expires_at,signup_invitation_token_hash,first_name,last_name,birth_date
         FROM external_auth_intents
        WHERE provider=$1 AND purpose=$2 AND state_hash=$3
          AND status='issued' AND expires_at > NOW()
        FOR UPDATE`,
      [provider, purpose, tokenHash(state)]
    );
    if (rows.length !== 1) throw unavailable();
    const row = rows[0];
    await client.query(
      `UPDATE external_auth_intents
          SET status='consumed',consumed_at=NOW(),signup_invitation_token_hash=NULL,
              first_name=NULL,last_name=NULL,birth_date=NULL
        WHERE id=$1`,
      [row.id]
    );
    return {
      id: row.id,
      expires_at: row.expires_at,
      registration: purpose === 'register' ? {
        invitationTokenHash: row.signup_invitation_token_hash,
        firstName: row.first_name,
        lastName: row.last_name,
        birthDate: row.birth_date,
      } : null,
    };
  });
}

module.exports = {
  issueIntent,
  consumeIntent,
  cleanupExpiredIntents,
  startCleanup,
  stopCleanup,
  TTL_SECONDS,
  CLEANUP_INTERVAL_MS,
};
