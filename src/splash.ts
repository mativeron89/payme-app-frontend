/**
 * Retiro del splash de carga — la mitad con criterio de `index.html`.
 *
 * Decisión de Mati (2026-08-19, etiqueta literal «B sólo cuando tarda»): el
 * splash existe únicamente mientras la app está cargando de verdad. La
 * APARICIÓN la gobierna CSS puro en `index.html` (300ms de retardo: si React
 * monta antes, nunca se ve). Este módulo gobierna el RETIRO, que es donde
 * vive el único criterio no trivial:
 *
 * **el anti-flash.** Si la app monta a los 310ms, el splash recién empezó a
 * fundirse; retirarlo en ese instante produce un parpadeo de 10ms que se ve
 * como un error. Una vez que ASOMÓ, se queda un mínimo visible y recién
 * después se funde. El costo declarado: en ese caso borde la persona espera
 * hasta ~800ms con la app ya lista debajo. Es el precio del «si aparece, que
 * no parpadee» de la orden — un umbral mínimo de visibilidad razonable.
 *
 * Los números están ESPEJADOS en el CSS de `index.html` a mano, porque ese
 * CSS tiene que pintar antes de que exista ningún módulo. `splash.test.ts`
 * impide que las dos copias se separen.
 */

/** Retardo de aparición del CSS: antes de esto, el splash nunca se vio. */
export const SPLASH_APARICION_MS = 300;

/** Si asomó, cuánto se queda como mínimo antes de empezar a fundirse. */
export const SPLASH_MINIMO_VISIBLE_MS = 500;

/** Duración del fundido de salida. */
export const SPLASH_FUNDIDO_MS = 160;

/**
 * Cuánto falta para empezar a fundir el splash, dado cuánto tardó el montaje.
 *
 * `null` = el splash nunca llegó a verse: se retira YA y sin fundido — un
 * fundido sobre algo invisible sería un `setTimeout` de deuda, no un efecto.
 * Un número = milisegundos a esperar para completar el mínimo visible
 * (`0` si ya lo cumplió).
 *
 * Pura a propósito: el DOM no se puede testear acá (jsdom está prohibido por
 * ratificación), así que TODO el criterio vive en esta función y la cáscara
 * de abajo queda sin decisiones. El navegador real la cubre `e2e/splash.spec.ts`.
 */
export function demoraDeRetiro(transcurridoMs: number): number | null {
  if (transcurridoMs <= SPLASH_APARICION_MS) return null;
  return Math.max(0, SPLASH_APARICION_MS + SPLASH_MINIMO_VISIBLE_MS - transcurridoMs);
}

/**
 * Cáscara DOM: aplica `demoraDeRetiro` sobre `#splash` y lo saca del árbol.
 *
 * El fundido congela primero la opacidad computada y recién después apaga la
 * animación: la animación de entrada termina en `opacity: 1` sólo por su
 * `fill: forwards`, y apagarla sin congelar haría saltar la opacidad a la
 * base (`0`) — el splash desaparecería de golpe y la transición no tendría
 * nada que transicionar.
 */
export function retirarSplash(ahoraMs: number = performance.now()): void {
  const el = document.getElementById('splash');
  if (!el) return;

  const demora = demoraDeRetiro(ahoraMs);
  if (demora === null) {
    el.remove();
    return;
  }

  window.setTimeout(() => {
    el.style.opacity = getComputedStyle(el).opacity;
    el.style.animation = 'none';
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${SPLASH_FUNDIDO_MS}ms ease`;
      el.style.opacity = '0';
    });
    window.setTimeout(() => el.remove(), SPLASH_FUNDIDO_MS + 90);
  }, demora);
}
