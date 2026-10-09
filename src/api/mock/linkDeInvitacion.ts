import type { LinkDeInvitacion } from '../linkDeInvitacion';
import { MockApiError, latencia } from './mockApi';

/**
 * AF-LINK-DE-INVITACION · D252 · el link de invitación en el modo de ejemplo
 * (tramo 1, sin el contrato del dueño): un código al azar por cuenta, que
 * «Cambiar mi link» reemplaza. Vive en localStorage para sobrevivir recargas.
 */
const CLAVE = 'payme.app.mock.invite_link.estado.v1';
const ORIGEN = 'https://app.paymemx.com';

function codigoNuevo(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function leer(): string | null {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}

function escribir(codigo: string): void {
  try { localStorage.setItem(CLAVE, codigo); } catch { /* sin almacenamiento: vive lo que dure */ }
}

function demorar<T>(valor: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(valor), latencia()));
}

const vista = (codigo: string): LinkDeInvitacion => ({ url: `${ORIGEN}/invitacion/${codigo}`, codigo });

export function mockLinkDeInvitacion(): Promise<LinkDeInvitacion> {
  if (leer() === 'error') return Promise.reject(new MockApiError(500, 'internal_error'));
  let codigo = leer();
  if (!codigo) {
    codigo = codigoNuevo();
    escribir(codigo);
  }
  return demorar(vista(codigo));
}

export function mockCambiarLinkDeInvitacion(): Promise<LinkDeInvitacion> {
  const codigo = codigoNuevo();
  escribir(codigo);
  return demorar(vista(codigo));
}
