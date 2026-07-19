import type { StoredSession } from '../api/storage';

/**
 * Nombre para saludar al usuario.
 *
 * G-02: `POST /auth/login` devuelve solo tokens y no hay `GET /me`, así que
 * fuera del registro no tenemos el nombre real. Como paliativo derivamos algo
 * legible del email que la persona tipeó. Cuando el contrato exponga el perfil
 * propio, esto se reemplaza por el dato real y se borra la derivación.
 */
export function displayName(session: StoredSession | null): string | null {
  const first = session?.user?.first_name?.trim();
  if (first) return first;

  const email = session?.email ?? session?.user?.email;
  if (!email) return null;
  const local = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  const candidate = local?.split(' ')[0];
  if (!candidate || candidate.length < 2 || /^\d+$/.test(candidate)) return null;
  return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
}
