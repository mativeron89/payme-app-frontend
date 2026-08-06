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

/**
 * **Las páginas de la app, en UNA sola lista.**
 *
 * Antes esto eran dos: la unión de tipos `PageId` y el `Set` de validación de
 * `parseHash`. Decían lo mismo y **nada las obligaba a coincidir**, así que
 * podían separarse en silencio y en la dirección peor:
 *
 * > Una página en el `Set` y **no** en la unión pasaba el `page as PageId` de
 * > `parseHash` —que es un cast **sin chequeo**: `ReadonlySet<string>.has()` no
 * > narrowea—, llegaba al switch de `App.tsx` sin `case`, y dejaba la app **en
 * > blanco**. El compilador no podía verlo: para él la unión estaba completa.
 *
 * Con la unión **derivada** del array esa deriva ya no es detectable: es
 * **imposible de escribir**. Y de paso el cast de `parseHash` pasa a ser sano
 * por construcción, porque el `Set` se construye de acá.
 *
 * Agregar una página es agregar un elemento acá. El `default` de `App.tsx` se
 * encarga de que olvidarse del `case` **rompa el build**.
 */
export const PAGES = [
  'home',
  /**
   * `cuenta` es la Cuenta VIEJA. Las tres pantallas que §1.11 lanza desde las
   * pestañas de Inicio son de PRIMER NIVEL y tienen su ruta propia: no cuelgan
   * de un parámetro de `cuenta`. Se probó al revés —`#/cuenta/tarjetas`— para
   * no tocar `App.tsx`, y evitar un archivo no es una razón de diseño.
   */
  'cuenta',
  'tarjetas',
  'pagos',
  'estadisticas',
  'cargar',
  'transferir',
  /**
   * §1.9 · `amigos` es la sección social ENTERA: Amigos, Grupos y Solicitudes
   * son tres pestañas de una sola pantalla, no tres rutas.
   *
   * **`grupos` se retiró limpia, sin alias**, y se pudo por lo mismo que
   * `perfil` en 0.46.0: su único call site eran las pestañas viejas y no había
   * **un solo `navigate('grupos')` durmiente**. Es lo contrario de `cuenta`,
   * que conserva su `case` justamente porque sí los tiene.
   */
  'amigos',
  'mesas',
  'scan',
  /**
   * §1.9 · **`perfil` se renombró a `mas`**, no se agregó al lado. Se pudo
   * porque esta ruta **no tenía un solo `navigate('perfil')` durmiente** —su
   * único call site era la quinta posición de la barra—, así que no hay
   * navegación ratificada que proteger. Es lo contrario de `cuenta`, que
   * conserva su `case` justamente porque sí los tiene.
   */
  'mas',
  'avisos',
  'mesa',
] as const;

export type PageId = (typeof PAGES)[number];

export interface Route {
  page: PageId;
  /** parámetro opcional (ej.: code en #/mesa/PA-2847). */
  param: string | null;
  /** query dentro del hash (ej.: t=<guest token> en el link de invitado). */
  query: URLSearchParams;
}

const DEFAULT_ROUTE: Route = { page: 'home', param: null, query: new URLSearchParams() };

/**
 * Se construye de `PAGES`, no de una copia. El `page as PageId` de abajo sigue
 * siendo un cast sin chequeo —`ReadonlySet<string>.has()` no narrowea— pero
 * ahora es **sano por construcción**: lo único que el `Set` deja pasar salió de
 * `PAGES`, y `PageId` es exactamente `PAGES`.
 */
const VALID_PAGES: ReadonlySet<string> = new Set(PAGES);

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
