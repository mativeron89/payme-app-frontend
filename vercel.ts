/**
 * Configuración de Vercel para los DOS proyectos que leen este repo,
 * `payme-app` y `payme-landing`.
 *
 * ══════════════════════════════════════════════════════════════════════
 * 🔴 EL CANDADO VA PRIMERO Y SIN CONDICIÓN, Y ESO CORRIGE UN FAIL-OPEN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * La versión anterior (`vercel.mjs`) hacía `throw` cuando
 * `PAYME_VERCEL_ARTIFACT` no era exactamente `app` o `landing`, **antes** de
 * exportar nada. Para el aislamiento de rutas eso fallaba cerrado y estaba
 * bien. Para el candado fallaba **abierto**, y es lo que se corrige acá:
 *
 *   sin config emitida  ⇒  rutas Meta no nacen        → 404 visible, seguro
 *   sin config emitida  ⇒  `deploymentEnabled` no llega → `main` DESPLIEGA SOLO
 *
 * Las dos cosas compartían un gate y tienen direcciones de fallo opuestas. Un
 * binding ausente en el panel de Vercel —algo que este repo no puede
 * observar— alcanzaba para quedarse sin candado en silencio.
 *
 * **El aislamiento no necesitaba el `throw`.** Un artefacto desconocido con
 * listas VACÍAS da exactamente lo mismo que `landing`: ninguna ruta nace. Y
 * contra el único caso que de verdad filtra —`landing` bindeado en el proyecto
 * App, un valor válido pero equivocado— el `throw` nunca protegió. Vaciar en
 * vez de lanzar conserva la garantía y mantiene el candado vivo.
 *
 * ⚠️ **Qué NO acredita este archivo.** Que Vercel lo lea, que el Root
 * Directory de cada proyecto sea la raíz y que `PAYME_VERCEL_ARTIFACT` esté
 * bindeada en ambos son hechos del proveedor, verificables sólo en su panel.
 * Ver `docs/DESPLIEGUE_GATEADO.md` y las deudas externas de
 * `docs/HARDENING_LANDING_LOCAL.md`.
 *
 * 📌 **Sin anotaciones de tipo a propósito.** El archivo es TypeScript válido
 * y **también** ESM plano, así que evalúa igual lo compile Vercel o no. Los
 * tests lo ejercitan con `node` crudo sobre sus bytes exactos: si alguien
 * introduce sintaxis sólo-TS, esa evaluación se cae y el gate lo dice.
 */
const artifact = process.env.PAYME_VERCEL_ARTIFACT;

/** Sólo el proyecto App publica las dos superficies públicas Meta. */
const esApp = artifact === 'app';

/** La landing: su propio proyecto Vercel sobre este mismo módulo. */
const esLanding = artifact === 'landing';

const paths = ['/privacy', '/facebook-data-deletion/:code'];

/**
 * n130 · AF-HISTORY-N130 · las rutas normales de la app (History API).
 *
 * Una por página, EXACTAS. No es un catch-all a propósito: las guardas de
 * despliegue prohíben reglas globales, porque un `/(.*)` alcanzaría de más, y
 * así una ruta que no existe sigue dando 404 en el edge. La lista espeja
 * `PAGES` de `src/router.ts`: este archivo se evalúa solo, sin importar nada,
 * así que `despliegue.test.ts` ata las dos listas.
 */
const PAGINAS_APP = [
  'home', 'cuenta', 'tarjetas', 'pagos', 'estadisticas', 'restaurantes', 'platos',
  'evolucion', 'cargar', 'transferir', 'amigos', 'mesas', 'scan', 'mas', 'avisos',
  'notificaciones', 'recovery', 'mesa',
];
/** Las que llevan un parámetro en la ruta: el código de mesa y el ID a transferir. */
const PAGINAS_CON_PARAMETRO = ['mesa', 'transferir'];
const rutasApp = [
  ...PAGINAS_APP.map((p) => `/${p}`),
  ...PAGINAS_CON_PARAMETRO.map((p) => `/${p}/:param`),
];
const headers = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

/**
 * ══════════════════════════════════════════════════════════════════════
 * n186 · CSP (orden AF-CSP-N186-20260925)
 * ══════════════════════════════════════════════════════════════════════
 *
 * **Landing: OBLIGATORIA.** Carga sólo lo propio —una hoja, dos fuentes,
 * cuatro imágenes— y UN `<script>` inline, el de idioma. Ese script se
 * autoriza por su hash exacto; un test lo recalcula desde el build y falla si
 * el script cambia sin que cambie el hash de acá.
 *
 * **App: SÓLO REPORTE** (`Content-Security-Policy-Report-Only`, sin
 * `report-uri`: las violaciones se ven en la consola). Pasar a obligatoria es
 * otra orden, después de observar producción.
 * - `<style>` inline de `index.html` (splash): por hash, sin `'unsafe-inline'`;
 * - Google Identity Services: script, iframe, fetch y hoja bajo `/gsi/`;
 * - n186 · AF-CSP-ESTILOS · lo que `gsi/client` INYECTA en nuestro documento,
 *   medido con el script real y la política exacta en Report-Only (harness en
 *   `~/.codex/runs/payme-af-csp-estilos-20260925/`), con los mismos dos
 *   hashes que la consola de producción:
 *   · un `<style>` propio de ~9,9 KB, constante: va por su hash exacto en
 *     `style-src-elem` y, para navegadores sin `-elem`, también en `style-src`.
 *     ⚠️ Si Google cambia `gsi/client`, cambia el hash y vuelve el reporte;
 *     antes de pasar a obligatoria se vuelve a medir;
 *   · el atributo `style` del botón, que lleva `width:Npx` con el ancho del
 *     contenedor (200..360, lo calcula `googleIdentity.ts`): cambia con cada
 *     teléfono, así que un hash no lo cubre. `'unsafe-inline'` SÓLO en
 *     `style-src-attr`: un atributo de estilo no ejecuta código, y scripts,
 *     conexiones y marcos no se tocan;
 * - Stripe.js: script e iframes (incluido el 3DS en `hooks.stripe.com`), API;
 * - el origen de la API sale de `VITE_API_URL` del mismo entorno de build; si
 *   falta o no parsea, no se agrega (es reporte: se vería en la consola);
 * - imágenes `blob:` (avatares, escáner) y `data:` (íconos SVG del CSS);
 * - service worker y manifest propios.
 *
 * Artefacto desconocido: NINGUNA cabecera, igual que rewrites y headers.
 */
const HASH_SCRIPT_IDIOMA_LANDING = "'sha256-0q+B8AZ70OFIwdyvViSs6/v+EDiwpZvDJ86Uf9Aiupc='";
const HASH_STYLE_SPLASH_APP = "'sha256-cm7TCL2O3xGpn0S6b2s0pom3xI3fEP3U38AYzzLIn2E='";
/** El `<style>` que inyecta `gsi/client` (medido el 2026-09-26; igual al de producción). */
const HASH_STYLE_GIS = "'sha256-RU4sU0AaS8IBGZx8XrGt/pa9A5SLA3dQszGeqT5L3Kw='";

// Parámetros con valor por defecto: TypeScript infiere el tipo sin anotaciones,
// y el archivo sigue siendo ESM plano (ver el 📌 de arriba).
function origenApi(valor = '') {
  try {
    const u = new URL(String(valor));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

function politica(directivas = [['']]) {
  return directivas.map((d) => d.join(' ')).join('; ');
}

const cspLanding = politica([
  ['default-src', "'self'"],
  ['script-src', HASH_SCRIPT_IDIOMA_LANDING],
  ['style-src', "'self'"],
  ['img-src', "'self'"],
  ['font-src', "'self'"],
  ['connect-src', "'none'"],
  ['object-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'none'"],
  ['frame-ancestors', "'none'"],
]);

const api = origenApi(process.env.VITE_API_URL);
const conApi = (lista = ['']) => (api ? [...lista, api] : lista);
const cspApp = politica([
  ['default-src', "'self'"],
  ['script-src', "'self'", 'https://accounts.google.com/gsi/client', 'https://js.stripe.com', 'https://*.js.stripe.com'],
  ['style-src', "'self'", HASH_STYLE_SPLASH_APP, 'https://accounts.google.com/gsi/style', HASH_STYLE_GIS],
  ['style-src-elem', "'self'", HASH_STYLE_SPLASH_APP, 'https://accounts.google.com/gsi/style', HASH_STYLE_GIS],
  ['style-src-attr', "'unsafe-inline'"],
  ['img-src', ...conApi(["'self'", 'data:', 'blob:'])],
  ['font-src', "'self'"],
  ['connect-src', ...conApi(["'self'", 'https://accounts.google.com/gsi/', 'https://api.stripe.com'])],
  ['frame-src', 'https://accounts.google.com/gsi/', 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com'],
  ['worker-src', "'self'"],
  ['manifest-src', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'none'"],
]);

const cabecerasCsp = esApp
  ? [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy-Report-Only', value: cspApp }] }]
  : esLanding
    ? [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: cspLanding }] }]
    : [];

export const config = {
  // 🔴 PRIMERA PROPIEDAD Y FUERA DE TODA CONDICIÓN. No depende del artefacto,
  // del entorno ni de nada que el panel de Vercel pueda no tener puesto.
  git: { deploymentEnabled: { main: false } },
  rewrites: esApp
    ? [...paths, ...rutasApp].map((source) => ({ source, destination: '/index.html' }))
    : [],
  headers: [
    ...cabecerasCsp,
    ...(esApp ? paths.map((source) => ({ source, headers })) : []),
  ],
};
