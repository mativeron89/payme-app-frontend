/** Delivery durable y dark para recovery. El token raw nunca sale de la memoria del intento. */
'use strict';

const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const logger = require('../utils/logger');
const { generateToken, tokenHash } = require('../utils/tokens');
const { runtimeConfigReady } = require('./authRecoveryTransport.resend');

const TTL_SECONDS = 15 * 60;
const LEASE_SECONDS = 30;
const RETENTION_DAYS = 30;
const BACKOFF_SECONDS = Object.freeze([30, 120, 600, 1800]);
const MAX_ATTEMPTS = 5;
const TICK_MS = 1_000;
const PURGE_BATCH = 100;
let transport = null;
let interval = null;
let ticking = false;
let stopping = false;
let inFlight = null;

function capability(env = process.env) {
  return env.AUTH_RECOVERY_EMAIL_ENABLED === 'true'
    && runtimeConfigReady(env) && typeof transport === 'function';
}

function installTransportForTests(candidate) {
  if (process.env.NODE_ENV !== 'test' || typeof candidate !== 'function') {
    throw new Error('auth_recovery_test_transport_forbidden');
  }
  transport = candidate;
}

function installRuntimeTransport(candidate, { env = process.env } = {}) {
  if (env.NODE_ENV === 'test' || typeof candidate !== 'function'
      || !runtimeConfigReady(env) || transport !== null) {
    throw new Error('auth_recovery_runtime_transport_forbidden');
  }
  transport = candidate;
}

function resetTransportForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('auth_recovery_test_transport_forbidden');
  transport = null;
}

async function recoverExpiredLeases(client) {
  const { rows } = await client.query(
    `SELECT id,user_id,attempt_count FROM auth_recovery_deliveries
      WHERE state='leased' AND lease_expires_at<=NOW()
      ORDER BY lease_expires_at,id FOR UPDATE SKIP LOCKED`
  );
  for (const row of rows) {
    const { rows: [attemptToken] } = await client.query(
      `SELECT status FROM auth_recovery_tokens
        WHERE delivery_id=$1 AND delivery_attempt=$2 FOR UPDATE`, [row.id, row.attempt_count]
    );
    if (attemptToken?.status === 'consumed') {
      await client.query(
        `UPDATE auth_recovery_tokens SET delivery_id=NULL,delivery_attempt=NULL
          WHERE delivery_id=$1 AND delivery_attempt=$2`, [row.id, row.attempt_count]
      );
      await client.query(
        `UPDATE auth_recovery_deliveries
            SET state='delivered',user_id=NULL,lease_token=NULL,lease_expires_at=NULL,
                delivered_at=NOW(),updated_at=NOW()
          WHERE id=$1 AND state='leased'`, [row.id]
      );
      continue;
    }
    await client.query(
      `UPDATE auth_recovery_tokens SET status='cancelled',cancelled_at=NOW()
        WHERE delivery_id=$1 AND delivery_attempt=$2 AND status='issued'`,
      [row.id, row.attempt_count]
    );
    const dead = row.attempt_count >= MAX_ATTEMPTS;
    const delay = dead ? 0 : BACKOFF_SECONDS[row.attempt_count - 1];
    await client.query(dead
      ? `UPDATE auth_recovery_deliveries
            SET state='dead',user_id=NULL,lease_token=NULL,lease_expires_at=NULL,dead_at=NOW(),updated_at=NOW()
          WHERE id=$1 AND state='leased'`
      : `UPDATE auth_recovery_deliveries
            SET state='queued',lease_token=NULL,lease_expires_at=NULL,
                next_attempt_at=NOW()+($2::int*INTERVAL '1 second'),updated_at=NOW()
          WHERE id=$1 AND state='leased'`, dead ? [row.id] : [row.id, delay]);
    if (dead) {
      await client.query(
        `UPDATE auth_recovery_tokens SET delivery_id=NULL,delivery_attempt=NULL
          WHERE delivery_id=$1`, [row.id]
      );
    }
  }
}

async function claimOne() {
  return pool.tx(async (client) => {
    await recoverExpiredLeases(client);
    const { rows: [job] } = await client.query(
      `SELECT d.id,d.user_id,d.generation,d.attempt_count,u.email,u.status
         FROM auth_recovery_deliveries d JOIN users u ON u.id=d.user_id
        WHERE d.state='queued' AND d.next_attempt_at<=NOW()
        ORDER BY d.next_attempt_at,d.created_at,d.id
        LIMIT 1 FOR UPDATE OF d,u SKIP LOCKED`
    );
    if (!job) return null;
    const { rows: [suspension] } = await client.query(
      `SELECT status FROM account_auth_suspensions WHERE user_id=$1 FOR UPDATE`, [job.user_id]
    );
    const eligible = job.status === 'active'
      ? suspension?.status !== 'pending_deletion'
      : job.status === 'suspended' && suspension?.status === 'pending_recovery';
    if (!eligible) {
      await client.query(
        `UPDATE auth_recovery_deliveries SET state='dead',user_id=NULL,dead_at=NOW(),updated_at=NOW()
          WHERE id=$1 AND state='queued'`, [job.id]
      );
      await client.query(
        `UPDATE auth_recovery_tokens SET delivery_id=NULL,delivery_attempt=NULL
          WHERE delivery_id=$1`, [job.id]
      );
      return null;
    }
    const leaseToken = randomUUID();
    const attempt = job.attempt_count + 1;
    const rawToken = generateToken(32);
    const hash = tokenHash(rawToken);
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
    await client.query(
      `UPDATE auth_recovery_tokens SET status='cancelled',cancelled_at=NOW()
        WHERE user_id=$1 AND status='issued'`, [job.user_id]
    );
    await client.query(
      `INSERT INTO auth_recovery_tokens
         (user_id,token_hash,status,expires_at,delivery_id,delivery_attempt)
       VALUES ($1,$2,'issued',$3,$4,$5)`,
      [job.user_id, hash, expiresAt, job.id, attempt]
    );
    const updated = await client.query(
      `UPDATE auth_recovery_deliveries
          SET state='leased',attempt_count=$2,lease_token=$3,
              lease_expires_at=NOW()+($4::int*INTERVAL '1 second'),updated_at=NOW()
        WHERE id=$1 AND state='queued' RETURNING id`,
      [job.id, attempt, leaseToken, LEASE_SECONDS]
    );
    if (updated.rowCount !== 1) throw new Error('auth_recovery_claim_lost');
    return { id: job.id, userId: job.user_id, email: job.email, attempt,
      leaseToken, rawToken, hash, expiresAt };
  });
}

async function finishSuccess(job) {
  return pool.tx(async (client) => {
    const finished = await client.query(
      `UPDATE auth_recovery_deliveries
          SET state='delivered',user_id=NULL,lease_token=NULL,lease_expires_at=NULL,
              delivered_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND state='leased' AND lease_token=$2 AND attempt_count=$3
        RETURNING id`, [job.id, job.leaseToken, job.attempt]
    );
    if (finished.rowCount === 1) {
      await client.query(
        `UPDATE auth_recovery_tokens SET delivery_id=NULL,delivery_attempt=NULL
          WHERE delivery_id=$1`, [job.id]
      );
    }
    return finished;
  });
}

async function finishFailure(job) {
  return pool.tx(async (client) => {
    const { rows: [locked] } = await client.query(
      `SELECT state,lease_token,attempt_count FROM auth_recovery_deliveries
        WHERE id=$1 FOR UPDATE`, [job.id]
    );
    if (!locked || locked.state !== 'leased' || locked.lease_token !== job.leaseToken
        || locked.attempt_count !== job.attempt) return false;
    await client.query(
      `UPDATE auth_recovery_tokens SET status='cancelled',cancelled_at=NOW()
        WHERE delivery_id=$1 AND delivery_attempt=$2 AND token_hash=$3 AND status='issued'`,
      [job.id, job.attempt, job.hash]
    );
    const dead = job.attempt >= MAX_ATTEMPTS;
    const delay = dead ? 0 : BACKOFF_SECONDS[job.attempt - 1];
    await client.query(dead
      ? `UPDATE auth_recovery_deliveries
            SET state='dead',user_id=NULL,lease_token=NULL,lease_expires_at=NULL,dead_at=NOW(),updated_at=NOW()
          WHERE id=$1 AND lease_token=$2`
      : `UPDATE auth_recovery_deliveries
            SET state='queued',lease_token=NULL,lease_expires_at=NULL,
                next_attempt_at=NOW()+($3::int*INTERVAL '1 second'),updated_at=NOW()
          WHERE id=$1 AND lease_token=$2`,
    dead ? [job.id, job.leaseToken] : [job.id, job.leaseToken, delay]);
    if (dead) {
      await client.query(
        `UPDATE auth_recovery_tokens SET delivery_id=NULL,delivery_attempt=NULL
          WHERE delivery_id=$1`, [job.id]
      );
    }
    return true;
  });
}

async function purgeTerminal() {
  return pool.query(
    `DELETE FROM auth_recovery_deliveries WHERE id IN (
       SELECT id FROM auth_recovery_deliveries
        WHERE state IN ('delivered','superseded','dead')
          AND updated_at < NOW()-($1::int*INTERVAL '1 day')
        ORDER BY updated_at,id LIMIT $2
     )`, [RETENTION_DAYS, PURGE_BATCH]
  );
}

async function tickOnce() {
  if (ticking) return { processed: 0 };
  ticking = true;
  try {
    await purgeTerminal();
    if (typeof transport !== 'function') return { processed: 0 };
    const job = await claimOne();
    if (!job) return { processed: 0 };
    try {
      await transport({ email: job.email, token: job.rawToken,
        token_hash: job.hash, expires_at: job.expiresAt });
      const finished = await finishSuccess(job);
      return { processed: 1, delivered: finished.rowCount === 1 ? 1 : 0 };
    } catch (_) {
      await finishFailure(job);
      logger.warn('auth_recovery_delivery_failed', { code: 'delivery_failed' });
      return { processed: 1, delivered: 0 };
    }
  } finally { ticking = false; }
}

async function scheduledTick() {
  if (stopping) return;
  if (inFlight) return inFlight;
  inFlight = tickOnce()
    .catch(() => { logger.error('auth_recovery_delivery_tick_failed', { code: 'tick_failed' }); })
    .finally(() => { inFlight = null; });
  return inFlight;
}

function start() {
  if (interval) return;
  stopping = false;
  interval = setInterval(scheduledTick, TICK_MS);
}
async function stop() {
  stopping = true;
  if (interval) { clearInterval(interval); interval = null; }
  const pending = inFlight;
  if (pending) await pending;
}

module.exports = {
  capability, installTransportForTests, installRuntimeTransport, resetTransportForTests,
  start, stop, tickOnce, _claimOne: claimOne, _finishSuccess: finishSuccess,
  _finishFailure: finishFailure, _recoverExpiredLeases: recoverExpiredLeases,
  _purgeTerminal: purgeTerminal, _scheduledTick: scheduledTick,
  BACKOFF_SECONDS, MAX_ATTEMPTS, LEASE_SECONDS, RETENTION_DAYS,
};
