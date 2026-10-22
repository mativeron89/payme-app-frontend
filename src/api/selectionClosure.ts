import { SELECTION_CLOSURE_CONTRACT, type SelectionClosureChallenge, type SelectionClosureConfirmation } from './types';

export const CLOSURE_REQUIRED = 'selection_closure_confirmation_required';
export const CLOSURE_CHANGED = 'selection_closure_state_changed';
export function isSelectionClosureRejection(code: string, status: number | null): boolean {
  return status === 409 && (code === CLOSURE_REQUIRED || code === CLOSURE_CHANGED);
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));

/** Date-time contractual; la precisión sub-ms sólo puede anticipar el descarte. */
export function closureDeadlineValid(value: unknown, now: number): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60
    && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;
}

/** null = payload inválido; changed sin challenge es un rechazo válido. */
export function decodeSelectionClosureRejection(
  code: string, status: number | null, extra: Record<string, unknown>,
  expected: { mesaCode: string; mode: 'consumo' | 'igual' }, now = Date.now(),
): { code: typeof CLOSURE_REQUIRED | typeof CLOSURE_CHANGED; challenge: SelectionClosureChallenge | null } | null {
  if (!isSelectionClosureRejection(code, status)) return null;
  // HttpError incluye error en body; MockApiError lo conserva como message.
  const raw = { ...extra, error: code };
  if (Object.hasOwn(extra, 'error') && extra.error !== code) return null;
  if (code === CLOSURE_CHANGED && exactKeys(raw, ['error'])) return { code, challenge: null };
  if (!exactKeys(raw, ['error', 'closure_confirmation'])) return null;
  const c: unknown = extra.closure_confirmation;
  if (!record(c) || !exactKeys(c, ['contract', 'revision', 'mesa_code', 'division_mode', 'would_close', 'valid_until'])
      || c.contract !== SELECTION_CLOSURE_CONTRACT || typeof c.revision !== 'string' || !/^[0-9a-f]{64}$/.test(c.revision)
      || !expected.mesaCode || c.mesa_code !== expected.mesaCode || c.division_mode !== expected.mode
      || c.would_close !== true || !closureDeadlineValid(c.valid_until, now)) return null;
  return { code: code as typeof CLOSURE_REQUIRED | typeof CLOSURE_CHANGED, challenge: Object.freeze({
    contract: SELECTION_CLOSURE_CONTRACT, revision: c.revision, mesa_code: expected.mesaCode,
    division_mode: expected.mode, would_close: true, valid_until: c.valid_until,
  }) };
}

export function selectionClosureConfirmation(challenge: SelectionClosureChallenge): SelectionClosureConfirmation {
  return Object.freeze({ contract: SELECTION_CLOSURE_CONTRACT, revision: challenge.revision, confirmed: true });
}

/** Copia privada en memoria. Congelar también cada ítem y el array, no sólo el sobre. */
export function freezeSelectionRequest<T extends { items: object[] }>(request: T): T {
  const copy = { ...request, items: request.items.map((item) => Object.freeze({ ...item })) };
  Object.freeze(copy.items);
  return Object.freeze(copy) as T;
}
