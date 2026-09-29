import { useEffect, useRef, useSyncExternalStore } from 'react';
import { readPendingInvitationLink, tokenForMesa } from '../api/invitationLink';
import { olvidarRetornoAMesa, tomarRetornoAMesa } from '../api/retornoTrasIngreso';
import { signupInvitationSnapshot, subscribeSignupInvitation } from '../api/signupInvitation';
import type { StoredSession } from '../api/storage';
import { irAlInicioTrasIngreso, replaceRoute, useRoute } from '../router';
import { conservaRutaTrasIngreso, mesaDeRetorno, trasCambioDeSesion } from './destinoTrasIngreso';

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
  // El tercer argumento es el del render en servidor, que usan los unitarios
  // que dibujan el árbol real (como en LoginScreen).
  const altaPendiente = useSyncExternalStore(
    subscribeSignupInvitation,
    signupInvitationSnapshot,
    signupInvitationSnapshot,
  );
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
    // AF-INVITACION-TRAS-GOOGLE · al cerrar sesión, la marca de retorno se va.
    if (habia && session === null) olvidarRetornoAMesa();
    if (decision === 'inicio') {
      // AF-INVITACION-TRAS-GOOGLE · la vuelta de Google llega a la raíz. Si la
      // persona venía del link de una mesa (marca de ≤30 min, de un uso) y la
      // invitación custodiada es de ESA mesa, se vuelve a la mesa: App monta
      // JoinMesaScreen con la sesión, después de las puertas legal y del @, y
      // canjea. Si no, Inicio como siempre.
      const mesa = mesaDeRetorno(tomarRetornoAMesa(), readPendingInvitationLink()?.code ?? null);
      if (mesa) replaceRoute('mesa', mesa);
      else irAlInicioTrasIngreso();
    }
    // Sólo el cambio de sesión decide: la ruta se lee como estaba en ese momento.
  }, [session]);
}
