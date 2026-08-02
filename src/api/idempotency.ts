import { useEffect, useState } from 'react';
import { loadSession, type StoredSession } from './storage';

/** No se puede acreditar un intento monetario; la UI debe detenerse. */
export class MonetarySafetyError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'MonetarySafetyError';
  }
}

export interface MoneyActor {
  /** auth:<principal> o guest:<sha256>; nunca contiene el token guest crudo. */
  id: string;
  session?: StoredSession;
}

const PREFIX = 'payme_idem_v2_';
const PENDING_PREFIX = 'payme_pending_v2_';
const PREPARED_PREFIX = 'payme_money_prepared_v2_';
const LEGACY_PREFIX = 'payme_idem_';
const LEGACY_PENDING_PREFIX = 'payme_pending_';
const SEPARATOR = '::';

interface StoredAttempt {
  actor: string;
  scope: string;
  key: string;
  operation: string;
  /** Auth: una familia nueva no puede firmar un intento iniciado por la vieja. */
  family_id?: string;
  pm?: string;
  payload?: unknown;
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    throw new MonetarySafetyError('money_storage_unavailable');
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
    if (sessionStorage.getItem(key) !== value) throw new Error('roundtrip');
  } catch {
    throw new MonetarySafetyError('money_storage_unavailable');
  }
}

function storageRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Limpiar no autoriza un reintento: el próximo acceso seguirá fail-closed.
  }
}

function parseScope(scope: string): { actor: string; raw: string } {
  const split = scope.indexOf(SEPARATOR);
  if (split <= 0 || split === scope.length - SEPARATOR.length) {
    throw new MonetarySafetyError('monetary_attempt_ambiguous');
  }
  const actor = scope.slice(0, split);
  const raw = scope.slice(split + SEPARATOR.length);
  if (!actor.startsWith('auth:') && !actor.startsWith('guest:')) {
    throw new MonetarySafetyError('monetary_attempt_ambiguous');
  }
  return { actor, raw };
}

function scopedKey(prefix: string, scope: string): string {
  return prefix + encodeURIComponent(scope);
}

function assertNoLegacy(scope: string, prefix: string): void {
  const { raw } = parseScope(scope);
  // Un registro previo sin propietario no puede atribuirse al actor actual.
  if (storageGet(prefix + raw) !== null) throw new MonetarySafetyError('monetary_attempt_ambiguous');
}

function readAttempt(scope: string): StoredAttempt | null {
  const expected = parseScope(scope);
  assertNoLegacy(scope, LEGACY_PREFIX);
  const raw = storageGet(scopedKey(PREFIX, scope));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredAttempt;
    if (
      typeof parsed?.key !== 'string' ||
      typeof parsed.actor !== 'string' ||
      typeof parsed.scope !== 'string' ||
      typeof parsed.operation !== 'string' ||
      parsed.actor !== expected.actor ||
      parsed.scope !== scope
    ) {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new MonetarySafetyError('monetary_attempt_ambiguous');
  }
}

function writeAttempt(scope: string, attempt: StoredAttempt): void {
  const expected = parseScope(scope);
  if (attempt.actor !== expected.actor || attempt.scope !== scope) {
    throw new MonetarySafetyError('monetary_attempt_ambiguous');
  }
  storageSet(scopedKey(PREFIX, scope), stable(attempt));
}

function currentFamilyForActor(actor: string): string | undefined {
  if (!actor.startsWith('auth:')) return undefined;
  const session = loadSession();
  if (!session || actor !== `auth:${session.principal_id}`) {
    throw new MonetarySafetyError('money_actor_unavailable');
  }
  return session.family_id;
}

async function withMoneyLock<T>(actor: string, resource: string, action: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new MonetarySafetyError('money_lock_unavailable');
  return locks.request(`payme-money-${actor}-${resource}`, { mode: 'exclusive' }, action);
}

function newKey(): string {
  if (!globalThis.crypto?.randomUUID) throw new MonetarySafetyError('money_crypto_unavailable');
  return crypto.randomUUID();
}

async function guestActor(token: string): Promise<MoneyActor> {
  if (!token || !globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new MonetarySafetyError('money_actor_unavailable');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { id: `guest:${fingerprint}` };
}

/** Actor estable para namespace; el token guest nunca entra a storage ni logs. */
export async function resolveMoneyActor(guestToken?: string): Promise<MoneyActor> {
  if (guestToken) return guestActor(guestToken);
  const session = loadSession();
  if (!session?.principal_id) throw new MonetarySafetyError('money_actor_unavailable');
  return { id: `auth:${session.principal_id}`, session };
}

/** Hook de UI: hasta resolver actor/crypto, toda acción monetaria queda bloqueada. */
export function useMoneyActor(guestToken?: string): { actor: MoneyActor | null; error: string | null } {
  const [actor, setActor] = useState<MoneyActor | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setActor(null);
    setError(null);
    resolveMoneyActor(guestToken)
      .then((next) => alive && setActor(next))
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : 'money_actor_unavailable'));
    return () => {
      alive = false;
    };
  }, [guestToken]);
  return { actor, error };
}

export function scopeForActor(actor: MoneyActor, rawScope: string): string {
  if (!rawScope) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  return `${actor.id}${SEPARATOR}${rawScope}`;
}

/** Crea o recupera una key únicamente bajo lock y con persistencia durable. */
export async function idempotencyKeyFor(scope: string, operation: string): Promise<string> {
  const { actor } = parseScope(scope);
  return withMoneyLock(actor, `attempt:${scope}`, async () => {
    const found = readAttempt(scope);
    if (found) {
      if (found.operation !== operation) throw new MonetarySafetyError('monetary_attempt_ambiguous');
      if (found.family_id !== currentFamilyForActor(actor)) throw new MonetarySafetyError('monetary_session_stale');
      return found.key;
    }
    const familyId = currentFamilyForActor(actor);
    const attempt: StoredAttempt = {
      actor,
      scope,
      key: newKey(),
      operation,
      ...(familyId && { family_id: familyId }),
    };
    writeAttempt(scope, attempt);
    return attempt.key;
  });
}

/** El pm_ queda ligado al mismo actor/intent; no existe fallback en memoria. */
export async function rememberPaymentMethod(scope: string, pm: string): Promise<void> {
  const { actor } = parseScope(scope);
  await withMoneyLock(actor, `attempt:${scope}`, async () => {
    const found = readAttempt(scope);
    if (!found || !pm) throw new MonetarySafetyError('monetary_attempt_ambiguous');
    writeAttempt(scope, { ...found, pm });
  });
}

export function recallPaymentMethod(scope: string): string | undefined {
  return readAttempt(scope)?.pm;
}

/**
 * Congela key + payload exacto antes de red. Si cambia el payload, es una
 * intención ambigua: no se genera key nueva ni se llama a la API.
 */
export async function prepareMonetaryRequest(scope: string, operation: string, payload: unknown): Promise<string> {
  const { actor } = parseScope(scope);
  return withMoneyLock(actor, `attempt:${scope}`, async () => {
    const found = readAttempt(scope);
    if (!found || found.operation !== operation) throw new MonetarySafetyError('monetary_attempt_ambiguous');
    if (found.family_id !== currentFamilyForActor(actor)) throw new MonetarySafetyError('monetary_session_stale');
    if (found.payload !== undefined && stable(found.payload) !== stable(payload)) {
      throw new MonetarySafetyError('monetary_payload_ambiguous');
    }
    const next = { ...found, payload };
    writeAttempt(scope, next);
    storageSet(
      `${PREPARED_PREFIX}${encodeURIComponent(actor)}:${encodeURIComponent(operation)}:${encodeURIComponent(found.key)}`,
      stable(next),
    );
    return found.key;
  });
}

/** Verifica el journal bajo lock y recién entonces permite enviar la mutación. */
export async function withPreparedMonetaryRequest<T>(
  operation: string,
  key: string,
  payload: unknown,
  guestToken: string | undefined,
  send: (session: StoredSession | undefined) => Promise<T>,
): Promise<T> {
  const actor = await resolveMoneyActor(guestToken);
  return withMoneyLock(actor.id, `send:${operation}:${key}`, async () => {
    const index = `${PREPARED_PREFIX}${encodeURIComponent(actor.id)}:${encodeURIComponent(operation)}:${encodeURIComponent(key)}`;
    const raw = storageGet(index);
    if (!raw) throw new MonetarySafetyError('monetary_request_unprepared');
    let attempt: StoredAttempt;
    try {
      attempt = JSON.parse(raw) as StoredAttempt;
    } catch {
      throw new MonetarySafetyError('monetary_request_unprepared');
    }
    if (attempt.actor !== actor.id || attempt.operation !== operation || attempt.key !== key) {
      throw new MonetarySafetyError('monetary_request_unprepared');
    }
    if (attempt.family_id !== actor.session?.family_id) throw new MonetarySafetyError('monetary_session_stale');
    if (stable(attempt.payload) !== stable(payload)) throw new MonetarySafetyError('monetary_request_unprepared');
    return send(actor.session);
  });
}

/** Descarte explícito: el usuario elige abandonar un journal, nunca se recicla solo. */
export function discardMonetaryAttempt(scope: string): void {
  const found = readAttempt(scope);
  if (!found) return;
  storageRemove(scopedKey(PREFIX, scope));
  const index = `${PREPARED_PREFIX}${encodeURIComponent(found.actor)}:${encodeURIComponent(found.operation)}:${encodeURIComponent(found.key)}`;
  storageRemove(index);
}

/**
 * Ruta explícita para un registro pre-actor. No lo atribuye ni lo reenvía: el
 * consumidor debe ofrecer reconciliación o descarte informado antes de llamar.
 */
export function discardLegacyMonetaryAttempt(rawScope: string): void {
  if (!rawScope || rawScope.includes(SEPARATOR)) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  storageRemove(LEGACY_PREFIX + rawScope);
  storageRemove(LEGACY_PENDING_PREFIX + rawScope);
}

/** Alias existente para los cierres terminales ya definidos por contrato. */
export function rotateIdempotencyKey(scope: string): void {
  discardMonetaryAttempt(scope);
}

export const TERMINAL_ATTEMPT_STATUSES = ['failed', 'cancelled', 'cancelling'] as const;
export const ROTATING_ERROR_CODES = [
  'idempotency_key_terminal',
  'insufficient_funds',
  'payment_provider_error',
  'no_slots_available',
  'mesa_not_payable',
  'fraction_not_available',
  'item_already_paid',
  'item_already_locked',
  'wallet_requires_auth',
  'validation_error',
] as const;

/** Timeout/red/5xx/conflict/429/refunded conservan el intento. */
export function shouldRotateOnError(code: string, status?: number | null): boolean {
  if (code === 'idempotency_conflict' || code === 'refunded') return false;
  if ((ROTATING_ERROR_CODES as readonly string[]).includes(code)) return true;
  if (typeof status === 'number') {
    if (status === 409 || status === 429) return false;
    return status >= 400 && status < 500;
  }
  return false;
}

export interface UnconfirmedAttempt {
  actor: string;
  scope: string;
  evidence: number;
  payload?: unknown;
}

function readPending(area: string): UnconfirmedAttempt | null {
  const expected = parseScope(area);
  assertNoLegacy(area, LEGACY_PENDING_PREFIX);
  const raw = storageGet(scopedKey(PENDING_PREFIX, area));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UnconfirmedAttempt;
    if (parsed.actor !== expected.actor || typeof parsed.scope !== 'string' || typeof parsed.evidence !== 'number') {
      throw new Error('invalid');
    }
    return parsed;
  } catch {
    throw new MonetarySafetyError('monetary_attempt_ambiguous');
  }
}

export function markUnconfirmed(area: string, scope: string, evidence = 0, payload?: unknown): void {
  const actor = parseScope(area).actor;
  if (parseScope(scope).actor !== actor) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const attempt: UnconfirmedAttempt = { actor, scope, evidence, ...(payload !== undefined && { payload }) };
  storageSet(scopedKey(PENDING_PREFIX, area), stable(attempt));
}

export function readUnconfirmed(area: string): UnconfirmedAttempt | null {
  return readPending(area);
}

export function clearUnconfirmed(area: string): void {
  storageRemove(scopedKey(PENDING_PREFIX, area));
}
