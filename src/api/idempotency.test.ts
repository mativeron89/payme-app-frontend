import { describe, expect, it } from 'vitest';
import { shouldRotateOnError } from './idempotency';

describe('B-06: clasificación de reintentos', () => {
  it('conserva conflicto vivo y rate-limit', () => {
    expect(shouldRotateOnError('idempotency_conflict', 409)).toBe(false);
    expect(shouldRotateOnError('concurrent_conflict', 409)).toBe(false);
    expect(shouldRotateOnError('rate_limited', 429)).toBe(false);
    expect(shouldRotateOnError('validation_error')).toBe(false);
    expect(shouldRotateOnError('validation_error', 400)).toBe(true);
  });

  it('el status ambiguo manda aunque el body arrastre un código terminal conocido', () => {
    expect(shouldRotateOnError('payment_provider_error', 502)).toBe(false);
    expect(shouldRotateOnError('idempotency_key_terminal', 503)).toBe(false);
    expect(shouldRotateOnError('insufficient_funds', 408)).toBe(false);
    expect(shouldRotateOnError('no_slots_available', 425)).toBe(false);
    expect(shouldRotateOnError('wallet_requires_auth', 429)).toBe(false);
  });

  it('rota rechazos terminales aunque Backend los exprese como 409', () => {
    for (const code of [
      'idempotency_key_terminal',
      'fraction_not_available',
      'item_already_paid',
      'item_already_locked',
      'no_slots_available',
      'mesa_not_payable',
      'payment_method_owner_conflict',
      'payment_method_requires_saved_reference',
      'slot_claim_conflict',
    ]) {
      expect(shouldRotateOnError(code, 409)).toBe(true);
    }
  });
});
