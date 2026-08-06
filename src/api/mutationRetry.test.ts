import { describe, expect, it } from 'vitest';
import { isDefinitiveMutationError, isServiceUnavailable } from './mutationRetry';

describe('reintentos idempotentes no monetarios', () => {
  it('conserva key/materialización ante timeout, 5xx, 429 y conflicto ambiguo', () => {
    expect(isDefinitiveMutationError('unknown', null)).toBe(false);
    expect(isDefinitiveMutationError('service_unavailable', 503)).toBe(false);
    expect(isDefinitiveMutationError('mesa_not_invitable', 503)).toBe(false);
    expect(isDefinitiveMutationError('rate_limited', 429)).toBe(false);
    expect(isDefinitiveMutationError('idempotency_conflict', 409)).toBe(false);
    expect(isDefinitiveMutationError('concurrent_conflict', 409)).toBe(false);
    expect(isDefinitiveMutationError('future_unknown_conflict', 409)).toBe(false);
    expect(isDefinitiveMutationError('validation_error', null)).toBe(false);
  });

  it('rota tras todo 400 definitivo y los 409 públicos que no aplicaron la mutación', () => {
    expect(isDefinitiveMutationError('validation_error', 400)).toBe(true);
    expect(isDefinitiveMutationError('invited_user_not_found', 404)).toBe(true);
    for (const code of [
      'mesa_not_invitable',
      'already_mesa_participant',
      'invitation_recipient_mismatch',
      'payment_method_owned_by_another_user',
      'payment_method_not_attachable',
      'payment_method_remote_not_attached',
      'payment_method_remote_owner_conflict',
      'payment_method_owner_conflict',
      'payment_method_requires_saved_reference',
    ]) {
      expect(isDefinitiveMutationError(code, 409), code).toBe(true);
    }
  });

  it('identifica el 503 para copy de reintento de la misma operación', () => {
    expect(isServiceUnavailable(503)).toBe(true);
    expect(isServiceUnavailable(500)).toBe(false);
  });
});
