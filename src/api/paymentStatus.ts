export type SettlementOutcome = 'success' | 'definitive' | 'ambiguous';

export interface MesaClosureView { title: string; detail: string; completed: boolean; }
/** Copy contractual: solo `completed` acredita cierre/dispersión. */
export function mesaClosureView(status: unknown): MesaClosureView {
  switch (status) {
    case 'fully_paid':
      return { title: 'Pagos registrados', detail: 'La mesa todavía está pendiente de cierre y liquidación.', completed: false };
    case 'settled':
      return { title: 'Mesa liquidada', detail: 'El faltante, si existió, quedó registrado. Aún no podemos afirmar la entrega al restaurante.', completed: false };
    case 'completed':
      return { title: 'Cierre completado', detail: 'La mesa terminó su proceso de cierre.', completed: true };
    case 'pending_auth':
      return { title: 'Garantía en confirmación', detail: 'Todavía no podemos confirmar el resultado de la garantía.', completed: false };
    case 'auth_failed':
      return { title: 'Garantía no confirmada', detail: 'No podemos afirmar que exista un cobro o cierre de la mesa.', completed: false };
    case 'cancelled':
      return { title: 'Mesa cancelada', detail: 'No podemos afirmar que exista un cobro o cierre de la mesa.', completed: false };
    case 'expired':
      return { title: 'Mesa vencida', detail: 'El cierre y cualquier liquidación todavía requieren confirmación.', completed: false };
    case 'settling':
      return { title: 'Mesa en liquidación', detail: 'El cierre sigue en proceso; todavía no está confirmado.', completed: false };
    case 'dispersing':
      return { title: 'Entrega en proceso', detail: 'La liquidación sigue en proceso; todavía no está confirmada.', completed: false };
    default:
      return { title: 'Estado de la mesa', detail: 'Todavía no podemos confirmar el cierre ni una entrega al restaurante.', completed: false };
  }
}

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
