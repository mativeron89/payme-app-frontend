import { defineConfig } from 'vite';

/**
 * BUILD DE LA LANDING — config PROPIA, y por eso es un archivo aparte.
 *
 * La alternativa era agregar una segunda entry a `vite.config.ts` con
 * `rollupOptions.input`. Se descartó por dos razones concretas:
 *
 * 1. **El build de la webapp no se toca.** `deploy-demo.yml` —retirado el
 *    2026-08-21, ver `docs/DESPLIEGUE_GATEADO.md`— lo invocaba dos
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
 * Sin el plugin de React a propósito: la landing sólo tiene un script inline
 * acotado, sin entry ni grafo de módulos. Por construcción no hay dónde colar
 * `AuthProvider`, la capa de API ni Stripe.
 */
export default defineConfig({
  root: 'landing',
  /**
   * 🔴 RUTAS RELATIVAS, y esto ELIMINA un modo de falla en vez de esquivarlo.
   *
   * Por defecto Vite emite `/assets/…` — absoluto, pensado para la raíz de un
   * dominio. La landing vive HOY en TRES lugares a la vez —`paymemx.com` raíz,
   * `www.` y el prefijo `…github.io/payme-app-frontend/landing/`—, y bajo un
   * prefijo un `/assets/…` apunta a la raíz de `github.io`: **la página carga y
   * no aparece ni un estilo.** Falla en silencio, que es lo peor que puede
   * hacer.
   *
   * 🔴 ACTUALIZADO el 2026-08-10: acá decía «va a vivir en `paymemx.com` raíz
   * algún día». Ya vive. Y la decisión salió REFORZADA: el ápice sirve el
   * artefacto **sin ningún rebasing y sin que nadie tocara una bandera**.
   *
   * La salida obvia era pasar `--base=/payme-app-frontend/landing/` en el
   * workflow. Funciona, y depende de que alguien se acuerde de la bandera cada
   * vez y de que el prefijo no cambie. **`base: './'` anda en la raíz Y bajo
   * cualquier prefijo**, así que el día que la landing se mude a su dominio
   * propio sigue andando sin que nadie toque nada.
   *
   * Se verifica en el `dist`, no en la teoría: `landing.test.ts` exige que las
   * rutas emitidas empiecen con `./`.
   *
   * 🔴 Y hasta el 2026-08-10 esa frase prometía más de lo que había —aunque
   * NO era falsa, y la distinción importa—. No existía ningún test que
   * exigiera el `./`: cambiar `base` a `'/'` ponía la suite en rojo igual,
   * pero por **«las tres imágenes se USAN»**, cuyo regex casa `src="./assets/…"`
   * y dejaba de encontrarlas. O sea: la propiedad estaba protegida **de
   * rebote**, y quien la rompiera se iba a investigar peso muerto.
   *
   * Un gate que falla con el nombre equivocado manda a la persona a otro lado.
   * **Ahora existe el test propio** y falla diciendo lo que pasó. El de las
   * imágenes se conserva: cubre otra cosa.
   */
  base: './',
  // Fuera de `dist/`, que es del artefacto de la webapp. Dos targets, dos
  // carpetas: si compartieran salida, "artefactos separados" sería una
  // afirmación y no un hecho verificable.
  build: {
    outDir: '../dist-landing',
    emptyOutDir: true,
    // La política estática prohíbe `data:`: incluso el símbolo oficial chico
    // debe viajar como archivo propio y relativo, no inlineado por Vite.
    assetsInlineLimit: 0,
  },
});
