/**
 * D179 · decisión 179 de Mati · la barra de abajo en la app de inicio de iOS.
 *
 * **Lo que pasa (captura 8 de Mati, 0.212.0):** al abrir la app agregada a
 * inicio, la barra queda subida, con una franja vacía debajo; en cuanto se
 * scrollea, se acomoda. WebKit arranca con el viewport achicado y lo corrige
 * recién cuando hay un scroll.
 *
 * **Lo que hace esto:** el mismo scroll, solo y mínimo: 1 px y vuelta, al
 * arrancar, al volver de segundo plano y al restaurar la página de la caché.
 * Sólo con `navigator.standalone === true` (la app de inicio de iOS): en Safari
 * y en la computadora no hace nada.
 *
 * **Qué scrollea, medido** (`movil`, 390×844, Inicio, Estadísticas y
 * Configuración): el documento NUNCA (844/844, porque `html`, `body` y `#root`
 * miden 100 % y `.app` es `100dvh` con `overflow: hidden`); scrollea el `.scroll`
 * de cada pantalla. **Deducido, no medido:** cuál de los dos scrolls dispara el
 * recálculo de WebKit. Un dedo sobre una pantalla corta hace rebotar el
 * documento; sobre una larga, mueve el `.scroll`. Por eso el empujón mueve los
 * dos: el documento, alargando `html` 1 px mientras dura, y el `.scroll` si
 * tiene para dónde.
 *
 * **La garantía (peor caso = 0.212.0):** no toca el alto de `.app` ni de la
 * barra (lo que en 0.210.5 la cortó), sólo posiciones de scroll, y las devuelve
 * a donde estaban dos cuadros después. Si WebKit no recalcula, todo queda como
 * antes: la barra entera, subida, y se acomoda con el primer scroll. No se hace
 * con un dedo apoyado ni mientras la persona scrollea (cortaría el impulso).
 */

/** Esperas: a que la persona termine de scrollear, y el segundo intento del arranque. */
export const QUIETO_MS = 500;
export const SEGUNDO_INTENTO_MS = 700;

export function esAppDeInicioIOS(nav: Navigator): boolean {
  return (nav as Navigator & { standalone?: unknown }).standalone === true;
}

/** El `.scroll` de la pantalla, si tiene para dónde moverse. */
function scrollerDeLaPantalla(doc: Document): HTMLElement | null {
  const el = doc.querySelector<HTMLElement>('.app .scroll');
  return el && el.scrollHeight > el.clientHeight ? el : null;
}

/**
 * Engancha el empujón. Devuelve cómo soltarlo: listeners, cuadros y esperas
 * pendientes, y si había un empujón a medias, lo deja como estaba.
 */
export function iniciarEmpujon(win: Window = window): () => void {
  if (!esAppDeInicioIOS(win.navigator)) return () => {};

  const doc = win.document;
  const raiz = doc.documentElement;
  const cuadros = new Set<number>();
  const esperas = new Set<ReturnType<typeof setTimeout>>();
  let tocando = false;
  let ultimoScrollAjeno = Number.NEGATIVE_INFINITY;
  /** Mientras dura un empujón (y un cuadro después), sus scrolls no cuentan como de la persona. */
  let propio = false;
  let deshacer: (() => void) | null = null;

  const ahora = () => win.performance.now();

  function cuadro(fn: () => void): void {
    const id = win.requestAnimationFrame(() => {
      cuadros.delete(id);
      fn();
    });
    cuadros.add(id);
  }
  const dosCuadros = (fn: () => void) => cuadro(() => cuadro(fn));

  function esperar(ms: number, fn: () => void): void {
    const id = setTimeout(() => {
      esperas.delete(id);
      fn();
    }, ms);
    esperas.add(id);
  }

  function empujar(): void {
    if (deshacer || tocando || ahora() - ultimoScrollAjeno < QUIETO_MS) return;
    const minPrevio = raiz.style.getPropertyValue('min-height');
    const prioridadPrevia = raiz.style.getPropertyPriority('min-height');
    const y0 = win.scrollY;
    const interior = scrollerDeLaPantalla(doc);
    const top0 = interior ? interior.scrollTop : 0;

    propio = true;
    raiz.style.setProperty('min-height', 'calc(100% + 1px)');
    win.scrollTo(0, y0 + 1);
    if (interior) interior.scrollTop = top0 > 0 ? top0 - 1 : top0 + 1;

    deshacer = () => {
      deshacer = null;
      win.scrollTo(0, y0);
      if (interior) interior.scrollTop = top0;
      if (minPrevio) raiz.style.setProperty('min-height', minPrevio, prioridadPrevia);
      else raiz.style.removeProperty('min-height');
    };
    dosCuadros(() => {
      deshacer?.();
      cuadro(() => {
        propio = false;
      });
    });
  }

  const alArrancar = () => {
    dosCuadros(empujar);
    esperar(SEGUNDO_INTENTO_MS, empujar);
  };
  const alMostrar = (evento: Event) => {
    if ((evento as PageTransitionEvent).persisted) dosCuadros(empujar);
  };
  const alVolver = () => {
    if (doc.visibilityState === 'visible') dosCuadros(empujar);
  };
  const alTocar = () => {
    tocando = true;
  };
  const alSoltar = () => {
    tocando = false;
  };
  const alScrollear = () => {
    if (!propio) ultimoScrollAjeno = ahora();
  };

  const opciones = { capture: true, passive: true } as const;
  win.addEventListener('pageshow', alMostrar);
  doc.addEventListener('visibilitychange', alVolver);
  win.addEventListener('touchstart', alTocar, opciones);
  win.addEventListener('touchend', alSoltar, opciones);
  win.addEventListener('touchcancel', alSoltar, opciones);
  win.addEventListener('scroll', alScrollear, opciones);
  if (doc.readyState === 'complete') alArrancar();
  else win.addEventListener('load', alArrancar, { once: true });

  return () => {
    win.removeEventListener('load', alArrancar);
    win.removeEventListener('pageshow', alMostrar);
    doc.removeEventListener('visibilitychange', alVolver);
    win.removeEventListener('touchstart', alTocar, opciones);
    win.removeEventListener('touchend', alSoltar, opciones);
    win.removeEventListener('touchcancel', alSoltar, opciones);
    win.removeEventListener('scroll', alScrollear, opciones);
    for (const id of cuadros) win.cancelAnimationFrame(id);
    cuadros.clear();
    for (const id of esperas) clearTimeout(id);
    esperas.clear();
    deshacer?.();
    propio = false;
  };
}
