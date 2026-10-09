import { useSyncExternalStore } from 'react';

/**
 * AF-LINK-DE-INVITACION · D252 · el link de invitación de Amigos.
 *
 * Mati: «ahora solo es el link que necesito que se genere y se pueda compartir
 * para que se empiece a masificar». Cada cuenta tiene un link propio
 * (`/invitacion/<código>`); quien se registra con él queda amigo directo de
 * quien lo compartió. Nada de puntos ni premios en la app (D252: los puntos
 * esperan a los pagos).
 *
 * **Tramo 1 (esta versión):** la pantalla y el recorrido con el mock. El
 * contrato del dueño (App Backend 2.173.0) todavía no se consume: en el modo
 * real la capacidad queda APAGADA y no hay tarjeta. En el mock la enciende el
 * seam `payme.app.mock.invite_link.v1 = encendido` (apagado por defecto).
 */

export interface LinkDeInvitacion {
  /** El link completo para compartir. */
  readonly url: string;
  readonly codigo: string;
}

// ─── La capacidad ─────────────────────────────────────────────────────────

export const CLAVE_LINK_DE_INVITACION_MOCK = 'payme.app.mock.invite_link.v1';

function leerLocal(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}

export type EstadoCapacidadLink = 'pendiente' | 'encendida' | 'apagada';
let capacidad: EstadoCapacidadLink = 'pendiente';
const oyentes = new Set<() => void>();

/**
 * Se alimenta con la config, como Viajes. Tramo 1: en el modo real, siempre
 * apagada (el dueño todavía no la publica); en el mock, el seam.
 */
export function aplicarConfigLinkDeInvitacion(_config: unknown, mock: boolean): boolean {
  const siguiente: EstadoCapacidadLink = mock && leerLocal(CLAVE_LINK_DE_INVITACION_MOCK) === 'encendido'
    ? 'encendida' : 'apagada';
  if (siguiente !== capacidad) {
    capacidad = siguiente;
    for (const oyente of [...oyentes]) oyente();
  }
  return capacidad === 'encendida';
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}
const instantanea = (): EstadoCapacidadLink => capacidad;

export function useCapacidadLinkDeInvitacion(): EstadoCapacidadLink {
  return useSyncExternalStore(suscribir, instantanea, instantanea);
}

export function assertLinkDeInvitacion(): void {
  if (capacidad !== 'encendida') throw new Error('invite_link_not_available');
}

export function reiniciarLinkDeInvitacionParaTests(): void {
  capacidad = 'pendiente';
}

// ─── El código que llega por el link, hasta el alta ───────────────────────

/**
 * El código de `/invitacion/<código>` se guarda en `sessionStorage` (la misma
 * pestaña, como el alta con Google de D102: sobrevive a la ida y vuelta a
 * Google y muere al cerrar la pestaña). No es una credencial: el link es para
 * compartirse. Un código mal formado no se guarda.
 */
export const CLAVE_CODIGO_DE_INVITACION = import.meta.env.VITE_MOCK === '1'
  ? 'payme.app.mock.referral_code.v1'
  : 'payme.app.real.referral_code.v1';

const CODIGO = /^[A-Za-z0-9_-]{4,64}$/;

export function codigoValido(valor: unknown): valor is string {
  return typeof valor === 'string' && CODIGO.test(valor);
}

function sesionDelNavegador(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

export function guardarCodigoDeInvitacion(codigo: string): boolean {
  if (!codigoValido(codigo)) return false;
  try {
    sesionDelNavegador()?.setItem(CLAVE_CODIGO_DE_INVITACION, codigo);
    return true;
  } catch {
    return false;
  }
}

/** El código guardado; uno mal formado se borra y no se devuelve. */
export function leerCodigoDeInvitacion(): string | null {
  let valor: string | null = null;
  try { valor = sesionDelNavegador()?.getItem(CLAVE_CODIGO_DE_INVITACION) ?? null; } catch { return null; }
  if (valor === null) return null;
  if (codigoValido(valor)) return valor;
  olvidarCodigoDeInvitacion();
  return null;
}

export function olvidarCodigoDeInvitacion(): void {
  try { sesionDelNavegador()?.removeItem(CLAVE_CODIGO_DE_INVITACION); } catch { /* sin almacenamiento */ }
}
