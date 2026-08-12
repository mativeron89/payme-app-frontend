import type { User } from './types';

/**
 * Persistencia de sesión en localStorage. `user` es opcional SOLO por
 * compatibilidad con sesiones persistidas antes de v2.20 (G-02): hoy login y
 * register lo devuelven siempre, y una sesión vieja sin `user` se hidrata con
 * GET /account/me al restaurar (AuthContext).
 */

// La demo mock (/) y el build real (/live/) viven en el MISMO origen de GitHub
// Pages, así que comparten localStorage. Si la clave fuera única, una sesión
// mock se filtraría al build real (y su token falso iría al backend real).
// Namespaced por modo para que cada deploy tenga su propia sesión aislada.
const KEY = import.meta.env.VITE_MOCK === '1' ? 'payme_app_session__mock' : 'payme_app_session';
const TOMBSTONE_KEY = `${KEY}__invalidated_families_v1`;
const TOMBSTONE_VERSION = 1;
const MAX_TOMBSTONES = 64;
const listeners = new Set<() => void>();
const volatileInvalidated = new Map<string, string>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  user?: User;
  family_id: string;
  principal_id: string;
}

export class SessionStorageInvalidationError extends Error {
  readonly physicalSessionRemoved: boolean;

  constructor(physicalSessionRemoved: boolean) {
    super('session_storage_unavailable');
    this.name = 'SessionStorageInvalidationError';
    this.physicalSessionRemoved = physicalSessionRemoved;
  }
}

interface SessionTombstone {
  family_id: string;
  principal_id: string;
  at: number;
}

interface SessionTombstoneJournal {
  v: number;
  entries: SessionTombstone[];
}

function validSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as StoredSession;
  const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  if (!nonEmpty(s.access_token) || !nonEmpty(s.refresh_token) || !nonEmpty(s.family_id) || !nonEmpty(s.principal_id)) return false;
  return s.user === undefined || (!!s.user && typeof s.user === 'object' && nonEmpty(s.user.id) && s.user.id === s.principal_id);
}

function sameFamily(a: Pick<StoredSession, 'family_id' | 'principal_id'>, b: Pick<StoredSession, 'family_id' | 'principal_id'>): boolean {
  return a.family_id === b.family_id && a.principal_id === b.principal_id;
}

function readRawSession(): StoredSession | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  return validSession(parsed) ? parsed : null;
}

function readTombstones(): SessionTombstone[] {
  const raw = localStorage.getItem(TOMBSTONE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('session_tombstone_ambiguous');
  const journal = parsed as SessionTombstoneJournal;
  if (journal.v !== TOMBSTONE_VERSION || !Array.isArray(journal.entries) || journal.entries.some((entry) =>
    !entry || typeof entry !== 'object' || typeof entry.family_id !== 'string' || !entry.family_id || typeof entry.principal_id !== 'string' || !entry.principal_id || !Number.isSafeInteger(entry.at) || entry.at < 0
  )) throw new Error('session_tombstone_ambiguous');
  return journal.entries;
}

function tombstoned(session: Pick<StoredSession, 'family_id' | 'principal_id'>): boolean {
  if (volatileInvalidated.get(session.family_id) === session.principal_id) return true;
  return readTombstones().some((entry) => sameFamily(entry, session));
}

/**
 * La invalidación se persiste y verifica ANTES de borrar tokens. Así, aunque
 * removeItem falle o un refresh viejo termine tarde, load/save fallan cerrado.
 */
export function persistSessionTombstone(session: StoredSession): void {
  volatileInvalidated.set(session.family_id, session.principal_id);
  try {
    const entries = readTombstones().filter((entry) => !sameFamily(entry, session));
    entries.push({ family_id: session.family_id, principal_id: session.principal_id, at: Date.now() });
    entries.sort((a, b) => b.at - a.at);
    const raw = JSON.stringify({ v: TOMBSTONE_VERSION, entries: entries.slice(0, MAX_TOMBSTONES) });
    localStorage.setItem(TOMBSTONE_KEY, raw);
    if (localStorage.getItem(TOMBSTONE_KEY) !== raw) throw new Error('roundtrip');
    volatileInvalidated.delete(session.family_id);
  } catch {
    throw new Error('session_storage_unavailable');
  } finally {
    // La UI relee de inmediato: el tombstone durable o, ante fallo, el mapa
    // fail-closed impiden que siga firmando con la familia invalidada.
    notify();
  }
}

/** Borra solo la familia invalidada; una familia de relogin queda intacta. */
export function invalidateSession(session: StoredSession): boolean {
  let storageUnavailable = false;
  try {
    persistSessionTombstone(session);
  } catch {
    // El mapa volátil ya dejó la familia fail-closed. Aun sin journal durable,
    // intentamos quitar sus tokens físicos; abandonar acá los dejaría vivos
    // para una pestaña o proceso nuevo que no comparta ese mapa.
    storageUnavailable = true;
  }

  let removed = false;
  try {
    const current = readRawSession();
    if (current && sameFamily(current, session)) {
      localStorage.removeItem(KEY);
      const after = readRawSession();
      if (after && sameFamily(after, session)) throw new Error('roundtrip');
      removed = true;
    }
  } catch {
    storageUnavailable = true;
  } finally {
    notify();
  }

  if (storageUnavailable) throw new SessionStorageInvalidationError(removed);
  return removed;
}

export function createSession(session: Omit<StoredSession, 'family_id' | 'principal_id'>): StoredSession {
  if (!session.user?.id) throw new Error('session_identity_required');
  return { ...session, family_id: crypto.randomUUID(), principal_id: session.user.id };
}

export function saveSession(s: StoredSession): void {
  if (!validSession(s)) throw new Error('session_identity_required');
  try {
    if (tombstoned(s)) throw new Error('session_invalidated');
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (error) {
    if (error instanceof Error && error.message === 'session_invalidated') throw error;
    throw new Error('session_storage_unavailable');
  }
  const confirmed = loadSession();
  if (!confirmed || confirmed.family_id !== s.family_id || confirmed.principal_id !== s.principal_id || confirmed.access_token !== s.access_token || confirmed.refresh_token !== s.refresh_token) {
    throw new Error('session_storage_unavailable');
  }
  notify();
}

export function loadSession(): StoredSession | null {
  try {
    const session = readRawSession();
    if (!session || tombstoned(session)) return null;
    return session;
  } catch {
    // Storage/tombstone ambiguo o sesión corrupta: nunca se firma a ciegas.
    try { localStorage.removeItem(KEY); } catch { /* fail-closed por retorno */ }
    return null;
  }
}

export function isCurrentSession(session: StoredSession): boolean {
  const current = loadSession();
  return !!current &&
    current.family_id === session.family_id &&
    current.principal_id === session.principal_id &&
    current.access_token === session.access_token &&
    current.refresh_token === session.refresh_token;
}

/** CAS: respuestas viejas no pueden adoptar ni borrar otra familia. */
export function replaceCurrentSession(expected: StoredSession, next: StoredSession): boolean {
  if (!sameFamily(expected, next)) return false;
  if (!isCurrentSession(expected)) return false;
  saveSession(next);
  return true;
}

export function clearCurrentSession(expected: StoredSession): boolean {
  return invalidateSession(expected);
}

export function clearSession(): void {
  try {
    const current = readRawSession();
    if (current) {
      invalidateSession(current);
      return;
    }
    localStorage.removeItem(KEY);
  } catch {
    throw new Error('session_storage_unavailable');
  }
  notify();
}

/** Una única fuente observable para la pestaña actual y para storage cross-tab. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === TOMBSTONE_KEY || event.key === null) notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
