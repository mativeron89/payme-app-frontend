import { useEffect, useState } from 'react';

/**
 * Mini-router por hash, propio (mismo patrón que el dashboard frontend).
 * Formato: #/home · #/cuenta · #/mesa/PA-2847 (T2+) · ...
 *
 * Nota T3 (invitado por link): el backend arma el link como
 * `${FRONTEND_PUBLIC_URL}/mesa/:code?t=<token>`. Con hash routing, en el
 * deploy FRONTEND_PUBLIC_URL debe terminar en `/#` para que el link caiga
 * en `#/mesa/:code?t=...`; parseHash ya soporta el `?t=` adentro del hash.
 */

export type PageId =
  | 'home'
  | 'cuenta'
  | 'cargar'
  | 'transferir'
  | 'amigos'
  | 'grupos'
  | 'mesas'
  | 'scan'
  | 'perfil'
  | 'avisos'
  | 'mesa';

export interface Route {
  page: PageId;
  /** parámetro opcional (ej.: code en #/mesa/PA-2847). */
  param: string | null;
  /** query dentro del hash (ej.: t=<guest token> en el link de invitado). */
  query: URLSearchParams;
}

const DEFAULT_ROUTE: Route = { page: 'home', param: null, query: new URLSearchParams() };

const VALID_PAGES: ReadonlySet<string> = new Set([
  'home',
  'cuenta',
  'cargar',
  'transferir',
  'amigos',
  'grupos',
  'mesas',
  'scan',
  'perfil',
  'avisos',
  'mesa',
]);

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  if (!clean) return DEFAULT_ROUTE;
  const [pathPart, queryPart] = clean.split('?');
  const query = new URLSearchParams(queryPart ?? '');
  const [pageRaw, paramRaw] = (pathPart ?? '').split('/');
  const page = (pageRaw ?? '').toLowerCase();
  if (!VALID_PAGES.has(page)) return DEFAULT_ROUTE;
  if (!paramRaw) return { page: page as PageId, param: null, query };
  try {
    return { page: page as PageId, param: decodeURIComponent(paramRaw), query };
  } catch {
    // Un deep link mal codificado no puede dejar la app en blanco.
    return DEFAULT_ROUTE;
  }
}

// Navegaciones hechas DENTRO de la app: goBack() vuelve por el historial real
// del navegador (cada cambio de hash crea una entrada), pero si la pantalla se
// abrió directo (deep link, refresh) no hay adónde volver → cae al fallback.
let internalNavs = 0;

export function navigate(page: PageId, param?: string): void {
  const suffix = param ? `/${encodeURIComponent(param)}` : '';
  const next = `#/${page}${suffix}`;
  if (window.location.hash !== next) internalNavs += 1;
  window.location.hash = next;
}

/**
 * Reemplaza la ruta actual **sin dejar entrada en el historial**.
 *
 * Para redirigir desde una ruta que no se debe poder alcanzar. Con `navigate`
 * la ruta bloqueada quedaría viva en el historial y el botón Atrás la
 * recuperaría — el mismo mecanismo por el que Back revivía el token de una
 * invitación. Una ruta a la que no se puede entrar tampoco se puede volver.
 */
export function replaceRoute(page: PageId, param?: string): void {
  const suffix = param ? `/${encodeURIComponent(param)}` : '';
  const next = `#/${page}${suffix}`;
  if (window.location.hash === next) return;
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${next}`,
    );
    // `replaceState` no dispara `hashchange`: hay que avisarle al router.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch {
    // Si el navegador no deja tocar el historial, al menos sacar de la ruta.
    window.location.hash = next;
  }
}

/**
 * Volver RESPETANDO de dónde viniste (R-08: los back hardcodeados mandaban a
 * un hub fijo aunque hubieras entrado desde otra pantalla). `fallback` es la
 * pantalla "contenedora" natural si no hay historial propio.
 */
export function goBack(fallback: PageId, fallbackParam?: string): void {
  if (internalNavs > 0) {
    internalNavs -= 1;
    window.history.back();
  } else {
    navigate(fallback, fallbackParam);
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
