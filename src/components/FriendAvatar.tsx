import { useEffect, useRef } from 'react';
import { api } from '../api';
import { claveAmigo, fotosEnMemoria } from '../api/fotosEnMemoria';
import { currentSamePrincipalSession } from '../api/profileIdentity';
import { isCurrentSession, loadSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useFotoEnMemoria } from './useFotoEnMemoria';
import { Avatar } from './ui';

/**
 * Foto privada de una amistad ya aceptada. La ruta nunca llega a `src`: sólo
 * vive un `blob:` y cualquier 404/error sin foto guardada deja las iniciales.
 *
 * E173-3 · decisión 175: la foto vive en el caché en memoria de la sesión
 * (`fotosEnMemoria`). Si ya está, se muestra al instante y se revalida en
 * segundo plano con cada `refreshToken`; un 404 la retira. Desmontar no revoca
 * nada: volver a Amigos la muestra sin esperar.
 *
 * `hasAvatar` es el `has_avatar` de `GET /api/friends` (dueño v2.148.0):
 * - `false` ⇒ no se pide y se retira la guardada, si había;
 * - ausente (dueño anterior) ⇒ se pide, como antes de la clave.
 */
export function FriendAvatar({
  friendId,
  name,
  refreshToken,
  hasAvatar,
  variant = 'color',
}: {
  friendId: string;
  name: string;
  refreshToken: number;
  hasAvatar?: boolean;
  /**
   * El monograma de respaldo, sin foto. Amigos usa el de siempre; «compartir
   * mesa» conserva el suyo (`marca`, sin color por persona, reconciliación
   * 2026-08-21). La foto es la misma en los dos lados.
   */
  variant?: 'color' | 'marca';
}) {
  const { session } = useAuth();
  const clave = claveAmigo(friendId);
  const url = useFotoEnMemoria(hasAvatar === false ? null : session, clave);
  // Los tokens no son la identidad de la foto: un refresh no la vuelve a pedir.
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const familyId = session?.family_id ?? null;
  const principalId = session?.principal_id ?? null;

  useEffect(() => {
    const origen = sesionRef.current;
    if (!origen) return;
    const expected = currentSamePrincipalSession(origen, loadSession());
    if (!expected || !isCurrentSession(expected)) return;
    if (hasAvatar === false) {
      fotosEnMemoria.retirar(expected, clave);
      return;
    }
    void fotosEnMemoria.cargar(expected, clave, async () => (await api.getFriendAvatar(friendId, expected)).blob);
  }, [friendId, clave, refreshToken, familyId, principalId, hasAvatar]);

  return url ? (
    <img className="friend-avatar-image" src={url} alt="" aria-hidden="true" />
  ) : <Avatar name={name} variant={variant} />;
}
