import { useEffect, useRef } from 'react';
import { fotosEnMemoria } from '../api/fotosEnMemoria';
import { currentSamePrincipalSession } from '../api/profileIdentity';
import { isCurrentSession, loadSession, type StoredSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useFotoEnMemoria } from './useFotoEnMemoria';
import { Avatar } from './ui';

/**
 * E174-3 / E174-3B · decisión 174 · la foto de quien invita. Se monta sólo cuando
 * el dueño dio la pista (`has_inviter_avatar === true`); la ruta vuelve a decidir
 * en cada pedido (404 no oracular). Mientras carga, o con 404, las iniciales.
 *
 * La usan la fila de la notificación (por id de notificación) y la tarjeta
 * «Te invitaron» y la burbuja de Inicio (por id de invitación): cambia la clave
 * y el pedido, no el comportamiento. Vive en la memoria de fotos de la sesión
 * (decisión 175): la guardada se ve al instante y cada montaje la revalida en
 * segundo plano.
 */
export function FotoDeQuienInvita({
  clave,
  pedir,
  nombre,
  size,
  className = 'foto-quien-invita',
}: {
  clave: string;
  pedir: (sesion: StoredSession) => Promise<Blob>;
  nombre: string;
  size: number;
  /** La fila de la notificación conserva su clase (`aviso-invitador-foto`). */
  className?: string;
}) {
  const { session } = useAuth();
  const url = useFotoEnMemoria(session, clave);
  const sesionRef = useRef(session);
  sesionRef.current = session;
  // El pedido cambia de identidad en cada render; la foto, no.
  const pedirRef = useRef(pedir);
  pedirRef.current = pedir;
  const familyId = session?.family_id ?? null;
  const principalId = session?.principal_id ?? null;
  useEffect(() => {
    const origen = sesionRef.current;
    if (!origen) return;
    const expected = currentSamePrincipalSession(origen, loadSession());
    if (!expected || !isCurrentSession(expected)) return;
    void fotosEnMemoria.cargar(expected, clave, () => pedirRef.current(expected));
  }, [clave, familyId, principalId]);
  return url
    ? <img className={className} src={url} alt="" aria-hidden="true" style={{ width: size, height: size }} />
    : <Avatar name={nombre} size={size} />;
}
