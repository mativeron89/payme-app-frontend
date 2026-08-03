import { describe, expect, it } from 'vitest';
import { isDefinitiveStripeErrorType } from './stripe';
import { shouldRotateOnError } from './idempotency';

describe('B-06: errores locales de Stripe vs rechazo HTTP del backend', () => {
  it('solo un rechazo explícito de tarjeta es definitivo', () => {
    expect(isDefinitiveStripeErrorType('card_error')).toBe(true);
    for (const type of ['validation_error', 'api_error', 'api_connection_error', undefined]) {
      expect(isDefinitiveStripeErrorType(type)).toBe(false);
    }
  });

  it('conserva ante validation_error local, pero libera ante HTTP 400 definitivo', () => {
    expect(shouldRotateOnError('validation_error')).toBe(false);
    expect(shouldRotateOnError('validation_error', 400)).toBe(true);
  });
});
