export type SettlementOutcome = 'success' | 'definitive' | 'ambiguous';

/** Solo estados que el contrato acredita permiten cerrar/rotar un pago de mesa. */
export function mesaPaymentOutcome(status: unknown): SettlementOutcome {
  if (status === 'succeeded' || status === 'processed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'definitive';
  return 'ambiguous';
}

/** El topup sin acreditación explícita queda bloqueado: el contrato no ofrece reconciliación por id. */
export function topupOutcome(status: unknown, requiresAction: boolean, clientSecret?: string): SettlementOutcome {
  if (requiresAction) return clientSecret ? 'ambiguous' : 'ambiguous';
  if (status === 'succeeded') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'definitive';
  return 'ambiguous';
}

/** Solo una mesa abierta acredita la garantía; polling incierto no libera el hold. */
export function guaranteeOutcome(status: unknown): SettlementOutcome {
  if (status === 'open') return 'success';
  if (status === 'auth_failed' || status === 'cancelled' || status === 'expired') return 'definitive';
  return 'ambiguous';
}
