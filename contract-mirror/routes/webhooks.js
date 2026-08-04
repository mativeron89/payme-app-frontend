/**
 * routes/webhooks.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P1 #5: reacquire de eventos retryables es ATÓMICO.
 *     `acquireWebhookSlot` ya no hace SELECT-luego-UPDATE para reabrir;
 *     usa un UPDATE ... WHERE status IN (retryables) RETURNING. Si no
 *     devuelve fila, otro worker ganó → 'in_progress' (503).
 *
 * v2.5.1 (se mantiene):
 *   - P0 #4: estados retryable_no_local_record / failed_retryable / failed_terminal.
 *   - P0 #5: charge.refunded escribe payment_refunds.
 */
'use strict';

const crypto = require('node:crypto');
const express = require('express');
const pool = require('../db/pool');
const eventEmitter = require('../services/eventEmitter');
const stripeService = require('../services/stripe');
const savedCards = require('../services/savedCards');   // D4 (v2.16)
const itemClaims = require('../services/itemClaims');   // v2.18 (fracciones)
const stateMachine = require('../utils/stateMachine');
const paymentProcessor = require('../services/paymentProcessor');
const settlement = require('../services/settlement');
const topupProcessor = require('../services/topupProcessor');
const connectRefundProcessor = require('../services/connectRefundProcessor');
const {
  assertPaymentIntentContract,
  guaranteeIntentMismatches,
} = require('../services/paymentIntentContract');
const connectService = require('../services/connect');   // v2.22 (Connect)
const logger = require('../utils/logger');
const { stripeEventModeMatches } = require('../middleware/envValidation');

const router = express.Router();

const MAX_WEBHOOK_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES) || 10;
const REPLAY_REQUIRED_EVENT_TYPES = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'payment_intent.processing',
  'payment_intent.amount_capturable_updated',
  'charge.refunded',
]);
const CONNECT_REPLAY_REQUIRED_EVENT_TYPES = new Set([
  ...REPLAY_REQUIRED_EVENT_TYPES,
  'refund.created',
  'refund.updated',
  'refund.failed',
]);

function eventRequiresDurableReplay(event) {
  const types = event?.account
    ? CONNECT_REPLAY_REQUIRED_EVENT_TYPES
    : REPLAY_REQUIRED_EVENT_TYPES;
  return types.has(event?.type);
}

function stripeObjectId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function paymeMetadata(metadata) {
  const allowed = new Set([
    'attempt_id', 'mesa_id', 'user_id', 'kind', 'save_pm',
    'topup_id', 'payme_user_id', 'type',
  ]);
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(([key]) => allowed.has(key))
  );
}

function normalizedInboxObject(event) {
  const object = event?.data?.object || null;
  if (!object) return null;
  if (event.type === 'charge.refunded') {
    return {
      id: object.id || null,
      object: object.object || null,
      payment_intent: stripeObjectId(object.payment_intent),
      application_fee: stripeObjectId(object.application_fee),
      amount: object.amount ?? null,
      amount_captured: object.amount_captured ?? null,
      amount_refunded: object.amount_refunded ?? null,
      currency: object.currency || null,
      refunded: object.refunded,
      payment_method: stripeObjectId(object.payment_method),
      metadata: paymeMetadata(object.metadata),
      refunds: {
        data: Array.isArray(object.refunds?.data)
          ? object.refunds.data.map((refund) => ({ id: refund?.id || null }))
          : [],
      },
    };
  }
  if (['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
    return {
      id: object.id || null,
      object: object.object || null,
      charge: stripeObjectId(object.charge),
      payment_intent: stripeObjectId(object.payment_intent),
      amount: object.amount ?? null,
      currency: object.currency || null,
      status: object.status || null,
      failure_reason: object.failure_reason || null,
      pending_reason: object.pending_reason || null,
      created: object.created || null,
      metadata: paymeMetadata(object.metadata),
    };
  }
  return {
    id: object.id || null,
    object: object.object || null,
    status: object.status || null,
    amount: object.amount ?? null,
    amount_received: object.amount_received ?? null,
    amount_capturable: object.amount_capturable ?? null,
    currency: object.currency || null,
    capture_method: object.capture_method || null,
    payment_method: stripeObjectId(object.payment_method),
    customer: stripeObjectId(object.customer),
    setup_future_usage: object.setup_future_usage || null,
    payment_method_types: Array.isArray(object.payment_method_types)
      ? [...object.payment_method_types]
      : [],
    application_fee_amount: object.application_fee_amount ?? null,
    latest_charge: stripeObjectId(object.latest_charge),
    metadata: paymeMetadata(object.metadata),
    last_payment_error: object.last_payment_error
      ? { code: object.last_payment_error.code || null }
      : null,
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function snapshotHash(snapshot) {
  if (!snapshot) return null;
  return crypto.createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex');
}

function webhookInboxMetadata(event) {
  const snapshot = eventRequiresDurableReplay(event) ? {
    id: event.id,
    type: event.type,
    account: event.account || null,
    livemode: !!event.livemode,
    created: event.created || null,
    data: { object: normalizedInboxObject(event) },
  } : null;
  return {
    livemode: !!event?.livemode,
    account: event?.account || null,
    // Snapshot verificado por firma, suficiente para reconstrucción manual o
    // replay local aun si Stripe deja de reintentar. No se guarda el request
    // HTTP ni headers; sólo el objeto económico normalizado del evento.
    event_snapshot: snapshot,
    event_snapshot_hash: snapshotHash(snapshot),
  };
}

function assertWebhookSlotBinding(row, event, provider) {
  const incoming = webhookInboxMetadata(event);
  const storedHash = row?.metadata?.event_snapshot_hash
    || snapshotHash(row?.metadata?.event_snapshot || null);
  if (!row || row.provider !== provider || row.event_type !== event.type
      || (row.metadata?.account || null) !== (event.account || null)
      || !!row.metadata?.livemode !== !!event.livemode
      || (storedHash !== null && storedHash !== incoming.event_snapshot_hash)) {
    const err = new Error('webhook_event_binding_conflict');
    err.code = 'webhook_event_binding_conflict';
    throw err;
  }
}

// Un slot durable por sí solo no evita que un worker lento sobreviva al umbral
// de recuperación. El advisory lock vive en una conexión dedicada durante toda
// la respuesta: otro proceso/instancia sólo puede retomar el event_id después
// de que el worker termine o su conexión muera. Así el timer puede marcar un
// slot stale como retryable sin habilitar dos ejecutores simultáneos.
/**
 * Toma el advisory lock del evento. **NUNCA lanza**: distingue las tres salidas
 * posibles para que el handler HTTP pueda decidir sin depender de un catch.
 *
 * N-01 (OLA 2-A): antes esto re-lanzaba ante un fallo de `pool.connect()`. Los
 * dos endpoints lo llamaban FUERA de todo try/catch, Express 4 no captura
 * rejections de handlers async y no hay handler global → un blip de PostgreSQL
 * durante una ráfaga de webhooks **mataba el proceso**, justo en el canal por
 * donde entra el dinero. Regresión introducida en e8a3faf.
 *
 * El lock vive en su propio pool (`pool.lockPool`): la conexión queda retenida
 * toda la request mientras el handler necesita OTRAS conexiones, así que
 * tomarla del pool principal permitía que una ráfaga se auto-bloqueara. El
 * advisory lock es de alcance de base, no de pool, así que la exclusión
 * cross-worker se conserva intacta.
 *
 * @returns {Promise<{status:'acquired', lock:{release:Function}}
 *                  |{status:'in_progress'}
 *                  |{status:'unavailable', error:Error}>}
 */
async function acquireWebhookEventLock(eventId) {
  let client;
  try {
    client = await pool.lockPool.connect();
  } catch (err) {
    // Pool agotado, PostgreSQL caído o timeout de conexión. No es un duplicado:
    // es infraestructura. Se devuelve como dato, no como excepción.
    return { status: 'unavailable', error: err };
  }
  try {
    const { rows: [row] } = await client.query(
      `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired`,
      [eventId]
    );
    if (!row?.acquired) {
      client.release();
      return { status: 'in_progress' };
    }
  } catch (err) {
    client.release(true);
    return { status: 'unavailable', error: err };
  }
  let released = false;
  return {
    status: 'acquired',
    lock: {
      /** Idempotente y **nunca rechaza**: se invoca desde un `void` sin dueño. */
      async release() {
        if (released) return;
        released = true;
        try {
          await client.query(
            `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
            [eventId]
          );
          client.release();
        } catch (err) {
          // Un fallo acá tampoco puede escapar: `releaseWebhookLockWithResponse`
          // lo llama con `void`, así que una rejection sería otra vez un crash.
          try { client.release(true); } catch (_) { /* la conexión ya se fue */ }
          logger.error('webhook_advisory_unlock_failed', {
            event_id: eventId, error: err.message,
          });
        }
      },
    },
  };
}

/**
 * Variante que LANZA ante fallo de infraestructura, para los sweeps internos:
 * ellos corren dentro de su propio try/catch, registran el fallo en el inbox y
 * reintentan. Ahí un throw es la conducta correcta; en un handler HTTP no.
 */
async function holdWebhookEventLock(eventId) {
  const result = await acquireWebhookEventLock(eventId);
  if (result.status === 'unavailable') throw result.error;
  return result.status === 'acquired' ? result.lock : null;
}

function releaseWebhookLockWithResponse(res, lock) {
  let releaseStarted = false;
  const release = () => {
    if (releaseStarted) return;
    releaseStarted = true;
    void lock.release();
  };
  res.once('finish', release);
  res.once('close', release);
}

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripeService.verifyWebhookSignature(req.body, req.headers['stripe-signature']);
  } catch (err) {
    logger.error('webhook_signature_invalid', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (!stripeEventModeMatches(event)) {
    logger.error('webhook_livemode_mismatch', { event_id: event.id, type: event.type, livemode: event.livemode });
    return res.status(400).json({ received: false, error: 'webhook_livemode_mismatch' });
  }

  // N-01: se captura localmente. Un fallo de infraestructura acá NO puede
  // escapar como rejection no manejada (Express 4 no las atrapa y el proceso
  // caería). 503 para que Stripe reintente el evento.
  const lockResult = await acquireWebhookEventLock(event.id);
  if (lockResult.status === 'unavailable') {
    logger.error('webhook_lock_unavailable', {
      event_id: event.id, type: event.type,
      error: lockResult.error.message, code: lockResult.error.code || null,
    });
    return res.status(503).json({ received: false, error: 'webhook_lock_unavailable' });
  }
  if (lockResult.status === 'in_progress') {
    logger.info('webhook_worker_in_progress', { event_id: event.id, type: event.type });
    return res.status(503).json({ received: false, in_progress: true });
  }
  const eventLock = lockResult.lock;
  releaseWebhookLockWithResponse(res, eventLock);

  logger.webhook(event);

  let slot;
  try {
    slot = await acquireWebhookSlot(event);
  } catch (err) {
    logger.error('platform_webhook_slot_acquire_failed', {
      event_id: event.id, type: event.type, error: err.code || err.message,
    });
    if (err.code === 'webhook_event_binding_conflict') {
      return res.status(400).json({ received: false, error: err.code });
    }
    return res.status(500).json({ received: false, error: 'slot_acquire_failed' });
  }
  const acquired = slot.state;
  const platformLeaseId = slot.leaseId || null;
  if (acquired === 'duplicate_processed') {
    return res.json({ received: true, duplicate: true });
  }
  if (acquired === 'in_progress') {
    return res.status(503).json({ received: false, in_progress: true });
  }
  if (acquired === 'failed_terminal') {
    logger.error('webhook_terminal_failure_received_again', {
      event_id: event.id, type: event.type,
    });
    return res.json({ received: true, terminal: true });
  }

  try {
    const outcome = await dispatchPlatformEvent(event);
    const foundLocal = outcome.foundLocal;

    if (foundLocal === false) {
      const newCount = await markRetryableNoLocalRecord(event, platformLeaseId);
      logger.warn('webhook_no_local_record_will_retry', {
        event_id: event.id, type: event.type, retry_count: newCount,
      });
      if (newCount >= MAX_WEBHOOK_RETRIES && !eventRequiresDurableReplay(event)) {
        const terminalized = await pool.query(
          `UPDATE processed_webhook_events
              SET status='failed_terminal',
                  failure_reason='max_retries_no_local_record',
                  last_attempt_at = NOW()
          WHERE event_id = $1 AND processing_lease_id=$2::uuid
            AND status='retryable_no_local_record'`,
          [event.id, platformLeaseId]
        );
        assertPlatformLeaseFinish(terminalized.rowCount);
        logger.error('webhook_max_retries_reached', {
          event_id: event.id, type: event.type, retry_count: newCount,
        });
        return res.json({
          received: true, terminal: true, reason: 'max_retries_no_local_record',
        });
      }
      return res.status(503).json({ received: false, no_local_record: true });
    }

    const finished = await pool.query(
      `UPDATE processed_webhook_events
          SET status='processed', processed_at=NOW(), last_attempt_at=NOW(),
              metadata=metadata - 'event_snapshot'
        WHERE event_id = $1 AND processing_lease_id=$2::uuid
          AND status='processing'`,
      [event.id, platformLeaseId]
    );
    assertPlatformLeaseFinish(finished.rowCount);
    res.json({
      received: true,
      ...(outcome.guarantee && { guarantee: true }),
      ...(outcome.ignored && { ignored: outcome.ignored }),
    });
  } catch (err) {
    logger.error('webhook_handler_error', {
      event_id: event.id, type: event.type,
      error: err.message, stack: err.stack,
    });
    let failStatus;
    try {
      failStatus = await markFailedAfterError(event, platformLeaseId, err.message);
    } catch (finishErr) {
      if (finishErr.code === 'platform_webhook_processing_lease_lost') {
        logger.error('platform_webhook_stale_worker_fenced', {
          event_id: event.id, type: event.type,
        });
        return res.status(500).json({ received: false, error: 'processing_lease_lost' });
      }
      throw finishErr;
    }
    if (failStatus === 'failed_terminal') {
      return res.json({ received: true, terminal: true, error: 'handler_failed' });
    }
    res.status(500).json({ received: false, error: 'handler_failed' });
  }
});

/**
 * Handler único reutilizable por la entrega HTTP firmada y por el replay del
 * inbox durable. El worker jamás salta validaciones de contrato: reconstruye
 * sólo el snapshot normalizado que ya pasó firma+mode gate y entra por las
 * mismas primitivas monetarias.
 */
async function dispatchPlatformEvent(event) {
  const piObj = event.type.startsWith('payment_intent.') ? event.data?.object : null;
  if (piObj?.metadata?.kind === 'guarantee_auth') {
    const guaranteeResult = await handleGuaranteeIntentEvent(event.type, piObj);
    if (!guaranteeResult.ignored
        && event.type === 'payment_intent.amount_capturable_updated') {
      await mirrorIntentPaymentMethodIfRequested(piObj);
    }
    return {
      foundLocal: true,
      guarantee: true,
      ignored: guaranteeResult.ignored || null,
    };
  }

  let foundLocal = true;
  switch (event.type) {
    case 'payment_intent.succeeded':
      foundLocal = await routeSucceeded(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      foundLocal = await routeFailed(event.data.object);
      break;
    case 'payment_intent.canceled':
      foundLocal = await routeCancelled(event.data.object);
      break;
    case 'payment_intent.processing':
      foundLocal = await routeProcessing(event.data.object);
      break;
    case 'charge.refunded':
      foundLocal = await handleChargeRefunded(event.data.object, event);
      break;
    default:
      logger.debug('webhook_unhandled', { type: event.type });
      foundLocal = true;
  }
  return { foundLocal };
}

/**
 * Toma el slot del webhook.
 *
 * v2.5.2 P1 #5: el reacquire de retryables es atómico (UPDATE ... RETURNING).
 *
 * Returns: { state, leaseId? }. Cada adquisición rota un lease durable; un
 * worker viejo puede terminar su efecto idempotente, pero nunca pisar el estado
 * del dueño nuevo del inbox.
 */
async function acquireWebhookSlot(event) {
  try {
    const { rows: [inserted] } = await pool.query(
      `INSERT INTO processed_webhook_events
         (event_id, provider, event_type, status, metadata)
       VALUES ($1, 'stripe', $2, 'processing', $3)
       RETURNING processing_lease_id::text AS lease_id`,
      [event.id, event.type, webhookInboxMetadata(event)]
    );
    return { state: 'acquired', leaseId: inserted.lease_id };
  } catch (err) {
    if (err.code !== '23505') throw err;

    const { rows } = await pool.query(
      `SELECT provider, event_type, status, retry_count, metadata
         FROM processed_webhook_events WHERE event_id = $1`,
      [event.id]
    );
    assertWebhookSlotBinding(rows[0], event, 'stripe');
    const cur = rows[0]?.status;
    const retryCount = Number(rows[0]?.retry_count || 0);

    if (cur === 'processed') {
      logger.info('webhook_already_processed', { event_id: event.id, type: event.type });
      return { state: 'duplicate_processed' };
    }
    if (cur === 'processing') {
      logger.info('webhook_in_progress', { event_id: event.id });
      return { state: 'in_progress' };
    }
    if (cur === 'failed_terminal') {
      if (!eventRequiresDurableReplay(event)) return { state: 'failed_terminal' };
      const { rows: [reacquired] } = await pool.query(
        `UPDATE processed_webhook_events
            SET status='processing', processing_started_at=NOW(), last_attempt_at=NOW(),
                processing_lease_id=uuid_generate_v4()
          WHERE event_id=$1 AND status='failed_terminal'
        RETURNING processing_lease_id::text AS lease_id`,
        [event.id]
      );
      return reacquired
        ? { state: 'acquired', leaseId: reacquired.lease_id }
        : { state: 'in_progress' };
    }
    if (cur === 'retryable_no_local_record' || cur === 'failed_retryable') {
      if (retryCount >= MAX_WEBHOOK_RETRIES && !eventRequiresDurableReplay(event)) {
        await pool.query(
          `UPDATE processed_webhook_events
              SET status='failed_terminal',
                  failure_reason = COALESCE(failure_reason, 'max_retries_reached'),
                  last_attempt_at = NOW()
            WHERE event_id = $1`,
          [event.id]
        );
        return { state: 'failed_terminal' };
      }
      // ─── v2.5.2 P1 #5: reacquire ATÓMICO ───
      // Solo un worker puede mover de retryable→processing. El WHERE con los
      // estados retryables actúa como guard: si otro worker ya lo movió a
      // 'processing', este UPDATE no matchea y devuelve 0 filas.
      const { rows: upd } = await pool.query(
        `UPDATE processed_webhook_events
            SET status='processing',
                processing_started_at = NOW(),
                last_attempt_at = NOW(),
                processing_lease_id=uuid_generate_v4()
          WHERE event_id = $1
            AND status IN ('retryable_no_local_record','failed_retryable')
        RETURNING processing_lease_id::text AS lease_id`,
        [event.id]
      );
      if (upd.length === 0) {
        logger.info('webhook_reacquire_lost_race', { event_id: event.id });
        return { state: 'in_progress' };
      }
      logger.info('webhook_retry_reacquired', {
        event_id: event.id, previous_status: cur, retry_count: retryCount,
      });
      return { state: 'acquired', leaseId: upd[0].lease_id };
    }
    return { state: 'in_progress' };
  }
}

function platformLeaseLostError() {
  const err = new Error('platform_webhook_processing_lease_lost');
  err.code = 'platform_webhook_processing_lease_lost';
  return err;
}

function assertPlatformLeaseFinish(rowCount) {
  if (rowCount !== 1) throw platformLeaseLostError();
}

async function markRetryableNoLocalRecord(event, leaseId) {
  const { rows } = await pool.query(
    `UPDATE processed_webhook_events
        SET status='retryable_no_local_record',
            failure_reason='no_local_record',
            retry_count = retry_count + 1,
            last_attempt_at = NOW()
      WHERE event_id = $1 AND processing_lease_id=$2::uuid
        AND status='processing'
  RETURNING retry_count`,
    [event.id, leaseId]
  );
  assertPlatformLeaseFinish(rows.length);
  return Number(rows[0]?.retry_count || 0);
}

async function markFailedAfterError(event, leaseId, reason) {
  const terminalize = !eventRequiresDurableReplay(event);
  const { rows } = await pool.query(
    `UPDATE processed_webhook_events
        SET retry_count = retry_count + 1,
            failure_reason = $2,
            last_attempt_at = NOW(),
            status = CASE
              WHEN $4::boolean AND retry_count + 1 >= $3 THEN 'failed_terminal'
              ELSE 'failed_retryable'
            END
      WHERE event_id = $1 AND processing_lease_id=$5::uuid
        AND status='processing'
  RETURNING status`,
    [event.id, (reason || '').slice(0, 500), MAX_WEBHOOK_RETRIES, terminalize, leaseId]
  );
  assertPlatformLeaseFinish(rows.length);
  return rows[0]?.status;
}

// ═══════════════════════════════════════════════════════════
// Routing
// ═══════════════════════════════════════════════════════════
async function routeSucceeded(pi) {
  if (await routeTopupIntent(pi)) return true;

  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(pi, pi.metadata.attempt_id, 'succeeded');
  }
  if (attempt) {
    assertAttemptIntentContract(attempt, pi, null, 'succeeded');
    await mirrorIntentPaymentMethodIfRequested(pi);
    await handleMesaPaymentSucceeded(attempt, pi, null);
    return true;
  }
  return false;
}

async function mirrorIntentPaymentMethodIfRequested(pi) {
  if (pi?.metadata?.save_pm !== '1' || !pi.payment_method
      || !pi.metadata.user_id || pi.metadata.user_id === 'guest') {
    return { skipped: true };
  }
  return savedCards.mirrorSavedPaymentMethod(pi.metadata.user_id, pi.payment_method);
}

async function routeFailed(pi) {
  if (await routeTopupIntent(pi)) return true;

  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(
      pi, pi.metadata.attempt_id, 'requires_payment_method'
    );
  }
  if (attempt) {
    assertAttemptIntentContract(attempt, pi, null, 'requires_payment_method');
    await handleMesaPaymentFailed(attempt, pi);
    return true;
  }
  return false;
}

async function routeCancelled(pi) {
  if (await routeTopupIntent(pi)) return true;
  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(pi, pi.metadata.attempt_id, 'canceled');
  }
  if (attempt) {
    assertAttemptIntentContract(attempt, pi, null, 'canceled');
    await handleMesaPaymentCancelled(attempt);
    return true;
  }
  return false;
}

async function routeProcessing(pi) {
  if (await routeTopupIntent(pi)) return true;
  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(pi, pi.metadata.attempt_id, 'processing');
  }
  if (attempt) {
    assertAttemptIntentContract(attempt, pi, null, 'processing');
    await pool.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT status FROM payment_attempts WHERE id = $1 FOR UPDATE`, [attempt.id]
      );
      const cur = rows[0]?.status;
      if (cur && ['pending','requires_action'].includes(cur)) {
        await client.query(`UPDATE payment_attempts SET status='processing' WHERE id=$1`, [attempt.id]);
        await stateMachine.transition({
          client, entityType: 'payment_attempt', entityId: attempt.id,
          fromState: cur, toState: 'processing',
          reason: 'stripe_webhook', triggeredBy: 'webhook',
        });
      }
    });
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════
// Lookups
// ═══════════════════════════════════════════════════════════
async function findTopupByIntent(intentId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, method, amount_cents, status, stripe_payment_intent_id
       FROM topups WHERE stripe_payment_intent_id = $1`, [intentId]
  );
  return rows[0] || null;
}

async function findTopupByMetadataId(topupId) {
  if (typeof topupId !== 'string') return null;
  const { rows } = await pool.query(
    `SELECT id, user_id, method, amount_cents, status, stripe_payment_intent_id
       FROM topups WHERE id::text=$1`,
    [topupId]
  );
  return rows[0] || null;
}

/**
 * Metadata sólo localiza. El processor vuelve a leer bajo FOR UPDATE y exige
 * monto, moneda, customer, método, tipo, id y snapshot durable exactos antes
 * de bindear o mover un centavo.
 */
async function routeTopupIntent(pi) {
  const bound = await findTopupByIntent(pi.id);
  const metadataTopup = pi.metadata?.topup_id
    ? await findTopupByMetadataId(pi.metadata.topup_id)
    : null;
  if (bound && metadataTopup && bound.id !== metadataTopup.id) {
    const err = new Error('topup_payment_intent_metadata_binding_conflict');
    err.code = 'topup_payment_intent_metadata_binding_conflict';
    throw err;
  }
  const topup = bound || metadataTopup;
  if (!topup) return false;
  await topupProcessor.applyTopupIntent({ topupId: topup.id, intent: pi });
  return true;
}

async function findAttemptByIntent(intentId) {
  const { rows } = await pool.query(
    `SELECT id, status, mesa_id, user_id, stripe_payment_intent_id,
            stripe_account_id, gross_amount_cents, application_fee_cents,
            payment_type, operation_type, stripe_contract_prepared_at,
            stripe_source_payment_method_id, stripe_charge_payment_method_id,
            stripe_customer_id_snapshot, stripe_used_saved_card,
            stripe_save_payment_method,
            card_policy_version, card_brand_snapshot, card_funding_snapshot,
            card_verified_at, charge_card_verified_at
       FROM payment_attempts
      WHERE stripe_payment_intent_id = $1 AND stripe_account_id IS NULL`, [intentId]
  );
  return rows[0] || null;
}

async function reconcileAttemptByMetadata(pi, attemptId, expectedStatus) {
  return pool.tx(async (client) => {
    const { rows: [attempt] } = await client.query(
      `SELECT id, status, mesa_id, user_id, stripe_payment_intent_id,
              stripe_account_id, gross_amount_cents, application_fee_cents,
              payment_type, operation_type, stripe_contract_prepared_at,
              stripe_source_payment_method_id, stripe_charge_payment_method_id,
              stripe_customer_id_snapshot, stripe_used_saved_card,
              stripe_save_payment_method,
              card_policy_version, card_brand_snapshot, card_funding_snapshot,
              card_verified_at, charge_card_verified_at
         FROM payment_attempts WHERE id=$1 FOR UPDATE`,
      [attemptId]
    );
    if (!attempt || attempt.stripe_account_id
        || (attempt.stripe_payment_intent_id && attempt.stripe_payment_intent_id !== pi.id)) {
      return null;
    }
    assertAttemptIntentContract(attempt, pi, null, expectedStatus, {
      allowIntentBinding: true,
    });
    if (!attempt.stripe_payment_intent_id) {
      await client.query(
        `UPDATE payment_attempts SET stripe_payment_intent_id=$2 WHERE id=$1`,
        [attemptId, pi.id]
      );
      logger.audit('attempt_reconciled_by_metadata', {
        attempt_id: attempt.id, intent_id: pi.id,
      });
    }
    return { ...attempt, stripe_payment_intent_id: pi.id };
  });
}

function assertAttemptIntentContract(
  attempt, pi, connectedAccountId = null, expectedStatus = null, options = {}
) {
  try {
    return assertPaymentIntentContract(attempt, pi, {
      stripeAccountId: connectedAccountId,
      expectedStatus,
      allowIntentBinding: options.allowIntentBinding === true,
    });
  } catch (err) {
    logger.error('payment_intent_contract_mismatch', {
      attempt_id: attempt?.id || null,
      intent_id: pi?.id || null,
      expected_account: connectedAccountId,
      local_account: attempt?.stripe_account_id || null,
      mismatches: err.details?.mismatches || null,
    });
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════
async function handleMesaPaymentSucceeded(attempt, remoteIntent, connectedAccountId = null) {
  return settlement.reconcileSucceededAttempt({
    attemptId: attempt.id, mesaId: attempt.mesa_id,
    remoteIntent, stripeAccountId: connectedAccountId,
    triggeredBy: 'webhook',
  });
}

async function handleMesaPaymentFailed(attempt, pi) {
  await pool.tx(async (client) => {
    await paymentProcessor.processFailedPayment(
      client, attempt.id,
      pi.last_payment_error?.message || pi.last_payment_error?.code || 'unknown'
    );
  });
}

async function handleMesaPaymentCancelled(attempt) {
  const result = await settlement.finalizeCancellingAttempt(attempt.id, {
    reason: 'stripe_webhook_cancelled',
    triggeredBy: 'webhook',
    allowedFrom: ['pending', 'requires_action', 'processing', 'authorized', 'cancelling'],
  });
  if (!result.finalized && ['succeeded', 'processed', 'refunded'].includes(result.status)) {
    logger.warn('webhook_cancelled_but_attempt_succeeded', {
      attempt_id: attempt.id, status: result.status,
    });
  }
}

// ═══════════════════════════════════════════════════════════
// charge.refunded (v2.5.1 P0 #4 + #5; v2.5.2 P1 #6 via processRefund)
// ═══════════════════════════════════════════════════════════
async function handleChargeRefunded(charge, event, preauthenticatedAttempt = null) {
  // El endpoint Connect ya autenticó cuenta+restaurant+PI antes de llegar acá.
  // No se vuelve a buscar con el filtro de plataforma (`account IS NULL`), que
  // hacía ACK/ignore del refund directo y dejaba el ledger local mintiendo.
  let attempt = preauthenticatedAttempt || await findAttemptByIntent(charge.payment_intent);
  if (!attempt) {
    // v2.11 (A13): un refund de TOPUP no está soportado en MVP (habría que
    // debitar la wallet, posiblemente a saldo negativo → decisión de producto).
    // Se traza fuerte para revisión manual y se corta el retry-loop de Stripe.
    const topup = await findTopupByIntent(charge.payment_intent);
    if (topup) {
      logger.error('topup_refund_unhandled_manual_review', {
        topup_id: topup.id, user_id: topup.user_id,
        payment_intent: charge.payment_intent,
        amount_refunded: charge.amount_refunded,
      });
      return true;
    }
    logger.warn('refund_attempt_not_found', { payment_intent: charge.payment_intent });
    return false;
  }

  const stripeRefundId = charge.refunds?.data?.[0]?.id || null;

  let result;
  await pool.tx(async (client) => {
    result = await paymentProcessor.processRefund(client, attempt.id, {
      chargeAmount: charge.amount,
      chargeAmountRefunded: charge.amount_refunded,
      stripeChargeId: charge.id,
      stripeRefundId,
      rawEventId: event.id,
      triggeredBy: 'webhook',
    });
  });

  if (result?.partial) {
    logger.warn('refund_partial_pending_review', {
      attempt_id: attempt.id,
      charge_amount: charge.amount,
      refunded: charge.amount_refunded,
      review_id: result.review_id,
    });
  } else if (result?.partialAfterFull) {
    logger.warn('refund_partial_after_full_audited', {
      attempt_id: attempt.id, ledger_id: result.ledger_id,
    });
  }

  return true;
}

// ═══════════════════════════════════════════════════════════
// v2.11 (parche §3) — eventos de PaymentIntents de GARANTÍA
// (metadata.kind === 'guarantee_auth'; los crea settlement.placeCardHold)
// ═══════════════════════════════════════════════════════════
async function handleGuaranteeIntentEvent(
  type, pi, connectedAccountId = null, restaurantId = null
) {
  const mesaId = pi.metadata?.mesa_id;
  if (!mesaId) {
    logger.warn('guarantee_event_without_mesa', { intent_id: pi.id, type });
    return { handled: false, ignored: 'mesa_missing' };
  }
  return pool.tx(async (client) => {
    const { rows: [row] } = await client.query(
      `SELECT id, restaurant_id, opener_user_id, total_cents,
              status, guarantee_mode, auth_method,
              auth_payment_intent_id, auth_amount_cents, auth_stripe_account_id,
              auth_application_fee_cents, auth_source_payment_method_id,
              auth_charge_payment_method_id,
              auth_stripe_customer_id, auth_off_session, auth_save_payment_method,
              auth_card_policy_version, auth_card_brand, auth_card_funding,
              auth_card_verified_at, auth_charge_card_verified_at
         FROM mesas WHERE id=$1 FOR UPDATE`,
      [mesaId]
    );
    const mismatches = guaranteeIntentMismatches(row, pi, {
      stripeAccountId: connectedAccountId,
      restaurantId,
      eventType: type,
    });
    if (row?.status === 'pending_auth' && !row.auth_payment_intent_id
        && mismatches.length === 1 && mismatches[0] === 'intent_id') {
      // La respuesta de create puede haberse perdido después de crear el hold
      // remoto pero antes del binding local. Ni siquiera una firma Connect y una
      // metadata exacta prueban que un PI de una cuenta Standard sea nuestro:
      // se pide retry acotado hasta que el replay API bindea el PI por la key
      // `guarantee_${mesaId}`. Jamás se abre desde este payload.
      const err = new Error('guarantee_binding_pending');
      err.code = 'guarantee_binding_pending';
      throw err;
    }
    if (mismatches.length > 0) {
      logger.warn('guarantee_webhook_binding_rejected', {
        mesa_id: mesaId, intent_id: pi.id || null, type,
        account: connectedAccountId || null, mismatches,
      });
      const boundLocalIntent = !!row
        && row.auth_payment_intent_id === pi?.id
        && (row.auth_stripe_account_id || null) === (connectedAccountId || null);
      if (boundLocalIntent) {
        await quarantineGuaranteeContractDrift(client, row, type, pi, mismatches);
        return { handled: true, manual_review: true };
      }
      return { handled: false, ignored: `binding_mismatch:${mismatches.join(',')}` };
    }

    switch (type) {
      case 'payment_intent.amount_capturable_updated': {
        // No se bindea nada desde metadata: id, riel, monto y fee ya debían estar
        // persistidos antes del primer call a Stripe. Acá sólo cambia el estado.
        if (row.status === 'open') return { handled: true, idempotent: true };
        if (row.status !== 'pending_auth') {
          return { handled: false, ignored: `state_${row.status}` };
        }
        const upd = await client.query(
          `UPDATE mesas
              SET status='open', auth_application_fee_cents=$2
            WHERE id=$1 AND status='pending_auth'`,
          [mesaId, Number(pi.application_fee_amount || 0)]
        );
        if (upd.rowCount !== 1) throw new Error('guarantee_webhook_state_race');
        await stateMachine.transition({
          client, entityType: 'mesa', entityId: mesaId,
          fromState: 'pending_auth', toState: 'open',
          reason: 'guarantee_hold_authorized', triggeredBy: 'webhook',
        });
        await eventEmitter.enqueueTableOpened(client, mesaId);
        await eventEmitter.enqueuePaymentSecured(client, mesaId);
        logger.audit('guarantee_hold_authorized', { mesa_id: mesaId, intent_id: pi.id });
        return { handled: true };
      }
      case 'payment_intent.payment_failed': {
        if (row.status === 'auth_failed') return { handled: true, idempotent: true };
        if (row.status !== 'pending_auth') {
          return { handled: false, ignored: `state_${row.status}` };
        }
        const upd = await client.query(
          `UPDATE mesas SET status='auth_failed'
            WHERE id=$1 AND status='pending_auth'`,
          [mesaId]
        );
        if (upd.rowCount !== 1) throw new Error('guarantee_webhook_state_race');
        await stateMachine.transition({
          client, entityType: 'mesa', entityId: mesaId,
          fromState: 'pending_auth', toState: 'auth_failed',
          reason: pi.last_payment_error?.code || 'guarantee_auth_failed',
          triggeredBy: 'webhook',
        });
        logger.warn('guarantee_auth_failed_webhook', { mesa_id: mesaId, intent_id: pi.id });
        return { handled: true };
      }
      case 'payment_intent.succeeded':
        if (['pending_auth', 'open', 'partially_paid', 'fully_paid', 'expired'].includes(row.status)) {
          await quarantineGuaranteeRemoteIntervention(client, row, type, pi);
          return { handled: true, manual_review: true };
        }
        if (['auth_failed', 'cancelled'].includes(row.status)) {
          await markGuaranteeTerminalIntervention(client, row, type, pi);
          return { handled: true, manual_review: true };
        }
        logger.audit('guarantee_capture_confirmed', {
          mesa_id: mesaId, intent_id: pi.id, amount_received: pi.amount_received,
        });
        return { handled: true };
      case 'payment_intent.canceled':
        if (['pending_auth', 'open', 'partially_paid', 'fully_paid', 'expired'].includes(row.status)) {
          await quarantineGuaranteeRemoteIntervention(client, row, type, pi);
          return { handled: true, manual_review: true };
        }
        if (['auth_failed', 'cancelled'].includes(row.status)) {
          await markGuaranteeTerminalIntervention(client, row, type, pi);
          return { handled: true, manual_review: true };
        }
        logger.audit('guarantee_hold_released', { mesa_id: mesaId, intent_id: pi.id });
        return { handled: true };
      default:
        logger.debug('guarantee_event_ignored', { type, mesa_id: mesaId });
        return { handled: true, ignored: 'event_type' };
    }
  });
}

async function quarantineGuaranteeContractDrift(client, row, type, pi, mismatches) {
  const review = {
    reason: 'guarantee_remote_contract_drift',
    event_type: type,
    intent_id: pi?.id || null,
    mismatches: [...new Set(mismatches)].sort(),
    observed_at: new Date().toISOString(),
  };
  const quarantineStates = new Set([
    'pending_auth', 'open', 'partially_paid', 'fully_paid', 'expired',
  ]);
  if (quarantineStates.has(row.status)) {
    const upd = await client.query(
      `UPDATE mesas
          SET status='settling',
              metadata=jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{guarantee_manual_review}', $2::jsonb, true
              )
        WHERE id=$1 AND status=$3`,
      [row.id, JSON.stringify(review), row.status]
    );
    if (upd.rowCount !== 1) throw new Error('guarantee_contract_drift_quarantine_race');
    await stateMachine.transition({
      client, entityType: 'mesa', entityId: row.id,
      fromState: row.status, toState: 'settling',
      reason: review.reason, triggeredBy: 'webhook',
      metadata: { intent_id: pi?.id || null, event_type: type, mismatches: review.mismatches },
    });
  } else {
    const upd = await client.query(
      `UPDATE mesas
          SET metadata=jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{guarantee_manual_review}', $2::jsonb, true
              )
        WHERE id=$1 AND status=$3`,
      [row.id, JSON.stringify(review), row.status]
    );
    if (upd.rowCount !== 1) throw new Error('guarantee_contract_drift_review_race');
  }
  logger.error('guarantee_remote_contract_drift_manual_review', {
    mesa_id: row.id, intent_id: pi?.id || null, type,
    previous_status: row.status, mismatches: review.mismatches,
  });
}

async function quarantineGuaranteeRemoteIntervention(client, row, type, pi) {
  const review = guaranteeInterventionReview(type, pi);
  const upd = await client.query(
    `UPDATE mesas
        SET status='settling',
            metadata=jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{guarantee_manual_review}', $2::jsonb, true
            )
      WHERE id=$1 AND status=$3`,
    [row.id, JSON.stringify(review), row.status]
  );
  if (upd.rowCount !== 1) throw new Error('guarantee_quarantine_state_race');
  await stateMachine.transition({
    client, entityType: 'mesa', entityId: row.id,
    fromState: row.status, toState: 'settling',
    reason: review.reason, triggeredBy: 'webhook',
    metadata: { intent_id: pi.id, event_type: type },
  });
  logger.error('guarantee_remote_intervention_manual_review', {
    mesa_id: row.id, intent_id: pi.id, type, previous_status: row.status,
  });
}

async function markGuaranteeTerminalIntervention(client, row, type, pi) {
  const review = guaranteeInterventionReview(type, pi);
  const upd = await client.query(
    `UPDATE mesas
        SET metadata=jsonb_set(
              COALESCE(metadata, '{}'::jsonb),
              '{guarantee_manual_review}', $2::jsonb, true
            )
      WHERE id=$1 AND status=$3`,
    [row.id, JSON.stringify(review), row.status]
  );
  if (upd.rowCount !== 1) throw new Error('guarantee_terminal_review_state_race');
  logger.error('guarantee_terminal_intervention_manual_review', {
    mesa_id: row.id, intent_id: pi.id, type, terminal_status: row.status,
  });
}

function guaranteeInterventionReview(type, pi) {
  return {
    reason: type === 'payment_intent.succeeded'
      ? 'guarantee_captured_outside_settlement'
      : 'guarantee_canceled_outside_settlement',
    event_type: type,
    intent_id: pi.id,
    observed_at: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK DE CUENTAS CONECTADAS (v2.22 · Fase 1 del pivote Connect)
//
// Endpoint SEPARADO con su PROPIO signing secret: los eventos de cuentas
// conectadas se registran en Stripe con scope "Connected accounts" y firman con
// otro whsec. Verificarlos con el secreto de la plataforma daría 400 en todos y
// Stripe terminaría deshabilitando el endpoint.
//
// Cada evento trae `event.account` (el acct_ que lo originó) — ES la clave de
// ruteo: `data.object.id` de un account.updated también es el acct_, pero en
// los eventos de pago (Fase 2) no lo sería.
//
// Fase 1 solo sincroniza estado de cuentas. Los payment_intent.* de cuentas
// conectadas todavía no existen (no hay cargos allá); llegan al default, se
// loguean y se ACKean para no generar reintentos en Stripe.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Dedupe de eventos Connect.
 *
 * Mismo criterio que `acquireWebhookSlot` (el de plataforma): un 23505 NO es
 * automáticamente "duplicado". Si la fila quedó en `failed_retryable` por un
 * fallo transitorio, hay que RE-ADQUIRIRLA para que el reintento de Stripe se
 * procese de verdad. Colapsar todo 23505 a "duplicado" hacía que, después de un
 * único 500, el evento se ACKeara con 200 para siempre y no se procesara nunca
 * — incluido el `account.updated` que habilita a un restaurante a cobrar.
 *
 * Returns: 'acquired' | 'duplicate_processed' | 'in_progress' | 'failed_terminal'
 */
/**
 * Resuelve únicamente un PI que PayMe ya bindeó durablemente en esta cuenta.
 * En una cuenta Connect Standard el restaurante puede crear objetos propios y
 * elegir metadata, por lo que ni un snapshot v1 exacto autoriza a adoptar un
 * intent_id nuevo desde el webhook. La API/worker con la idempotency key de
 * PayMe debe recuperar y bindear primero; el evento queda retryable mientras
 * tanto.
 */
async function findConnectAttempt(pi, acctId) {
  const { rows } = await pool.query(
    `SELECT id, status, mesa_id, user_id, stripe_payment_intent_id,
            stripe_account_id, gross_amount_cents, application_fee_cents,
            payment_type, operation_type, stripe_contract_prepared_at,
            stripe_source_payment_method_id, stripe_charge_payment_method_id,
            stripe_customer_id_snapshot, stripe_used_saved_card,
            stripe_save_payment_method,
            card_policy_version, card_brand_snapshot, card_funding_snapshot,
            card_verified_at, charge_card_verified_at
       FROM payment_attempts
      WHERE stripe_payment_intent_id = $1 AND stripe_account_id = $2`,
    [pi.id, acctId]
  );
  return rows[0] || null;
}

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Metadata nunca acredita ownership ni autoriza un binding: sólo permite
// decidir si un evento sin intent_id local corresponde a una operación que
// PayMe realmente dejó preparada en ESA cuenta. Un Standard puede fabricar
// PIs y metadata arbitraria; random/foreign/already-bound se ACKean para no
// convertir esa superficie en una cola de retries infinita.
async function ackOrRetryUnbound(event, pi, acctId) {
  const attemptId = typeof pi?.metadata?.attempt_id === 'string'
    ? pi.metadata.attempt_id
    : '';
  if (!CANONICAL_UUID.test(attemptId) || typeof pi?.id !== 'string' || !pi.id) {
    logger.info('connect_cobro_propio_del_restaurante', {
      intent_id: pi?.id || null, account: acctId, reason: 'metadata_not_local',
    });
    return { retry: false, reason: 'attempt_metadata_not_local' };
  }

  const { rows: [candidate] } = await pool.query(
    `SELECT id,status,payment_type,operation_type,stripe_payment_intent_id,
            stripe_account_id,stripe_contract_prepared_at
       FROM payment_attempts
      WHERE id=$1::uuid AND stripe_account_id=$2`,
    [attemptId, acctId]
  );

  if (!candidate) {
    logger.warn('connect_attempt_metadata_rejected', {
      event_id: event.id, intent_id: pi.id, account: acctId,
      reason: 'attempt_not_local_to_account',
    });
    return { retry: false, reason: 'attempt_metadata_not_local' };
  }

  if (candidate.stripe_payment_intent_id) {
    if (candidate.stripe_payment_intent_id === pi.id) {
      // Carrera acotada: findConnectAttempt leyó antes del COMMIT que selló
      // el mismo PI. No se muta desde metadata; la próxima pasada lo hallará
      // exclusivamente por intent_id + account_id durables.
      return { retry: true, reason: 'attempt_binding_race' };
    }
    logger.warn('connect_attempt_metadata_rejected', {
      event_id: event.id, intent_id: pi.id, account: acctId,
      attempt_id: candidate.id, reason: 'attempt_already_bound',
    });
    return { retry: false, reason: 'attempt_metadata_not_local' };
  }

  const recoverable = candidate.operation_type === 'mesa_pay'
    && candidate.payment_type === 'card'
    && !!candidate.stripe_contract_prepared_at
    && ['pending', 'cancelling'].includes(candidate.status);
  if (!recoverable) {
    logger.warn('connect_attempt_metadata_rejected', {
      event_id: event.id, intent_id: pi.id, account: acctId,
      attempt_id: candidate.id, reason: 'attempt_not_recoverable',
    });
    return { retry: false, reason: 'attempt_metadata_not_local' };
  }

  const { rows } = await pool.query(
    `SELECT retry_count FROM processed_webhook_events WHERE event_id = $1`, [event.id]
  );
  const intentos = Number(rows[0]?.retry_count || 0);
  logger.warn('connect_attempt_no_encontrado', {
    event_id: event.id, intent_id: pi.id, account: acctId,
    attempt_id: candidate.id, intentos,
  });
  return { retry: true, reason: 'attempt_binding_pending' };
}

/** Marca 'processing' un attempt del riel directo (equivalente a routeProcessing). */
async function handleAttemptProcessing(attempt) {
  await pool.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT status FROM payment_attempts WHERE id = $1 FOR UPDATE`, [attempt.id]
    );
    const cur = rows[0]?.status;
    if (cur && ['pending', 'requires_action'].includes(cur)) {
      await client.query(`UPDATE payment_attempts SET status='processing' WHERE id=$1`, [attempt.id]);
      await stateMachine.transition({
        client, entityType: 'payment_attempt', entityId: attempt.id,
        fromState: cur, toState: 'processing',
        reason: 'stripe_connect_webhook', triggeredBy: 'webhook',
      });
    }
  });
}

async function acquireConnectSlot(event) {
  const meta = webhookInboxMetadata(event);
  try {
    const { rows: [inserted] } = await pool.query(
      `INSERT INTO processed_webhook_events
         (event_id, provider, event_type, status, metadata)
       VALUES ($1, 'stripe_connect', $2, 'processing', $3)
       RETURNING processing_lease_id::text AS lease_id`,
      [event.id, event.type, meta]
    );
    return { state: 'acquired', leaseId: inserted.lease_id };
  } catch (err) {
    if (err.code !== '23505') throw err;

    const { rows } = await pool.query(
      `SELECT provider, event_type, status, retry_count, metadata
         FROM processed_webhook_events WHERE event_id = $1`,
      [event.id]
    );
    assertWebhookSlotBinding(rows[0], event, 'stripe_connect');
    const cur = rows[0]?.status;
    const retryCount = Number(rows[0]?.retry_count || 0);

    if (cur === 'processed') return { state: 'duplicate_processed' };
    if (cur === 'processing') return { state: 'in_progress' };
    if (cur === 'failed_terminal') {
      if (!eventRequiresDurableReplay(event)) return { state: 'failed_terminal' };
      const { rows: [reacquired] } = await pool.query(
        `UPDATE processed_webhook_events
            SET status='processing', processing_started_at=NOW(), last_attempt_at=NOW(),
                processing_lease_id=uuid_generate_v4()
          WHERE event_id=$1 AND status='failed_terminal'
        RETURNING processing_lease_id::text AS lease_id`,
        [event.id]
      );
      return reacquired
        ? { state: 'acquired', leaseId: reacquired.lease_id }
        : { state: 'in_progress' };
    }

    if (cur === 'failed_retryable') {
      if (retryCount >= MAX_WEBHOOK_RETRIES && !eventRequiresDurableReplay(event)) {
        await pool.query(
          `UPDATE processed_webhook_events
              SET status='failed_terminal',
                  failure_reason = COALESCE(failure_reason, 'max_retries_reached'),
                  last_attempt_at = NOW()
            WHERE event_id = $1`,
          [event.id]
        );
        return { state: 'failed_terminal' };
      }
      // Re-adquisición ATÓMICA: si dos entregas compiten, solo una gana.
      const { rows: [reacquired] } = await pool.query(
        `UPDATE processed_webhook_events
            SET status='processing', retry_count = retry_count + 1,
                processing_started_at=NOW(), last_attempt_at=NOW(),
                processing_lease_id=uuid_generate_v4()
          WHERE event_id = $1 AND status = 'failed_retryable'
        RETURNING processing_lease_id::text AS lease_id`,
        [event.id]
      );
      return reacquired
        ? { state: 'acquired', leaseId: reacquired.lease_id }
        : { state: 'in_progress' };
    }
    return { state: 'duplicate_processed' };
  }
}

async function finishConnectSlot(eventId, leaseId, ok, reason) {
  const { rowCount } = await pool.query(
    `UPDATE processed_webhook_events
        SET status = $3::varchar,
            processed_at = CASE WHEN $3::varchar='processed' THEN NOW() ELSE NULL END,
            last_attempt_at = NOW(),
            failure_reason = $4,
            metadata = CASE WHEN $3::varchar='processed'
              THEN metadata - 'event_snapshot' ELSE metadata END
      WHERE event_id = $1 AND processing_lease_id=$2::uuid AND status='processing'`,
    [eventId, leaseId, ok ? 'processed' : 'failed_retryable',
      reason ? String(reason).slice(0, 500) : null]
  );
  if (rowCount !== 1) {
    const err = new Error('connect_webhook_processing_lease_lost');
    err.code = 'connect_webhook_processing_lease_lost';
    throw err;
  }
}

async function processConnectRefundEvent(event, restaurant) {
  const acctId = event.account || null;
  if (!acctId || !restaurant?.id || !event.data?.object) {
    throw new Error('connect_refund_identity_missing');
  }
  if (event.type === 'charge.refunded') {
    const result = await connectRefundProcessor.processChargeRefundWakeup({
      charge: event.data.object,
      eventId: event.id,
      stripeAccountId: acctId,
      triggeredBy: 'webhook',
    });
    const handled = result.refunds.filter((entry) => !entry.ignored);
    return handled.length === 0
      ? { ignored: 'refund_not_ours', refund: result }
      : { refund: result };
  }
  const refund = await connectRefundProcessor.processCanonicalRefundEvent({
    refund: event.data.object,
    eventId: event.id,
    eventType: event.type,
    stripeAccountId: acctId,
    triggeredBy: 'webhook',
  });
  return refund.ignored ? { ignored: refund.ignored, refund } : { refund };
}

async function replayConnectInboxEvent(event, restaurant) {
  const acctId = event.account;
  const piGar = event.type.startsWith('payment_intent.') ? event.data?.object : null;
  if (piGar?.metadata?.kind === 'guarantee_auth') {
    const guarantee = await handleGuaranteeIntentEvent(
      event.type, piGar, acctId, restaurant.id
    );
    return { handled: true, guarantee, ignored: guarantee.ignored || null };
  }

  if ([
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.canceled',
    'payment_intent.processing',
  ].includes(event.type)) {
    const pi = event.data.object;
    const expectedStatus = {
      'payment_intent.succeeded': 'succeeded',
      'payment_intent.payment_failed': 'requires_payment_method',
      'payment_intent.canceled': 'canceled',
      'payment_intent.processing': 'processing',
    }[event.type];
    const attempt = await findConnectAttempt(pi, acctId);
    if (!attempt) {
      const unbound = await ackOrRetryUnbound(event, pi, acctId);
      if (unbound.retry) {
        const err = new Error('connect_attempt_no_encontrado_todavia');
        err.code = unbound.reason || 'connect_attempt_no_encontrado_todavia';
        throw err;
      }
      return { handled: true, ignored: unbound.reason };
    }
    assertAttemptIntentContract(attempt, pi, acctId, expectedStatus);
    const handler = {
      'payment_intent.succeeded': (a) => handleMesaPaymentSucceeded(a, pi, acctId),
      'payment_intent.payment_failed': (a) => handleMesaPaymentFailed(a, pi),
      'payment_intent.canceled': handleMesaPaymentCancelled,
      'payment_intent.processing': (a) => handleAttemptProcessing(a),
    }[event.type];
    await handler(attempt);
    return { handled: true, attemptId: attempt.id };
  }

  if (['charge.refunded', 'refund.created', 'refund.updated', 'refund.failed']
    .includes(event.type)) {
    const result = await processConnectRefundEvent(event, restaurant);
    if (result.refund?.partial) {
      logger.error('connect_partial_refund_manual_review', {
        event_id: event.id, attempt_id: result.attemptId,
        obligation_id: result.refund.obligationId,
        reason: 'partial_refund_principal_tip_policy_pending',
      });
    }
    return { handled: true, ...result };
  }

  return { handled: true, ignored: 'event_type' };
}

async function sweepRetryableConnectRefundInbox({ limit = 25 } = {}) {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 100 ? limit : 25;
  const { rows } = await pool.tx(async (client) => {
    const { rows: candidates } = await client.query(
      `SELECT event_id
         FROM processed_webhook_events
        WHERE provider='stripe_connect' AND event_type=ANY($2::varchar[])
          AND status='failed_retryable' AND metadata ? 'event_snapshot'
        ORDER BY last_attempt_at ASC, event_id ASC
        LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [safeLimit, [...CONNECT_REPLAY_REQUIRED_EVENT_TYPES]]
    );
    if (candidates.length === 0) return { rows: [] };
    const ids = candidates.map((row) => row.event_id);
    return client.query(
      `UPDATE processed_webhook_events
          SET status='processing', retry_count=retry_count+1,
              processing_started_at=NOW(), last_attempt_at=NOW(),
              processing_lease_id=uuid_generate_v4()
        WHERE event_id=ANY($1::varchar[]) AND status='failed_retryable'
      RETURNING event_id, metadata, processing_lease_id::text AS lease_id`,
      [ids]
    );
  });
  const outcomes = [];
  for (const row of rows) {
    let eventLock = null;
    try {
      const event = row.metadata?.event_snapshot;
      if (!event || event.id !== row.event_id
          || !CONNECT_REPLAY_REQUIRED_EVENT_TYPES.has(event.type)
          || typeof event.account !== 'string' || !event.data?.object
          || !stripeEventModeMatches(event)) {
        throw new Error('connect_webhook_inbox_snapshot_invalid');
      }
      eventLock = await holdWebhookEventLock(event.id);
      if (!eventLock) throw new Error('connect_webhook_worker_in_progress');
      const restaurant = await connectService.findRestaurantByAccount(event.account);
      if (!restaurant) throw new Error('connect_webhook_inbox_account_unbound');
      const result = await replayConnectInboxEvent(event, restaurant);
      await finishConnectSlot(row.event_id, row.lease_id, true, result.ignored || null);
      outcomes.push({ eventId: row.event_id, processed: !result.ignored, ...result });
    } catch (err) {
      try {
        await finishConnectSlot(row.event_id, row.lease_id, false, err.code || err.message);
      } catch (finishErr) {
        logger.error('connect_webhook_inbox_finish_failed', {
          event_id: row.event_id, error: finishErr.message,
        });
      }
      logger.error('connect_webhook_inbox_retry_failed', {
        event_id: row.event_id, error: err.message, code: err.code || null,
      });
      outcomes.push({ eventId: row.event_id, error: err.code || err.message });
    } finally {
      if (eventLock) await eventLock.release();
    }
  }
  return outcomes;
}

async function sweepRetryablePlatformWebhookInbox({ limit = 25 } = {}) {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 100 ? limit : 25;
  const { rows } = await pool.tx(async (client) => {
    const { rows: candidates } = await client.query(
      `SELECT event_id
         FROM processed_webhook_events
        WHERE provider='stripe'
          AND status IN ('failed_retryable','retryable_no_local_record')
          AND metadata ? 'event_snapshot'
          AND event_type=ANY($2::varchar[])
        ORDER BY last_attempt_at ASC, event_id ASC
        LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [safeLimit, [...REPLAY_REQUIRED_EVENT_TYPES]]
    );
    if (candidates.length === 0) return { rows: [] };
    return client.query(
      `UPDATE processed_webhook_events
          SET status='processing', retry_count=retry_count+1,
              processing_started_at=NOW(), last_attempt_at=NOW(),
              processing_lease_id=uuid_generate_v4()
        WHERE event_id=ANY($1::varchar[])
          AND status IN ('failed_retryable','retryable_no_local_record')
      RETURNING event_id, metadata, processing_lease_id::text AS lease_id`,
      [candidates.map((row) => row.event_id)]
    );
  });

  const outcomes = [];
  for (const row of rows) {
    let eventLock = null;
    try {
      const event = row.metadata?.event_snapshot;
      if (!event || event.id !== row.event_id
          || !REPLAY_REQUIRED_EVENT_TYPES.has(event.type)
          || event.account !== null || !event.data?.object
          || !stripeEventModeMatches(event)) {
        throw new Error('platform_webhook_inbox_snapshot_invalid');
      }
      eventLock = await holdWebhookEventLock(event.id);
      if (!eventLock) throw new Error('platform_webhook_worker_in_progress');
      const result = await dispatchPlatformEvent(event);
      if (result.foundLocal === false) {
        const finished = await pool.query(
          `UPDATE processed_webhook_events
              SET status='retryable_no_local_record',
                  failure_reason='no_local_record', last_attempt_at=NOW()
            WHERE event_id=$1 AND processing_lease_id=$2::uuid
              AND status='processing'`,
          [event.id, row.lease_id]
        );
        assertPlatformLeaseFinish(finished.rowCount);
        outcomes.push({ eventId: event.id, processed: false, noLocalRecord: true });
      } else {
        const finished = await pool.query(
          `UPDATE processed_webhook_events
              SET status='processed', processed_at=NOW(), failure_reason=NULL,
                  last_attempt_at=NOW(), metadata=metadata - 'event_snapshot'
            WHERE event_id=$1 AND processing_lease_id=$2::uuid
              AND status='processing'`,
          [event.id, row.lease_id]
        );
        assertPlatformLeaseFinish(finished.rowCount);
        outcomes.push({ eventId: event.id, processed: true, ...result });
      }
    } catch (err) {
      try {
        const finished = await pool.query(
          `UPDATE processed_webhook_events
              SET status='failed_retryable', failure_reason=$3,
                  last_attempt_at=NOW()
            WHERE event_id=$1 AND processing_lease_id=$2::uuid
              AND status='processing'`,
          [row.event_id, row.lease_id, String(err.code || err.message).slice(0, 500)]
        );
        assertPlatformLeaseFinish(finished.rowCount);
      } catch (finishErr) {
        logger.error('platform_webhook_inbox_finish_failed', {
          event_id: row.event_id, error: finishErr.message,
        });
      }
      logger.error('platform_webhook_inbox_retry_failed', {
        event_id: row.event_id, error: err.message, code: err.code || null,
      });
      outcomes.push({ eventId: row.event_id, error: err.code || err.message });
    } finally {
      if (eventLock) await eventLock.release();
    }
  }
  return outcomes;
}

router.post('/stripe/connect', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.STRIPE_CONNECT_WEBHOOK_SECRET) {
    // Sin secreto configurado el endpoint no puede verificar nada. 503 (no 400)
    // para que Stripe reintente cuando quede configurado, en vez de darlo por
    // rechazado.
    logger.warn('connect_webhook_not_configured');
    return res.status(503).json({ received: false, reason: 'connect_webhook_not_configured' });
  }

  let event;
  try {
    event = stripeService.verifyConnectWebhookSignature(req.body, req.headers['stripe-signature']);
  } catch (err) {
    logger.error('connect_webhook_signature_invalid', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (!stripeEventModeMatches(event)) {
    logger.error('connect_webhook_livemode_mismatch', { event_id: event.id, type: event.type, account: event.account || null, livemode: event.livemode });
    return res.status(400).json({ received: false, error: 'webhook_livemode_mismatch' });
  }

  const acctId = event.account || null;
  logger.info('connect_webhook_received', {
    event_id: event.id, type: event.type, account: acctId,
  });

  // Un evento SIN `account` no viene de una cuenta conectada: llegó al endpoint
  // equivocado (endpoint mal scopeado en Stripe, o un `stripe listen` apuntado
  // acá). Se descarta ANTES de tocar processed_webhook_events: la PK de esa
  // tabla es sólo event_id, así que anotarlo bloquearía el mismo evento en el
  // endpoint de plataforma — un pago sin procesar.
  if (!acctId) {
    logger.warn('connect_webhook_without_account', { event_id: event.id, type: event.type });
    return res.json({ received: true, ignored: 'no_account' });
  }

  // N-01: mismo cierre que en /stripe. Este endpoint tenía el defecto idéntico.
  const lockResult = await acquireWebhookEventLock(event.id);
  if (lockResult.status === 'unavailable') {
    logger.error('connect_webhook_lock_unavailable', {
      event_id: event.id, type: event.type, account: acctId,
      error: lockResult.error.message, code: lockResult.error.code || null,
    });
    return res.status(503).json({ received: false, error: 'webhook_lock_unavailable' });
  }
  if (lockResult.status === 'in_progress') {
    logger.info('connect_webhook_worker_in_progress', {
      event_id: event.id, type: event.type, account: acctId,
    });
    return res.status(503).json({ received: false, in_progress: true });
  }
  const eventLock = lockResult.lock;
  releaseWebhookLockWithResponse(res, eventLock);

  let connectLeaseId = null;
  try {
    const slot = await acquireConnectSlot(event);
    if (slot.state === 'duplicate_processed') return res.json({ received: true, duplicate: true });
    if (slot.state === 'in_progress') return res.status(503).json({ received: false, in_progress: true });
    if (slot.state === 'failed_terminal') {
      logger.error('connect_webhook_failed_terminal', { event_id: event.id, type: event.type });
      return res.json({ received: true, terminal: true });
    }
    connectLeaseId = slot.leaseId;

    const restaurant = await connectService.findRestaurantByAccount(acctId);
    if (!restaurant) {
      // Cuenta que no conocemos (huérfana de una carrera, o de otro entorno).
      logger.warn('connect_webhook_unknown_account', { event_id: event.id, account: acctId });
      await finishConnectSlot(event.id, connectLeaseId, true, 'unknown_account');
      return res.json({ received: true, ignored: 'unknown_account' });
    }

    // ── v2.24 · el HOLD de garantía puede vivir en la cuenta conectada ──
    // Sus eventos (amount_capturable_updated del 3DS, succeeded de la captura,
    // canceled de la liberación) entran por acá. Igual que con los pagos, la
    // metadata NO alcanza como prueba: se exige que la mesa referida sea de
    // ESTE restaurante — relación que controla PayMe, no la cuenta conectada.
    const piGar = event.type.startsWith('payment_intent.') ? event.data?.object : null;
    if (restaurant && piGar?.metadata?.kind === 'guarantee_auth') {
      // Una cuenta Standard controla por completo sus PaymentIntents y metadata.
      // El handler exige el PI/riel/monto/fee ya sellados localmente; jamás bindea
      // o abre una mesa a partir del payload del restaurante.
      const guaranteeResult = await handleGuaranteeIntentEvent(
        event.type, piGar, acctId, restaurant.id
      );
      await finishConnectSlot(
        event.id, connectLeaseId, true, guaranteeResult.ignored || null
      );
      return res.json({
        received: true,
        ...(guaranteeResult.ignored && { ignored: guaranteeResult.ignored }),
      });
    }

    switch (event.type) {
      case 'account.updated': {
        // Se RELEE la cuenta en vez de usar event.data.object: Stripe no
        // garantiza orden de entrega y el KYC dispara varios account.updated
        // seguidos, así que el payload de un evento viejo podía pisar el estado
        // nuevo. Releer siempre converge al estado actual.
        const saved = await connectService.syncAccount(restaurant.id, acctId);
        logger.audit('connect_account_synced', {
          restaurant_id: restaurant.id, account: acctId,
          status: saved?.stripe_account_status,
          charges_enabled: saved?.stripe_charges_enabled,
        });
        break;
      }
      case 'capability.updated':
        // El payload es la capability, no la cuenta → hay que releerla igual.
        await connectService.syncAccount(restaurant.id, acctId);
        logger.audit('connect_capability_synced', {
          restaurant_id: restaurant.id, account: acctId,
          capability: event.data.object?.id, status: event.data.object?.status,
        });
        break;
      case 'account.application.deauthorized':
        // El restaurante desconectó su cuenta: deja de poder cobrar por acá.
        await pool.query(
          `UPDATE restaurants
              SET stripe_account_status='disabled', stripe_charges_enabled=false,
                  stripe_payouts_enabled=false, stripe_account_synced_at=NOW()
            WHERE id = $1`,
          [restaurant.id]
        );
        logger.error('connect_account_deauthorized', {
          restaurant_id: restaurant.id, account: acctId,
        });
        break;
      // ─── v2.23 · pagos hechos EN la cuenta conectada (direct charges) ────
      //
      // ⚠️ SUPERFICIE NO CONFIABLE. Acá el emisor del evento es el RESTAURANTE:
      // con una cuenta Standard puede crear PaymentIntents propios y elegir su
      // metadata. Por eso este camino NO usa el ruteo de la plataforma:
      //   · JAMÁS toca topups (viven siempre en la cuenta de PayMe): sin este
      //     corte, un `metadata.topup_id` inventado acreditaría saldo gratis.
      //   · Solo actúa sobre un attempt cuyo intent_id y account_id PayMe ya
      //     selló. Pertenecer al restaurante o copiar metadata NO alcanza.
      // Un cobro sin metadata PayMe se ACKea como ajeno. Si declara attempt_id
      // pero aún no existe binding durable, queda retryable para que la API o
      // el worker recupere el PI con la idempotency key de PayMe.
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
      case 'payment_intent.processing': {
        const pi = event.data.object;
        const expectedStatus = {
          'payment_intent.succeeded': 'succeeded',
          'payment_intent.payment_failed': 'requires_payment_method',
          'payment_intent.canceled': 'canceled',
          'payment_intent.processing': 'processing',
        }[event.type];
        const attempt = await findConnectAttempt(pi, acctId);
        if (!attempt) {
          const ajeno = await ackOrRetryUnbound(event, pi, acctId);
          if (ajeno.retry) {
            await finishConnectSlot(
              event.id, connectLeaseId, false,
              ajeno.reason || 'attempt_no_encontrado_todavia'
            );
            return res.status(500).json({ received: false, retry: true });
          }
          await finishConnectSlot(event.id, connectLeaseId, true, ajeno.reason);
          return res.json({ received: true, ignored: ajeno.reason });
        }
        assertAttemptIntentContract(attempt, pi, acctId, expectedStatus);
        const handler = {
          'payment_intent.succeeded': (a) => handleMesaPaymentSucceeded(a, pi, acctId),
          'payment_intent.payment_failed': (a) => handleMesaPaymentFailed(a, pi),
          'payment_intent.canceled': handleMesaPaymentCancelled,
          'payment_intent.processing': (a) => handleAttemptProcessing(a),
        }[event.type];
        await handler(attempt);
        break;
      }
      case 'charge.refunded':
      case 'refund.created':
      case 'refund.updated':
      case 'refund.failed': {
        const result = await processConnectRefundEvent(event, restaurant);
        if (result.ignored) {
          await finishConnectSlot(event.id, connectLeaseId, true, result.ignored);
          return res.json({ received: true, ignored: result.ignored });
        }
        if (result.refund?.partial) {
          logger.error('connect_partial_refund_manual_review', {
            event_id: event.id, attempt_id: result.attemptId,
            obligation_id: result.refund.obligationId,
            reason: 'partial_refund_principal_tip_policy_pending',
          });
        }
        break;
      }
      default:
        logger.debug('connect_webhook_unhandled', { type: event.type, account: acctId });
    }

    await finishConnectSlot(event.id, connectLeaseId, true, null);
    return res.json({ received: true });
  } catch (err) {
    logger.error('connect_webhook_failed', {
      event_id: event.id, type: event.type, account: acctId, error: err.message,
    });
    if (connectLeaseId) {
      try {
        await finishConnectSlot(event.id, connectLeaseId, false, err.message);
      } catch (finishErr) {
        logger.error('connect_webhook_slot_update_failed', {
          event_id: event.id, error: finishErr.message,
        });
      }
    }
    const status = err.code === 'webhook_event_binding_conflict' ? 400 : 500;
    return res.status(status).json({
      received: false,
      ...(status === 400 && { error: err.code }),
    });
  }
});

router.sweepRetryableConnectRefundInbox = sweepRetryableConnectRefundInbox;
router.sweepRetryablePlatformWebhookInbox = sweepRetryablePlatformWebhookInbox;
module.exports = router;
