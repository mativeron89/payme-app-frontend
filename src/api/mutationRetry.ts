/**
 * Clasificación para mutaciones idempotentes no monetarias (invitaciones y
 * alta de tarjeta). Un timeout, 5xx, rate-limit o conflicto de idempotencia no
 * prueba que el servidor no haya aplicado la operación: la key/materialización
 * se conserva y el usuario reintenta exactamente lo mismo.
 */
/**
 * 409 que prueban que ESTA mutación no se aplicó y permiten abandonar su
 * materialización/key. La lista refleja los contratos públicos vigentes de
 * mesas, invitaciones y tarjetas; un 409 desconocido queda fail-closed.
 */
export const DEFINITIVE_CONFLICT_CODES = new Set([
  'already_mesa_participant',
  'fraction_not_available',
  'idempotency_key_terminal',
  'invitation_recipient_mismatch',
  'item_already_locked',
  'item_already_paid',
  'mesa_not_active',
  'mesa_not_invitable',
  'mesa_not_payable',
  'no_slots_available',
  'payment_method_not_attachable',
  'payment_method_owned_by_another_user',
  'payment_method_owner_conflict',
  'payment_method_remote_not_attached',
  'payment_method_remote_owner_conflict',
  'payment_method_requires_saved_reference',
  'slot_claim_conflict',
]);

/** Estos conflictos pueden representar una operación viva o en carrera. */
export const AMBIGUOUS_CONFLICT_CODES = new Set([
  'concurrent_conflict',
  'idempotency_conflict',
]);

export function isDefinitiveMutationError(code: string, status?: number | null): boolean {
  // El status de transporte manda: un 5xx nunca acredita que el dominio haya
  // rechazado la mutación, aunque el body arrastre un código conocido.
  if (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500)
  ) return false;
  if (typeof status !== 'number') return false;
  if (status === 409) {
    if (AMBIGUOUS_CONFLICT_CODES.has(code)) return false;
    return DEFINITIVE_CONFLICT_CODES.has(code);
  }
  return status >= 400 && status < 500;
}

export function isServiceUnavailable(status?: number | null): boolean {
  return status === 503;
}
