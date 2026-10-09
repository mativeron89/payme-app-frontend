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
 * Contrato del dueño: App Backend 2.173.0, `contract-mirror/contract/
 * invitacion-personal-v1.json`. El front espeja: no arma códigos ni decide si
 * uno vale (un código que no vale, el dueño lo ignora en el alta, sin oráculo).
 * En el mock, la capacidad la enciende el seam
 * `payme.app.mock.invite_link.v1 = encendido` (apagado por defecto).
 */

export const CONTRATO_INVITACION_PERSONAL = 'payme.app.invitacion_personal/v1';

export interface LinkDeInvitacion {
  /** El link completo para compartir (en producción, `https://app.paymemx.com/#/invitacion/<código>`). */
  readonly url: string;
  readonly codigo: string;
  readonly creadoEn: string;
}

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const claves = Object.keys(v).sort();
  const quiero = [...esperadas].sort();
  return claves.length === quiero.length && claves.every((c, i) => c === quiero[i]);
}

export class LinkDeInvitacionResponseError extends Error {
  constructor(readonly endpoint: string) {
    super(`invite_link_response_invalid:${endpoint}`);
  }
}

/**
 * `GET /api/friends/invite-link` y `POST …/revoke` → `{ code, link, created_at }`,
 * claves EXACTAS. El link es absoluto y termina en `/invitacion/<code>`: otro
 * link sería otra semántica y no se comparte.
 */
export function decodeLinkDeInvitacion(raw: unknown, endpoint = 'invite_link'): LinkDeInvitacion {
  if (!objetoPlano(raw) || !clavesExactas(raw, ['code', 'link', 'created_at'])) throw new LinkDeInvitacionResponseError(endpoint);
  const { code, link, created_at: creado } = raw;
  if (!codigoValido(code) || typeof link !== 'string' || typeof creado !== 'string'
      // Una comparación, no una ruta que se pide: concatenado, no interpolado.
      || !/^https?:\/\/[^\s]+$/.test(link) || !link.endsWith('/invitacion/' + code)
      || Number.isNaN(Date.parse(creado))) {
    throw new LinkDeInvitacionResponseError(endpoint);
  }
  return { url: link, codigo: code, creadoEn: creado };
}

// ─── La capacidad ─────────────────────────────────────────────────────────

export const CLAVE_LINK_DE_INVITACION_MOCK = 'payme.app.mock.invite_link.v1';

function leerLocal(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}

/** El seam del mock: `encendido` exacto. Lo lee la config del mock, como el dueño lee su constante. */
export function linkDeInvitacionMockEncendido(): boolean {
  return leerLocal(CLAVE_LINK_DE_INVITACION_MOCK) === 'encendido';
}

/**
 * `features.invite_link` → `{ supported, enabled }`, claves EXACTAS. Encendida
 * sólo con los dos en `true`; ausente o de otra forma, apagada.
 */
export function decodeCapacidadLinkDeInvitacion(config: unknown): boolean {
  if (!objetoPlano(config) || !objetoPlano(config.features)) return false;
  const raw = config.features.invite_link;
  return objetoPlano(raw) && clavesExactas(raw, ['supported', 'enabled'])
    && raw.supported === true && raw.enabled === true;
}

export type EstadoCapacidadLink = 'pendiente' | 'encendida' | 'apagada';
let capacidad: EstadoCapacidadLink = 'pendiente';
const oyentes = new Set<() => void>();

/** Se alimenta con la config, como Viajes: sin request propia. */
export function aplicarConfigLinkDeInvitacion(config: unknown): boolean {
  const siguiente: EstadoCapacidadLink = decodeCapacidadLinkDeInvitacion(config) ? 'encendida' : 'apagada';
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

export function linkDeInvitacionHabilitado(): boolean {
  return capacidad === 'encendida';
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

/** `codigo.formato` del contrato: 16 caracteres base64url (12 bytes al azar). */
const CODIGO = /^[A-Za-z0-9_-]{16}$/;

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

/**
 * D252 · `referral_code` en el alta (correo y las tres de Google). Sólo con la
 * capacidad encendida: los cuerpos de Google son estrictos y un dueño anterior
 * los rechazaría. El código se olvida cuando hay sesión (App), haya creado la
 * cuenta o no: ninguna ruta aplica un código a una cuenta que ya existe.
 */
export function conReferido<T extends object>(cuerpo: T): T & { referral_code?: string } {
  if (!linkDeInvitacionHabilitado()) return cuerpo;
  const codigo = leerCodigoDeInvitacion();
  return codigo === null ? cuerpo : { ...cuerpo, referral_code: codigo };
}
