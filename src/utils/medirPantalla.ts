import { VERSION_APP } from '../api/versionPublicada';
import { ultimoTeclado } from '../tecladoAppDeInicio';

/**
 * E173-2 · el diagnóstico de pantalla (pedido del Bibliotecario IV tras la
 * captura 7 del iPhone de Mati): los números con los que WebKit dispone la app,
 * para no seguir a ciegas con la barra de abajo en la app de inicio.
 *
 * Sólo lee: no hace pedidos de red, no guarda nada y no toca la sesión ni datos
 * personales. Las claves son los nombres de las APIs del navegador, que no se
 * traducen; los valores son números o `true`/`false`/`undefined`.
 */
export type FilaDiagnostico = readonly [clave: string, valor: string];

/** Hasta dos decimales, sin ceros de más; `—` si no hay número. */
export function numero(n: unknown): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '—';
}

const MODOS = ['standalone', 'fullscreen', 'minimal-ui', 'browser'] as const;

/** Un elemento invisible para leer un valor CSS resuelto (env(), dvh…). */
function sonda(doc: Document, estilos: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = doc.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', top: '0', left: '0', width: '0', visibility: 'hidden', pointerEvents: 'none',
  }, estilos);
  el.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(el);
  return el;
}

function caja(el: Element | null): string {
  if (!el) return '—';
  const r = el.getBoundingClientRect();
  return `${numero(r.top)} · ${numero(r.bottom)} · ${numero(r.height)}`;
}

export function medirPantalla(win: Window = window): FilaDiagnostico[] {
  const doc = win.document;
  const nav = win.navigator as Navigator & { standalone?: unknown };
  const vv = win.visualViewport;

  const insets = sonda(doc, {
    paddingTop: 'env(safe-area-inset-top)',
    paddingRight: 'env(safe-area-inset-right)',
    paddingBottom: 'env(safe-area-inset-bottom)',
    paddingLeft: 'env(safe-area-inset-left)',
  });
  const unidades = (['100vh', '100svh', '100dvh', '100lvh'] as const).map((u) => sonda(doc, { height: u }));
  // `getComputedStyle` es VIVO: se lee antes de sacar la sonda, o queda vacío.
  const ci = win.getComputedStyle(insets);
  const valoresInsets = [ci.paddingTop, ci.paddingRight, ci.paddingBottom, ci.paddingLeft]
    .map((v) => numero(Number.parseFloat(v)));
  const altos = unidades.map((el) => numero(el.getBoundingClientRect().height));
  insets.remove();
  for (const el of unidades) el.remove();

  const app = doc.querySelector('.app');
  const barra = doc.querySelector('.appbar-block');
  const modo = MODOS.find((m) => win.matchMedia(`(display-mode: ${m})`).matches) ?? '—';
  // La corrección de 0.210.5 escribía en el style de <html>; 0.211.0 la retiró.
  // Se muestra cualquier estilo en línea de <html> o de `.app`: si algo los
  // estirara, se vería acá.
  const enLinea = (el: Element | null) => el?.getAttribute('style') || 'none';

  return [
    ['version', VERSION_APP],
    ['innerWidth × innerHeight', `${numero(win.innerWidth)} × ${numero(win.innerHeight)}`],
    ['outerWidth × outerHeight', `${numero(win.outerWidth)} × ${numero(win.outerHeight)}`],
    ['visualViewport width × height', vv ? `${numero(vv.width)} × ${numero(vv.height)}` : '—'],
    ['visualViewport offsetTop', vv ? numero(vv.offsetTop) : '—'],
    ['visualViewport scale', vv ? numero(vv.scale) : '—'],
    ['screen width × height', `${numero(win.screen.width)} × ${numero(win.screen.height)}`],
    ['devicePixelRatio', numero(win.devicePixelRatio)],
    ['documentElement clientHeight', numero(doc.documentElement.clientHeight)],
    ['100vh · 100svh · 100dvh · 100lvh', altos.join(' · ')],
    ['safe-area-inset top · right · bottom · left', valoresInsets.join(' · ')],
    ['.app height (computed)', app ? numero(Number.parseFloat(win.getComputedStyle(app).height)) : '—'],
    ['.app top · bottom · height', caja(app)],
    ['.appbar-block top · bottom · height', caja(barra)],
    ['navigator.standalone', String(nav.standalone)],
    ['display-mode', modo],
    ['orientation', win.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'],
    ['scrollY', numero(win.scrollY)],
    ['html style (JS fix)', enLinea(doc.documentElement)],
    ['.app style', enLinea(app)],
    // E179b · si la cadena de 100lvh está puesta (sólo la app de inicio de iOS).
    ['html class', doc.documentElement.className || 'none'],
    // D182 · la última vez que hubo un campo de texto enfocado: lo que dejó iOS
    // al abrir el teclado, antes de corregir. Sólo en memoria.
    ...filasDelTeclado(),
  ];
}

function filasDelTeclado(): FilaDiagnostico[] {
  const t = ultimoTeclado();
  if (!t) return [['teclado (último)', '—']];
  return [
    ['teclado: visualViewport height · offsetTop', `${numero(t.altoVisible)} · ${numero(t.offsetTop)}`],
    ['teclado: scrollY · .app top', `${numero(t.scrollY)} · ${numero(t.appTop)}`],
    ['teclado: campo · reajustes', `${t.campo} · ${t.reajustes}`],
  ];
}

/** Para «Copiar»: una fila por línea, `clave: valor`. */
export function textoDelDiagnostico(filas: readonly FilaDiagnostico[]): string {
  return filas.map(([clave, valor]) => `${clave}: ${valor}`).join('\n');
}

/** Ventana para los 5 toques en el logo. */
export const VENTANA_TOQUES_MS = 3_000;
export const TOQUES_PARA_ABRIR = 5;

/**
 * Registra un toque en el logo. Abre con 5 toques dentro de 3 s; al abrir, la
 * cuenta vuelve a cero.
 */
export function registrarToque(toques: readonly number[], ahora: number): { toques: number[]; abrir: boolean } {
  const recientes = [...toques.filter((t) => ahora - t < VENTANA_TOQUES_MS), ahora];
  if (recientes.length >= TOQUES_PARA_ABRIR) return { toques: [], abrir: true };
  return { toques: recientes, abrir: false };
}
