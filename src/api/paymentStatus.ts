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

export interface TopupPollResponse { topup: { status: unknown }; }
/** Poll acotado y cancelable: nunca interpreta `processing` como acreditado. */
export async function pollTopup<T extends TopupPollResponse>(
  load: () => Promise<T>,
  isOriginCurrent: () => boolean,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ outcome: SettlementOutcome; response: T | null }> {
  const waits = [0, 500, 1_000, 2_000, 4_000];
  let last: T | null = null;
  for (const wait of waits) {
    if (!isOriginCurrent()) return { outcome: 'ambiguous', response: last };
    if (wait) await pause(wait);
    if (!isOriginCurrent()) return { outcome: 'ambiguous', response: last };
    try { last = await load(); } catch { return { outcome: 'ambiguous', response: last }; }
    if (!isOriginCurrent()) return { outcome: 'ambiguous', response: last };
    const outcome = topupOutcome(last.topup.status, false);
    if (outcome !== 'ambiguous') return { outcome, response: last };
  }
  return { outcome: 'ambiguous', response: last };
}
