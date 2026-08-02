import { useEffect, useState } from 'react';
import { loadSession, type StoredSession } from './storage';

export class MonetarySafetyError extends Error {
  constructor(code: string) { super(code); this.name = 'MonetarySafetyError'; }
}

export interface MoneyActor { id: string; session?: StoredSession; }
export interface UnconfirmedAttempt { actor: string; scope: string; evidence: number; payload?: unknown; }

const JOURNAL_KEY = 'payme_money_journal_v3';
const VERSION = 3;
const SEPARATOR = '::';
const memoryPm = new Map<string, string>();
const memoryPending = new Map<string, UnconfirmedAttempt>();

interface Journal { v: number; actor: string; area: string; key: string; fingerprint?: string; state: 'prepared' | 'in_flight' | 'sending'; at: number; }
type JournalBook = Record<string, Journal>;

function stable(value: unknown): string { return JSON.stringify(value); }
function readBook(): JournalBook {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    if (!raw) return {};
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('corrupt');
    const book = value as JournalBook;
    if (Object.values(book).some((entry) => !entry || entry.v !== VERSION || typeof entry.actor !== 'string' || typeof entry.area !== 'string' || typeof entry.key !== 'string' || !['prepared', 'in_flight', 'sending'].includes(entry.state))) throw new Error('legacy');
    return book;
  } catch { throw new MonetarySafetyError('monetary_journal_ambiguous'); }
}
function writeBook(book: JournalBook): void {
  const raw = stable(book);
  try {
    localStorage.setItem(JOURNAL_KEY, raw);
    if (localStorage.getItem(JOURNAL_KEY) !== raw) throw new Error('roundtrip');
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
    const book = readBook(); const found = book[id.index];
    if (found && (found.v !== VERSION || found.actor !== id.actor || found.area !== id.area)) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found) return found.key;
    const entry: Journal = { v: VERSION, actor: id.actor, area: id.area, key: newKey(), state: 'prepared', at: Date.now() };
    writeBook({ ...book, [id.index]: entry }); return entry.key;
  });
}
export async function rememberPaymentMethod(scope: string, pm: string): Promise<void> { if (!pm) throw new MonetarySafetyError('monetary_attempt_ambiguous'); memoryPm.set(scope, pm); }
export function recallPaymentMethod(scope: string): string | undefined { return memoryPm.get(scope); }
export async function prepareMonetaryRequest(scope: string, operation: string, payload: unknown): Promise<string> {
  const id = await identities(scope, operation); const fingerprint = await digest(stable(payload));
  return withLock(id.index, async () => {
    const book = readBook(); const found = book[id.index];
    if (!found || found.v !== VERSION || found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found.state === 'sending') throw new MonetarySafetyError('monetary_area_frozen');
    if (found.fingerprint && found.fingerprint !== fingerprint) throw new MonetarySafetyError('monetary_payload_ambiguous');
    // Se escribe ANTES de toda red. Un crash deja in_flight detectable tras reload.
    writeBook({ ...book, [id.index]: { ...found, fingerprint, state: 'in_flight', at: Date.now() } }); return found.key;
  });
}
export async function withPreparedMonetaryRequest<T>(operation: string, key: string, payload: unknown, guestToken: string | undefined, send: (session: StoredSession | undefined) => Promise<T>): Promise<T> {
  const actor = await resolveMoneyActor(guestToken); const scope = scopeForActor(actor, 'runtime'); const id = await identities(scope, operation); const fingerprint = await digest(stable(payload));
  return withLock(id.index, async () => {
    const found = readBook()[id.index];
    if (!found || found.v !== VERSION || found.key !== key || found.state !== 'in_flight' || found.fingerprint !== fingerprint) throw new MonetarySafetyError('monetary_request_unprepared');
    writeBook({ ...readBook(), [id.index]: { ...found, state: 'sending', at: Date.now() } });
    return send(actor.session);
  });
}
export async function rotateIdempotencyKey(scope: string, operation?: string): Promise<void> {
  const raw = parseScope(scope).raw;
  const inferred = raw.startsWith('pay:') ? `mesa_pay:${raw.slice(4).split('|')[0]}` : raw.startsWith('mesa:') ? 'create_mesa' : raw.startsWith('topup:') ? 'topup_card' : raw.startsWith('transfer:') ? 'transfer' : undefined;
  if (!operation && !inferred) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const id = await identities(scope, operation ?? inferred!); await withLock(id.index, async () => { const book = readBook(); delete book[id.index]; writeBook(book); }); memoryPm.delete(scope);
}
export const ROTATING_ERROR_CODES = ['idempotency_key_terminal','insufficient_funds','payment_provider_error','no_slots_available','mesa_not_payable','fraction_not_available','item_already_paid','item_already_locked','wallet_requires_auth'] as const;
export function shouldRotateOnError(code: string, status?: number | null): boolean { if (code === 'idempotency_conflict' || code === 'refunded' || code === 'validation_error') return false; if ((ROTATING_ERROR_CODES as readonly string[]).includes(code)) return true; return typeof status === 'number' && status !== 409 && status !== 429 && status >= 400 && status < 500; }
export function markUnconfirmed(area: string, scope: string, evidence = 0, payload?: unknown): void { memoryPending.set(area, { actor: parseScope(area).actor, scope, evidence, ...(payload !== undefined && { payload }) }); }
export function readUnconfirmed(area: string): UnconfirmedAttempt | null {
  const memory = memoryPending.get(area); if (memory) return memory;
  // Sin payload recuperable tras reload, cualquier journal compartido activo
  // se trata como ambiguo: la UI no inventa una intención nueva.
  try { const active = Object.values(readBook()).some((entry) => entry.v === VERSION && entry.state !== 'prepared'); return active ? { actor: parseScope(area).actor, scope: area, evidence: 0 } : null; } catch { throw new MonetarySafetyError('monetary_journal_ambiguous'); }
}
export function clearUnconfirmed(area: string): void { memoryPending.delete(area); }
