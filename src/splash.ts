/**
 * Retiro del splash de carga — la mitad con criterio de `index.html`.
 *
 * D292 (Mati, 2026-10-12, «Siempre al abrir (Recomendada)»): la pantalla de carga aparece en cada apertura o recarga
 * —también por un link o un QR de mesa—, desde el primer cuadro, y queda **al menos 2 segundos desde que empezó a cargar
 * la página**. Si la app tarda más, sigue hasta que monte. Después, el fundido de siempre. Reemplaza «B sólo cuando
 * tarda» (2026-08-19), que la mostraba sólo si la app tardaba más de 300 ms.
 * - Adenda 1 («Hagamoslo de un segundo mejor»): 1 s, publicado en 0.244.1.
 * - Adenda 2 (0.245.1), después de ver ese segundo: «Aumenta a dos segundos el icono de carga inicial». Vuelve a 2 s.
 *
 * La APARICIÓN la gobierna CSS puro en `index.html` (tiene que pintar antes de que exista ningún módulo). Este módulo
 * gobierna el RETIRO: cuánto falta para completar el mínimo, y el fundido. «Desde que empezó a cargar» es
 * `performance.now()`, que corre desde el inicio de la navegación (también en una recarga y en un link de mesa).
 *
 * Los tiempos que también vive el CSS están ESPEJADOS a mano (la entrada del ícono y la rendición de 12 s).
 * `splash.test.ts` impide que las dos copias se separen.
 */

/** D292 · el mínimo visible, desde que empezó a cargar la página (la adenda 2: 2 s; la 1 lo había dejado en 1 s). */
export const SPLASH_MINIMO_MS = 2_000;

/** Duración del fundido de salida. */
export const SPLASH_FUNDIDO_MS = 160;

/** La entrada del ícono en el CSS: dura 240 ms y arranca al aparecer la pantalla (sin retardo). */
export const SPLASH_ENTRADA_ICONO_MS = 240;
export const SPLASH_ENTRADA_ICONO_RETARDO_MS = 0;

/** La rendición del CSS: si la app nunca monta, la pantalla se retira sola a los 12 s. */
export const SPLASH_RENDICION_MS = 12_000;

/**
 * El mínimo de ESTE build. Siempre 2 s, salvo en el servidor de desarrollo de la e2e, que arranca con
 * `VITE_E2E_CARGA_SIN_MINIMO=1` (`playwright.config.ts`): ahí las ~1300 pruebas de siempre no esperan el mínimo en cada
 * carga. 🔴 Con `DEV` delante (condición del Bibliotecario, 2026-10-12T13:40:42Z): en un `vite build` `DEV` es `false`
 * constante, así que aunque alguien ponga la variable en Vercel o en el CI, el build que se publica aplica el mínimo. La
 * pantalla de carga misma se prueba contra el build (`e2e/splash.spec.ts`, proyecto `pantalla-de-carga`), sin la marca.
 */
export const MINIMO_DE_ESTE_BUILD_MS = import.meta.env.DEV && import.meta.env.VITE_E2E_CARGA_SIN_MINIMO === '1' ? 0 : SPLASH_MINIMO_MS;

/**
 * Cuánto falta para empezar a fundir el splash, dado cuánto pasó desde que empezó a cargar la página: lo que falta para
 * el mínimo, o `0` si ya lo cumplió (la app tardó más: se funde enseguida).
 *
 * Pura a propósito: el DOM no se puede testear acá (jsdom está prohibido por ratificación), así que TODO el criterio
 * vive en esta función y la cáscara de abajo queda sin decisiones. El navegador real la cubre `e2e/splash.spec.ts`.
 */
export function demoraDeRetiro(transcurridoMs: number, minimoMs: number = SPLASH_MINIMO_MS): number {
  // Nunca negativo: un setTimeout con demora negativa es un bug callado.
  return Math.max(0, minimoMs - transcurridoMs);
}

/**
 * Cáscara DOM: aplica `demoraDeRetiro` sobre `#splash`, lo funde y lo saca del árbol.
 *
 * El fundido congela primero la opacidad computada y recién después apaga la animación: la rendición de 12 s es una
 * animación con `fill: forwards`, y apagarla sin congelar haría saltar la opacidad a la base — si ya se había rendido, el
 * splash reaparecería un cuadro antes de irse.
 */
export function retirarSplash(ahoraMs: number = performance.now()): void {
  const el = document.getElementById('splash');
  if (!el) return;

  window.setTimeout(() => {
    el.style.opacity = getComputedStyle(el).opacity;
    el.style.animation = 'none';
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${SPLASH_FUNDIDO_MS}ms ease`;
      el.style.opacity = '0';
    });
    window.setTimeout(() => el.remove(), SPLASH_FUNDIDO_MS + 90);
  }, demoraDeRetiro(ahoraMs, MINIMO_DE_ESTE_BUILD_MS));
}
