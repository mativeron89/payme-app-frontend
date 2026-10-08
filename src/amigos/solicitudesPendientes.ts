import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api';
import { loadSession, subscribeSession, type StoredSession } from '../api/storage';

/**
 * D230 · cuántas solicitudes de amistad RECIBIDAS esperan respuesta, para la
 * burbuja roja de «Amigos» en la barra de abajo.
 *
 * - **Cuándo se consulta** `GET /friends/requests?direction=incoming`: al abrir
 *   la app con sesión (una vez por cuenta, no en cada pantalla que monta la
 *   barra) y al volver a ella. Nunca en segundo plano.
 * - **Al aceptar o rechazar** no hace falta otra consulta: la pantalla de Amigos
 *   ya recarga sus solicitudes después de cada decisión (y al entrar y al
 *   volver), y publica su conteo acá. Así la burbuja y la pestaña
 *   «Solicitudes» no se contradicen.
 * - **De quién es el número:** se guarda con la familia y el principal de la
 *   sesión. Sin sesión, o con otra cuenta, no hay número: el de una cuenta
 *   nunca se ve en otra.
 * - **Si la consulta falla, no hay burbuja.** Mostrar el número anterior sería
 *   afirmar algo que no se pudo confirmar.
 */

function claveDe(session: StoredSession): string {
  return `${session.family_id}\u0000${session.principal_id}`;
}

let guardado: { clave: string; cantidad: number } | null = null;
/** La cuenta para la que ya se consultó al abrir la app. */
let consultadaPara: string | null = null;
/** Cada consulta o publicación nueva deja vieja a la anterior todavía en vuelo. */
let epoca = 0;
let enganchado = false;
const oyentes = new Set<() => void>();

function avisar(): void {
  for (const oyente of [...oyentes]) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/** El número de la cuenta actual, o `null` si no hay uno confirmado para ella. */
export function solicitudesPendientes(): number | null {
  const session = loadSession();
  if (!session || !guardado || guardado.clave !== claveDe(session)) return null;
  return guardado.cantidad;
}

/** La pantalla de Amigos publica lo que acaba de cargar para esa sesión. */
export function publicarSolicitudesPendientes(session: StoredSession, cantidad: number): void {
  epoca += 1;
  const actual = loadSession();
  if (!actual || claveDe(actual) !== claveDe(session)) return;
  guardado = { clave: claveDe(session), cantidad };
  avisar();
}

/** Consulta para la sesión actual. Sólo con la app a la vista. */
export function consultarSolicitudesPendientes(): void {
  if (document.visibilityState !== 'visible') return;
  const session = loadSession();
  if (!session) return;
  const clave = claveDe(session);
  consultadaPara = clave;
  epoca += 1;
  const mia = epoca;
  api.getIncomingFriendRequests().then(
    (r) => {
      if (mia !== epoca) return;
      const actual = loadSession();
      if (!actual || claveDe(actual) !== clave) return;
      guardado = { clave, cantidad: r.requests.length };
      avisar();
    },
    () => {
      if (mia !== epoca) return;
      if (guardado?.clave !== clave) return;
      guardado = null;
      avisar();
    },
  );
}

/** Al abrir la app: una consulta por cuenta. */
function consultarSiHaceFalta(): void {
  const session = loadSession();
  if (session && consultadaPara !== claveDe(session)) consultarSolicitudesPendientes();
}

/** Engancha una sola vez la vuelta a la app y el cambio de sesión. */
function enganchar(): void {
  if (enganchado) return;
  enganchado = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') consultarSolicitudesPendientes();
  });
  subscribeSession(() => {
    // Otra cuenta, o ninguna: el número se re-evalúa ya (puede desaparecer)…
    avisar();
    // …y si hay una cuenta nueva, se le pregunta la suya.
    consultarSiHaceFalta();
  });
}

/** El número para la burbuja de «Amigos»; consulta al montar la primera barra. */
export function useSolicitudesPendientes(): number | null {
  useEffect(() => {
    enganchar();
    consultarSiHaceFalta();
  }, []);
  return useSyncExternalStore(suscribir, solicitudesPendientes, () => null);
}

/** Sólo para tests: vuelve al estado inicial (no desengancha los oyentes globales). */
export function reiniciarParaTests(): void {
  guardado = null;
  consultadaPara = null;
  epoca += 1;
  oyentes.clear();
}
