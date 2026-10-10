import { numero, type FilaDiagnostico } from './medirPantalla';

/**
 * D256 · Mati, en la app de inicio: al entrar a un ticket ya cargado «No se
 * movía nada». No se reprodujo fuera de su iPhone, así que el panel de
 * diagnóstico (5 toques en el logo) lee lo que puede frenar un arrastre:
 *
 * - qué elementos hay en el centro de la pantalla, de arriba hacia abajo (un velo
 *   invisible aparecería primero);
 * - el contenedor que scrollea más cercano a ese punto, y si desborda;
 * - los ancestros que cortan el toque: `inert`, `pointer-events: none` o un
 *   `touch-action` que no deja desplazar;
 * - el `overflow` de `body` y de `html`, en línea y calculado;
 * - cuántos `[inert]` hay y cuántas hojas modales se creen abiertas.
 *
 * Se mide UNA vez, al abrir el panel y antes de que su propia hoja deje `.app`
 * inerte: medido después, el panel se vería a sí mismo. Sólo etiquetas y
 * clases, nunca texto ni ids.
 */

const MAX_CLASES = 2;
const MAX_LARGO = 48;
const PILA = 4;

/** `div.screen.vj-con-pie`: la etiqueta y hasta dos clases. */
export function describir(el: Element | null): string {
  if (!el) return '—';
  const clases = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
  const texto = [el.tagName.toLowerCase(), ...clases.slice(0, MAX_CLASES)].join('.');
  return texto.length > MAX_LARGO ? `${texto.slice(0, MAX_LARGO - 1)}…` : texto;
}

function desborda(c: CSSStyleDeclaration): boolean {
  return c.overflowY === 'auto' || c.overflowY === 'scroll';
}

/** Lo que en un ancestro corta el toque o el arrastre. */
function freno(el: Element, c: CSSStyleDeclaration): string | null {
  const partes: string[] = [];
  if ((el as HTMLElement).inert) partes.push('inert');
  if (c.pointerEvents === 'none') partes.push('pointer-events:none');
  // Todo lo que no sea el de siempre se muestra (también `pan-y`): mejor de más que esconder un freno.
  if (c.touchAction && c.touchAction !== 'auto' && c.touchAction !== 'manipulation') {
    partes.push(`touch-action:${c.touchAction}`);
  }
  return partes.length > 0 ? `${describir(el)} ${partes.join(' ')}` : null;
}

export function medirScroll(win: Window, hojasAbiertas: number): FilaDiagnostico[] {
  const doc = win.document;
  const x = Math.round(win.innerWidth / 2);
  const y = Math.round(win.innerHeight / 2);
  const pila = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : [];
  const tocado = pila[0] ?? null;

  let contenedor: Element | null = null;
  const frenos: string[] = [];
  for (let el: Element | null = tocado; el; el = el.parentElement) {
    const c = win.getComputedStyle(el);
    if (!contenedor && desborda(c)) contenedor = el;
    const f = freno(el, c);
    if (f) frenos.push(f);
  }
  const medidas = contenedor
    ? [win.getComputedStyle(contenedor).overflowY, numero(contenedor.clientHeight), numero(contenedor.scrollHeight),
      numero(contenedor.scrollTop)].join(' · ')
    : '—';
  const overflow = (el: HTMLElement) =>
    `${el.style.overflow || 'none'} · ${win.getComputedStyle(el).overflowY}`;

  return [
    ['al abrir · elementsFromPoint (centro)', `${x},${y} → ${pila.slice(0, PILA).map(describir).join(' › ') || '—'}`],
    ['al abrir · contenedor que scrollea', describir(contenedor)],
    ['al abrir · overflow-y · clientHeight · scrollHeight · scrollTop', medidas],
    ['al abrir · inert · pointer-events · touch-action', frenos.join(' | ') || 'none'],
    ['al abrir · body overflow (style · computed)', overflow(doc.body)],
    ['al abrir · html overflow (style · computed)', overflow(doc.documentElement)],
    ['al abrir · [inert] · hojas abiertas', `${doc.querySelectorAll('[inert]').length} · ${hojasAbiertas}`],
  ];
}
