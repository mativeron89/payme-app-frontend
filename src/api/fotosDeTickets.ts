import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { esCodigoDeEjemplo } from '../ayuda/ejemplo/fixtureEjemplo';
import { assertFotoDelTicketHabilitada } from './fotoDelTicket';
import { fotosDeTicketsEnMemoria, type FotosEnMemoria, type ResultadoFoto } from './fotosEnMemoria';
import { httpPrivateTicketImageRequest } from './http';
import { mockFotoDelTicketDeMesa, mockFotoDelTicketDeViaje } from './mock/fotoDelTicketMock';
import { assertViajesHabilitado } from './viajes';
import type { StoredSession } from './storage';

/**
 * D464 · D466 · pedir y mostrar las fotos de los tickets.
 *
 * - **Sólo con la capacidad encendida** (`assertFotoDelTicketHabilitada`): con
 *   el backend de hoy, ningún pedido.
 * - Las rutas del dueño (2.193.0): `GET /api/mesas/:code/ticket-image/thumb|full`
 *   y `GET /api/viajes/:id/tickets/:tid/ticket-image/thumb|full`, con las mismas
 *   puertas que el detalle. Un 404 es «sin foto».
 * - **Sólo en memoria** (`fotosDeTicketsEnMemoria`): nunca IndexedDB,
 *   localStorage ni Cache API, y el pedido va con `cache: 'no-store'`. Se vacía
 *   al cerrar sesión.
 * - **Un pedido por foto y por pantalla, sin reintentos**: la lista pide cada
 *   miniatura una vez; un error deja el ícono de siempre.
 *
 * No pasa por la fachada `api` a propósito: no es un método más que el tutorial
 * tenga que clasificar. El código de la mesa de ejemplo (`PA-1224`) nunca sale
 * a la red, igual que en la fachada.
 */

export type TamanoDeFoto = 'thumb' | 'full';

export type OrigenDeFoto =
  | { readonly tipo: 'mesa'; readonly code: string }
  | { readonly tipo: 'viaje'; readonly viajeId: string; readonly ticketId: string };

const IS_MOCK = import.meta.env.VITE_MOCK === '1';

export const PREFIJO_FOTO_DE_TICKET = 'ticket:';

/** La clave del caché: por origen y tamaño (la miniatura y la completa son fotos distintas). */
export function claveDeFotoDelTicket(origen: OrigenDeFoto, tamano: TamanoDeFoto): string {
  return origen.tipo === 'mesa'
    ? `${PREFIJO_FOTO_DE_TICKET}mesa:${origen.code}\u0000${tamano}`
    : `${PREFIJO_FOTO_DE_TICKET}viaje:${origen.viajeId}\u0000${origen.ticketId}\u0000${tamano}`;
}

/** Igualdad por valor: dos objetos del mismo origen son el mismo origen. */
export function mismoOrigen(a: OrigenDeFoto | null, b: OrigenDeFoto | null): boolean {
  if (!a || !b) return a === b;
  return claveDeFotoDelTicket(a, 'thumb') === claveDeFotoDelTicket(b, 'thumb');
}

/** El pedido de una foto, por el transporte privado (o el mock). */
export async function pedirFotoDelTicket(origen: OrigenDeFoto, tamano: TamanoDeFoto, sesion: StoredSession): Promise<Blob> {
  assertFotoDelTicketHabilitada();
  if (origen.tipo === 'mesa') {
    if (esCodigoDeEjemplo(origen.code)) throw new Error('ejemplo_sin_red');
    if (IS_MOCK) return mockFotoDelTicketDeMesa(origen.code, tamano);
    return httpPrivateTicketImageRequest(
      `/mesas/${encodeURIComponent(origen.code)}/ticket-image/${encodeURIComponent(tamano)}`, tamano, sesion,
    );
  }
  assertViajesHabilitado();
  if (IS_MOCK) return mockFotoDelTicketDeViaje(origen.viajeId, origen.ticketId, tamano);
  return httpPrivateTicketImageRequest(
    `/viajes/${encodeURIComponent(origen.viajeId)}/tickets/${encodeURIComponent(origen.ticketId)}/ticket-image/${encodeURIComponent(tamano)}`,
    tamano, sesion,
  );
}

/** Lo que una pantalla sabe de una foto. `sin_foto` = el dueño respondió 404. */
export type EstadoDeFoto = 'cargando' | 'lista' | 'sin_foto' | 'error';

function estadoDe(resultado: ResultadoFoto, hayUrl: boolean): EstadoDeFoto | null {
  switch (resultado) {
    case 'guardada':
    case 'igual': return 'lista';
    case 'retirada': return 'sin_foto';
    case 'conservada': return hayUrl ? 'lista' : 'error';
    case 'descartada': return null;
  }
}

/**
 * D481 · 2d · el estado de una miniatura de la lista, sin cambiar la caché ni
 * los pedidos: con la foto en memoria, `lista`; con el 404 del dueño,
 * `sin_foto` (va el ícono suelto); si el pedido falló, `error` (el recuadro
 * con el ícono, que sigue abriendo el visor y éste la vuelve a pedir); si no,
 * `cargando` (el recuadro vacío).
 */
export function estadoDeMiniatura(hayUrl: boolean, sinFoto: boolean, fallo: boolean): EstadoDeFoto {
  if (hayUrl) return 'lista';
  if (sinFoto) return 'sin_foto';
  return fallo ? 'error' : 'cargando';
}

/**
 * Las miniaturas de una lista: pide cada una UNA vez por montaje de la
 * pantalla, de a pocas a la vez, y avisa al llegar. `urlDe` devuelve la foto o
 * `null`; `sinFoto` dice si el dueño respondió 404 (entonces va el ícono);
 * `estadoDe` (D481), en qué está cada una.
 */
export function useMiniaturasDeTickets(
  session: StoredSession | null,
  origenes: readonly OrigenDeFoto[] | null,
  cache: FotosEnMemoria = fotosDeTicketsEnMemoria,
  pedir: typeof pedirFotoDelTicket = pedirFotoDelTicket,
): {
  urlDe: (o: OrigenDeFoto) => string | null;
  sinFoto: (o: OrigenDeFoto) => boolean;
  estadoDe: (o: OrigenDeFoto) => EstadoDeFoto;
} {
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const pedidas = useRef(new Set<string>());
  const sinFotoRef = useRef(new Set<string>());
  /** D481 · las que terminaron sin foto en memoria y sin el 404 del dueño: un error de red o del servidor. */
  const falloRef = useRef(new Set<string>());
  const cola = useRef<OrigenDeFoto[]>([]);
  const enVuelo = useRef(0);
  const vivo = useRef(true);
  const [, setVersion] = useState(0);
  useSyncExternalStore(cache.suscribir, () => cache.tamano, () => cache.tamano);

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  const avanzar = useCallback(() => {
    while (enVuelo.current < MINIATURAS_A_LA_VEZ && cola.current.length > 0) {
      const origen = cola.current.shift()!;
      const sesion = sesionRef.current;
      if (!sesion) return;
      enVuelo.current += 1;
      const clave = claveDeFotoDelTicket(origen, 'thumb');
      void cache.cargar(sesion, clave, () => pedir(origen, 'thumb', sesion))
        .then((r) => {
          if (r === 'retirada') sinFotoRef.current.add(clave);
          else if (estadoDe(r, cache.ver(sesion, clave) !== null) === 'error') falloRef.current.add(clave);
          else falloRef.current.delete(clave);
          if (vivo.current) setVersion((n) => n + 1);
        })
        .finally(() => {
          enVuelo.current -= 1;
          if (vivo.current) avanzar();
        });
    }
  }, [cache, pedir]);

  useEffect(() => {
    if (!origenes || !session) return;
    for (const origen of origenes) {
      const clave = claveDeFotoDelTicket(origen, 'thumb');
      if (pedidas.current.has(clave)) continue;
      pedidas.current.add(clave);
      cola.current.push(origen);
    }
    avanzar();
  }, [origenes, avanzar, session]);

  const urlDe = (o: OrigenDeFoto) => (session ? cache.ver(session, claveDeFotoDelTicket(o, 'thumb')) : null);
  const sinFoto = (o: OrigenDeFoto) => sinFotoRef.current.has(claveDeFotoDelTicket(o, 'thumb'));
  return {
    urlDe,
    sinFoto,
    estadoDe: (o) => estadoDeMiniatura(urlDe(o) !== null, sinFoto(o), falloRef.current.has(claveDeFotoDelTicket(o, 'thumb'))),
  };
}

/** De a cuántas miniaturas se piden: la lista de Mesas trae hasta 20 por página. */
export const MINIATURAS_A_LA_VEZ = 4;

/**
 * Una foto (la que muestra el visor): la pide al montarse —o al cambiar de
 * origen o tamaño— una vez, y devuelve su URL y su estado. `reintentar` la
 * vuelve a pedir (el botón del visor ante un error).
 */
export function useFotoDelTicket(
  session: StoredSession | null,
  origen: OrigenDeFoto | null,
  tamano: TamanoDeFoto,
  cache: FotosEnMemoria = fotosDeTicketsEnMemoria,
  pedir: typeof pedirFotoDelTicket = pedirFotoDelTicket,
): { url: string | null; estado: EstadoDeFoto; reintentar: () => void } {
  const clave = origen ? claveDeFotoDelTicket(origen, tamano) : null;
  const url = useSyncExternalStore(
    cache.suscribir,
    () => (session && clave ? cache.ver(session, clave) : null),
    () => null,
  );
  const [estado, setEstado] = useState<{ clave: string | null; estado: EstadoDeFoto }>({ clave, estado: 'cargando' });
  const [intento, setIntento] = useState(0);
  const origenRef = useRef(origen);
  origenRef.current = origen;

  useEffect(() => {
    const o = origenRef.current;
    if (!session || !clave || !o) return undefined;
    let vigente = true;
    setEstado({ clave, estado: 'cargando' });
    void cache.cargar(session, clave, () => pedir(o, tamano, session)).then((r) => {
      if (!vigente) return;
      const e = estadoDe(r, cache.ver(session, clave) !== null);
      if (e) setEstado({ clave, estado: e });
    });
    return () => { vigente = false; };
  }, [session, clave, tamano, intento, cache, pedir]);

  const actual: EstadoDeFoto = estado.clave === clave ? estado.estado : 'cargando';
  return {
    url,
    // Lo guardado se muestra mientras se revalida.
    estado: actual === 'cargando' && url ? 'lista' : actual,
    reintentar: () => setIntento((n) => n + 1),
  };
}
