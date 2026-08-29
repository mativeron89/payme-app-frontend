'use strict';

const NATIVE_WALLET_PAYMENT_ENABLED = false;
const NATIVE_WALLET_TYPES = new Set(['apple_pay', 'google_pay']);

function isNativeWalletType(paymentType) {
  return NATIVE_WALLET_TYPES.has(paymentType);
}

function acceptsNewPayment(paymentType) {
  return !isNativeWalletType(paymentType) || NATIVE_WALLET_PAYMENT_ENABLED;
}

module.exports = {
  NATIVE_WALLET_PAYMENT_ENABLED,
  isNativeWalletType,
  acceptsNewPayment,
};
