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

/**
 * Nombre COMPLETO, que es lo que pide `SISTEMA_DISENO.md` §5 bis · A para la
 * banda navy — no el saludo. Es distinto de `displayName` a propósito: uno
 * saluda ("Hola, Mati") y el otro identifica la sesión ("Matias Verón"), y
 * confundirlos fue lo que dejó la cabecera del rediseño con medio nombre.
 *
 * Con apellido ausente devuelve el nombre solo; sin ninguno de los dos,
 * `null` — la banda va con el logo solo, que se ve mucho mejor que un hueco.
 */
export function fullName(session: StoredSession | null): string | null {
  const u = session?.user;
  return [u?.first_name?.trim(), u?.last_name?.trim()].filter(Boolean).join(' ') || null;
}
