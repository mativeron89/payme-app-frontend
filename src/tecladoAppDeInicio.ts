/**
 * D182 · decisión 182 de Mati · el teclado en la app de inicio de iOS.
 *
 * Mati: «cuando selecciono el buscador en amigos, la burbuja se rompe». En la
 * captura 15 (0.215.0, app de inicio) la página entera subió ≈ 58 pt, justo
 * 852 − 794, y el encabezado quedó debajo de la barra de estado. El buscador
 * (a ~239 pt) ya estaba por encima del teclado: iOS no la subió para mostrar el
 * campo.
 *
 * Lo que NO se pudo medir acá (Chromium no tiene teclado de iOS ni el viewport
 * corto de WebKit): si iOS la sube con un scroll del documento (`scrollY`) o
 * corriendo el visualViewport (`offsetTop`). Por eso esto hace dos cosas:
 *
 * 1. **Mide.** Con un campo de texto enfocado, anota el alto y el `offsetTop`
 *    del visualViewport, el `scrollY`, el top de `.app`, qué campo era (por su
 *    rótulo, nunca su valor) y cuántas veces se corrigió. De cada foco guarda la
 *    lectura MÁS corrida, que es la que iOS produjo, no la que queda después de
 *    corregir. Sólo en memoria. El panel de diagnóstico lo muestra como
 *    «Teclado (último)».
 * 2. **Corrige lo que sabe corregir**, con el peor caso igual a hoy: si el campo
 *    está dentro de un contenedor que scrollea (el `.scroll` de la pantalla) y
 *    el documento quedó desplazado, lo vuelve a 0 y acerca el campo moviendo su
 *    contenedor. A lo sumo tres veces por foco: si iOS insiste, queda como hoy.
 *    Nunca con un dedo apoyado ni en el impulso de un arrastre (500 ms después de
 *    soltar): eso lo mueve la persona, no iOS. El toque que enfoca el campo no
 *    es un arrastre y no espera; lo que se saltea por un arrastre se reintenta
 *    al terminar la espera.
 *    Un campo sin contenedor que scrollee (el login, que scrollea con el
 *    documento) no se toca. Si lo de iOS es correr el visualViewport con
 *    `scrollY` en 0, esto no hace nada: queda como hoy, y el panel lo dice.
 *
 * Sólo con `navigator.standalone === true`.
 */
import { esAppDeInicioIOS } from './appDeInicio';

export interface InstantaneaTeclado {
  readonly altoVisible: number;
  readonly offsetTop: number;
  readonly scrollY: number;
  readonly appTop: number;
  readonly campo: string;
  /** Cuántas veces se volvió el documento a 0 en ese foco. */
  readonly reajustes: number;
}

let ultima: InstantaneaTeclado | null = null;

/** La última instantánea con un campo enfocado, para el panel de diagnóstico. */
export function ultimoTeclado(): InstantaneaTeclado | null {
  return ultima;
}

export const MAX_REAJUSTES = 3;
/** Después de soltar el dedo, cuánto se espera antes de volver a corregir (el impulso del scroll). */
export const QUIETO_MS = 500;
const MARGEN_PX = 12;
const TIPOS_DE_TEXTO = new Set(['text', 'email', 'password', 'search', 'tel', 'number', 'url']);

export function esCampoDeTexto(el: EventTarget | null): el is HTMLElement {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TIPOS_DE_TEXTO.has(el.type);
  return el.isContentEditable;
}

/**
 * Cómo se nombra el campo en el panel: su rótulo o su placeholder, nunca lo
 * escrito. Sin «@»: el panel se copia y no lleva nada con forma de usuario.
 */
export function describir(el: HTMLElement): string {
  const rotulo = el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name');
  return rotulo ? rotulo.replace(/@/g, '').slice(0, 40) : el.tagName.toLowerCase();
}

/**
 * El contenedor que scrollea al campo, si lo hay: el más cercano con
 * `overflow-y: auto | scroll`, aunque en ese momento no desborde. Medido en el
 * censo de E179b: el `.scroll` de Amigos mide 682/682 con pocos amigos, y igual
 * es lo que tiene que moverse, no el documento. Por encima de `.app` no hay
 * ninguno (`.app` y `html` recortan con `hidden`).
 */
export function contenedorQueScrollea(el: HTMLElement, win: Window): HTMLElement | null {
  for (let a = el.parentElement; a; a = a.parentElement) {
    const { overflowY } = win.getComputedStyle(a);
    if (overflowY === 'auto' || overflowY === 'scroll') return a;
  }
  return null;
}

/**
 * Cuánto mover el contenedor para que el campo quede a la vista: entre el borde
 * de arriba del contenedor y el más alto de su borde de abajo y del borde de lo
 * visible (arriba del teclado). Positivo = bajar el contenido del contenedor.
 */
export function desplazamientoParaVer(
  campo: { readonly top: number; readonly bottom: number },
  contenedor: { readonly top: number; readonly bottom: number },
  visibleAbajo: number,
  margen = MARGEN_PX,
): number {
  const abajo = Math.min(contenedor.bottom, visibleAbajo) - margen;
  const arriba = contenedor.top + margen;
  if (campo.bottom > abajo) return Math.min(campo.bottom - abajo, campo.top - arriba);
  if (campo.top < arriba) return campo.top - arriba;
  return 0;
}

export function cuidarTeclado(win: Window = window): () => void {
  if (!esAppDeInicioIOS(win.navigator)) return () => {};
  const doc = win.document;
  const vv = win.visualViewport;
  let reajustes = 0;
  let cuadro = 0;
  /** Lo corrida que estaba la lectura guardada de este foco. */
  let corrimiento = -1;
  let tocando = false;
  let movio = false;
  let soltadoEn = Number.NEGATIVE_INFINITY;
  let reintento: ReturnType<typeof setTimeout> | undefined;
  const quieto = () => !tocando && win.performance.now() - soltadoEn >= QUIETO_MS;

  const acomodar = () => {
    const campo = doc.activeElement;
    if (!esCampoDeTexto(campo)) return;
    const antes = {
      altoVisible: vv ? vv.height : win.innerHeight,
      offsetTop: vv ? vv.offsetTop : 0,
      scrollY: win.scrollY,
      appTop: doc.querySelector('.app')?.getBoundingClientRect().top ?? Number.NaN,
    };
    const contenedor = contenedorQueScrollea(campo, win);
    if (contenedor && !quieto() && reintento === undefined) {
      reintento = setTimeout(() => {
        reintento = undefined;
        enElProximoCuadro();
      }, QUIETO_MS);
    }
    const corrida = Math.abs(antes.scrollY) + Math.abs(antes.offsetTop) + Math.abs(antes.appTop || 0);
    if (corrida >= corrimiento) {
      corrimiento = corrida;
      ultima = { ...antes, campo: describir(campo), reajustes };
    }
    if (contenedor && win.scrollY !== 0 && reajustes < MAX_REAJUSTES && quieto()) {
      reajustes += 1;
      if (ultima) ultima = { ...ultima, reajustes };
      win.scrollTo(0, 0);
    }
    if (contenedor && quieto()) {
      const visibleAbajo = vv ? vv.offsetTop + vv.height : win.innerHeight;
      const d = desplazamientoParaVer(campo.getBoundingClientRect(), contenedor.getBoundingClientRect(), visibleAbajo);
      if (d !== 0) contenedor.scrollTop += d;
    }
  };
  const enElProximoCuadro = () => {
    win.cancelAnimationFrame(cuadro);
    cuadro = win.requestAnimationFrame(acomodar);
  };
  const alEnfocar = (evento: Event) => {
    if (!esCampoDeTexto(evento.target)) return;
    reajustes = 0;
    corrimiento = -1;
    enElProximoCuadro();
  };
  const alMoverseLaPagina = (evento: Event) => {
    if (evento.target === doc) enElProximoCuadro();
  };
  const alTocar = () => {
    tocando = true;
    movio = false;
  };
  const alMover = () => {
    movio = true;
  };
  const alSoltar = () => {
    tocando = false;
    if (movio) soltadoEn = win.performance.now();
  };
  const opciones = { capture: true, passive: true } as const;

  doc.addEventListener('focusin', alEnfocar);
  doc.addEventListener('scroll', alMoverseLaPagina);
  win.addEventListener('touchstart', alTocar, opciones);
  win.addEventListener('touchmove', alMover, opciones);
  win.addEventListener('touchend', alSoltar, opciones);
  win.addEventListener('touchcancel', alSoltar, opciones);
  vv?.addEventListener('resize', enElProximoCuadro);
  vv?.addEventListener('scroll', enElProximoCuadro);
  return () => {
    doc.removeEventListener('focusin', alEnfocar);
    doc.removeEventListener('scroll', alMoverseLaPagina);
    win.removeEventListener('touchstart', alTocar, opciones);
    win.removeEventListener('touchmove', alMover, opciones);
    win.removeEventListener('touchend', alSoltar, opciones);
    win.removeEventListener('touchcancel', alSoltar, opciones);
    vv?.removeEventListener('resize', enElProximoCuadro);
    vv?.removeEventListener('scroll', enElProximoCuadro);
    win.cancelAnimationFrame(cuadro);
    if (reintento !== undefined) clearTimeout(reintento);
  };
}

/** Sólo para tests. */
export function reiniciarParaTests(): void {
  ultima = null;
}
