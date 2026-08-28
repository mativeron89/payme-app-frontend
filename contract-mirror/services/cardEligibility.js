/**
 * Política cerrada de elegibilidad de tarjetas para todos los money paths.
 *
 * La evidencia es siempre el PaymentMethod de Stripe, nunca el body ni el
 * espejo local. Los snapshots que devuelve este módulo son inmutables y se
 * persisten antes del primer hold/cargo para que un replay no recalcule una
 * decisión monetaria con estado vivo.
 */
'use strict';

const stripeService = require('./stripe');

const CARD_POLICY_VERSION = 1;
const ALLOWED_BRANDS = new Set(['visa', 'mastercard', 'amex']);
const ALLOWED_FUNDING = new Set(['credit', 'debit']);
const ALLOWED_NATIVE_WALLETS = new Set(['apple_pay', 'google_pay']);
const OWNERSHIP_MODES = new Set(['saved', 'typed_user', 'typed_guest', 'clone']);

function remoteId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function cardError(code, status, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function normalized(value) {
  return typeof value === 'string' ? value.toLowerCase() : null;
}

/**
 * Valida un objeto PaymentMethod ya recuperado/creado en su cuenta correcta.
 *
 * ownership:
 * - `saved`: debe pertenecer exactamente al Customer esperado.
 * - `typed_user`: puede estar sin adjuntar o pertenecer al Customer esperado.
 * - `typed_guest`: debe estar sin adjuntar.
 * - `clone`: ownership no aporta autoridad; la cuenta se fija en la request.
 */
function assertEligibleCard(remote, {
  expectedPaymentMethodId,
  expectedCustomerId = null,
  ownership,
  stripeAccount = null,
  expectedSnapshot = null,
  expectedPaymentType = 'card',
  reconciliationCode = 'payment_method_verification_unavailable',
} = {}) {
  if (!OWNERSHIP_MODES.has(ownership)) {
    throw cardError(reconciliationCode, 503, { field: 'ownership_mode' });
  }
  if (ownership === 'clone' && !stripeAccount) {
    throw cardError(reconciliationCode, 503, { field: 'stripe_account' });
  }
  if (['saved', 'typed_user'].includes(ownership) && !expectedCustomerId) {
    throw cardError(reconciliationCode, 503, { field: 'expected_customer' });
  }
  if (!remote || typeof remote !== 'object'
      || remoteId(remote) !== expectedPaymentMethodId) {
    throw cardError(reconciliationCode, 503, { field: 'id' });
  }

  const customerId = remoteId(remote.customer);
  if (ownership === 'saved' && (!expectedCustomerId || customerId !== expectedCustomerId)) {
    throw cardError('payment_method_owner_conflict', 409);
  }
  if (ownership === 'typed_user'
      && customerId !== null && customerId !== expectedCustomerId) {
    throw cardError('payment_method_owner_conflict', 409);
  }
  if (ownership === 'typed_guest' && customerId !== null) {
    throw cardError('payment_method_owner_conflict', 409);
  }

  if (remote.type == null) {
    throw cardError(reconciliationCode, 503, { field: 'card' });
  }

  if (remote.type !== 'card') {
    throw cardError('payment_method_card_not_supported', 422, {
      type: remote.type,
      brand: null,
      funding: null,
      wallet: null,
    });
  }

  if (remote.card == null
      || remote.card.brand == null || remote.card.funding == null) {
    throw cardError(reconciliationCode, 503, { field: 'card' });
  }

  const brand = normalized(remote.card.brand);
  const funding = normalized(remote.card.funding);
  const walletPresent = remote.card.wallet != null;
  const walletType = walletPresent
    ? (normalized(remote.card.wallet?.type) || 'unknown')
    : null;
  const nativeWallet = ALLOWED_NATIVE_WALLETS.has(expectedPaymentType);
  if (!ALLOWED_BRANDS.has(brand)
      || !ALLOWED_FUNDING.has(funding)
      || (nativeWallet ? walletType !== expectedPaymentType : walletPresent)) {
    throw cardError('payment_method_card_not_supported', 422, {
      type: remote.type || null,
      brand,
      funding,
      wallet: walletType,
    });
  }

  const snapshot = {
    // La identidad de wallet queda sellada en `payment_type`; el CHECK físico
    // vigente admite policy 1 y no se relaja ni migra para esta rebanada.
    policyVersion: CARD_POLICY_VERSION,
    brand,
    funding,
    walletType: nativeWallet ? walletType : null,
    verifiedAt: new Date(),
  };

  if (expectedSnapshot && !isTrustedSnapshot(expectedSnapshot)) {
    throw cardError(reconciliationCode, 503, { field: 'expected_snapshot' });
  }
  if (expectedSnapshot
      && (Number(expectedSnapshot.policyVersion) !== snapshot.policyVersion
        || expectedSnapshot.brand !== brand
        || expectedSnapshot.funding !== funding
        || (expectedSnapshot.walletType ?? null) !== snapshot.walletType)) {
    throw cardError(reconciliationCode, 503, {
      field: 'snapshot',
      expected: expectedSnapshot,
      observed: snapshot,
    });
  }
  return snapshot;
}

async function retrieveEligibleCard({
  paymentMethodId,
  stripeAccount = null,
  expectedCustomerId = null,
  ownership,
  expectedSnapshot = null,
  expectedPaymentType = 'card',
  reconciliationCode = 'payment_method_verification_unavailable',
}) {
  let remote;
  try {
    remote = stripeAccount
      ? await stripeService.retrievePaymentMethod(paymentMethodId, { stripeAccount })
      : await stripeService.retrievePaymentMethod(paymentMethodId);
  } catch (cause) {
    throw cardError(reconciliationCode, 503, {
      providerCode: cause?.code || null,
    });
  }
  return {
    remote,
    snapshot: assertEligibleCard(remote, {
      expectedPaymentMethodId: paymentMethodId,
      expectedCustomerId,
      ownership,
      stripeAccount,
      expectedSnapshot,
      expectedPaymentType,
      reconciliationCode,
    }),
  };
}

function isTrustedSnapshot(snapshot) {
  const timestamp = snapshot?.verifiedAt instanceof Date
    ? snapshot.verifiedAt.getTime()
    : Date.parse(snapshot?.verifiedAt);
  const version = Number(snapshot?.policyVersion);
  const walletType = snapshot?.walletType ?? null;
  return version === CARD_POLICY_VERSION
    && ALLOWED_BRANDS.has(snapshot?.brand)
    && ALLOWED_FUNDING.has(snapshot?.funding)
    && (walletType === null || ALLOWED_NATIVE_WALLETS.has(walletType))
    && Number.isFinite(timestamp);
}

module.exports = {
  CARD_POLICY_VERSION,
  ALLOWED_BRANDS,
  ALLOWED_FUNDING,
  ALLOWED_NATIVE_WALLETS,
  OWNERSHIP_MODES,
  assertEligibleCard,
  retrieveEligibleCard,
  isTrustedSnapshot,
  remoteId,
};
