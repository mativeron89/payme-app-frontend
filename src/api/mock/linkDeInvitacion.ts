import { MockApiError, latencia } from './mockApi';

/**
 * AF-LINK-DE-INVITACION · D252 · el «dueño» del link de invitación en el modo
 * de ejemplo (App Backend 2.173.0, `contract/invitacion-personal-v1.json`): un
 * código de 16 caracteres base64url por cuenta, que nace la primera vez que se
 * pide y que «revoke» reemplaza. Devuelve el cuerpo crudo `{ code, link,
 * created_at }`; la fachada lo decodifica igual que el del dueño. Vive en
 * localStorage para sobrevivir recargas. Seam de error: el estado `error`.
 */
const CLAVE = 'payme.app.mock.invite_link.estado.v1';
/** Como `FRONTEND_PUBLIC_URL` en producción, que termina en `/#`. */
const ORIGEN = 'https://app.paymemx.com/#';

interface Estado {
  readonly code: string;
  readonly created_at: string;
}

function codigoNuevo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

function leer(): Estado | 'error' | null {
  try {
    const raw = localStorage.getItem(CLAVE);
    if (raw === 'error') return 'error';
    const e = raw ? JSON.parse(raw) as Estado : null;
    return e && typeof e.code === 'string' && typeof e.created_at === 'string' ? e : null;
  } catch {
    return null;
  }
}

function escribir(e: Estado): void {
  try { localStorage.setItem(CLAVE, JSON.stringify(e)); } catch { /* sin almacenamiento: vive lo que dure */ }
}

function nuevo(): Estado {
  const e = { code: codigoNuevo(), created_at: new Date().toISOString() };
  escribir(e);
  return e;
}

function demorar<T>(valor: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(valor), latencia()));
}

const cuerpo = (e: Estado) => ({ code: e.code, link: `${ORIGEN}/invitacion/${e.code}`, created_at: e.created_at });

/** `GET /api/friends/invite-link`: el vigente; si no hay, nace ahora. */
export function mockLinkDeInvitacion(): Promise<unknown> {
  const e = leer();
  if (e === 'error') return Promise.reject(new MockApiError(500, 'internal_error'));
  return demorar(cuerpo(e ?? nuevo()));
}

/** `POST /api/friends/invite-link/revoke`: revoca el vigente y devuelve otro. */
export function mockCambiarLinkDeInvitacion(): Promise<unknown> {
  if (leer() === 'error') return Promise.reject(new MockApiError(500, 'internal_error'));
  return demorar(cuerpo(nuevo()));
}
