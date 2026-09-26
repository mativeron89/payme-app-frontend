import { useEffect, useRef, useSyncExternalStore } from 'react';
import { tokenForMesa } from '../api/invitationLink';
import { signupInvitationSnapshot, subscribeSignupInvitation } from '../api/signupInvitation';
import type { StoredSession } from '../api/storage';
import { irAlInicioTrasIngreso, useRoute } from '../router';
import { conservaRutaTrasIngreso, trasCambioDeSesion } from './destinoTrasIngreso';

/**
 * AF-INICIO-TRAS-INGRESO · después de entrar, Inicio; salvo un enlace de
 * entrada. La regla y su porqué están en `destinoTrasIngreso.ts`.
 *
 * Vive en `AuthProvider` y no en el shell de `App.tsx` a propósito: el
 * proveedor remonta a sus hijos con cada familia de sesión (`key` del
 * `Fragment`), así que el shell nace YA con la sesión nueva y no puede ver el
 * paso de «sin sesión» a «con sesión». El proveedor no se remonta.
 *
 * La invitación de alta se suelta de la URL y de su custodia al crear la
 * cuenta, a veces antes de que llegue la sesión: por eso se anota mientras NO
 * hay sesión, y la decisión lee esa nota.
 */
export function useInicioTrasIngreso(session: StoredSession | null): void {
  const route = useRoute();
  const altaPendiente = useSyncExternalStore(subscribeSignupInvitation, signupInvitationSnapshot);
  const invitacionDeAltaVista = useRef(false);
  useEffect(() => {
    if (!session && altaPendiente.status === 'available') invitacionDeAltaVista.current = true;
  }, [session, altaPendiente]);

  const sesionAnterior = useRef(session);
  useEffect(() => {
    const habia = sesionAnterior.current !== null;
    sesionAnterior.current = session;
    const decision = trasCambioDeSesion(habia, session !== null, () => conservaRutaTrasIngreso(route, {
      tokenDeInvitacion: tokenForMesa(route.param ?? '', route.query.get('t')),
      invitacionDeAlta: invitacionDeAltaVista.current,
    }));
    if (session !== null) invitacionDeAltaVista.current = false;
    if (decision === 'inicio') irAlInicioTrasIngreso();
    // Sólo el cambio de sesión decide: la ruta se lee como estaba en ese momento.
  }, [session]);
}
