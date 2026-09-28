import { navegarComoEl303 } from './googleRedirect';
import { mockGoogleRedirectLinkLoginUri } from './mock/mockApi';

/**
 * AF-VINCULAR-GOOGLE · decisión 107, punto 1 · la VUELTA de «Vincular Google» en
 * la misma pestaña (App Backend v2.141.0, `docs/GOOGLE_VINCULAR_REDIRECT_D107_WIRE.md`).
 *
 * Google hace el POST al `login_uri` con el `state` `vincular:<id>` y el dueño
 * contesta 303 a la raíz con uno de estos fragmentos (wire §2.3):
 * - `#google_link=listo`: la cuenta de Google quedó anotada en el intento.
 *   **Todavía no se vinculó**: falta la contraseña (`complete`);
 * - `#google_redirect_error=<csrf_failed|social_auth_failed|temporarily_unavailable>`:
 *   los MISMOS fragmentos que usa «Entrar» (fase 1).
 *
 * Los errores no dicen de qué ida vienen. Por eso, al salir a vincular, se deja
 * una marca en `sessionStorage` con la hora (no el `state`, que no se guarda en
 * ningún storage). Con la marca vigente, esos errores son de vincular; sin ella,
 * siguen siendo de «Entrar», como hasta hoy.
 *
 * Como la fase 1, se lee ANTES de React y del router: se borra el fragmento con
 * `history.replaceState` y la dirección pasa a `/mas`, donde está «Cuentas
 * conectadas». Por eso esta captura va PRIMERO en `main.tsx`.
 */

export const CLAVE_VINCULAR_EN_CURSO = 'payme.app.google_vincular_en_curso.v1';

/** Un poco más que la vida del intento del dueño (9 minutos). */
const VIGENCIA_MARCA_MS = 10 * 60 * 1000;

const ERRORES = ['csrf_failed', 'social_auth_failed', 'temporarily_unavailable'] as const;
export type ErrorDeVueltaVincular = (typeof ERRORES)[number];

export type LecturaVueltaVincular =
  | { readonly tipo: 'nada' }
  | { readonly tipo: 'listo' }
  | { readonly tipo: 'error'; readonly error: ErrorDeVueltaVincular }
  /** Con la forma de la vuelta de vincular pero con un valor que no es del dueño. */
  | { readonly tipo: 'invalida' };

/**
 * Lee un fragmento, sin tocar nada. Pura. `enCurso` dice si hay una ida a
 * vincular vigente: sin ella, los errores son de «Entrar» y acá no se leen.
 */
export function leerVueltaVincular(hash: string, enCurso: boolean): LecturaVueltaVincular {
  if (/^#google_link=/.test(hash)) {
    const params = new URLSearchParams(hash.slice(1));
    return [...params.keys()].length === 1 && params.get('google_link') === 'listo'
      ? { tipo: 'listo' }
      : { tipo: 'invalida' };
  }
  if (!enCurso || !/^#google_redirect_error=/.test(hash)) return { tipo: 'nada' };
  const params = new URLSearchParams(hash.slice(1));
  const error = params.get('google_redirect_error');
  return [...params.keys()].length === 1 && error !== null && (ERRORES as readonly string[]).includes(error)
    ? { tipo: 'error', error: error as ErrorDeVueltaVincular }
    : { tipo: 'nada' };
}

function sesion(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/** Al salir a Google para vincular. Sólo la hora: nunca el `state`. */
export function marcarVincularEnCurso(ahora: number = Date.now()): void {
  try { sesion()?.setItem(CLAVE_VINCULAR_EN_CURSO, String(ahora)); } catch { /* sin storage: la vuelta con error se lee como de «Entrar» */ }
}

export function vincularEnCurso(ahora: number = Date.now()): boolean {
  try {
    const raw = sesion()?.getItem(CLAVE_VINCULAR_EN_CURSO);
    const desde = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(desde) && desde <= ahora && ahora - desde <= VIGENCIA_MARCA_MS;
  } catch {
    return false;
  }
}

export function olvidarVincularEnCurso(): void {
  try { sesion()?.removeItem(CLAVE_VINCULAR_EN_CURSO); } catch { /* nada que borrar */ }
}

/** Lo que «Cuentas conectadas» puede saber de la vuelta. */
export type VueltaVincular =
  | { readonly estado: 'ausente' }
  | { readonly estado: 'listo' }
  | { readonly estado: 'error'; readonly error: ErrorDeVueltaVincular | 'invalida' };

let snapshot: VueltaVincular = { estado: 'ausente' };

export function vueltaVincularSnapshot(): VueltaVincular {
  return snapshot;
}

/** «Cuentas conectadas» ya tomó la vuelta: deja de pesar. */
export function olvidarVueltaVincular(): void {
  snapshot = { estado: 'ausente' };
}

export function resetVueltaVincularForTests(): void {
  snapshot = { estado: 'ausente' };
}

/**
 * Se llama ANTES de montar React (`main.tsx`), antes que la fase 1. Si la URL
 * trae la vuelta de vincular, la retira con `replaceState` —sin entrada en el
 * historial—, deja la dirección en `/mas` y suelta la marca. Si no pudo sacar el
 * fragmento, falla cerrado.
 */
export function capturarVueltaVincular(): void {
  if (typeof window === 'undefined') return;
  const lectura = leerVueltaVincular(window.location.hash, vincularEnCurso());
  if (lectura.tipo === 'nada') return;
  olvidarVincularEnCurso();
  try {
    // Sin query: el 303 del dueño vuelve a la raíz sólo con el fragmento.
    window.history.replaceState(window.history.state, '', '/mas');
  } catch {
    // sin historial no hay forma segura de sacarlo: se descarta abajo
  }
  if (window.location.hash !== '') {
    snapshot = { estado: 'error', error: 'invalida' };
    throw new Error('google_link_cleanup_failed');
  }
  snapshot = lectura.tipo === 'listo'
    ? { estado: 'listo' }
    : { estado: 'error', error: lectura.tipo === 'error' ? lectura.error : 'invalida' };
}

/** Riel mock: lo que en real hacen Google (el POST con el `state`) y el dueño (el 303). */
export async function simularIdaYVueltaVincularMock(credencial: string, state: string): Promise<void> {
  navegarComoEl303(await mockGoogleRedirectLinkLoginUri(credencial, state));
}
