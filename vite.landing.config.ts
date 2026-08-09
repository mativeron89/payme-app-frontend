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
  /**
   * 🔴 RUTAS RELATIVAS, y esto ELIMINA un modo de falla en vez de esquivarlo.
   *
   * Por defecto Vite emite `/assets/…` — absoluto, pensado para la raíz de un
   * dominio. La landing va a vivir en `paymemx.com` raíz algún día, pero la
   * PREVIEW vive bajo un prefijo (`…github.io/payme-app-frontend/landing/`), y
   * ahí un `/assets/…` apunta a la raíz de `github.io`: **la página carga y no
   * aparece ni un estilo.** Falla en silencio, que es lo peor que puede hacer.
   *
   * La salida obvia era pasar `--base=/payme-app-frontend/landing/` en el
   * workflow. Funciona, y depende de que alguien se acuerde de la bandera cada
   * vez y de que el prefijo no cambie. **`base: './'` anda en la raíz Y bajo
   * cualquier prefijo**, así que el día que la landing se mude a su dominio
   * propio sigue andando sin que nadie toque nada.
   *
   * Se verifica en el `dist`, no en la teoría: `landing.test.ts` exige que las
   * rutas emitidas empiecen con `./`.
   */
  base: './',
  // Fuera de `dist/`, que es del artefacto de la webapp. Dos targets, dos
  // carpetas: si compartieran salida, "artefactos separados" sería una
  // afirmación y no un hecho verificable.
  build: {
    outDir: '../dist-landing',
    emptyOutDir: true,
  },
});
