import type { LegalAcceptanceRequest } from './types';
import { navegarComoEl303 } from './googleRedirect';
import { mockGoogleRedirectSignupLoginUri } from './mock/mockApi';

/**
 * AF-GOOGLE-ALTA-REDIRECT · decisión 102 · «Crea tu cuenta» con Google en la
 * MISMA pestaña (fase 2 del redirect; la fase 1, «Entrar», es `googleRedirect.ts`).
 *
 * Contrato: App Backend v2.138.0 (`e81b7c21`), `docs/GOOGLE_ALTA_REDIRECT_D102_WIRE.md`
 * (sha256 08443790…), espejado en `contract-mirror/contract/social-auth-v1.json`
 * (`google_redirect_signup_start`, `google_redirect_signup`) y
 * `contract-mirror/routes/social-auth.js`.
 *
 * La ida y vuelta (wire §2 a §5):
 * 1. el botón de «Crea tu cuenta» va en redirect con `state` = `alta:<id>`;
 * 2. lo que hoy viaja a `/google/continue` salvo el `id_token` —aviso, casillas,
 *    invitación y, si ya se pidieron, nombre y apellido— queda en
 *    `sessionStorage` antes de salir (sobrevive la ida y vuelta en la pestaña);
 * 3. Google vuelve con `#google_signup=<código>`: se lee ANTES del router, se
 *    borra del historial y se canjea en `POST /api/auth/google/redirect/signup`.
 *
 * 🔴 **El código vive sólo en la memoria de este módulo**: ningún storage,
 * ningún log. Algunos desenlaces lo dejan vivo (422, 429, 503, 409
 * `legal_version_mismatch`), así que no se suelta hasta un desenlace terminal.
 */

// ─── state del botón (wire §2) ───────────────────────────────────────────

export const PREFIJO_ESTADO_ALTA = 'alta:';
const ID_ESTADO = /^[A-Za-z0-9_-]{1,100}$/;

/** `alta:` + 1 a 100 de `[A-Za-z0-9_-]`. Un UUID sirve. */
export function estadoDeAlta(id: string = crypto.randomUUID()): string {
  if (!ID_ESTADO.test(id)) throw new Error('google_alta_state_invalido');
  return `${PREFIJO_ESTADO_ALTA}${id}`;
}

export function esEstadoDeAlta(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIJO_ESTADO_ALTA)
    && ID_ESTADO.test(value.slice(PREFIJO_ESTADO_ALTA.length));
}

// ─── contexto del alta en sessionStorage (wire §3) ──────────────────────

export const CLAVE_CONTEXTO_ALTA = 'payme.app.google_alta_contexto.v1';

/** Lo que hoy viaja a `/google/continue` salvo el `id_token`. Nunca el código. */
export interface ContextoAlta {
  readonly accepted_notice_version: string;
  readonly legal_acceptance?: LegalAcceptanceRequest;
  readonly invitation_token?: string;
  readonly first_name?: string;
  readonly last_name?: string;
}

const VERSION = /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function texto(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function decodeAceptacion(value: unknown): LegalAcceptanceRequest | null {
  if (!plainObject(value)) return null;
  const claves = Object.keys(value).sort().join(',');
  if (claves !== 'adult_declaration,aviso_hash,aviso_version,terminos_hash,terminos_version') return null;
  if (!texto(value.aviso_version, 20) || !texto(value.aviso_hash, 200)
      || !texto(value.terminos_version, 20) || !texto(value.terminos_hash, 200)
      || value.adult_declaration !== true) return null;
  return {
    aviso_version: value.aviso_version,
    aviso_hash: value.aviso_hash,
    terminos_version: value.terminos_version,
    terminos_hash: value.terminos_hash,
    adult_declaration: true,
  };
}

/**
 * Lee el contexto guardado, fail-closed: cualquier forma rara es «no hay
 * contexto», y la pantalla vuelve a mostrar las casillas (wire: «si se perdió
 * el sessionStorage, volver a mostrar las casillas»).
 */
export function decodeContextoAlta(value: unknown): ContextoAlta | null {
  if (!plainObject(value)) return null;
  const permitidas = new Set(['accepted_notice_version', 'legal_acceptance', 'invitation_token', 'first_name', 'last_name']);
  if (Object.keys(value).some((k) => !permitidas.has(k))) return null;
  if (typeof value.accepted_notice_version !== 'string' || !VERSION.test(value.accepted_notice_version)) return null;
  const ctx: {
    accepted_notice_version: string;
    legal_acceptance?: LegalAcceptanceRequest;
    invitation_token?: string;
    first_name?: string;
    last_name?: string;
  } = { accepted_notice_version: value.accepted_notice_version };
  if (value.legal_acceptance !== undefined) {
    const aceptacion = decodeAceptacion(value.legal_acceptance);
    if (!aceptacion) return null;
    ctx.legal_acceptance = aceptacion;
  }
  if (value.invitation_token !== undefined) {
    if (!texto(value.invitation_token, 200)) return null;
    ctx.invitation_token = value.invitation_token;
  }
  if ((value.first_name === undefined) !== (value.last_name === undefined)) return null;
  if (value.first_name !== undefined) {
    if (!texto(value.first_name, 100) || !texto(value.last_name, 100)) return null;
    ctx.first_name = value.first_name as string;
    ctx.last_name = value.last_name as string;
  }
  return ctx;
}

function sesion(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function guardarContextoAlta(ctx: ContextoAlta): void {
  try { sesion()?.setItem(CLAVE_CONTEXTO_ALTA, JSON.stringify(ctx)); } catch { /* sin storage: al volver se piden las casillas */ }
}

export function leerContextoAlta(): ContextoAlta | null {
  try {
    const raw = sesion()?.getItem(CLAVE_CONTEXTO_ALTA);
    return raw ? decodeContextoAlta(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function borrarContextoAlta(): void {
  try { sesion()?.removeItem(CLAVE_CONTEXTO_ALTA); } catch { /* nada que borrar */ }
}

// ─── la vuelta: #google_signup=<código> (wire §4) ───────────────────────

const CODE_RE = /^[A-Za-z0-9_-]{20,200}$/;

export type LecturaVueltaAlta =
  | { readonly tipo: 'nada' }
  | { readonly tipo: 'codigo'; readonly codigo: string }
  | { readonly tipo: 'invalida' };

/** Lee un fragmento, sin tocar nada. Pura. Los errores de la vuelta son los de la fase 1. */
export function leerVueltaAltaGoogle(hash: string): LecturaVueltaAlta {
  if (!/^#google_signup=/.test(hash)) return { tipo: 'nada' };
  const params = new URLSearchParams(hash.slice(1));
  if ([...params.keys()].length !== 1) return { tipo: 'invalida' };
  const codigo = params.get('google_signup');
  return codigo !== null && CODE_RE.test(codigo) ? { tipo: 'codigo', codigo } : { tipo: 'invalida' };
}

/** Lo que la pantalla puede saber de la vuelta: nunca el código. */
export type VueltaAlta = { readonly estado: 'ausente' | 'codigo' | 'invalida' };

let codigoPrivado: string | null = null;
let snapshot: VueltaAlta = { estado: 'ausente' };

export function vueltaAltaSnapshot(): VueltaAlta {
  return snapshot;
}

/**
 * Se llama ANTES de montar React (`main.tsx`), junto con la fase 1. Retira el
 * fragmento con `replaceState` y comprueba que salió; si no pudo, falla
 * cerrado: un código que no se pudo sacar de la URL no se canjea.
 */
export function capturarVueltaAltaGoogle(): void {
  if (typeof window === 'undefined') return;
  const lectura = leerVueltaAltaGoogle(window.location.hash);
  if (lectura.tipo === 'nada') return;
  const limpia = `${window.location.pathname}${window.location.search}`;
  try {
    window.history.replaceState(window.history.state, '', limpia);
  } catch {
    // sin historial no hay forma segura de sacarlo: se descarta abajo
  }
  if (window.location.hash !== '') {
    codigoPrivado = null;
    snapshot = { estado: 'invalida' };
    throw new Error('google_signup_cleanup_failed');
  }
  if (lectura.tipo === 'codigo') {
    codigoPrivado = lectura.codigo;
    snapshot = { estado: 'codigo' };
  } else {
    snapshot = { estado: 'invalida' };
  }
}

/**
 * Canjea con el código en memoria. NO lo suelta: un desenlace que lo deja vivo
 * permite reintentar con el mismo código (wire §5). Lo suelta `olvidarCodigoAlta`.
 * Mientras un canje está en vuelo, un segundo llamado comparte su promesa
 * (`StrictMode` monta dos veces).
 */
let canjeEnVuelo: Promise<unknown> | null = null;

export function canjearAltaGoogle<T>(canjear: (codigo: string) => Promise<T>): Promise<T> {
  if (canjeEnVuelo) return canjeEnVuelo as Promise<T>;
  const codigo = codigoPrivado;
  if (codigo === null) return Promise.reject(new Error('google_signup_sin_codigo'));
  const enVuelo = canjear(codigo).finally(() => { if (canjeEnVuelo === enVuelo) canjeEnVuelo = null; });
  canjeEnVuelo = enVuelo;
  return enVuelo;
}

export function hayCodigoAlta(): boolean {
  return codigoPrivado !== null;
}

/** Desenlace terminal (o la persona abandonó): el código se suelta de la memoria. */
export function olvidarCodigoAlta(): void {
  codigoPrivado = null;
  snapshot = { estado: 'ausente' };
}

export function resetGoogleAltaRedirectForTests(): void {
  codigoPrivado = null;
  snapshot = { estado: 'ausente' };
  canjeEnVuelo = null;
}

// ─── qué hace la pantalla con una respuesta de error (wire §5) ───────────

/**
 * ¿El código sigue vivo después de este error? Los que el wire marca «sí»:
 * `422 profile_required`, `429`, `503` y `409 legal_version_mismatch`. Todo lo
 * demás es terminal.
 */
export function codigoSigueVivo(status: number | null, code: string): boolean {
  // El `400` también lo deja vivo en el dueño, pero un cuerpo mal armado no se
  // arregla reintentando: la app lo trata como terminal.
  if (status === 422 && code === 'profile_required') return true;
  if (status === 429) return true;
  if (status === 503) return true;
  if (status === 409 && code === 'legal_version_mismatch') return true;
  return false;
}

/**
 * Riel mock: lo que en real hacen Google (el POST al `login_uri` con el `state`
 * de alta) y el dueño (el 303 a `/#google_signup=…`).
 */
export async function simularIdaYVueltaAltaMock(credencial: string): Promise<void> {
  navegarComoEl303(await mockGoogleRedirectSignupLoginUri(credencial));
}
