/**
 * E173-2 · decisión 173 de Mati · la barra de abajo en la app agregada a inicio.
 *
 * Mati, con capturas de su iPhone: «Ni bien abro […] la barra inferior queda
 * desfasada más arriba, tengo que subir y bajar para que se ajuste a la
 * pantalla.» Medido en la captura: `.app` termina ~57 pt antes del borde, casi
 * el alto de la barra de estado de arriba, y se corrige al hacer scroll.
 *
 * Es un defecto de WebKit en las apps de inicio con `viewport-fit=cover`: el
 * viewport arranca achicado en el inset superior (`innerHeight`,
 * `visualViewport` y `100dvh` a la vez), y `position: fixed; bottom: 0`
 * también queda corto (WebKit 237961). Con CSS solo no alcanza. No está
 * reproducido acá: no hay simulador de iOS, y Chromium no lo tiene.
 *
 * La corrección, acotada al caso documentado:
 * - sólo en la app de inicio de iOS (`navigator.standalone === true`); Safari,
 *   Android y escritorio no la ven;
 * - sólo si el faltante entre el alto real de la pantalla y `innerHeight`
 *   coincide con el inset superior medido. Así no pisa una ventana de iPad
 *   achicada a propósito, ni la horizontal, donde el inset superior es 0;
 * - fija el alto de `.app` en el de la pantalla (`--app-alto-standalone`), y lo
 *   retira cuando WebKit se corrige solo.
 */

export interface MedidaViewport {
  /** `navigator.standalone === true`: la app de inicio de iOS. */
  readonly standalone: boolean;
  readonly innerHeight: number;
  /** `screen.width`/`screen.height` en iOS no rotan: son los de vertical. */
  readonly screenWidth: number;
  readonly screenHeight: number;
  readonly vertical: boolean;
  /** `env(safe-area-inset-top)` resuelto, en px. */
  readonly insetSuperior: number;
}

/** Margen de redondeo entre medidas de WebKit. */
const TOLERANCIA_PX = 4;

export const VARIABLE_ALTO = '--app-alto-standalone';
export const CLASE_SONDA = 'viewport-sonda';

/** El alto que hay que imponer a `.app`, o `null` si el viewport está sano o no es el caso. */
export function altoCorregido(m: MedidaViewport): number | null {
  if (!m.standalone || !(m.insetSuperior > 0)) return null;
  const alto = m.vertical
    ? Math.max(m.screenWidth, m.screenHeight)
    : Math.min(m.screenWidth, m.screenHeight);
  if (!(alto > 0) || !(m.innerHeight > 0)) return null;
  const faltante = alto - m.innerHeight;
  if (faltante <= TOLERANCIA_PX) return null;
  if (Math.abs(faltante - m.insetSuperior) > TOLERANCIA_PX) return null;
  return alto;
}

/**
 * Engancha la corrección y devuelve cómo soltarla. En cualquier navegador que
 * no sea la app de inicio de iOS no hace nada: ni sonda, ni listeners.
 */
export function ajustarViewportStandalone(win: Window = window): () => void {
  const nav = win.navigator as Navigator & { standalone?: unknown };
  if (nav.standalone !== true) return () => {};

  const doc = win.document;
  const raiz = doc.documentElement;
  // El inset superior se lee resuelto de un elemento con ese padding: el valor
  // de una custom property con `env()` vuelve sin resolver.
  const sonda = doc.createElement('div');
  sonda.className = CLASE_SONDA;
  sonda.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(sonda);

  const medir = () => {
    const alto = altoCorregido({
      standalone: true,
      innerHeight: win.innerHeight,
      screenWidth: win.screen.width,
      screenHeight: win.screen.height,
      vertical: win.matchMedia('(orientation: portrait)').matches,
      insetSuperior: Number.parseFloat(win.getComputedStyle(sonda).paddingTop) || 0,
    });
    if (alto === null) raiz.style.removeProperty(VARIABLE_ALTO);
    else raiz.style.setProperty(VARIABLE_ALTO, `${alto}px`);
  };
  const alVolver = () => {
    if (doc.visibilityState === 'visible') medir();
  };

  medir();
  // El primer paint puede cambiar el inset o el viewport: una medida más.
  const frame = win.requestAnimationFrame(medir);
  win.addEventListener('resize', medir);
  win.addEventListener('orientationchange', medir);
  win.addEventListener('pageshow', medir);
  doc.addEventListener('visibilitychange', alVolver);
  win.visualViewport?.addEventListener('resize', medir);

  return () => {
    win.cancelAnimationFrame(frame);
    win.removeEventListener('resize', medir);
    win.removeEventListener('orientationchange', medir);
    win.removeEventListener('pageshow', medir);
    doc.removeEventListener('visibilitychange', alVolver);
    win.visualViewport?.removeEventListener('resize', medir);
    raiz.style.removeProperty(VARIABLE_ALTO);
    sonda.remove();
  };
}
