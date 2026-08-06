/**
 * Contrato y aplicación transaccional de resultados Stripe para topups.
 *
 * Un `topup_id` en metadata sirve para localizar una fila, nunca para
 * autorizarla. Antes de bindear o acreditar se compara el PaymentIntent con el
 * snapshot durable persistido antes del primer side effect remoto.
 */
'use strict';

const pool = require('../db/pool');
const notifs = require('./notifications');
const { centsToDisplay, sumCents } = require('../utils/money');
const logger = require('../utils/logger');

const ACTIVE_STATUSES = new Set(['pending', 'processing']);
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'expired', 'cancelled']);

function objectId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function providerKey(topup) {
  return `topup_${topup.method}_${topup.id}`;
}

function assertTopupIntentContract(topup, intent) {
  const expectedType = `topup_${topup.method}`;
  const expectedPaymentMethodType = topup.method === 'card' ? 'card' : 'oxxo';
  const methodTypes = Array.isArray(intent?.payment_method_types)
    ? intent.payment_method_types
    : [];
  const mismatches = [];

  if (!topup?.stripe_contract_prepared_at) mismatches.push('contract_not_prepared');
  if (!intent?.id || typeof intent.id !== 'string') mismatches.push('id');
  if (topup?.stripe_payment_intent_id
      && topup.stripe_payment_intent_id !== intent?.id) mismatches.push('bound_intent');
  if (!Number.isSafeInteger(Number(topup?.amount_cents))
      || Number(topup.amount_cents) <= 0
      || Number(intent?.amount) !== Number(topup.amount_cents)) mismatches.push('amount');
  if (intent?.status === 'succeeded'
      && (!Number.isSafeInteger(Number(intent?.amount_received))
        || Number(intent.amount_received) !== Number(topup.amount_cents))) {
    mismatches.push('amount_received');
  }
  if (String(intent?.currency || '').toLowerCase() !== 'mxn') mismatches.push('currency');
  if (intent?.capture_method !== 'automatic') mismatches.push('capture_method');
  if (objectId(intent?.customer) !== topup?.stripe_customer_id_snapshot) mismatches.push('customer');
  if (intent?.metadata?.topup_id !== topup?.id) mismatches.push('metadata.topup_id');
  if (intent?.metadata?.payme_user_id !== topup?.user_id) mismatches.push('metadata.payme_user_id');
  if (intent?.metadata?.type !== expectedType) mismatches.push('metadata.type');
  if (methodTypes.length !== 1 || methodTypes[0] !== expectedPaymentMethodType) {
    mismatches.push('payment_method_types');
  }

  if (topup?.method === 'card') {
    if (!topup.stripe_payment_method_id_snapshot
        || objectId(intent?.payment_method) !== topup.stripe_payment_method_id_snapshot) {
      mismatches.push('payment_method');
    }
  } else if (topup?.method === 'oxxo') {
    if (!topup.billing_email_snapshot || !topup.billing_name_snapshot) {
      mismatches.push('billing_snapshot');
    }
  } else {
    mismatches.push('method');
  }

  if (mismatches.length > 0) {
    const err = new Error('topup_payment_intent_contract_mismatch');
    err.code = 'topup_payment_intent_contract_mismatch';
    err.details = { mismatches, topup_id: topup?.id || null, intent_id: intent?.id || null };
    throw err;
  }
}

function localStatusForIntent(intent) {
  switch (intent?.status) {
    case 'succeeded': return 'succeeded';
    case 'processing':
    case 'requires_action': return 'processing';
    case 'requires_payment_method': return 'failed';
    case 'canceled': return 'cancelled';
    default: {
      const err = new Error('topup_payment_intent_state_unresolved');
      err.code = 'topup_payment_intent_state_unresolved';
      err.remoteStatus = intent?.status || null;
      throw err;
    }
  }
}

async function lockTopup(client, topupId) {
  const { rows: [topup] } = await client.query(
    `SELECT id, user_id, method, amount_cents, status, failure_reason,
            stripe_payment_intent_id, stripe_client_secret, stripe_status,
            stripe_contract_prepared_at,
            stripe_customer_id_snapshot, stripe_payment_method_id_snapshot,
            billing_email_snapshot, billing_name_snapshot,
            stripe_voucher_url, voucher_reference, voucher_expires_at
       FROM topups WHERE id=$1 FOR UPDATE`,
    [topupId]
  );
  if (!topup) {
    const err = new Error('topup_not_found');
    err.code = 'topup_not_found';
    throw err;
  }
  return topup;
}

function validateVoucher(voucher) {
  if (!voucher) return null;
  const expiresAt = voucher.expires_at instanceof Date
    ? voucher.expires_at
    : new Date(voucher.expires_at);
  if (!voucher.voucher_url || !voucher.voucher_number
      || Number.isNaN(expiresAt.getTime())) {
    const err = new Error('topup_voucher_contract_mismatch');
    err.code = 'topup_voucher_contract_mismatch';
    throw err;
  }
  return { ...voucher, expires_at: expiresAt };
}

/**
 * Bindea y aplica un resultado remoto exacto bajo un único lock de topup.
 * El crédito de wallet y la transición a succeeded comparten transacción.
 */
async function applyTopupIntent({ topupId, intent, voucher = null }) {
  return pool.tx(async (client) => {
    const topup = await lockTopup(client, topupId);
    assertTopupIntentContract(topup, intent);
    const nextStatus = localStatusForIntent(intent);
    const normalizedVoucher = topup.method === 'oxxo' ? validateVoucher(voucher) : null;

    if (topup.stripe_payment_intent_id
        && topup.stripe_payment_intent_id !== intent.id) {
      throw Object.assign(new Error('topup_payment_intent_binding_conflict'), {
        code: 'topup_payment_intent_binding_conflict',
      });
    }

    // Los eventos de fallo/cancelación fuera de orden jamás pisan dinero ya
    // acreditado. Un supuesto éxito posterior a un terminal negativo se manda
    // a revisión: el flujo nuevo no permite producir esa combinación.
    if (topup.status === 'succeeded') {
      if (nextStatus !== 'succeeded') {
        logger.warn('topup_terminal_event_ignored', {
          topup_id: topup.id, local_status: topup.status, remote_status: intent.status,
        });
      }
      return { topup: { ...topup, status: 'succeeded' }, credited: false, idempotent: true };
    }
    const exactTerminalSuccessRescue = ['failed', 'cancelled'].includes(topup.status)
      && nextStatus === 'succeeded'
      && topup.stripe_payment_intent_id === intent.id;
    if (TERMINAL_STATUSES.has(topup.status) && !exactTerminalSuccessRescue) {
      if (topup.status === nextStatus) {
        return { topup, credited: false, idempotent: true };
      }
      const err = new Error('topup_terminal_state_conflict');
      err.code = 'topup_terminal_state_conflict';
      err.details = { local_status: topup.status, remote_status: intent.status };
      throw err;
    }
    if (!ACTIVE_STATUSES.has(topup.status) && !exactTerminalSuccessRescue) {
      throw Object.assign(new Error('topup_local_state_unresolved'), {
        code: 'topup_local_state_unresolved',
      });
    }
    const voucherAlreadyPersisted = topup.method !== 'oxxo'
      || (topup.stripe_voucher_url && topup.voucher_reference && topup.voucher_expires_at);
    if (topup.stripe_payment_intent_id === intent.id
        && topup.stripe_status === intent.status
        && topup.status === nextStatus
        && (!normalizedVoucher || voucherAlreadyPersisted)) {
      return { topup, credited: false, idempotent: true };
    }

    const failureReason = nextStatus === 'failed'
      ? (intent.last_payment_error?.message || intent.last_payment_error?.code || 'requires_payment_method')
      : null;
    const voucherSql = normalizedVoucher
      ? `, stripe_voucher_url=$4, voucher_reference=$5, voucher_expires_at=$6`
      : '';
    const params = normalizedVoucher
      ? [topup.id, intent.id, nextStatus, normalizedVoucher.voucher_url,
        normalizedVoucher.voucher_number, normalizedVoucher.expires_at, failureReason]
      : [topup.id, intent.id, nextStatus, failureReason];
    const failureIndex = normalizedVoucher ? 7 : 4;
    params.push(intent.client_secret || null);
    const clientSecretIndex = params.length;
    params.push(intent.status);
    const stripeStatusIndex = params.length;
    await client.query(
      `UPDATE topups
          SET stripe_payment_intent_id=$2,
              stripe_client_secret=$${clientSecretIndex},
              stripe_status=$${stripeStatusIndex}, status=$3,
              failure_reason=$${failureIndex}, updated_at=NOW()${voucherSql}
        WHERE id=$1`,
      params
    );

    if (nextStatus !== 'succeeded') {
      if (nextStatus === 'failed') {
        await notifs.create({
          client, user_id: topup.user_id, type: 'topup_failed',
          body: `No pudimos acreditar tu carga de ${centsToDisplay(Number(topup.amount_cents))}.`,
          payload: {
            amount_cents: Number(topup.amount_cents),
            reason: intent.last_payment_error?.code || null,
          },
          related_entity_type: 'topup', related_entity_id: topup.id,
        });
      }
      return {
        topup: {
          ...topup, stripe_payment_intent_id: intent.id,
          stripe_client_secret: intent.client_secret || null,
          stripe_status: intent.status, status: nextStatus,
        },
        credited: false, idempotent: false,
      };
    }

    // Dos topups distintos del mismo usuario pueden confirmar a la vez. La
    // creación idempotente evita la carrera de INSERT sobre wallets(user_id),
    // y el FOR UPDATE serializa los saldos posteriores.
    await client.query(
      `INSERT INTO wallets (user_id, balance_cents)
       VALUES ($1,0) ON CONFLICT (user_id) DO NOTHING`,
      [topup.user_id]
    );
    const { rows: [wallet] } = await client.query(
      `SELECT id, balance_cents FROM wallets WHERE user_id=$1 FOR UPDATE`,
      [topup.user_id]
    );
    const durableWallet = wallet;
    if (!durableWallet) throw new Error('topup_wallet_not_found_after_upsert');
    const newBalance = sumCents(durableWallet.balance_cents, topup.amount_cents);
    await client.query(
      `UPDATE wallets SET balance_cents=$1, updated_at=NOW() WHERE id=$2`,
      [newBalance, durableWallet.id]
    );
    await client.query(
      `INSERT INTO wallet_transactions
         (wallet_id, user_id, type, amount_cents, balance_after_cents,
          related_entity_type, related_entity_id, description)
       VALUES ($1,$2,$3,$4,$5,'topup',$6,$7)`,
      [durableWallet.id, topup.user_id,
       topup.method === 'oxxo' ? 'topup_oxxo' : 'topup_card',
       topup.amount_cents, newBalance, topup.id,
       `Carga de saldo vía ${topup.method.toUpperCase()}`]
    );
    await notifs.create({
      client, user_id: topup.user_id, type: 'topup_succeeded',
      body: `Se acreditaron ${centsToDisplay(Number(topup.amount_cents))} a tu saldo PayMe`,
      payload: {
        amount_cents: Number(topup.amount_cents), method: topup.method,
        new_balance: newBalance,
      },
      related_entity_type: 'topup', related_entity_id: topup.id,
    });

    return {
      topup: {
        ...topup, stripe_payment_intent_id: intent.id,
        stripe_client_secret: intent.client_secret || null,
        stripe_status: intent.status,
        status: 'succeeded', failure_reason: null,
      },
      credited: true, idempotent: false, newBalance,
    };
  });
}

module.exports = {
  providerKey,
  assertTopupIntentContract,
  localStatusForIntent,
  applyTopupIntent,
};
