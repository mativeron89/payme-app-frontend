import type { AppNotification } from './types';
import { currentSamePrincipalSession } from './profileIdentity';
import type { StoredSession } from './storage';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESA_CODE = /^[A-Z]{2}-\d{3,5}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function safeCents(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function positiveSafeCents(value: unknown): value is number {
  return safeCents(value) && Number(value) > 0;
}

function isoUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function displayName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const length = [...value].length;
  return value.trim().length > 0 && length >= 1 && length <= 201
    && !/\p{Cc}|[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/u.test(value);
}

export interface ShortfallNotificationDisclosure {
  readonly mesaCode: string;
  readonly shortfallCents: number;
}

/**
 * Sólo la notificación post-cierre nueva y exacta habilita el fetch lazy.
 * El aviso histórico/temprano sigue visible, pero nunca abre identidades.
 */
export function readShortfallNotificationDisclosure(
  notification: AppNotification,
): ShortfallNotificationDisclosure | null {
  if (notification.type !== 'mesa_shortfall_charged'
      || notification.related_entity_type !== 'mesa'
      || typeof notification.related_entity_id !== 'string'
      || !UUID.test(notification.related_entity_id)
      || !plainObject(notification.payload)) return null;
  const payload = notification.payload;
  if (!exactKeys(payload, ['mesa_id', 'mesa_code', 'shortfall_cents', 'detail_available'])
      || typeof payload.mesa_id !== 'string' || !UUID.test(payload.mesa_id)
      || payload.mesa_id.toLowerCase() !== notification.related_entity_id.toLowerCase()
      || typeof payload.mesa_code !== 'string' || !MESA_CODE.test(payload.mesa_code)
      || !positiveSafeCents(payload.shortfall_cents)
      || payload.detail_available !== true) {
    return null;
  }
  return { mesaCode: payload.mesa_code, shortfallCents: Number(payload.shortfall_cents) };
}

export interface ShortfallDetailRow {
  readonly display_name: string;
  readonly due_cents: number;
}

export interface AvailableShortfallDetail {
  readonly version: 1;
  readonly detail_available: true;
  readonly closed_at: string;
  readonly shortfall_cents: number;
  readonly unassigned_cents: number;
  readonly rows: readonly ShortfallDetailRow[];
}

export interface UnavailableShortfallDetail {
  readonly version: 1;
  readonly detail_available: false;
  readonly closed_at: string;
  readonly shortfall_cents: number | null;
  readonly unassigned_cents: null;
  readonly rows: readonly [];
}

export type ShortfallDetail = AvailableShortfallDetail | UnavailableShortfallDetail;

/** El residual monetario no es una persona ni aumenta cardinalidad. */
export function shortfallIdentifiedCount(detail: AvailableShortfallDetail): number {
  return detail.rows.length;
}

/** Una notificación dispara como máximo un fetch hasta cambiar de sesión/fila. */
export class LazyShortfallGate {
  private generation = 0;
  private started = false;

  start(): number | null {
    if (this.started) return null;
    this.started = true;
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation: number): boolean {
    return this.started && generation === this.generation;
  }

  reset(): void {
    this.generation += 1;
    this.started = false;
  }
}

export type ShortfallLoadOutcome =
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'available'; readonly detail: AvailableShortfallDetail };

interface ShortfallLoadDependencies {
  readonly request: (
    mesaCode: string,
    shortfallCents: number,
    origin: StoredSession,
  ) => Promise<ShortfallDetail>;
  readonly loadCurrent: () => StoredSession | null;
  readonly isCurrent: (session: StoredSession) => boolean;
}

/**
 * Orquestación pura del fetch lazy: permite medir refresh, relogin y errores
 * sin montar un DOM artificial. Un error sólo cambia UI si la misma familia y
 * principal siguen vigentes; una respuesta de otra sesión no publica nada.
 */
export async function loadShortfallDetailForSession(
  origin: StoredSession,
  mesaCode: string,
  shortfallCents: number,
  dependencies: ShortfallLoadDependencies,
): Promise<ShortfallLoadOutcome> {
  try {
    const detail = await dependencies.request(mesaCode, shortfallCents, origin);
    const current = currentSamePrincipalSession(origin, dependencies.loadCurrent());
    if (!current || !dependencies.isCurrent(current)) return { kind: 'stale' };
    return detail.detail_available
      ? { kind: 'available', detail }
      : { kind: 'unavailable' };
  } catch {
    const current = currentSamePrincipalSession(origin, dependencies.loadCurrent());
    return current && dependencies.isCurrent(current)
      ? { kind: 'unavailable' }
      : { kind: 'stale' };
  }
}

export function decodeShortfallDetailResponse(
  input: unknown,
  expectedShortfallCents: number,
): ShortfallDetail {
  if (!plainObject(input) || !exactKeys(input, ['shortfall_detail']) || !plainObject(input.shortfall_detail)) {
    throw new Error('shortfall_detail_response_malformed');
  }
  const detail = input.shortfall_detail;
  if (!exactKeys(detail, [
    'version', 'detail_available', 'closed_at', 'shortfall_cents', 'unassigned_cents', 'rows',
  ]) || detail.version !== 1 || typeof detail.detail_available !== 'boolean'
      || !isoUtc(detail.closed_at) || !Array.isArray(detail.rows)) {
    throw new Error('shortfall_detail_response_malformed');
  }

  if (detail.detail_available === false) {
    if (!(detail.shortfall_cents === null || safeCents(detail.shortfall_cents))
        || (detail.shortfall_cents !== null && Number(detail.shortfall_cents) !== expectedShortfallCents)
        || detail.unassigned_cents !== null || detail.rows.length !== 0) {
      throw new Error('shortfall_detail_response_malformed');
    }
    return {
      version: 1,
      detail_available: false,
      closed_at: detail.closed_at,
      shortfall_cents: detail.shortfall_cents === null ? null : Number(detail.shortfall_cents),
      unassigned_cents: null,
      rows: [],
    };
  }

  if (!safeCents(detail.shortfall_cents) || !safeCents(detail.unassigned_cents)
      || Number(detail.shortfall_cents) !== expectedShortfallCents) {
    throw new Error('shortfall_detail_reconciliation_invalid');
  }
  const rows: ShortfallDetailRow[] = [];
  let total = Number(detail.unassigned_cents);
  for (const value of detail.rows) {
    if (!plainObject(value) || !exactKeys(value, ['display_name', 'due_cents'])
        || !displayName(value.display_name) || !positiveSafeCents(value.due_cents)) {
      throw new Error('shortfall_detail_response_malformed');
    }
    total += Number(value.due_cents);
    if (!Number.isSafeInteger(total)) throw new Error('shortfall_detail_reconciliation_invalid');
    rows.push({ display_name: value.display_name, due_cents: Number(value.due_cents) });
  }
  if (total !== Number(detail.shortfall_cents)) throw new Error('shortfall_detail_reconciliation_invalid');
  return {
    version: 1,
    detail_available: true,
    closed_at: detail.closed_at,
    shortfall_cents: Number(detail.shortfall_cents),
    unassigned_cents: Number(detail.unassigned_cents),
    rows,
  };
}
