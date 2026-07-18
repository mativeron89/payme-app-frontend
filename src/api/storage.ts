import type { User } from './types';

/**
 * Persistencia de sesión en localStorage. `user` es opcional porque el
 * contrato real solo lo devuelve en register (G-02: login devuelve solo
 * tokens). Cuando exista GET /me se completa acá.
 */

const KEY = 'payme_app_session';

export interface StoredSession {
  access_token: string;
  refresh_token: string;
  user?: User;
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
      typeof (parsed as StoredSession).refresh_token === 'string'
    ) {
      return parsed as StoredSession;
    }
  } catch {
    // sesión corrupta → se descarta
  }
  localStorage.removeItem(KEY);
  return null;
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
