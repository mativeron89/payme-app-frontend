/**
 * Convergencia única para un PaymentIntent remoto `succeeded`.
 *
 * El resultado puede llegar por respuesta síncrona, webhook o reconciliación
 * posterior a una cancelación ambigua. Todos deben respetar el mismo orden de
 * locks (mesa → attempt → items/claims) y el mismo rescate tardío.
 */
'use strict';

const pool = require('../db/pool');
const paymentProcessor = require('./paymentProcessor');
const itemClaims = require('./itemClaims');
const stateMachine = require('../utils/stateMachine');
const logger = require('../utils/logger');
const { assertPaymentIntentContract } = require('./paymentIntentContract');

async function processRemoteSuccess({
  attemptId, mesaId, remoteIntent, stripeAccountId = null,
  triggeredBy = 'system',
}) {
  return pool.tx(async (client) => {
    const { rows: [mesa] } = await client.query(
      `SELECT id, status, settlement_fenced_at,
              settlement_snapshot_collected_cents,
              settlement_snapshot_tip_cents,
              settlement_snapshot_shortfall_cents
         FROM mesas WHERE id=$1 FOR UPDATE`, [mesaId]
    );
    if (!mesa) return { resolved: false, reason: 'mesa_missing', status: null };

    const { rows: [attempt] } = await client.query(
      `SELECT id, mesa_id, user_id, status, payment_type, operation_type,
              items_amount_cents, tip_amount_cents, gross_amount_cents,
              application_fee_cents,
              stripe_payment_intent_id, stripe_account_id,
              stripe_contract_prepared_at,
              stripe_source_payment_method_id, stripe_charge_payment_method_id,
              stripe_customer_id_snapshot, stripe_used_saved_card,
              stripe_save_payment_method,
              card_policy_version, card_brand_snapshot, card_funding_snapshot,
              card_verified_at, charge_card_verified_at
         FROM payment_attempts WHERE id=$1 FOR UPDATE`,
      [attemptId]
    );
    if (!attempt) return { resolved: false, reason: 'attempt_missing', status: null };
    if (attempt.mesa_id !== mesaId) {
      throw Object.assign(new Error('payment_attempt_mesa_binding_conflict'), {
        code: 'payment_attempt_mesa_binding_conflict',
      });
    }
    assertPaymentIntentContract(attempt, remoteIntent, {
      stripeAccountId,
      expectedStatus: 'succeeded',
    });
    const cur = attempt.status;
    if (['processed', 'refunded'].includes(cur)) {
      return { resolved: true, status: cur, alreadyProcessed: true };
    }

    // La foto de garantía ya quedó sellada. Cortar ANTES del rescate de
    // claims/slots es esencial: incluso restaurar tenencia sería mutar la
    // contabilidad sobre la que se está capturando. Se conserva el éxito remoto
    // y una obligación D1-D durable, pero no se acredita dos veces.
    const quarantined = await paymentProcessor.quarantineLateSuccessAfterSettlementFence(
      client, attempt, mesa, triggeredBy
    );
    if (quarantined) {
      return {
        resolved: true,
        status: 'succeeded',
        accounted: false,
        ...quarantined,
      };
    }

    if (['failed', 'cancelled'].includes(cur)) {
      const equalRescue = await paymentProcessor.reclaimLateEqualSlot(client, attemptId);
      let conflict = false;
      let conflictReason = null;
      if (equalRescue.applies) {
        conflict = equalRescue.conflict;
        conflictReason = equalRescue.reason || null;
      } else {
        const rescue = await itemClaims.restoreAttemptClaims(client, attemptId);
        conflict = rescue.conflict;
        conflictReason = rescue.item_id || null;
        if (!conflict && rescue.restored === 0) {
          const { rows: legacyItems } = await client.query(
            `SELECT mi.id, mi.status FROM payment_attempt_items pai
               JOIN mesa_items mi ON mi.id = pai.mesa_item_id
               JOIN mesas m ON m.id = mi.mesa_id
              WHERE pai.payment_attempt_id=$1 AND m.division_mode='consumo'
              ORDER BY mi.id
              FOR UPDATE OF mi`,
            [attemptId]
          );
          conflict = legacyItems.some((item) => item.status !== 'released');
          conflictReason = conflict ? 'legacy_item_unavailable' : null;
          if (!conflict) {
            for (const item of legacyItems) {
              await client.query(
                `UPDATE mesa_items SET status='locked', locked_by_attempt=$2
                  WHERE id=$1 AND status='released'`,
                [item.id, attemptId]
              );
              await stateMachine.transition({
                client, entityType: 'mesa_item', entityId: item.id,
                fromState: 'released', toState: 'locked',
                reason: 'remote_late_success_rescue', triggeredBy,
              });
            }
          }
        }
      }

      await client.query(
        `UPDATE payment_attempts
            SET status='succeeded', failure_reason=$2
          WHERE id=$1`,
        [attemptId, conflict
          ? `late_success_conflict_manual_review:${String(conflictReason || 'unknown').slice(0, 430)}`
          : null]
      );
      await stateMachine.transition({
        client, entityType: 'payment_attempt', entityId: attemptId,
        fromState: cur, toState: 'succeeded',
        reason: conflict ? 'remote_late_success_conflict' : 'remote_late_success_rescue',
        triggeredBy,
      });
      if (conflict) {
        logger.error('late_success_conflict_manual_review', {
          attempt_id: attemptId, previous_status: cur, reason: conflictReason,
        });
        return { resolved: false, reason: 'late_success_conflict', status: 'succeeded' };
      }
    } else if (cur !== 'succeeded') {
      await client.query(
        `UPDATE payment_attempts SET status='succeeded', failure_reason=NULL WHERE id=$1`,
        [attemptId]
      );
      await stateMachine.transition({
        client, entityType: 'payment_attempt', entityId: attemptId,
        fromState: cur, toState: 'succeeded',
        reason: cur === 'cancelling' ? 'stripe_won_cancel_race' : 'stripe_remote_success',
        triggeredBy,
      });
    }

    const result = await paymentProcessor.processSuccessfulPayment(client, attemptId, {
      triggeredBy,
    });
    if (!result.processed && !result.alreadyProcessed) {
      return {
        resolved: false,
        reason: result.manualReview || result.invalidStatus || 'processing_incomplete',
        status: 'succeeded',
      };
    }
    return { resolved: true, status: 'processed', ...result };
  });
}

module.exports = { processRemoteSuccess };
