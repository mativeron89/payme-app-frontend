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

const express = require('express');
const pool = require('../db/pool');
const eventEmitter = require('../services/eventEmitter');
const stripeService = require('../services/stripe');
const savedCards = require('../services/savedCards');   // D4 (v2.16)
const itemClaims = require('../services/itemClaims');   // v2.18 (fracciones)
const stateMachine = require('../utils/stateMachine');
const paymentProcessor = require('../services/paymentProcessor');
const notifs = require('../services/notifications');
const { centsToDisplay } = require('../utils/money');
const logger = require('../utils/logger');

const router = express.Router();

const MAX_WEBHOOK_RETRIES = Number(process.env.WEBHOOK_MAX_RETRIES) || 10;

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripeService.verifyWebhookSignature(req.body, req.headers['stripe-signature']);
  } catch (err) {
    logger.error('webhook_signature_invalid', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  logger.webhook(event);

  const acquired = await acquireWebhookSlot(event);
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
    // ── v2.11 (parche §3 · garantía): interceptar PIs de guarantee_auth ──
    // Los PaymentIntents del hold de garantía NO son attempts ni topups; si caen
    // en el routing normal terminan en retryable_no_local_record y ensucian el
    // retry-loop. Se manejan acá y se responde 200.
    const piObj = event.type.startsWith('payment_intent.') ? event.data.object : null;

    // D4 (v2.16): tarjeta guardada por 3DS — si el PI pedía guardar
    // (metadata.save_pm) y el desafío terminó bien (pago confirmado o hold
    // autorizado), espejar la tarjeta localmente. Cubre pago Y garantía en un
    // solo punto. Best-effort: mirrorSavedPaymentMethod jamás lanza, el
    // webhook sigue su curso normal.
    if (piObj && piObj.metadata?.save_pm === '1' && piObj.payment_method
        && piObj.metadata.user_id && piObj.metadata.user_id !== 'guest'
        && (event.type === 'payment_intent.succeeded'
            || event.type === 'payment_intent.amount_capturable_updated')) {
      await savedCards.mirrorSavedPaymentMethod(piObj.metadata.user_id, piObj.payment_method);
    }

    if (piObj && piObj.metadata && piObj.metadata.kind === 'guarantee_auth') {
      await handleGuaranteeIntentEvent(event.type, piObj);
      await pool.query(
        `UPDATE processed_webhook_events
            SET status='processed', processed_at=NOW(), last_attempt_at=NOW()
          WHERE event_id = $1`,
        [event.id]
      );
      return res.json({ received: true, guarantee: true });
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

    if (foundLocal === false) {
      const newCount = await markRetryableNoLocalRecord(event);
      logger.warn('webhook_no_local_record_will_retry', {
        event_id: event.id, type: event.type, retry_count: newCount,
      });
      if (newCount >= MAX_WEBHOOK_RETRIES) {
        await pool.query(
          `UPDATE processed_webhook_events
              SET status='failed_terminal',
                  failure_reason='max_retries_no_local_record',
                  last_attempt_at = NOW()
            WHERE event_id = $1`,
          [event.id]
        );
        logger.error('webhook_max_retries_reached', {
          event_id: event.id, type: event.type, retry_count: newCount,
        });
        return res.json({
          received: true, terminal: true, reason: 'max_retries_no_local_record',
        });
      }
      return res.status(503).json({ received: false, no_local_record: true });
    }

    await pool.query(
      `UPDATE processed_webhook_events
          SET status='processed', processed_at=NOW(), last_attempt_at=NOW()
        WHERE event_id = $1`,
      [event.id]
    );
    res.json({ received: true });
  } catch (err) {
    logger.error('webhook_handler_error', {
      event_id: event.id, type: event.type,
      error: err.message, stack: err.stack,
    });
    const failStatus = await markFailedAfterError(event, err.message);
    if (failStatus === 'failed_terminal') {
      return res.json({ received: true, terminal: true, error: 'handler_failed' });
    }
    res.status(500).json({ received: false, error: 'handler_failed' });
  }
});

/**
 * Toma el slot del webhook.
 *
 * v2.5.2 P1 #5: el reacquire de retryables es atómico (UPDATE ... RETURNING).
 *
 * Returns: 'acquired' | 'duplicate_processed' | 'in_progress' | 'failed_terminal'
 */
async function acquireWebhookSlot(event) {
  try {
    await pool.query(
      `INSERT INTO processed_webhook_events
         (event_id, provider, event_type, status, metadata)
       VALUES ($1, 'stripe', $2, 'processing', $3)`,
      [event.id, event.type, { livemode: event.livemode }]
    );
    return 'acquired';
  } catch (err) {
    if (err.code !== '23505') throw err;

    const { rows } = await pool.query(
      `SELECT status, retry_count FROM processed_webhook_events WHERE event_id = $1`,
      [event.id]
    );
    const cur = rows[0]?.status;
    const retryCount = Number(rows[0]?.retry_count || 0);

    if (cur === 'processed') {
      logger.info('webhook_already_processed', { event_id: event.id, type: event.type });
      return 'duplicate_processed';
    }
    if (cur === 'processing') {
      logger.info('webhook_in_progress', { event_id: event.id });
      return 'in_progress';
    }
    if (cur === 'failed_terminal') {
      return 'failed_terminal';
    }
    if (cur === 'retryable_no_local_record' || cur === 'failed_retryable') {
      if (retryCount >= MAX_WEBHOOK_RETRIES) {
        await pool.query(
          `UPDATE processed_webhook_events
              SET status='failed_terminal',
                  failure_reason = COALESCE(failure_reason, 'max_retries_reached'),
                  last_attempt_at = NOW()
            WHERE event_id = $1`,
          [event.id]
        );
        return 'failed_terminal';
      }
      // ─── v2.5.2 P1 #5: reacquire ATÓMICO ───
      // Solo un worker puede mover de retryable→processing. El WHERE con los
      // estados retryables actúa como guard: si otro worker ya lo movió a
      // 'processing', este UPDATE no matchea y devuelve 0 filas.
      const { rows: upd } = await pool.query(
        `UPDATE processed_webhook_events
            SET status='processing',
                processing_started_at = NOW(),
                last_attempt_at = NOW()
          WHERE event_id = $1
            AND status IN ('retryable_no_local_record','failed_retryable')
        RETURNING event_id`,
        [event.id]
      );
      if (upd.length === 0) {
        logger.info('webhook_reacquire_lost_race', { event_id: event.id });
        return 'in_progress';
      }
      logger.info('webhook_retry_reacquired', {
        event_id: event.id, previous_status: cur, retry_count: retryCount,
      });
      return 'acquired';
    }
    return 'acquired';
  }
}

async function markRetryableNoLocalRecord(event) {
  const { rows } = await pool.query(
    `UPDATE processed_webhook_events
        SET status='retryable_no_local_record',
            failure_reason='no_local_record',
            retry_count = retry_count + 1,
            last_attempt_at = NOW()
      WHERE event_id = $1
  RETURNING retry_count`,
    [event.id]
  );
  return Number(rows[0]?.retry_count || 0);
}

async function markFailedAfterError(event, reason) {
  const { rows } = await pool.query(
    `UPDATE processed_webhook_events
        SET retry_count = retry_count + 1,
            failure_reason = $2,
            last_attempt_at = NOW(),
            status = CASE
              WHEN retry_count + 1 >= $3 THEN 'failed_terminal'
              ELSE 'failed_retryable'
            END
      WHERE event_id = $1
  RETURNING status`,
    [event.id, (reason || '').slice(0, 500), MAX_WEBHOOK_RETRIES]
  );
  return rows[0]?.status;
}

// ═══════════════════════════════════════════════════════════
// Routing
// ═══════════════════════════════════════════════════════════
async function routeSucceeded(pi) {
  let topup = await findTopupByIntent(pi.id);
  if (!topup && pi.metadata?.topup_id) {
    topup = await reconcileTopupByMetadata(pi.id, pi.metadata.topup_id);
  }
  if (topup) { await handleTopupSucceeded(topup); return true; }

  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(pi.id, pi.metadata.attempt_id);
  }
  if (attempt) { await handleMesaPaymentSucceeded(attempt); return true; }
  return false;
}

async function routeFailed(pi) {
  let topup = await findTopupByIntent(pi.id);
  if (!topup && pi.metadata?.topup_id) {
    topup = await reconcileTopupByMetadata(pi.id, pi.metadata.topup_id);
  }
  if (topup) { await handleTopupFailed(topup, pi); return true; }

  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(pi.id, pi.metadata.attempt_id);
  }
  if (attempt) { await handleMesaPaymentFailed(attempt, pi); return true; }
  return false;
}

async function routeCancelled(pi) {
  let topup = await findTopupByIntent(pi.id);
  if (!topup && pi.metadata?.topup_id) {
    topup = await reconcileTopupByMetadata(pi.id, pi.metadata.topup_id);
  }
  if (topup) {
    // v2.11 (A12): nunca cancelar un topup ya acreditado/terminal (out-of-order)
    await pool.query(
      `UPDATE topups SET status='cancelled' WHERE id=$1 AND status IN ('pending','processing')`,
      [topup.id]
    );
    return true;
  }
  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(pi.id, pi.metadata.attempt_id);
  }
  if (attempt) { await handleMesaPaymentCancelled(attempt); return true; }
  return false;
}

async function routeProcessing(pi) {
  let topup = await findTopupByIntent(pi.id);
  if (!topup && pi.metadata?.topup_id) {
    topup = await reconcileTopupByMetadata(pi.id, pi.metadata.topup_id);
  }
  if (topup) {
    await pool.query(
      `UPDATE topups SET status='processing' WHERE id=$1 AND status IN ('pending')`,
      [topup.id]
    );
    return true;
  }
  let attempt = await findAttemptByIntent(pi.id);
  if (!attempt && pi.metadata?.attempt_id) {
    attempt = await reconcileAttemptByMetadata(pi.id, pi.metadata.attempt_id);
  }
  if (attempt) {
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

async function findAttemptByIntent(intentId) {
  const { rows } = await pool.query(
    `SELECT id, status, mesa_id, user_id, stripe_payment_intent_id
       FROM payment_attempts WHERE stripe_payment_intent_id = $1`, [intentId]
  );
  return rows[0] || null;
}

async function reconcileTopupByMetadata(intentId, topupId) {
  const { rows } = await pool.query(
    `UPDATE topups
        SET stripe_payment_intent_id = $1
      WHERE id = $2 AND stripe_payment_intent_id IS NULL
  RETURNING id, user_id, method, amount_cents, status`,
    [intentId, topupId]
  );
  const t = rows[0];
  if (t) {
    logger.audit('topup_reconciled_by_metadata', { topup_id: t.id, intent_id: intentId });
    return t;
  }
  const { rows: existing } = await pool.query(
    `SELECT id, user_id, method, amount_cents, status FROM topups WHERE id = $1`, [topupId]
  );
  return existing[0] || null;
}

async function reconcileAttemptByMetadata(intentId, attemptId) {
  const { rows } = await pool.query(
    `UPDATE payment_attempts
        SET stripe_payment_intent_id = $1
      WHERE id = $2 AND stripe_payment_intent_id IS NULL
  RETURNING id, status, mesa_id, user_id`,
    [intentId, attemptId]
  );
  const a = rows[0];
  if (a) {
    logger.audit('attempt_reconciled_by_metadata', { attempt_id: a.id, intent_id: intentId });
    return a;
  }
  const { rows: existing } = await pool.query(
    `SELECT id, status, mesa_id, user_id FROM payment_attempts WHERE id = $1`, [attemptId]
  );
  return existing[0] || null;
}

// ═══════════════════════════════════════════════════════════
// Handlers
// ═══════════════════════════════════════════════════════════
async function handleTopupSucceeded(topup) {
  if (topup.status === 'succeeded') return;
  await pool.tx(async (client) => {
    const { rows: fresh } = await client.query(
      `SELECT id, user_id, method, amount_cents, status FROM topups WHERE id = $1 FOR UPDATE`,
      [topup.id]
    );
    const t = fresh[0];
    if (!t || t.status === 'succeeded') return;

    const { rows: wRows } = await client.query(
      `SELECT id, balance_cents FROM wallets WHERE user_id = $1 FOR UPDATE`, [t.user_id]
    );
    let wallet = wRows[0];
    if (!wallet) {
      const { rows: newW } = await client.query(
        `INSERT INTO wallets (user_id, balance_cents) VALUES ($1, 0) RETURNING id, balance_cents`,
        [t.user_id]
      );
      wallet = newW[0];
    }
    const newBalance = Number(wallet.balance_cents) + Number(t.amount_cents);
    await client.query(`UPDATE topups SET status='succeeded', updated_at=NOW() WHERE id=$1`, [t.id]);
    await client.query(`UPDATE wallets SET balance_cents=$1, updated_at=NOW() WHERE id=$2`, [newBalance, wallet.id]);

    const txType = t.method === 'oxxo' ? 'topup_oxxo' : 'topup_card';
    await client.query(
      `INSERT INTO wallet_transactions
         (wallet_id, user_id, type, amount_cents, balance_after_cents,
          related_entity_type, related_entity_id, description)
       VALUES ($1,$2,$3,$4,$5,'topup',$6,$7)`,
      [wallet.id, t.user_id, txType, t.amount_cents, newBalance,
       t.id, `Carga de saldo vía ${t.method.toUpperCase()}`]
    );
    await notifs.create({
      client, user_id: t.user_id, type: 'topup_succeeded',
      body: `Se acreditaron ${centsToDisplay(Number(t.amount_cents))} a tu saldo PayMe`,
      payload: {
        amount_cents: Number(t.amount_cents),
        method: t.method, new_balance: newBalance,
      },
      related_entity_type: 'topup', related_entity_id: t.id,
    });
  });
}

async function handleTopupFailed(topup, pi) {
  // v2.11 (A12): los webhooks de Stripe pueden llegar FUERA DE ORDEN. Un
  // 'payment_failed' tardío nunca debe pisar un topup ya acreditado
  // ('succeeded' con saldo sumado) ni uno terminal.
  const { rowCount } = await pool.query(
    `UPDATE topups SET status='failed', failure_reason=$1
      WHERE id=$2 AND status IN ('pending','processing')`,
    [pi.last_payment_error?.message || 'unknown', topup.id]
  );
  if (rowCount === 0) {
    logger.warn('topup_failed_ignored_terminal', { topup_id: topup.id, status: topup.status });
    return;
  }
  await notifs.create({
    user_id: topup.user_id, type: 'topup_failed',
    body: `No pudimos acreditar tu carga de ${centsToDisplay(Number(topup.amount_cents))}.`,
    payload: {
      amount_cents: Number(topup.amount_cents),
      reason: pi.last_payment_error?.code,
    },
    related_entity_type: 'topup', related_entity_id: topup.id,
  });
}

async function handleMesaPaymentSucceeded(attempt) {
  await pool.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT status FROM payment_attempts WHERE id = $1 FOR UPDATE`, [attempt.id]
    );
    const cur = rows[0]?.status;
    if (!cur) return;

    if (cur === 'cancelling') {
      logger.warn('webhook_succeeded_while_cancelling', { attempt_id: attempt.id });
      await client.query(`UPDATE payment_attempts SET status='succeeded' WHERE id = $1`, [attempt.id]);
      await client.query(
        `INSERT INTO state_transitions
           (entity_type, entity_id, from_state, to_state, reason, triggered_by)
         VALUES ('payment_attempt', $1, 'cancelling', 'succeeded', 'webhook_won_race', 'webhook')`,
        [attempt.id]
      );
    } else if (['succeeded','processed','refunded'].includes(cur)) {
      // ya está
    } else if (['cancelled', 'failed'].includes(cur)) {
      // ── v2.11 (A11 · P0): Stripe cobró pero el attempt ya fue cerrado local ──
      // Pasa cuando el timer/settle canceló ANTES de que llegara este webhook
      // (la orden común: cancelIntent falla porque el PI ya cobró, y el webhook
      // tarda segundos), o cuando un PI falló y luego se confirmó. Sin esta rama,
      // cancelled/failed→succeeded viola el FSM → 409 → retry-loop de Stripe →
      // "cobrado pero no registrado" terminal.
      // v2.18 (fracciones): el rescate opera sobre CLAIMS. Conflicto = alguna
      // fracción liberada ya no entra en su ítem (otro la tomó). Dos pasadas:
      // primero verifica todas, después restaura — fiel al A11 original (en
      // conflicto NO se restaura nada: succeeded sin procesar → revisión manual).
      const rescue = await itemClaims.restoreAttemptClaims(client, attempt.id);
      let conflict = rescue.conflict;
      if (!conflict && rescue.restored === 0) {
        // COMPAT pre-v2.18: attempt de consumo sin claims — rescate viejo por
        // payment_attempt_items (división 'iguales' queda excluida: sus filas
        // G-07 son dato declarado, no tenencia).
        const { rows: legacyItems } = await client.query(
          `SELECT mi.id, mi.status FROM payment_attempt_items pai
             JOIN mesa_items mi ON mi.id = pai.mesa_item_id
             JOIN mesas m ON m.id = mi.mesa_id
            WHERE pai.payment_attempt_id = $1 AND m.division_mode = 'consumo'
            FOR UPDATE OF mi`,
          [attempt.id]
        );
        conflict = legacyItems.some((r) => r.status !== 'released');
        if (!conflict) {
          for (const it of legacyItems) {
            await client.query(
              `UPDATE mesa_items SET status='locked', locked_by_attempt=$2
                WHERE id=$1 AND status='released'`,
              [it.id, attempt.id]
            );
            await stateMachine.transition({
              client, entityType: 'mesa_item', entityId: it.id,
              fromState: 'released', toState: 'locked',
              reason: 'webhook_late_rescue', triggeredBy: 'webhook',
            });
          }
        }
      }
      await client.query(
        `UPDATE payment_attempts SET status='succeeded', failure_reason=NULL WHERE id = $1`,
        [attempt.id]
      );
      await client.query(
        `INSERT INTO state_transitions
           (entity_type, entity_id, from_state, to_state, reason, triggered_by)
         VALUES ('payment_attempt', $1, $2, 'succeeded', $3, 'webhook')`,
        [attempt.id, cur, conflict ? 'webhook_late_success_conflict' : 'webhook_late_rescue']
      );
      if (conflict) {
        // Alguien más tomó las fracciones liberadas: NO pisar. El cobro queda
        // 'succeeded' SIN procesar → cola de revisión manual (refund probable).
        logger.error('late_success_conflict_manual_review', {
          attempt_id: attempt.id, previous_status: cur, item_id: rescue.item_id,
        });
        return;
      }
      // restoreAttemptClaims ya re-tomó los claims (released→locked) para que
      // processSuccessfulPayment pueda marcarlos paid (released→paid es inválido).
      logger.warn('webhook_late_rescue', {
        attempt_id: attempt.id, previous_status: cur, claims: rescue.restored,
      });
    } else {
      await client.query(`UPDATE payment_attempts SET status='succeeded' WHERE id = $1`, [attempt.id]);
      await stateMachine.transition({
        client, entityType: 'payment_attempt', entityId: attempt.id,
        fromState: cur, toState: 'succeeded',
        reason: 'stripe_webhook', triggeredBy: 'webhook',
      });
    }
    await paymentProcessor.processSuccessfulPayment(client, attempt.id, { triggeredBy: 'webhook' });
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
  await pool.tx(async (client) => {
    const { rows } = await client.query(
      `SELECT status FROM payment_attempts WHERE id = $1 FOR UPDATE`, [attempt.id]
    );
    const cur = rows[0]?.status;
    if (!cur || cur === 'cancelled') return;
    if (['succeeded','processed','refunded'].includes(cur)) {
      logger.warn('webhook_cancelled_but_attempt_succeeded', { attempt_id: attempt.id, status: cur });
      return;
    }
    await client.query(`UPDATE payment_attempts SET status='cancelled' WHERE id=$1`, [attempt.id]);
    await stateMachine.transition({
      client, entityType: 'payment_attempt', entityId: attempt.id,
      fromState: cur, toState: 'cancelled', triggeredBy: 'webhook',
    });
    await client.query(
      `UPDATE mesa_items
          SET status='released',
              locked_by_attempt=NULL,
              locked_by_user_id=NULL,
              locked_by_guest_token=NULL,
              locked_by_guest_token_hash=NULL,
              lock_token=NULL,
              lock_expires_at=NULL
        WHERE locked_by_attempt = $1 AND status = 'locked'`,
      [attempt.id]
    );
    await client.query(
      `UPDATE mesa_division_slots
          SET status='available',
              claimed_by_attempt_id=NULL,
              claimed_by_user_id=NULL,
              claimed_by_guest_token=NULL,
              claimed_by_guest_token_hash=NULL,
              claimed_at=NULL
        WHERE claimed_by_attempt_id = $1 AND status = 'claimed'`,
      [attempt.id]
    );
  });
}

// ═══════════════════════════════════════════════════════════
// charge.refunded (v2.5.1 P0 #4 + #5; v2.5.2 P1 #6 via processRefund)
// ═══════════════════════════════════════════════════════════
async function handleChargeRefunded(charge, event) {
  let attempt = await findAttemptByIntent(charge.payment_intent);
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
async function handleGuaranteeIntentEvent(type, pi) {
  const mesaId = pi.metadata?.mesa_id;
  if (!mesaId) {
    logger.warn('guarantee_event_without_mesa', { intent_id: pi.id, type });
    return true;
  }
  switch (type) {
    case 'payment_intent.amount_capturable_updated': {
      // 3DS completado: el hold quedó autorizado → activar la mesa
      const upd = await pool.tx(async (client) => {
        const r = await client.query(
          `UPDATE mesas
              SET status='open', auth_method='card',
                  auth_payment_intent_id=$2,
                  auth_amount_cents=COALESCE(auth_amount_cents, $3)
            WHERE id=$1 AND status='pending_auth'`,
          [mesaId, pi.id, pi.amount_capturable ?? pi.amount ?? null]
        );
        // Outbox E1c: table_opened cuando el 3DS activa la mesa (misma tx).
        if (r.rowCount === 1) {
          await eventEmitter.enqueueTableOpened(client, mesaId);
          // Outbox E6 (v2.13): hold autorizado → payment_secured (misma tx, seq siguiente).
          await eventEmitter.enqueuePaymentSecured(client, mesaId);
        }
        return r;
      });
      if (upd.rowCount === 1) {
        try {
          await stateMachine.transition({
            entityType: 'mesa', entityId: mesaId,
            fromState: 'pending_auth', toState: 'open',
            reason: 'guarantee_hold_authorized', triggeredBy: 'webhook',
          });
        } catch (e) { logger.warn('guarantee_transition_failed', { mesa_id: mesaId, error: e.message }); }
        logger.audit('guarantee_hold_authorized', { mesa_id: mesaId, intent_id: pi.id });
      }
      return true;
    }
    case 'payment_intent.payment_failed': {
      const upd = await pool.query(
        `UPDATE mesas SET status='auth_failed' WHERE id=$1 AND status = 'pending_auth'`,
        [mesaId]
      );
      if (upd.rowCount === 1) {
        try {
          await stateMachine.transition({
            entityType: 'mesa', entityId: mesaId,
            fromState: 'pending_auth', toState: 'auth_failed',
            reason: pi.last_payment_error?.code || 'guarantee_auth_failed',
            triggeredBy: 'webhook',
          });
        } catch (e) { logger.warn('guarantee_transition_failed', { mesa_id: mesaId, error: e.message }); }
        logger.warn('guarantee_auth_failed_webhook', { mesa_id: mesaId, intent_id: pi.id });
      }
      return true;
    }
    case 'payment_intent.succeeded':
      // Captura del faltante al liquidar (settlement Fase 2). Solo traza.
      logger.audit('guarantee_capture_confirmed', {
        mesa_id: mesaId, intent_id: pi.id, amount_received: pi.amount_received,
      });
      return true;
    case 'payment_intent.canceled':
      // Liberación del hold (shortfall 0 o timer). Solo traza.
      logger.audit('guarantee_hold_released', { mesa_id: mesaId, intent_id: pi.id });
      return true;
    default:
      logger.debug('guarantee_event_ignored', { type, mesa_id: mesaId });
      return true;
  }
}

module.exports = router;
