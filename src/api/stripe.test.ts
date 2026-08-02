import { describe, expect, it } from 'vitest';
import { isDefinitiveStripeErrorType } from './stripe';
import { shouldRotateOnError } from './idempotency';

describe('B-06: validation_error no libera una intención monetaria', () => {
  it('solo un rechazo explícito de tarjeta es definitivo', () => {
    expect(isDefinitiveStripeErrorType('card_error')).toBe(true);
    for (const type of ['validation_error', 'api_error', 'api_connection_error', undefined]) {
      expect(isDefinitiveStripeErrorType(type)).toBe(false);
    }
  });

  it('create mesa, pago y topup conservan key/freeze ante validation_error', () => {
    expect(shouldRotateOnError('validation_error', 400)).toBe(false);
  });
});
