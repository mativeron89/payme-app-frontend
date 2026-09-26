import { useEffect, useState } from 'react';

/**
 * Mini-router propio. **n130 (AF-HISTORY-N130): rutas normales con History API**
 * —`/home`, `/mesa/PA-2847`— en lugar de `#/…`.
 *
 * 🔴 **Opción A, adenda del Bibliotecario:** los enlaces que llevan un SECRETO
 * en el fragmento se QUEDAN en el fragmento, igual que antes:
 *   - `#/mesa/:code?t=<token>`: la invitación del dueño,
 *     `${FRONTEND_PUBLIC_URL}/mesa/:code?t=…` con `FRONTEND_PUBLIC_URL` que
 *     termina en `/#` (`contract-mirror/routes/mesas.js`);
 *   - `#/recovery?token=…`: el correo de recuperación, y toda la familia
 *     `#/recovery` porque `recoveryFlow.ts` trabaja sobre el fragmento;
 *   - `signup_invitation` en el fragmento.
 * Lo que va después de `#` no viaja nunca al servidor ni en el `Referer`.
 * Pasarlo a path o query lo mandaría al edge en cada carga, así que la
 * conversión NUNCA toca esos fragmentos (`fragmentoConSecreto`). Se enrutan
 * desde el fragmento, como siempre, y al navegar a otra página el fragmento
 * sale de la URL.
 *
 * Todo otro `#/…` viejo (enlaces guardados, marcadores) se convierte con
 * `replaceState` a su ruta, conservando su query, sin dejar entrada en el
 * historial.
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
  /** AF-29 · 2b «Tus restaurantes»: se abre desde Mis estadísticas. */
  'restaurantes',
  /** AF-31 · 2c «Qué comes» por platos: se abre desde Mis estadísticas. */
  'platos',
  /** AF-31 · 2f «Evolución»: se abre desde Mis estadísticas. */
  'evolucion',
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
  /** AF2 · LEGAL-3.0.0 / decisiones 33-37: Configuración › Notificaciones (sólo correo). */
  'notificaciones',
  /** Completion público; el token vive sólo en memoria y nunca en PageId/query. */
  'recovery',
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

interface HashResolution {
  route: Route;
  /** `false` sólo cuando parsear exigió degradar a Inicio. */
  recognized: boolean;
}

function resolveHash(hash: string): HashResolution {
  const clean = hash.replace(/^#\/?/, '');
  // Sin hash, `#` y `#/` ya representan el default; no son links sucios.
  if (!clean) return { route: DEFAULT_ROUTE, recognized: true };
  const [pathPart, queryPart] = clean.split('?');
  const query = new URLSearchParams(queryPart ?? '');
  const [pageRaw, paramRaw] = (pathPart ?? '').split('/');
  const page = (pageRaw ?? '').toLowerCase();
  if (!VALID_PAGES.has(page)) return { route: DEFAULT_ROUTE, recognized: false };
  if (!paramRaw) return {
    route: { page: page as PageId, param: null, query },
    recognized: true,
  };
  try {
    return {
      route: { page: page as PageId, param: decodeURIComponent(paramRaw), query },
      recognized: true,
    };
  } catch {
    // Un deep link mal codificado no puede dejar la app en blanco.
    return { route: DEFAULT_ROUTE, recognized: false };
  }
}

export function parseHash(hash: string): Route {
  return resolveHash(hash).route;
}

/** La ruta de un `pathname` + `search` de la app (sin fragmento). */
function resolvePath(pathname: string, search: string): HashResolution {
  const limpio = pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  const query = search.startsWith('?') ? search.slice(1) : search;
  return resolveHash(`#/${limpio}${query ? `?${query}` : ''}`);
}

export function parseLocation(pathname: string, search: string): Route {
  return resolvePath(pathname, search).route;
}

/**
 * 🔴 **¿El fragmento lleva un secreto?** Si sí, no se convierte nunca (opción A).
 *
 * Es deliberadamente conservador: cualquier `t`, `token` o `signup_invitation`
 * en la query del fragmento, o la familia `#/recovery` entera, cuentan. Un
 * falso positivo sólo deja un enlace viejo con `#`; un falso negativo mandaría
 * un token al servidor.
 */
export function fragmentoConSecreto(hash: string): boolean {
  const limpio = hash.replace(/^#\/?/, '');
  const [camino = '', query = ''] = limpio.split('?');
  if (/^recovery(\/|$)/i.test(camino)) return true;
  const params = new URLSearchParams(query);
  for (const clave of params.keys()) {
    if (/^(t|token|signup_invitation)$/i.test(clave)) return true;
  }
  // Un `token=` fuera de una query bien formada también cuenta.
  return /(^|[?&#/])(t|token|signup_invitation)=/i.test(limpio);
}

/** ¿Hay un fragmento con ruta (`#/algo`)? `#` y `#/` solos no son ruta. */
function fragmentoConRuta(hash: string): boolean {
  return hash.replace(/^#\/?/, '').length > 0;
}

/**
 * Convierte un `#/…` viejo SIN secreto a su ruta, con `replaceState`. La query
 * del fragmento se suma a la de la URL (la del fragmento gana en una clave
 * repetida). Devuelve `true` si convirtió.
 */
export function convertirFragmentoViejo(): boolean {
  const { hash, search } = window.location;
  if (!fragmentoConRuta(hash) || fragmentoConSecreto(hash)) return false;
  const limpio = hash.replace(/^#\/?/, '');
  const [camino = '', queryFragmento = ''] = limpio.split('?');
  const query = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(queryFragmento)) query.set(k, v);
  const q = query.toString();
  try {
    window.history.replaceState(window.history.state, '', `/${camino}${q ? `?${q}` : ''}`);
    return true;
  } catch {
    return false;
  }
}

/** La ruta de la ubicación actual: el fragmento con secreto manda; si no, el path. */
function resolveLocation(): HashResolution {
  const { hash, pathname, search } = window.location;
  if (fragmentoConRuta(hash)) return resolveHash(hash);
  return resolvePath(pathname, search);
}

/** Aviso interno: `pushState`/`replaceState` no disparan `popstate`. */
export const EVENTO_RUTA = 'payme:ruta';

function avisarRuta(): void {
  window.dispatchEvent(new Event(EVENTO_RUTA));
}

/** La URL completa de la app, para comparar antes y después de navegar. */
export function ubicacionActual(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

// Navegaciones hechas DENTRO de la app: goBack() vuelve por el historial real
// del navegador (cada navegación crea una entrada), pero si la pantalla se
// abrió directo (deep link, refresh) no hay adónde volver → cae al fallback.
let internalNavs = 0;

function destino(page: PageId, param?: string): string {
  const suffix = param ? `/${encodeURIComponent(param)}` : '';
  // La query de la URL (p. ej. `?r=` del QR) se conserva al navegar, como se
  // conservaba con el router por hash. El fragmento, no: un fragmento con
  // secreto sale de la URL al pasar a otra página.
  return `/${page}${suffix}${window.location.search}`;
}

export function navigate(page: PageId, param?: string): void {
  const next = destino(page, param);
  if (ubicacionActual() === next) return;
  internalNavs += 1;
  try {
    window.history.pushState(null, '', next);
  } catch {
    window.location.assign(next);
    return;
  }
  avisarRuta();
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
  const next = destino(page, param);
  if (ubicacionActual() === next) return;
  try {
    window.history.replaceState(window.history.state, '', next);
  } catch {
    window.location.replace(next);
    return;
  }
  avisarRuta();
}

/**
 * G-35 · si el parser tuvo que degradar a Inicio, la barra también dice Inicio.
 *
 * Se reemplaza la entrada actual: con una asignación normal la ruta inválida
 * quedaría detrás del botón Atrás y reaparecería en cada retroceso. Rutas
 * conocidas y sus queries quedan byte por byte intactas.
 */
export function normalizeUnknownHash(hash: string): boolean {
  if (resolveHash(hash).recognized) return false;
  replaceRoute('home');
  return true;
}

/** Lo mismo que `normalizeUnknownHash`, sobre la ubicación completa. */
function normalizarDesconocida(): boolean {
  if (resolveLocation().recognized) return false;
  replaceRoute('home');
  return true;
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
  const [route, setRoute] = useState<Route>(() => {
    convertirFragmentoViejo();
    return resolveLocation().route;
  });
  useEffect(() => {
    const onChange = () => {
      convertirFragmentoViejo();
      if (normalizarDesconocida()) return;
      setRoute(resolveLocation().route);
    };
    // `popstate` (Atrás/Adelante), `hashchange` (un `#/…` viejo que llega con
    // la app abierta, o los flujos que todavía trabajan sobre el fragmento) y
    // el aviso propio de `navigate`/`replaceRoute`.
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    window.addEventListener(EVENTO_RUTA, onChange);
    // Ningún evento corre por la URL con la que se montó la app.
    onChange();
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener(EVENTO_RUTA, onChange);
    };
  }, []);
  return route;
}
