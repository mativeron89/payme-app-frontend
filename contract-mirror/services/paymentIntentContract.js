/**
 * Contrato remoto único de un PaymentIntent de pago de mesa.
 *
 * Un webhook firmado acredita el origen del evento, no que sus importes o su
 * metadata coincidan con el attempt local. Del mismo modo, un retrieve/cancel
 * exitoso sólo acredita el objeto devuelto. Toda convergencia remota pasa por
 * esta validación antes de mover estado, claims, propinas o saldo.
 */
'use strict';

const pool = require('../db/pool');
const { prorateCents } = require('../utils/money');

function objectId(value) {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

function normalized(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function contractError(mismatches, attempt, intent) {
  const err = new Error('payment_intent_contract_mismatch');
  err.code = 'payment_intent_contract_mismatch';
  err.details = {
    attempt_id: attempt?.id || null,
    intent_id: intent?.id || null,
    mismatches,
  };
  return err;
}

function assertPaymentIntentContract(attempt, intent, {
  stripeAccountId = attempt?.stripe_account_id || null,
  expectedStatus = null,
  allowedStatuses = null,
  allowIntentBinding = false,
} = {}) {
  const mismatches = [];
  const expectedAccount = normalized(stripeAccountId);
  const localAccount = normalized(attempt?.stripe_account_id);
  const intentId = normalized(intent?.id);
  const expectedAmount = Number(attempt?.gross_amount_cents);
  const expectedFee = Number(attempt?.application_fee_cents || 0);
  const remoteAmount = Number(intent?.amount);
  const remoteFee = Number(intent?.application_fee_amount || 0);
  const expectedCustomer = expectedAccount
    ? null
    : normalized(attempt?.stripe_customer_id_snapshot);
  const expectedSetup = attempt?.stripe_save_payment_method && !expectedAccount
    ? 'off_session'
    : null;
  const types = Array.isArray(intent?.payment_method_types)
    ? intent.payment_method_types
    : [];

  if (!attempt || attempt.operation_type !== 'mesa_pay'
      || !['card', 'apple_pay', 'google_pay'].includes(attempt.payment_type)) {
    mismatches.push('attempt_kind');
  }
  if (!attempt?.stripe_contract_prepared_at
      || !normalized(attempt?.stripe_source_payment_method_id)
      || !normalized(attempt?.stripe_charge_payment_method_id)
      || typeof attempt?.stripe_used_saved_card !== 'boolean'
      || typeof attempt?.stripe_save_payment_method !== 'boolean') {
    mismatches.push('durable_snapshot');
  }
  const hasV1CardEvidence = Number(attempt?.card_policy_version) === 1
    && ['visa', 'mastercard', 'amex'].includes(attempt?.card_brand_snapshot)
    && ['credit', 'debit'].includes(attempt?.card_funding_snapshot)
    && Number.isFinite(Date.parse(attempt?.card_verified_at))
    && Number.isFinite(Date.parse(attempt?.charge_card_verified_at));
  // No se bloquea retroactivamente una obligación remota ya bindeada: policy0
  // sólo puede reconciliar exactamente su PI durable. Todo binding nuevo debe
  // nacer con evidencia v1 completa.
  const hasExplicitCardPolicy = Object.prototype.hasOwnProperty.call(
    attempt || {}, 'card_policy_version'
  );
  const isAlreadyBoundLegacy = hasExplicitCardPolicy
    && Number(attempt.card_policy_version) === 0
    && !!attempt?.stripe_payment_intent_id
    && attempt.stripe_payment_intent_id === intentId;
  if (!hasV1CardEvidence && !isAlreadyBoundLegacy) {
    mismatches.push('card_policy_snapshot');
  }
  if (hasV1CardEvidence && attempt?.payment_type !== 'card') {
    mismatches.push('attempt_kind');
  }
  const hasExactDurableIntent = !!intentId
    && intentId === attempt?.stripe_payment_intent_id;
  const canBindCurrentPolicyIntent = !!intentId
    && allowIntentBinding === true
    // Connect Standard es una superficie no confiable: el restaurante puede
    // fabricar PIs y metadata. Sólo plataforma admite recovery por metadata.
    && expectedAccount === null
    && attempt?.stripe_payment_intent_id == null
    && hasV1CardEvidence;
  if (!hasExactDurableIntent && !canBindCurrentPolicyIntent) mismatches.push('id');
  if (localAccount !== expectedAccount
      || (attempt?.stripe_account_id != null && !localAccount)) {
    mismatches.push('account_context');
  }
  if (Object.prototype.hasOwnProperty.call(intent || {}, 'payme_request_account_id')
      && normalized(intent.payme_request_account_id) !== expectedAccount) {
    mismatches.push('request_account');
  }
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0
      || !Number.isSafeInteger(remoteAmount) || remoteAmount !== expectedAmount) {
    mismatches.push('amount');
  }
  if (intent?.status === 'succeeded') {
    const received = Number(intent?.amount_received);
    if (!Number.isSafeInteger(received) || received !== expectedAmount) {
      mismatches.push('amount_received');
    }
  }
  if (!Number.isSafeInteger(expectedFee) || expectedFee < 0
      || !Number.isSafeInteger(remoteFee) || remoteFee !== expectedFee) {
    mismatches.push('application_fee_amount');
  }
  if (hasV1CardEvidence && (
    expectedAmount <= 0
    || expectedFee >= expectedAmount
    || (!expectedAccount && expectedFee !== 0)
    || (!expectedAccount
      && attempt?.stripe_charge_payment_method_id
        !== attempt?.stripe_source_payment_method_id)
    || (attempt?.stripe_used_saved_card === true
      && !attempt?.stripe_customer_id_snapshot)
    || (attempt?.stripe_save_payment_method === true
      && !attempt?.stripe_customer_id_snapshot)
    || (attempt?.stripe_customer_id_snapshot != null
      && !normalized(attempt.stripe_customer_id_snapshot))
  )) {
    mismatches.push('card_payment_snapshot');
  }
  if (String(intent?.currency || '').toLowerCase() !== 'mxn') mismatches.push('currency');
  if (intent?.capture_method !== 'automatic') mismatches.push('capture_method');
  if (objectId(intent?.payment_method) !== attempt?.stripe_charge_payment_method_id) {
    mismatches.push('payment_method');
  }
  if (objectId(intent?.customer) !== expectedCustomer) mismatches.push('customer');
  if (normalized(intent?.setup_future_usage) !== expectedSetup) mismatches.push('setup_future_usage');
  if (types.length !== 1 || types[0] !== 'card') mismatches.push('payment_method_types');
  if (intent?.metadata?.attempt_id !== attempt?.id) mismatches.push('metadata.attempt_id');
  if (intent?.metadata?.mesa_id !== attempt?.mesa_id) mismatches.push('metadata.mesa_id');
  if (intent?.metadata?.user_id !== (attempt?.user_id || 'guest')) {
    mismatches.push('metadata.user_id');
  }
  if (expectedStatus && intent?.status !== expectedStatus) mismatches.push('status');
  if (allowedStatuses && !allowedStatuses.includes(intent?.status)) mismatches.push('status');

  if (mismatches.length > 0) throw contractError(mismatches, attempt, intent);
  return true;
}

/**
 * Contrato remoto de una garantía card. A diferencia de un pago, una captura
 * del hold puede recibir menos que el monto autorizado; el fee de Connect se
 * prorratea sobre ese `amount_received`. La compatibilidad policy0 queda
 * limitada al mismo PI que ya estaba persistido antes de recibir el webhook.
 */
function guaranteeIntentMismatches(row, intent, {
  stripeAccountId = null,
  restaurantId = null,
  eventType = null,
} = {}) {
  const mismatches = [];
  if (!row) return ['mesa_not_found'];

  const expectedAccount = normalized(row.auth_stripe_account_id);
  const observedAccount = normalized(stripeAccountId);
  const authAmount = Number(row.auth_amount_cents);
  const totalAmount = Number(row.total_cents);
  const authFee = Number(row.auth_application_fee_cents);
  const sourcePaymentMethodId = normalized(row.auth_source_payment_method_id);
  const chargePaymentMethodId = normalized(row.auth_charge_payment_method_id);
  const customerId = normalized(row.auth_stripe_customer_id);
  const verifiedAt = Date.parse(row.auth_card_verified_at);
  const chargeVerifiedAt = Date.parse(row.auth_charge_card_verified_at);
  const hasV1CardEvidence = Number(row.auth_card_policy_version) === 1
    && ['visa', 'mastercard', 'amex'].includes(row.auth_card_brand)
    && ['credit', 'debit'].includes(row.auth_card_funding)
    && Number.isFinite(verifiedAt)
    && Number.isFinite(chargeVerifiedAt);
  const isAlreadyBoundLegacy = Number(row.auth_card_policy_version) === 0
    && !!row.auth_payment_intent_id
    && row.auth_payment_intent_id === normalized(intent?.id);

  if (restaurantId && row.restaurant_id !== restaurantId) mismatches.push('restaurant');
  if (!row.guarantee_mode || row.auth_method !== 'card') mismatches.push('guarantee_binding');
  if (!sourcePaymentMethodId || !chargePaymentMethodId || !customerId
      || typeof row.auth_off_session !== 'boolean'
      || typeof row.auth_save_payment_method !== 'boolean') {
    mismatches.push('provider_snapshot');
  }
  if (!hasV1CardEvidence && !isAlreadyBoundLegacy) {
    mismatches.push('card_policy_snapshot');
  }
  if (!normalized(row.auth_payment_intent_id)
      || row.auth_payment_intent_id !== normalized(intent?.id)) {
    mismatches.push('intent_id');
  }
  if (expectedAccount !== observedAccount
      || (row.auth_stripe_account_id != null && !expectedAccount)) {
    mismatches.push('account');
  }
  if (!Number.isSafeInteger(authAmount) || authAmount <= 0
      || !Number.isSafeInteger(totalAmount) || totalAmount !== authAmount
      || Number(intent?.amount) !== authAmount) {
    mismatches.push('amount');
  }
  if (row.auth_application_fee_cents == null
      || !Number.isSafeInteger(authFee) || authFee < 0 || authFee >= authAmount
      || (!expectedAccount && authFee !== 0)) {
    mismatches.push('application_fee_snapshot');
  }
  if (!expectedAccount && sourcePaymentMethodId !== chargePaymentMethodId) {
    mismatches.push('platform_payment_method_snapshot');
  }
  if ((row.auth_off_session === true || row.auth_save_payment_method === true)
      && !customerId) {
    mismatches.push('customer_snapshot');
  }
  if (String(intent?.currency || '').toLowerCase() !== 'mxn') mismatches.push('currency');
  if (intent?.capture_method !== 'manual') mismatches.push('capture_method');
  if (objectId(intent?.payment_method) !== chargePaymentMethodId) {
    mismatches.push('payment_method');
  }
  const expectedCustomer = expectedAccount ? null : customerId;
  if (objectId(intent?.customer) !== expectedCustomer) mismatches.push('customer');
  const expectedSetup = row.auth_save_payment_method && !expectedAccount
    ? 'off_session'
    : null;
  if (normalized(intent?.setup_future_usage) !== expectedSetup) {
    mismatches.push('setup_future_usage');
  }
  const types = Array.isArray(intent?.payment_method_types)
    ? intent.payment_method_types
    : [];
  if (types.length !== 1 || types[0] !== 'card') mismatches.push('payment_method_types');
  if (intent?.metadata?.kind !== 'guarantee_auth') mismatches.push('metadata.kind');
  if (intent?.metadata?.mesa_id !== row.id) mismatches.push('metadata.mesa_id');
  if (intent?.metadata?.user_id !== row.opener_user_id) mismatches.push('metadata.user_id');

  let expectedFee = authFee;
  if (eventType === 'payment_intent.succeeded' && expectedAccount) {
    const received = Number(intent?.amount_received);
    expectedFee = Number.isSafeInteger(received)
      && received >= 0 && received <= authAmount
      ? prorateCents(authFee, received, authAmount)
      : NaN;
  }
  if (Number(intent?.application_fee_amount || 0) !== expectedFee) {
    mismatches.push('application_fee_amount');
  }

  const expectedStatuses = {
    'payment_intent.amount_capturable_updated': 'requires_capture',
    'payment_intent.succeeded': 'succeeded',
    'payment_intent.payment_failed': 'requires_payment_method',
    'payment_intent.canceled': 'canceled',
    'payment_intent.processing': 'processing',
  };
  if (expectedStatuses[eventType] && intent?.status !== expectedStatuses[eventType]) {
    mismatches.push('status');
  }
  if (eventType === 'payment_intent.amount_capturable_updated'
      && Number(intent?.amount_capturable) !== authAmount) {
    mismatches.push('capturable');
  }
  return [...new Set(mismatches)];
}

async function loadPaymentAttemptContract(attemptId, db = pool) {
  const { rows: [attempt] } = await db.query(
    `SELECT id, mesa_id, user_id, status, payment_type, operation_type,
            gross_amount_cents, application_fee_cents,
            stripe_payment_intent_id, stripe_account_id,
            stripe_contract_prepared_at,
            stripe_source_payment_method_id, stripe_charge_payment_method_id,
            stripe_customer_id_snapshot, stripe_used_saved_card,
            stripe_save_payment_method,
            card_policy_version,card_brand_snapshot,card_funding_snapshot,
            card_verified_at,charge_card_verified_at
       FROM payment_attempts WHERE id=$1`,
    [attemptId]
  );
  return attempt || null;
}

module.exports = {
  assertPaymentIntentContract,
  guaranteeIntentMismatches,
  loadPaymentAttemptContract,
};
