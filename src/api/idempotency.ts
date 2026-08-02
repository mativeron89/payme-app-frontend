import { useEffect, useState } from 'react';
import { loadSession, type StoredSession } from './storage';

export class MonetarySafetyError extends Error {
  constructor(code: string) { super(code); this.name = 'MonetarySafetyError'; }
}

export interface MoneyActor { id: string; session?: StoredSession; }
export interface UnconfirmedAttempt { actor: string; scope: string; /** Baseline atribuible; ausente nunca acredita un pago. */ evidence?: number; payload?: unknown; }

const JOURNAL_PREFIX = 'payme_money_journal_v3_';
const VERSION = 3;
const SEPARATOR = '::';
const memoryPm = new Map<string, string>();
const memoryPending = new Map<string, UnconfirmedAttempt>();

interface Journal { v: number; actor: string; area: string; key: string; fingerprint?: string; state: 'prepared' | 'in_flight' | 'sending' | 'ambiguous' | 'terminal'; at: number; retries?: number; evidence?: number; reference?: string; }

function stable(value: unknown): string { return JSON.stringify(value); }
function journalKey(index: string): string { return JOURNAL_PREFIX + index; }
function readEntry(index: string): Journal | null {
  try {
    const raw = localStorage.getItem(journalKey(index));
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('corrupt');
    const entry = value as Journal;
    if (entry.v !== VERSION || typeof entry.actor !== 'string' || typeof entry.area !== 'string' || typeof entry.key !== 'string' || !['prepared', 'in_flight', 'sending', 'ambiguous', 'terminal'].includes(entry.state) || (entry.evidence !== undefined && (!Number.isSafeInteger(entry.evidence) || entry.evidence < 0)) || (entry.reference !== undefined && (typeof entry.reference !== 'string' || !entry.reference))) throw new Error('legacy');
    return entry;
  } catch { throw new MonetarySafetyError('monetary_journal_ambiguous'); }
}
function writeEntry(index: string, entry: Journal): void {
  const raw = stable(entry);
  try {
    localStorage.setItem(journalKey(index), raw);
    if (localStorage.getItem(journalKey(index)) !== raw) throw new Error('roundtrip');
  } catch { throw new MonetarySafetyError('money_storage_unavailable'); }
}
function parseScope(scope: string): { actor: string; raw: string } {
  const at = scope.indexOf(SEPARATOR);
  if (at <= 0) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const actor = scope.slice(0, at);
  if (!actor.startsWith('auth:') && !actor.startsWith('guest:')) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  return { actor, raw: scope.slice(at + SEPARATOR.length) };
}
function areaFor(operation: string): string {
  if (operation.startsWith('topup_')) return 'topup';
  if (operation === 'transfer') return 'transfer';
  if (operation.startsWith('mesa_pay:')) return operation;
  return operation;
}
async function digest(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') throw new MonetarySafetyError('money_crypto_unavailable');
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function identities(scope: string, operation: string): Promise<{ actor: string; area: string; index: string }> {
  const parsed = parseScope(scope);
  const family = parsed.actor.startsWith('auth:') ? currentFamily(parsed.actor) : '';
  const actor = await digest(`${parsed.actor}|${family}`);
  const area = await digest(areaFor(operation));
  return { actor, area, index: await digest(`${actor}|${area}`) };
}
function currentFamily(actor: string): string {
  const session = loadSession();
  if (!session || actor !== `auth:${session.principal_id}`) throw new MonetarySafetyError('money_actor_unavailable');
  return session.family_id;
}
async function withLock<T>(index: string, action: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (!locks) throw new MonetarySafetyError('money_lock_unavailable');
  // El nombre usa solo un hash; nunca identidad, payload ni PM crudos.
  return locks.request(`payme-money-${index}`, { mode: 'exclusive' }, action);
}
function newKey(): string {
  if (!globalThis.crypto?.randomUUID) throw new MonetarySafetyError('money_crypto_unavailable');
  return crypto.randomUUID();
}
export async function resolveMoneyActor(guestToken?: string): Promise<MoneyActor> {
  if (guestToken) return { id: `guest:${await digest(guestToken)}` };
  const session = loadSession();
  if (!session?.principal_id) throw new MonetarySafetyError('money_actor_unavailable');
  return { id: `auth:${session.principal_id}`, session };
}
export function useMoneyActor(guestToken?: string): { actor: MoneyActor | null; error: string | null } {
  const [actor, setActor] = useState<MoneyActor | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { let alive = true; setActor(null); resolveMoneyActor(guestToken).then((a) => alive && setActor(a)).catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'money_actor_unavailable')); return () => { alive = false; }; }, [guestToken]);
  return { actor, error };
}
export function scopeForActor(actor: MoneyActor, raw: string): string { if (!raw) throw new MonetarySafetyError('monetary_attempt_ambiguous'); return `${actor.id}${SEPARATOR}${raw}`; }

export async function idempotencyKeyFor(scope: string, operation: string): Promise<string> {
  const id = await identities(scope, operation);
  return withLock(id.index, async () => {
    const found = readEntry(id.index);
    if (found && (found.v !== VERSION || found.actor !== id.actor || found.area !== id.area)) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found) return found.key;
    const entry: Journal = { v: VERSION, actor: id.actor, area: id.area, key: newKey(), state: 'prepared', at: Date.now() };
    writeEntry(id.index, entry); return entry.key;
  });
}
export async function rememberPaymentMethod(scope: string, pm: string): Promise<void> { if (!pm) throw new MonetarySafetyError('monetary_attempt_ambiguous'); memoryPm.set(scope, pm); }
export function recallPaymentMethod(scope: string): string | undefined { return memoryPm.get(scope); }
export async function prepareMonetaryRequest(scope: string, operation: string, payload: unknown, evidence?: number): Promise<string> {
  const id = await identities(scope, operation); const fingerprint = await digest(stable(payload));
  if (evidence !== undefined && (!Number.isSafeInteger(evidence) || evidence < 0)) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  return withLock(id.index, async () => {
    const found = readEntry(id.index);
    if (!found || found.v !== VERSION || found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found.state === 'sending' || found.state === 'terminal') throw new MonetarySafetyError('monetary_area_frozen');
    if (found.fingerprint && found.fingerprint !== fingerprint) throw new MonetarySafetyError('monetary_payload_ambiguous');
    // Se escribe ANTES de toda red. Un crash deja in_flight detectable tras reload.
    writeEntry(id.index, { ...found, fingerprint, state: 'in_flight', at: Date.now(), ...(evidence !== undefined && { evidence }) }); return found.key;
  });
}
export async function withPreparedMonetaryRequest<T>(operation: string, key: string, payload: unknown, guestToken: string | undefined, send: (session: StoredSession | undefined) => Promise<T>): Promise<T> {
  const actor = await resolveMoneyActor(guestToken); const scope = scopeForActor(actor, 'runtime'); const id = await identities(scope, operation); const fingerprint = await digest(stable(payload));
  return withLock(id.index, async () => {
    const found = readEntry(id.index);
    if (!found || found.v !== VERSION || found.key !== key || found.fingerprint !== fingerprint) throw new MonetarySafetyError('monetary_request_unprepared');
    if (found.state === 'terminal') throw new MonetarySafetyError('monetary_terminal_retained');
    if (!['in_flight', 'ambiguous'].includes(found.state)) throw new MonetarySafetyError('monetary_request_unprepared');
    writeEntry(id.index, { ...found, state: 'sending', at: Date.now(), retries: (found.retries ?? 0) + 1 });
    try { return await send(actor.session); }
    catch (error) { writeEntry(id.index, { ...found, state: 'ambiguous', at: Date.now(), retries: (found.retries ?? 0) + 1 }); throw error; }
  });
}
export async function rotateIdempotencyKey(scope: string, operation?: string): Promise<void> {
  const raw = parseScope(scope).raw;
  const inferred = raw.startsWith('pay:') ? `mesa_pay:${raw.slice(4).split('|')[0]}` : raw.startsWith('mesa:') ? 'create_mesa' : raw.startsWith('topup:') ? 'topup_card' : raw.startsWith('transfer:') ? 'transfer' : undefined;
  if (!operation && !inferred) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const id = await identities(scope, operation ?? inferred!); await withLock(id.index, async () => { const found = readEntry(id.index); if (!found) return; writeEntry(id.index, { ...found, state: 'terminal', at: Date.now() }); }); memoryPm.delete(scope);
}
/** Referencia opaca para reconciliar; el payload/PM nunca se persiste. */
export async function rememberMonetaryReference(scope: string, operation: string, reference: string): Promise<void> {
  if (!reference) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const id = await identities(scope, operation);
  await withLock(id.index, async () => {
    const found = readEntry(id.index);
    if (!found || found.actor !== id.actor || found.area !== id.area || !['in_flight', 'sending', 'ambiguous'].includes(found.state)) throw new MonetarySafetyError('monetary_request_unprepared');
    writeEntry(id.index, { ...found, reference, at: Date.now() });
  });
}
export async function readMonetaryReference(scope: string, operation: string): Promise<string | null> {
  const id = await identities(scope, operation);
  return withLock(id.index, async () => {
    const found = readEntry(id.index);
    if (!found || found.actor !== id.actor || found.area !== id.area || found.state === 'terminal' || found.state === 'prepared') return null;
    return found.reference ?? null;
  });
}
export const ROTATING_ERROR_CODES = ['idempotency_key_terminal','insufficient_funds','payment_provider_error','no_slots_available','mesa_not_payable','fraction_not_available','item_already_paid','item_already_locked','wallet_requires_auth'] as const;
export function shouldRotateOnError(code: string, status?: number | null): boolean { if (code === 'idempotency_conflict' || code === 'refunded' || code === 'validation_error') return false; if ((ROTATING_ERROR_CODES as readonly string[]).includes(code)) return true; return typeof status === 'number' && status !== 409 && status !== 429 && status >= 400 && status < 500; }
export function markUnconfirmed(area: string, scope: string, evidence = 0, payload?: unknown): void { memoryPending.set(area, { actor: parseScope(area).actor, scope, evidence, ...(payload !== undefined && { payload }) }); }
/**
 * Tras reload se consulta exclusivamente el journal del actor+familia+área
 * actual. Un intento ajeno (u otra mesa) no puede congelar ni liberar esta UI.
 * Si falta payload/PM en memoria, se devuelve una congelación sin payload: la
 * vista no puede reconstruir ni reenviar una mutación a ciegas.
 */
export async function readUnconfirmed(area: string, operation: string): Promise<UnconfirmedAttempt | null> {
  const parsed = parseScope(area);
  const memory = memoryPending.get(area);
  if (memory && memory.actor === parsed.actor) return memory;
  const id = await identities(area, operation);
  return withLock(id.index, async () => {
    const found = readEntry(id.index);
    if (!found || found.state === 'prepared') return null;
    if (found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    return { actor: parsed.actor, scope: area, ...(found.evidence !== undefined && { evidence: found.evidence }) };
  });
}
export function clearUnconfirmed(area: string): void { memoryPending.delete(area); }
