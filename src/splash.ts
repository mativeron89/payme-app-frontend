/**
 * Retiro del splash de carga — la mitad con criterio de `index.html`.
 *
 * D292 (Mati, 2026-10-12, «Siempre al abrir (Recomendada)»): la pantalla de carga aparece en cada apertura o recarga
 * —también por un link o un QR de mesa—, desde el primer cuadro, y queda **al menos 2 segundos**. Si la app tarda más,
 * sigue hasta que monte. Después, el fundido de siempre. Reemplaza «B sólo cuando tarda» (2026-08-19), que la mostraba
 * sólo si la app tardaba más de 300 ms.
 * - Adenda 1 («Hagamoslo de un segundo mejor»): 1 s, publicado en 0.244.1.
 * - Adenda 2 (0.245.1), después de ver ese segundo: «Aumenta a dos segundos el icono de carga inicial». Vuelve a 2 s.
 *
 * 🔴 D300 · los 2 s se cuentan **desde el primer cuadro en que se pintó el `#splash`**, no desde que empezó la
 * navegación. Contados desde la navegación, una página que tardaba en llegar se comía el mínimo: la pantalla se veía
 * menos de 2 s, o ni se veía. El primer cuadro pintado es la entrada `first-contentful-paint` de Paint Timing: el
 * `#splash` está en el HTML y su ícono es lo primero con contenido, así que es su primer cuadro.
 *
 * La APARICIÓN la gobierna CSS puro en `index.html` (tiene que pintar antes de que exista ningún módulo). Este módulo
 * gobierna el RETIRO: cuánto falta para completar el mínimo, y el fundido.
 *
 * La rendición de 12 s también vive en el CSS: está ESPEJADA a mano, y `splash.test.ts` impide que las dos copias se
 * separen. D300 sacó la entrada del ícono (240 ms): el ícono está entero desde el primer cuadro.
 */

/** D292 · el mínimo visible, desde el primer cuadro pintado (D300). La adenda 2: 2 s; la 1 lo había dejado en 1 s. */
export const SPLASH_MINIMO_MS = 2_000;

/** Duración del fundido de salida. */
export const SPLASH_FUNDIDO_MS = 160;

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
 * Cuánto falta para empezar a fundir el splash, dado cuánto pasó desde que se pintó por primera vez: lo que falta para
 * el mínimo, o `0` si ya lo cumplió (la app tardó más: se funde enseguida).
 *
 * Pura a propósito: el DOM no se puede testear acá (jsdom está prohibido por ratificación), así que TODO el criterio
 * vive en esta función y la cáscara de abajo queda sin decisiones. El navegador real la cubre `e2e/splash.spec.ts`.
 */
export function demoraDeRetiro(transcurridoMs: number, minimoMs: number = SPLASH_MINIMO_MS): number {
  // Nunca negativo: un setTimeout con demora negativa es un bug callado.
  return Math.max(0, minimoMs - transcurridoMs);
}

/** Lo que hace falta de una entrada de Paint Timing. */
export interface EntradaDePintado {
  readonly name: string;
  readonly startTime: number;
}

/**
 * 🔴 D300 · desde cuándo se cuenta el mínimo: el primer cuadro pintado (`first-contentful-paint`), en la escala de
 * `performance.now()`.
 *
 * Sin esa entrada todavía —el splash aún no se pintó, el navegador la anota unos cuadros después, o no implementa Paint
 * Timing—, se cuenta desde AHORA: el splash queda a lo sumo unos cuadros de más, nunca menos de 2 s. Y nunca desde
 * después de ahora: la demora no puede pasar del mínimo.
 */
export function desdeElPrimerCuadro(entradas: readonly EntradaDePintado[], ahoraMs: number): number {
  const fcp = entradas.find((e) => e.name === 'first-contentful-paint');
  return fcp ? Math.min(fcp.startTime, ahoraMs) : ahoraMs;
}

/** Las entradas de pintado del navegador; ninguna si no implementa Paint Timing. */
function entradasDePintado(): readonly EntradaDePintado[] {
  return typeof performance.getEntriesByType === 'function' ? performance.getEntriesByType('paint') : [];
}

/**
 * Cáscara DOM: aplica `demoraDeRetiro` sobre `#splash`, desde su primer cuadro pintado (D300), lo funde y lo saca del
 * árbol.
 *
 * El fundido congela primero la opacidad computada y recién después apaga la animación: la rendición de 12 s es una
 * animación con `fill: forwards`, y apagarla sin congelar haría saltar la opacidad a la base — si ya se había rendido, el
 * splash reaparecería un cuadro antes de irse.
 */
export function retirarSplash(
  ahoraMs: number = performance.now(),
  entradas: readonly EntradaDePintado[] = entradasDePintado(),
): void {
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
  }, demoraDeRetiro(ahoraMs - desdeElPrimerCuadro(entradas, ahoraMs), MINIMO_DE_ESTE_BUILD_MS));
}
