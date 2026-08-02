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
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(KEY);
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
  localStorage.removeItem(KEY);
  return null;
}

export function isCurrentSession(session: StoredSession): boolean {
  const current = loadSession();
  return !!current && current.family_id === session.family_id && current.principal_id === session.principal_id;
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
  localStorage.removeItem(KEY);
}
