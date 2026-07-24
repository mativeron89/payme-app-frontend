import type { StoredSession } from '../api/storage';

/**
 * Nombre para saludar al usuario. G-02 RESUELTO (backend v2.20): login y
 * register devuelven `user`, y una sesión vieja sin él se hidrata con
 * GET /account/me al restaurar. Si aún así falta (p. ej. offline en ese
 * primer restore), se saluda sin nombre.
 */
export function displayName(session: StoredSession | null): string | null {
  return session?.user?.first_name?.trim() || null;
}
