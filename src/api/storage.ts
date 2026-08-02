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
const listeners = new Set<() => void>();

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

export function createSession(session: Omit<StoredSession, 'family_id' | 'principal_id'>): StoredSession {
  if (!session.user?.id) throw new Error('session_identity_required');
  return { ...session, family_id: crypto.randomUUID(), principal_id: session.user.id };
}

export function saveSession(s: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    throw new Error('session_storage_unavailable');
  }
  const confirmed = loadSession();
  if (!confirmed || confirmed.family_id !== s.family_id || confirmed.principal_id !== s.principal_id || confirmed.access_token !== s.access_token) {
    throw new Error('session_storage_unavailable');
  }
  notify();
}

export function loadSession(): StoredSession | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as StoredSession).access_token === 'string' &&
      typeof (parsed as StoredSession).refresh_token === 'string' &&
      typeof (parsed as StoredSession).family_id === 'string' &&
      typeof (parsed as StoredSession).principal_id === 'string'
    ) {
      return parsed as StoredSession;
    }
  } catch {
    // sesión corrupta → se descarta
  }
  clearSession();
  return null;
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
  if (!isCurrentSession(expected)) return false;
  saveSession(next);
  return true;
}

export function clearCurrentSession(expected: StoredSession): boolean {
  if (!isCurrentSession(expected)) return false;
  clearSession();
  return true;
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Sin acceso a storage tampoco puede existir una sesión confiable en UI.
  }
  notify();
}

/** Una única fuente observable para la pestaña actual y para storage cross-tab. */
export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) notify();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
