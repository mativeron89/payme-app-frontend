import { defineConfig } from 'vite';

/**
 * BUILD DE LA LANDING — config PROPIA, y por eso es un archivo aparte.
 *
 * La alternativa era agregar una segunda entry a `vite.config.ts` con
 * `rollupOptions.input`. Se descartó por dos razones concretas:
 *
 * 1. **El build de la webapp no se toca.** `deploy-demo.yml` lo invoca dos
 *    veces con `--base` y `--outDir` distintos; meterle una entry más cambia
 *    lo que produce ese pipeline sin que nadie lo haya pedido. Esta orden dice
 *    "cero deploy", y la forma más segura de cumplirlo es no modificar el
 *    artefacto que hoy se despliega.
 * 2. **Grafos disjuntos por construcción, no por convención.** Con dos builds
 *    separados no existe la posibilidad de un chunk compartido: son dos
 *    invocaciones de Rollup que no se conocen. Con una sola entrada compartida
 *    habría que confiar en que el code-splitting no los junte.
 *
 * 🔴 Lo que esto NO significa: que un workflow futuro no pueda coordinar los
 * dos despliegues. Puede. La independencia es **de artefacto y de origen, no
 * de tubería** (`SPEC_LANDING.md` §2).
 *
 * Sin el plugin de React a propósito: la landing no tiene una sola línea de
 * JS. Es la forma más fuerte de cumplir las prohibiciones de §2 del spec — sin
 * grafo de módulos no hay dónde colar `AuthProvider`, la capa de API ni Stripe.
 */
export default defineConfig({
  root: 'landing',
  // Fuera de `dist/`, que es del artefacto de la webapp. Dos targets, dos
  // carpetas: si compartieran salida, "artefactos separados" sería una
  // afirmación y no un hecho verificable.
  build: {
    outDir: '../dist-landing',
    emptyOutDir: true,
  },
});
