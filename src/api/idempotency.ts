import { useEffect, useState } from 'react';
import { economicKeysFor, payloadHash } from '../utils/payloadIdentity';
import { isDefinitiveMutationError } from './mutationRetry';
import { loadSession, type StoredSession } from './storage';

export class MonetarySafetyError extends Error {
  constructor(code: string) { super(code); this.name = 'MonetarySafetyError'; }
}

export interface MoneyActor { id: string; session?: StoredSession; }
export interface MonetaryIntentHandle { key: string; generation: number; lease: string; }
export interface UnconfirmedAttempt {
  actor: string;
  scope: string;
  handle: MonetaryIntentHandle;
  /** Otra familia del mismo principal solo puede reconciliar, nunca mutar. */
  reconciliationRequired?: boolean;
  payload?: unknown;
}

const JOURNAL_PREFIX = 'payme_money_journal_v5_';
const PREVIOUS_JOURNAL_PREFIXES = ['payme_money_journal_v4_', 'payme_money_journal_v3_'] as const;
const LEGACY_QUARANTINE_PREFIX = 'payme_money_legacy_quarantine_v1_';
const LEGACY_IDEM_PREFIX = 'payme_idem_';
const LEGACY_PENDING_PREFIX = 'payme_pending_';
const VERSION = 5;
const SEPARATOR = '::';
const memoryPm = new Map<string, string>();
const memoryPending = new Map<string, UnconfirmedAttempt>();

/**
 * `fpv` — VERSIÓN DEL FINGERPRINT (ORDEN 2-A). Ausente = 1, el digest del
 * request ENTERO. `2` = identidad económica alineada con `PAYLOAD_KEYS` del
 * dueño. Se guarda en vez de deducirse porque un journal escrito por la
 * versión anterior sigue vivo en el navegador de alguien: sin la marca, su
 * fingerprint viejo se compararía contra el algoritmo nuevo y un reintento
 * legítimo moriría con `monetary_payload_ambiguous`.
 */
interface Journal { v: number; actor: string; family: string; area: string; key: string; generation: number; fingerprint?: string; fpv?: number; state: 'prepared' | 'in_flight' | 'sending' | 'ambiguous' | 'terminal'; at: number; retries?: number; reference?: string; }

function stable(value: unknown): string { return JSON.stringify(value); }
function journalKey(index: string): string { return JOURNAL_PREFIX + index; }
function legacyQuarantineKey(area: string): string { return LEGACY_QUARANTINE_PREFIX + area; }
function readEntry(index: string): Journal | null {
  try {
    const raw = localStorage.getItem(journalKey(index));
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('corrupt');
    const entry = value as Journal;
    if (
      entry.v !== VERSION ||
      typeof entry.actor !== 'string' || !entry.actor ||
      typeof entry.family !== 'string' || !entry.family ||
      typeof entry.area !== 'string' || !entry.area ||
      typeof entry.key !== 'string' || entry.key.length < 8 || entry.key.length > 100 ||
      !Number.isSafeInteger(entry.generation) || entry.generation < 1 ||
      !Number.isSafeInteger(entry.at) || entry.at < 0 ||
      !['prepared', 'in_flight', 'sending', 'ambiguous', 'terminal'].includes(entry.state) ||
      (entry.fingerprint !== undefined && !/^[0-9a-f]{64}$/.test(entry.fingerprint)) ||
      (entry.fpv !== undefined && entry.fpv !== 2) ||
      (entry.retries !== undefined && (!Number.isSafeInteger(entry.retries) || entry.retries < 0)) ||
      (entry.reference !== undefined && (typeof entry.reference !== 'string' || !entry.reference))
    ) throw new Error('legacy');
    return entry;
  } catch { throw new MonetarySafetyError('monetary_journal_ambiguous'); }
}
function guardPreviousJournal(area: string): void {
  try {
    // v3/v4 indexaban por familia; v5 indexa por principal estable. Como el
    // índice viejo no se puede derivar tras relogin, se barre el área opaca.
    // Ignorar uno solo podría habilitar una mutación paralela cross-family.
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !PREVIOUS_JOURNAL_PREFIXES.some((prefix) => key.startsWith(prefix))) continue;
      const raw = localStorage.getItem(key);
      const value: unknown = raw ? JSON.parse(raw) : null;
      if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { area?: unknown }).area !== 'string') {
        // Un residuo corrupto tampoco puede atribuirse con seguridad.
        throw new MonetarySafetyError('monetary_journal_ambiguous');
      }
      if ((value as { area: string }).area === area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    }
  } catch (error) {
    if (error instanceof MonetarySafetyError) throw error;
    throw new MonetarySafetyError('money_storage_unavailable');
  }
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
  // Dominio durable/lock, deliberadamente independiente del raw scope:
  // - topup: todos los rieles/montos se excluyen entre sí;
  // - transfer/create_mesa: una sola intención viva por principal;
  // - mesa_pay: se serializa por código de mesa, no entre mesas distintas.
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
async function identities(scope: string, operation: string): Promise<{ actor: string; family: string; area: string; index: string }> {
  const parsed = parseScope(scope);
  // `actor` es estable entre familias del MISMO principal: el journal vivo
  // debe sobrevivir logout/relogin. `family` liga quién puede MUTARLO.
  const actor = await digest(parsed.actor);
  // El lease no forma parte del índice ni del lock. Para auth es el family_id
  // local (ya persistido en la sesión); para guest, el actor ya es un digest.
  const family = parsed.actor.startsWith('auth:') ? currentFamily(parsed.actor) : parsed.actor;
  const area = await digest(areaFor(operation));
  return { actor, family, area, index: await digest(`${actor}|${area}`) };
}
function legacyOperation(raw: string): string | null {
  if (raw.startsWith('pay:')) return `mesa_pay:${raw.slice(4).split('|')[0]}`;
  if (raw.startsWith('mesa:')) return 'create_mesa';
  if (raw.startsWith('topup:')) return 'topup_card';
  if (raw.startsWith('transfer:')) return 'transfer';
  return null;
}
function memoryKey(scope: string): string {
  // El scope crudo direcciona artefactos EN MEMORIA; el lease opaco del
  // handle aporta la familia. Nunca define el área durable ni su lock.
  parseScope(scope);
  return scope;
}
function handleMemoryKey(scope: string, handle: MonetaryIntentHandle): string {
  return `${memoryKey(scope)}|${handle.lease}|g${handle.generation}|${handle.key}`;
}
function handleBelongsToCurrentFamily(scope: string, handle: MonetaryIntentHandle): boolean {
  const parsed = parseScope(scope);
  const current = parsed.actor.startsWith('auth:') ? currentFamily(parsed.actor) : parsed.actor;
  return handle.lease === current;
}
function legacyKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key) keys.push(key);
    }
    return keys;
  } catch { throw new MonetarySafetyError('monetary_legacy_quarantined'); }
}
interface LegacyQuarantine { v: 1 | 2; area: string; at: number; state?: 'frozen' | 'reconciled'; reconciled_at?: number; }
function writeLegacyQuarantine(area: string, record?: LegacyQuarantine): void {
  const key = legacyQuarantineKey(area);
  const value = stable(record ?? { v: 2, area, at: Date.now(), state: 'frozen' });
  try {
    localStorage.setItem(key, value);
    if (localStorage.getItem(key) !== value) throw new Error('roundtrip');
  } catch { throw new MonetarySafetyError('money_storage_unavailable'); }
}
/**
 * Lectura del registro de cuarentena. Un v1 (sin `state`) se lee como
 * congelado: es el formato que escribía la versión anterior.
 */
function parseLegacyQuarantine(area: string): LegacyQuarantine | null {
  const raw = localStorage.getItem(legacyQuarantineKey(area));
  if (!raw) return null;
  const value = JSON.parse(raw) as unknown;
  if (
    !value || typeof value !== 'object' || Array.isArray(value) ||
    ((value as { v?: unknown }).v !== 1 && (value as { v?: unknown }).v !== 2) ||
    (value as { area?: unknown }).area !== area
  ) throw new Error('corrupt');
  const record = value as LegacyQuarantine;
  const state = record.v === 2 ? record.state : 'frozen';
  if (state !== 'frozen' && state !== 'reconciled') throw new Error('corrupt');
  return { ...record, state };
}
function hasLegacyQuarantine(area: string): boolean {
  try {
    const record = parseLegacyQuarantine(area);
    // N-09: una cuarentena RECONCILIADA por el titular deja de bloquear. El
    // residuo NO se borra: sigue en sessionStorage como evidencia.
    return !!record && record.state !== 'reconciled';
  } catch { throw new MonetarySafetyError('monetary_legacy_quarantined'); }
}
/**
 * origin/main no persistía actor/family. No se puede atribuir ese intento a
 * la sesión actual de forma segura; se conserva intacto y se cuarentena el
 * área opaca antes de emitir una nueva mutación.
 */
function guardLegacy(area: string, operation: string): void {
  if (hasLegacyQuarantine(area)) throw new MonetarySafetyError('monetary_legacy_quarantined');
  // N-09: si el titular ya reconcilió esta área, el residuo intacto no vuelve a
  // congelarla. Sin esto, liberar era imposible: el barrido la re-escribía.
  if (isLegacyQuarantineReconciled(area)) return;
  for (const key of legacyKeys()) {
    const raw = key.startsWith(LEGACY_IDEM_PREFIX)
      ? key.slice(LEGACY_IDEM_PREFIX.length)
      : key.startsWith(LEGACY_PENDING_PREFIX)
        ? key.slice(LEGACY_PENDING_PREFIX.length)
        : null;
    const legacy = raw ? legacyOperation(raw) : null;
    // Un prefijo histórico desconocido tampoco se ignora: no se puede saber
    // qué mutación protegía ni a qué área atribuirlo. Se congela el área que
    // el usuario intenta abrir, antes de red, hasta reconciliación explícita.
    if (raw && (!legacy || areaFor(legacy) === areaFor(operation))) {
      writeLegacyQuarantine(area);
      throw new MonetarySafetyError('monetary_legacy_quarantined');
    }
  }
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
function handleOf(entry: Journal): MonetaryIntentHandle {
  return { key: entry.key, generation: entry.generation, lease: entry.family };
}
function sameHandle(entry: Journal, handle: MonetaryIntentHandle): boolean {
  return entry.key === handle.key && entry.generation === handle.generation && entry.family === handle.lease;
}
function validHandle(handle: MonetaryIntentHandle): boolean {
  return !!handle && typeof handle.key === 'string' && handle.key.length > 0 && Number.isSafeInteger(handle.generation) && handle.generation > 0 && typeof handle.lease === 'string' && handle.lease.length > 0;
}
function payloadUsesHandle(payload: unknown, handle: MonetaryIntentHandle): boolean {
  return !!payload && typeof payload === 'object' && !Array.isArray(payload) &&
    (payload as { idempotency_key?: unknown }).idempotency_key === handle.key;
}
export async function resolveMoneyActor(guestToken?: string): Promise<MoneyActor> {
  if (guestToken) return { id: `guest:${await digest(guestToken)}` };
  const session = loadSession();
  if (!session?.principal_id) throw new MonetarySafetyError('money_actor_unavailable');
  return { id: `auth:${session.principal_id}`, session };
}
export function useMoneyActor(guestToken?: string): { actor: MoneyActor | null; error: string | null; resolvedFor: string | undefined } {
  const [actor, setActor] = useState<MoneyActor | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `resolvedFor` no se persiste ni se usa como nombre de storage/key. Le
  // permite al caller no montar una vista B con el actor que resolvió A
  // mientras Web Crypto calcula el fingerprint nuevo.
  const [resolvedFor, setResolvedFor] = useState<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setActor(null);
    setError(null);
    setResolvedFor(undefined);
    resolveMoneyActor(guestToken)
      .then((a) => { if (alive) { setActor(a); setResolvedFor(guestToken); } })
      .catch((e: unknown) => { if (alive) { setActor(null); setError(e instanceof Error ? e.message : 'money_actor_unavailable'); setResolvedFor(guestToken); } });
    return () => { alive = false; };
  }, [guestToken]);
  return { actor, error, resolvedFor };
}
export function scopeForActor(actor: MoneyActor, raw: string): string { if (!raw) throw new MonetarySafetyError('monetary_attempt_ambiguous'); return `${actor.id}${SEPARATOR}${raw}`; }

/**
 * Adquiere la generación vigente para una acción explícita del usuario.
 * Un terminal abre exactamente una generación nueva bajo el mismo lock; un
 * intento preparado/en vuelo/ambiguo conserva su handle para el replay.
 */
export async function acquireMonetaryIntent(scope: string, operation: string): Promise<MonetaryIntentHandle> {
  const id = await identities(scope, operation);
  return withLock(id.index, async () => {
    guardLegacy(id.area, operation);
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (found && (found.v !== VERSION || found.actor !== id.actor || found.area !== id.area)) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found && found.state !== 'terminal') {
      if (found.family !== id.family) throw new MonetarySafetyError('monetary_family_reconciliation_required');
      return handleOf(found);
    }
    const generation = found ? found.generation + 1 : 1;
    if (!Number.isSafeInteger(generation)) throw new MonetarySafetyError('monetary_journal_ambiguous');
    const entry: Journal = { v: VERSION, actor: id.actor, family: id.family, area: id.area, key: newKey(), generation, state: 'prepared', at: Date.now() };
    writeEntry(id.index, entry);
    return handleOf(entry);
  });
}
export async function rememberPaymentMethod(scope: string, handle: MonetaryIntentHandle, pm: string): Promise<void> {
  if (!validHandle(handle) || !pm) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  if (!handleBelongsToCurrentFamily(scope, handle)) throw new MonetarySafetyError('monetary_family_reconciliation_required');
  memoryPm.set(handleMemoryKey(scope, handle), pm);
}
export function recallPaymentMethod(scope: string, handle: MonetaryIntentHandle): string | undefined {
  try {
    if (!handleBelongsToCurrentFamily(scope, handle)) return undefined;
    return memoryPm.get(handleMemoryKey(scope, handle));
  }
  catch { return undefined; }
}
/**
 * ORDEN 2-A · EL SELLO DEL INTENTO PASA A SER SU IDENTIDAD ECONÓMICA.
 *
 * Antes era `sha256(JSON.stringify(request))` — el request ENTERO — y eso es
 * **más grueso que el contrato**: el dueño hashea un subconjunto declarado y
 * **deja la fuente de pago afuera a propósito**, porque Stripe.js materializa
 * otro `pm_` por invocación y meterlo adentro rota la clave en un reload con
 * tarjeta tipeada → segunda mesa con segundo hold (B-06).
 *
 * Consecuencia real y medida: el organizador que perdía la pestaña durante el
 * 3DS **no podía reenviar** aunque el backend lo hubiera aceptado. Fallaba
 * cerrado —cortaba, no duplicaba— pero trababa por una diferencia que no es
 * económica.
 *
 * Sólo se alinea donde hay llaves owner publicadas. G-37 agregó `mesa_pay`
 * v2 además de `create_mesa`; el resto conserva el digest grueso.
 *
 * @returns el fingerprint sellado y su versión.
 */
async function fingerprintDe(operation: string, payload: unknown): Promise<{ value: string; fpv?: 2 }> {
  const keys = economicKeysFor(operation);
  if (!keys) return { value: await digest(stable(payload)) };
  return { value: await payloadHash(payload, keys), fpv: 2 };
}

/**
 * ¿El payload que llega es el mismo que se selló? La comparación usa **el
 * algoritmo con el que se selló**, no el vigente: un journal escrito por la
 * versión anterior guarda un digest v1, y compararlo contra el hash económico
 * mataría un reintento legítimo con `monetary_payload_ambiguous`.
 *
 * Un match v1 implica que el request es byte-idéntico, o sea que la identidad
 * económica **también** lo es: por eso el caller puede reescribir el sello a
 * v2 sin aflojar nada.
 */
function selloCoincide(found: Journal, nuevo: { value: string; fpv?: 2 }, legacy: string): boolean {
  if (!found.fingerprint) return true;
  return found.fpv === 2 ? found.fingerprint === nuevo.value : found.fingerprint === legacy;
}

export async function prepareMonetaryRequest(scope: string, operation: string, handle: MonetaryIntentHandle, payload: unknown): Promise<void> {
  if (!validHandle(handle) || !payloadUsesHandle(payload, handle)) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const id = await identities(scope, operation);
  const sello = await fingerprintDe(operation, payload);
  const legacy = await digest(stable(payload));
  await withLock(id.index, async () => {
    guardLegacy(id.area, operation);
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found || found.v !== VERSION || found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found.family !== id.family) throw new MonetarySafetyError('monetary_family_reconciliation_required');
    if (!sameHandle(found, handle)) throw new MonetarySafetyError('monetary_generation_stale');
    if (found.state === 'terminal') throw new MonetarySafetyError('monetary_area_frozen');
    if (!selloCoincide(found, sello, legacy)) throw new MonetarySafetyError('monetary_payload_ambiguous');
    // Se escribe ANTES de toda red. `sending` con el mismo fingerprint también
    // puede volver a in_flight: significa que el proceso cayó después del POST;
    // el replay conserva la misma key y nunca duplica la intención económica.
    // Una entrada v1 que coincidió se REESCRIBE a v2: el request era
    // byte-idéntico, así que su identidad económica está acreditada.
    writeEntry(id.index, { ...found, fingerprint: sello.value, ...(sello.fpv ? { fpv: sello.fpv } : {}), state: 'in_flight', at: Date.now() });
  });
}
export async function withPreparedMonetaryRequest<T>(operation: string, handle: MonetaryIntentHandle, payload: unknown, guestToken: string | undefined, send: (session: StoredSession | undefined) => Promise<T>): Promise<T> {
  if (!validHandle(handle) || !payloadUsesHandle(payload, handle)) throw new MonetarySafetyError('monetary_request_unprepared');
  const actor = await resolveMoneyActor(guestToken); const scope = scopeForActor(actor, 'runtime'); const id = await identities(scope, operation);
  const sello = await fingerprintDe(operation, payload);
  const legacy = await digest(stable(payload));
  return withLock(id.index, async () => {
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found || found.v !== VERSION) throw new MonetarySafetyError('monetary_request_unprepared');
    if (found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found.family !== id.family) throw new MonetarySafetyError('monetary_family_reconciliation_required');
    if (!sameHandle(found, handle)) throw new MonetarySafetyError('monetary_generation_stale');
    // Acá se exige que YA esté sellado —a diferencia de `prepare`, donde el
    // sello puede no existir todavía—: mandar sin preparar es el agujero que
    // esta función cierra. Por eso `!found.fingerprint` también corta.
    if (!found.fingerprint || !selloCoincide(found, sello, legacy)) throw new MonetarySafetyError('monetary_request_unprepared');
    if (found.state === 'terminal') throw new MonetarySafetyError('monetary_generation_stale');
    if (!['in_flight', 'ambiguous'].includes(found.state)) throw new MonetarySafetyError('monetary_request_unprepared');
    writeEntry(id.index, { ...found, state: 'sending', at: Date.now(), retries: (found.retries ?? 0) + 1 });
    try { return await send(actor.session); }
    catch (error) { writeEntry(id.index, { ...found, state: 'ambiguous', at: Date.now(), retries: (found.retries ?? 0) + 1 }); throw error; }
  });
}
/** Marca terminal SOLO la generación capturada. Nunca libera una más nueva. */
export async function completeMonetaryIntent(scope: string, operation: string, handle: MonetaryIntentHandle): Promise<void> {
  if (!validHandle(handle)) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const id = await identities(scope, operation);
  await withLock(id.index, async () => {
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found || found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found.family !== id.family) throw new MonetarySafetyError('monetary_family_reconciliation_required');
    if (!sameHandle(found, handle)) throw new MonetarySafetyError('monetary_generation_stale');
    if (found.state !== 'terminal') writeEntry(id.index, { ...found, state: 'terminal', at: Date.now() });
  });
  memoryPm.delete(handleMemoryKey(scope, handle));
}
/**
 * N-07 · SALIDA del intento congelado, tras una reconciliación EXPLÍCITA.
 *
 * El journal sabía congelar pero no destrabar: sin payload en memoria —o sea
 * tras cualquier reload, back del navegador o remount— el área quedaba
 * bloqueada sin ninguna transición posible. Para `create_mesa` el área es
 * global por principal, así que un corte de red abriendo una mesa dejaba al
 * organizador sin poder abrir NINGUNA mesa nunca más en ese navegador.
 *
 * A diferencia de `completeMonetaryIntent`, esta función NO exige que la
 * familia coincida. El motivo: un relogin del MISMO principal crea una familia
 * nueva, así que exigirla convertía el fail-closed en denegación permanente.
 * Lo que sí se exige es el actor (principal estable) y la generación exacta,
 * de modo que el aislamiento cross-PRINCIPAL —el que de verdad protege— queda
 * intacto.
 *
 * Sólo TERMINALIZA: nunca entrega payload ni PM, nunca reenvía, nunca cobra.
 * El caller debe haber obtenido evidencia autoritativa del backend (para una
 * mesa, `claimed_by_me`) y confirmación del usuario ANTES de llamar. No hay TTL
 * ni desbloqueo automático: es una decisión humana informada.
 */
export async function reconcileMonetaryIntent(scope: string, operation: string, handle: MonetaryIntentHandle): Promise<void> {
  if (!validHandle(handle)) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const id = await identities(scope, operation);
  await withLock(id.index, async () => {
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found) return;
    if (found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    if (found.key !== handle.key || found.generation !== handle.generation) throw new MonetarySafetyError('monetary_generation_stale');
    if (found.state !== 'terminal') writeEntry(id.index, { ...found, state: 'terminal', at: Date.now() });
  });
  // Los artefactos en memoria mueren con el intento; nunca sobreviven a su
  // generación. Se limpian best-effort: una familia vieja no puede tocar los de
  // la vigente y eso no debe impedir la reconciliación.
  try { memoryPm.delete(handleMemoryKey(scope, handle)); } catch { /* fail-open solo en memoria */ }
  try { memoryPending.delete(handleMemoryKey(scope, handle)); } catch { /* idem */ }
}
/** Referencia opaca para reconciliar; el payload/PM nunca se persiste. */
export async function rememberMonetaryReference(scope: string, operation: string, handle: MonetaryIntentHandle, reference: string): Promise<void> {
  if (!validHandle(handle) || !reference) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  const id = await identities(scope, operation);
  await withLock(id.index, async () => {
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found || found.actor !== id.actor || found.area !== id.area || !['in_flight', 'sending', 'ambiguous'].includes(found.state)) throw new MonetarySafetyError('monetary_request_unprepared');
    if (found.family !== id.family) throw new MonetarySafetyError('monetary_family_reconciliation_required');
    if (!sameHandle(found, handle)) throw new MonetarySafetyError('monetary_generation_stale');
    writeEntry(id.index, { ...found, reference, at: Date.now() });
  });
}
/**
 * ORDEN 2-A · el `payload_hash` que se manda en
 * `GET /mesas/creations/:idempotency_key`, leído del journal.
 *
 * 🔴 **Devuelve `null` salvo que el sello sea v2, y esa condición es la que
 * hace segura la consulta.** Un sello v1 es el digest del request ENTERO —un
 * número que el dueño no puede reproducir— así que mandarlo daría **409
 * `payload_hash_conflict` garantizado**, y este front lee ese 409 como
 * "conservá el freeze": el organizador quedaría trabado por un dato que
 * nosotros mandamos mal. Mejor no mandar hash: el endpoint contesta igual, sin
 * el chequeo extra.
 */
export async function readEconomicFingerprint(scope: string, operation: string): Promise<string | null> {
  const id = await identities(scope, operation);
  return withLock(id.index, async () => {
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found || found.actor !== id.actor || found.area !== id.area) return null;
    if (found.state === 'terminal' || found.state === 'prepared') return null;
    return found.fpv === 2 && found.fingerprint ? found.fingerprint : null;
  });
}
export async function readMonetaryReference(scope: string, operation: string): Promise<{ reference: string; handle: MonetaryIntentHandle } | null> {
  const id = await identities(scope, operation);
  return withLock(id.index, async () => {
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found || found.actor !== id.actor || found.area !== id.area || found.state === 'terminal' || found.state === 'prepared') return null;
    return found.reference ? { reference: found.reference, handle: handleOf(found) } : null;
  });
}
export function shouldRotateOnError(code: string, status?: number | null): boolean {
  // El status manda también para códigos conocidos. Un 5xx puede llegar
  // después de que el proveedor aplicó la operación; reusar la misma key es
  // seguro. Si el backend ya la terminalizó, el replay devuelve el 409 público
  // correspondiente y recién entonces se abre una generación nueva.
  return isDefinitiveMutationError(code, status);
}
export function markUnconfirmed(area: string, scope: string, handle: MonetaryIntentHandle, payload?: unknown): void {
  if (!validHandle(handle)) throw new MonetarySafetyError('monetary_attempt_ambiguous');
  if (!handleBelongsToCurrentFamily(area, handle)) throw new MonetarySafetyError('monetary_family_reconciliation_required');
  memoryPending.set(handleMemoryKey(area, handle), { actor: parseScope(area).actor, scope, handle, ...(payload !== undefined && { payload }) });
}
/**
 * Tras reload se consulta el journal del principal+área. Otra familia del mismo
 * principal recibe una congelación de solo reconciliación; nunca payload/PM ni
 * permiso de mutación. Otro principal u otra mesa permanecen aislados. Si falta
 * payload en memoria, la vista no puede reconstruir ni reenviar a ciegas.
 */
export async function readUnconfirmed(area: string, operation: string): Promise<UnconfirmedAttempt | null> {
  const parsed = parseScope(area);
  const id = await identities(area, operation);
  return withLock(id.index, async () => {
    guardLegacy(id.area, operation);
    guardPreviousJournal(id.area);
    const found = readEntry(id.index);
    if (!found || found.state === 'prepared' || found.state === 'terminal') return null;
    if (found.actor !== id.actor || found.area !== id.area) throw new MonetarySafetyError('monetary_journal_ambiguous');
    const crossFamily = found.family !== id.family;
    const memory = crossFamily ? undefined : memoryPending.get(handleMemoryKey(area, handleOf(found)));
    if (memory && memory.actor === parsed.actor && sameHandle(found, memory.handle)) {
      return memory.payload !== undefined
        ? memory
        : { ...memory, reconciliationRequired: true };
    }
    return {
      actor: parsed.actor,
      scope: area,
      handle: handleOf(found),
      // Sin payload en memoria no existe replay exacto, incluso dentro de la
      // misma familia tras reload. El caller debe bloquear ANTES de volver a
      // tokenizar tarjeta o construir otra intención.
      reconciliationRequired: true,
    };
  });
}
export function clearUnconfirmed(area: string, handle: MonetaryIntentHandle): void {
  try {
    if (handleBelongsToCurrentFamily(area, handle)) memoryPending.delete(handleMemoryKey(area, handle));
  } catch { /* una familia vieja nunca limpia la vigente */ }
}

// ─── N-09 · salida controlada de la cuarentena legacy ───────────────

function isLegacyQuarantineReconciled(area: string): boolean {
  try { return parseLegacyQuarantine(area)?.state === 'reconciled'; }
  catch { return false; }
}

export interface LegacyQuarantineState {
  area: string;
  at: number;
  reconciled: boolean;
  /** Claves de residuo halladas, para el runbook. Nunca su contenido. */
  residue: string[];
}

/**
 * Estado de la cuarentena para una operación, en forma consultable por la UI.
 * No lanza: la pantalla necesita poder EXPLICAR el bloqueo, y una función que
 * sólo sabía lanzar es la razón por la que no existía ninguna salida.
 */
export async function readLegacyQuarantine(scope: string, operation: string): Promise<LegacyQuarantineState | null> {
  const id = await identities(scope, operation);
  let record: LegacyQuarantine | null = null;
  try { record = parseLegacyQuarantine(id.area); }
  catch { return { area: id.area, at: 0, reconciled: false, residue: [] }; }
  if (!record) return null;
  let residue: string[] = [];
  try {
    residue = legacyKeys().filter(
      (k) => k.startsWith(LEGACY_IDEM_PREFIX) || k.startsWith(LEGACY_PENDING_PREFIX),
    );
  } catch { residue = []; }
  return { area: id.area, at: record.at, reconciled: record.state === 'reconciled', residue };
}

/**
 * Levanta la cuarentena tras una reconciliación EXPLÍCITA del titular.
 *
 * No borra el residuo: la evidencia monetaria se conserva intacta, tal como
 * exige la orden. Lo único que cambia es que el área deja de estar congelada,
 * así que la próxima operación abre una generación nueva.
 *
 * Es una decisión humana, no un TTL: la pantalla debe haber mostrado el runbook
 * y pedido confirmación antes de llamar acá.
 */
export async function releaseLegacyQuarantine(scope: string, operation: string): Promise<void> {
  const id = await identities(scope, operation);
  await withLock(id.index, async () => {
    let record: LegacyQuarantine | null = null;
    try { record = parseLegacyQuarantine(id.area); }
    catch { record = null; }
    writeLegacyQuarantine(id.area, {
      v: 2,
      area: id.area,
      at: record?.at ?? Date.now(),
      state: 'reconciled',
      reconciled_at: Date.now(),
    });
  });
}

// ─── N-08 · borde invitado↔autenticado ──────────────────────────────

/**
 * ¿Este DISPOSITIVO ya tiene un intento monetario para esta misma área bajo
 * OTRO actor?
 *
 * El caso: la misma persona entra a una mesa primero por link de invitado y
 * después autenticada (o al revés). Son dos actores distintos, así que el
 * journal nace virgen y sale una idempotency key nueva. En división igual eso
 * toma un SEGUNDO casillero: doble cobro real, con B-06 puesto.
 *
 * `claimed_by_me` del backend NO alcanza para detectarlo —lo verifiqué en
 * `contract-mirror/routes/mesas.js`: se computa por identidad (hash del token
 * de invitado para el guest, `user_id` para el autenticado), así que el backend
 * también ve dos personas distintas—. La única evidencia disponible sin cambiar
 * contrato es local: este navegador sí conoce las dos puertas.
 *
 * NO fusiona principals ni los compara: sólo informa que existe otro actor con
 * intento sobre la MISMA área, sin decir cuál ni entregar nada suyo. Y NO
 * bloquea: pagar varias partes es legítimo (acta 2026-07-25, el guard
 * un-usuario-un-casillero está vetado). Sirve para exigir una confirmación
 * explícita, de modo que sea una decisión y no un accidente.
 *
 * Ante cualquier ambigüedad devuelve `true`: preferimos preguntar de más.
 */
export async function crossActorIntentExists(scope: string, operation: string): Promise<boolean> {
  const id = await identities(scope, operation);
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(JOURNAL_PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw) as unknown;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
      const entry = value as Journal;
      if (typeof entry.area !== 'string' || typeof entry.actor !== 'string') return true;
      if (entry.area === id.area && entry.actor !== id.actor) return true;
    }
    return false;
  } catch { return true; }
}
