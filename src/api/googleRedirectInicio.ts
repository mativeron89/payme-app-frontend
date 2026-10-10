import { estadoDeAlta } from './googleAltaRedirect';

/**
 * D268 · S-02 · el ingreso con Google por redirect, ATADO AL NAVEGADOR QUE LO
 * EMPEZÓ (App Backend 2.178.0, `features.google_redirect_binding`;
 * `contract-mirror/contract/social-auth-v1.json`).
 *
 * El agujero: un `#google_redirect=<código>` que llega por un link se canjeaba
 * solo, aunque este navegador no hubiera empezado ningún ingreso, y con la
 * sesión abierta cambiaba de cuenta.
 *
 * El arreglo, como lo pide el dueño:
 * 1. Al dibujar el botón («Entrar» o «Crea tu cuenta»), el front fabrica un par
 *    PKCE: un `verifier` aleatorio (32 bytes en base64url, 43 caracteres) y su
 *    `challenge` = base64url(SHA-256(verifier)). A Google viaja sólo el
 *    `state` `entrar:<challenge>` o `crear:<challenge>`; el `verifier` queda en
 *    `sessionStorage` y nunca viaja en la URL.
 * 2. Al volver, se canjea SÓLO si este navegador empezó ese ingreso: con su
 *    `verifier` (el dueño compara con el challenge) o, si el dueño no publica
 *    la capacidad, con el registro «sin binding». Sin registro, no se canjea:
 *    «nunca canjear un código sin un verifier propio pendiente».
 *
 * 🔴 Acá se guarda el `verifier`, nunca el código (vive en la memoria de
 * `googleRedirect.ts` y `googleAltaRedirect.ts`), y sólo en `sessionStorage`:
 * es de esta pestaña y muere con ella.
 */

export type FlujoGoogle = 'entrar' | 'crear';

/** Lo que se guarda al empezar: con el verifier o, sin la capacidad del dueño, «sin binding». */
export type InicioGoogle = { readonly binding: true; readonly verifier: string } | { readonly binding: false };

export const CLAVES_INICIO_GOOGLE: Readonly<Record<FlujoGoogle, string>> = {
  entrar: 'payme.app.google_inicio_entrar.v1',
  crear: 'payme.app.google_inicio_crear.v1',
};

/** El formato del dueño (`services/googleRedirect.js`, `VERIFIER_RE`). */
const VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/;

export function base64url(bytes: Uint8Array): string {
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 32 bytes aleatorios en base64url: 43 caracteres, lo que recomienda el dueño. */
export function nuevoVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** base64url, sin relleno, de SHA-256(verifier): siempre 43 caracteres. */
export async function challengeDe(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function sesion(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function guardar(flujo: FlujoGoogle, inicio: InicioGoogle): boolean {
  const json = JSON.stringify(inicio);
  try {
    const s = sesion();
    if (!s) return false;
    s.setItem(CLAVES_INICIO_GOOGLE[flujo], json);
    return s.getItem(CLAVES_INICIO_GOOGLE[flujo]) === json;
  } catch {
    return false;
  }
}

/**
 * Se llama al dibujar el botón. Devuelve el `state` que viaja a Google:
 * - con la capacidad del dueño: `entrar:<challenge>` o `crear:<challenge>`, con
 *   el verifier guardado (sin `sessionStorage`, falla: sin verifier no habría
 *   canje, y no se degrada a suelto);
 * - sin ella: «Entrar» sin `state` y «Crea tu cuenta» con `alta:<id>`, como
 *   antes, con el registro «sin binding».
 */
export async function iniciarIngresoGoogle(flujo: FlujoGoogle, conBinding: boolean): Promise<string | undefined> {
  if (!conBinding) {
    guardar(flujo, { binding: false });
    return flujo === 'crear' ? estadoDeAlta() : undefined;
  }
  const verifier = nuevoVerifier();
  const challenge = await challengeDe(verifier);
  if (!guardar(flujo, { binding: true, verifier })) throw new Error('google_redirect_sin_storage');
  return `${flujo}:${challenge}`;
}

/** Lee el registro de inicio, fail-closed: cualquier forma rara es «no se empezó acá». */
export function leerInicioGoogle(flujo: FlujoGoogle): InicioGoogle | null {
  try {
    const raw = sesion()?.getItem(CLAVES_INICIO_GOOGLE[flujo]);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const claves = Object.keys(o).sort().join(',');
    if (claves === 'binding' && o.binding === false) return { binding: false };
    if (claves === 'binding,verifier' && o.binding === true && typeof o.verifier === 'string' && VERIFIER_RE.test(o.verifier)) {
      return { binding: true, verifier: o.verifier };
    }
    return null;
  } catch {
    return null;
  }
}

export function borrarInicioGoogle(flujo: FlujoGoogle): void {
  try { sesion()?.removeItem(CLAVES_INICIO_GOOGLE[flujo]); } catch { /* nada que borrar */ }
}

/** Lee y borra en el acto: el canje de «Entrar» es de un solo uso. */
export function tomarInicioGoogle(flujo: FlujoGoogle): InicioGoogle | null {
  const inicio = leerInicioGoogle(flujo);
  borrarInicioGoogle(flujo);
  return inicio;
}

/** El verifier que viaja al canje, si el ingreso lo tiene. */
export function verifierDe(inicio: InicioGoogle): { readonly verifier?: string } {
  return inicio.binding ? { verifier: inicio.verifier } : {};
}
