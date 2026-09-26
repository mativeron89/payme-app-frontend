import { mockGoogleRedirectLoginUri } from './mock/mockApi';

/**
 * AF-GOOGLE-REDIRECT · decisiones 92 y 94 · la VUELTA del ingreso con Google en
 * la misma pestaña.
 *
 * Google hace el POST al `login_uri` (`/auth/google/redirect`, que el hosting
 * pasa al dueño) y el dueño contesta **303** a la raíz de la app con uno de
 * estos fragmentos (`docs/GOOGLE_REDIRECT_D92_WIRE.md` §4):
 *
 * - `#google_redirect=<código>`: ingreso válido; el código se canjea una vez en
 *   `POST /api/auth/google/redirect/redeem` (un solo uso, 60 s);
 * - `#google_redirect_error=<csrf_failed|social_auth_failed|temporarily_unavailable>`.
 *
 * 🔴 **El orden es obligatorio (wire §5):**
 * 1. se lee el fragmento AL ARRANCAR, antes de React y del router;
 * 2. se borra con `history.replaceState` ANTES de canjear, y se comprueba;
 * 3. se canjea una sola vez;
 * 4. el código vive sólo en memoria de este módulo: ningún storage, ningún log.
 *
 * El código nunca llega a path ni query: lo que va después de `#` no viaja al
 * servidor ni en el `Referer`, y se retira de la URL antes de la primera
 * request. `router.fragmentoConSecreto` lo cuenta además como secreto, así que
 * ni siquiera un fallo de este módulo lo convertiría en una ruta.
 */

/** El `login_uri` registrado en Google Cloud (wire §2 y contrato `google_redirect_flow`). */
export const GOOGLE_REDIRECT_LOGIN_URI = 'https://app.paymemx.com/auth/google/redirect';

/** El formato del dueño (`services/googleRedirect.js`, `CODE_RE`). */
const CODE_RE = /^[A-Za-z0-9_-]{20,200}$/;

export const ERRORES_DE_VUELTA = ['csrf_failed', 'social_auth_failed', 'temporarily_unavailable'] as const;
export type ErrorDeVuelta = (typeof ERRORES_DE_VUELTA)[number];

export type LecturaDeVuelta =
  | { readonly tipo: 'nada' }
  | { readonly tipo: 'codigo'; readonly codigo: string }
  | { readonly tipo: 'error'; readonly error: ErrorDeVuelta }
  /** Tiene la forma de la vuelta pero no un valor válido: se limpia y no se canjea. */
  | { readonly tipo: 'invalida' };

/** Lee un fragmento, sin tocar nada. Pura: es lo que prueban los unitarios. */
export function leerVueltaGoogleRedirect(hash: string): LecturaDeVuelta {
  if (!/^#google_redirect(_error)?=/.test(hash)) return { tipo: 'nada' };
  const params = new URLSearchParams(hash.slice(1));
  const claves = [...params.keys()];
  if (claves.length !== 1) return { tipo: 'invalida' };
  const codigo = params.get('google_redirect');
  if (codigo !== null) return CODE_RE.test(codigo) ? { tipo: 'codigo', codigo } : { tipo: 'invalida' };
  const error = params.get('google_redirect_error');
  return error !== null && (ERRORES_DE_VUELTA as readonly string[]).includes(error)
    ? { tipo: 'error', error: error as ErrorDeVuelta }
    : { tipo: 'invalida' };
}

/** Lo que la pantalla puede saber de la vuelta: nunca el código. */
export type VueltaGoogleRedirect =
  | { readonly estado: 'ausente' }
  | { readonly estado: 'codigo' }
  | { readonly estado: 'error'; readonly error: ErrorDeVuelta }
  | { readonly estado: 'invalida' };

let codigoPrivado: string | null = null;
let snapshot: VueltaGoogleRedirect = { estado: 'ausente' };
let canjeEnVuelo: Promise<void> | null = null;

export function vueltaGoogleRedirectSnapshot(): VueltaGoogleRedirect {
  return snapshot;
}

/**
 * Se llama ANTES de montar React (`main.tsx`). Si la URL trae la vuelta, la
 * retira con `replaceState` —sin entrada en el historial— y comprueba que salió;
 * si no puede, falla cerrado: un código que no se pudo sacar de la URL no se
 * canjea.
 */
export function capturarVueltaGoogleRedirect(): void {
  if (typeof window === 'undefined') return;
  const lectura = leerVueltaGoogleRedirect(window.location.hash);
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
    throw new Error('google_redirect_cleanup_failed');
  }
  if (lectura.tipo === 'codigo') {
    codigoPrivado = lectura.codigo;
    snapshot = { estado: 'codigo' };
  } else if (lectura.tipo === 'error') {
    snapshot = { estado: 'error', error: lectura.error };
  } else {
    snapshot = { estado: 'invalida' };
  }
}

/**
 * Canjea el código capturado UNA vez. El código se suelta de la memoria antes
 * de la request, así que un segundo llamado —`StrictMode` monta dos veces— no
 * tiene nada que mandar: comparte la misma promesa.
 */
export function canjearVueltaGoogleRedirectUnaVez(
  canjear: (codigo: string) => Promise<unknown>,
): Promise<void> {
  if (canjeEnVuelo) return canjeEnVuelo;
  const codigo = codigoPrivado;
  codigoPrivado = null;
  if (codigo === null) return Promise.reject(new Error('google_redirect_sin_codigo'));
  canjeEnVuelo = canjear(codigo).then(() => undefined);
  return canjeEnVuelo;
}

/** La pantalla ya mostró el resultado: la vuelta deja de pesar. */
export function olvidarVueltaGoogleRedirect(): void {
  snapshot = { estado: 'ausente' };
}

export function resetGoogleRedirectForTests(): void {
  codigoPrivado = null;
  snapshot = { estado: 'ausente' };
  canjeEnVuelo = null;
}

/**
 * Riel mock: lo que en real hacen Google (el POST al `login_uri`) y el dueño
 * (el 303 a `/#…`). El mock del dueño decide el fragmento; acá sólo se navega
 * como el 303: la raíz, con recarga completa, que es un documento nuevo.
 */
export function navegarComoEl303(fragmento: string): void {
  const destino = new URL('/', window.location.origin);
  destino.hash = fragmento;
  window.history.replaceState(null, '', destino.href);
  window.location.reload();
}

/** Riel mock: el POST de Google al `login_uri` (el mock del dueño) y el 303. */
export async function simularIdaYVueltaMock(credencial: string): Promise<void> {
  navegarComoEl303(await mockGoogleRedirectLoginUri(credencial));
}
