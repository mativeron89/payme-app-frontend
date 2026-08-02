import { describe, expect, it } from 'vitest';
import { shouldRotateOnError } from './idempotency';

describe('B-06: clasificación de reintentos', () => {
  it('conserva conflicto vivo y rate-limit', () => {
    expect(shouldRotateOnError('idempotency_conflict', 409)).toBe(false);
    expect(shouldRotateOnError('rate_limited', 429)).toBe(false);
  });

  it('rota rechazos terminales aunque Backend los exprese como 409', () => {
    for (const code of [
      'idempotency_key_terminal',
      'fraction_not_available',
      'item_already_paid',
      'item_already_locked',
      'no_slots_available',
      'mesa_not_payable',
    ]) {
      expect(shouldRotateOnError(code, 409)).toBe(true);
    }
  });
});
