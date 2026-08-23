import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
/** La superficie IMPORTABLE: es esto lo que no puede tener efectos. */
const LIB = join(AQUI, 'aliasesLib.mjs');
/** El entrypoint, que sí ejecuta — nadie lo importa. */
const CLI = join(AQUI, 'verificar-aliases.mjs');

/**
 * 🔴 P97 · EL MÓDULO ES IMPORTABLE SIN EJECUTAR SU CLI — medido por EFECTO.
 *
 * `verificar-aliases.mjs` es a la vez CLI y módulo: el workflow lo invoca con
 * `node`, y los centinelas le importan sus patrones productivos. El guard que
 * separa esos dos usos existe desde el P94.
 *
 * ## Por qué no alcanzaba mirar exit, señal y salida
 *
 * Ésa era la versión anterior de este archivo, y Codex mostró que mide **silencio
 * TERMINAL**, no inacción. Con una llamada silenciosa a `adjudicarPoblacion()` en
 * la rama importada —que corre `vitest list` y `playwright test --list`— el
 * centinela quedaba **2/2 verde**: el CLI hacía su trabajo entero dentro de un
 * import y ninguna de las tres señales se movía.
 *
 * 🔴 **Silencio ≠ inacción.** Es la clase de toda la jornada un click más fino:
 * el oráculo miraba justamente lo que el efecto no toca.
 *
 * ## Cómo se mide el efecto
 *
 * Se pone un `npx` **de mentira** al frente del `PATH`, que lo único que hace es
 * escribir una marca. El CLI llega a `npx` para sus herramientas pesadas, así
 * que:
 *
 * ```
 * importar el módulo   →  CERO marcas    ← el control target
 * correr el CLI        →  marca presente ← el control positivo
 * ```
 *
 * Es la misma técnica de marca-en-disco que el arnés usa para sus mutantes, y por
 * el mismo motivo: **el `exit 0` y el silencio son justo lo que el mecanismo
 * produce; medir con ellos sería medir con el instrumento que el ataque mueve.**
 *
 * ## 🔴 QUÉ ACREDITA ESTE CENTINELA, después del P99
 *
 * Tres defensas, y la primera es la que cierra la clase:
 *
 * ① **estructura** — la lógica vive en `aliasesLib.mjs`, que **no contiene
 *    dispatcher**. No hay rama importada capaz de ejecutar nada, no porque una
 *    condición lo impida sino porque el código no está ahí;
 * ② **efecto observable** — importar la lib no invoca herramientas (espía de
 *    `npx`) y **no borra el reporte ni el artefacto** (los dos sinks no-`npx`
 *    que Codex midió verdes, y que el workflow usa);
 * ③ **forma** — la superficie importable **sólo declara**: ninguna invocación en
 *    su nivel superior, ni siquiera inofensiva. Esto cubre lo que ② no puede
 *    ver: una llamada de sólo lectura no deja rastro, y medido daba 4/4 verde.
 *
 * ⚠️ **El fixture positivo ejercita los tres flujos** —Vitest, Playwright y
 * `tsc`— y cada uno se afirma por separado. Antes llegaba sólo a Vitest y el
 * claim los nombraba a los tres: acreditado en un tercio.
 */
describe('🔴 importar el módulo no ejecuta el CLI · medido por efecto', () => {
  /**
   * Monta un árbol de prueba con un `npx` de mentira al frente del `PATH`.
   *
   * El espía sale ≠0 a propósito: lo que se mide es la MARCA, no su éxito, y así
   * no finge resultados que no ocurrieron.
   */
  function montarEspia(): { readonly marca: string; readonly env: NodeJS.ProcessEnv } {
    const raiz = mkdtempSync(join(tmpdir(), 'payme-espia-'));
    const marca = join(raiz, 'invocaciones.txt');
    writeFileSync(
      join(raiz, 'package.json'),
      JSON.stringify({ scripts: { typecheck: 'tsc --noEmit -p tsconfig.json' } }),
    );
    writeFileSync(marca, '');
    /**
     * 🔴 Hace falta un test EN DISCO, y lo descubrió el control positivo.
     *
     * Sin él, `acreditarColeccion` corta por «no hay archivos, mediría en vacío»
     * y **nunca llega a invocar `npx`**: el espía no registraba nada, y el caso
     * target habría pasado sobre un escenario que no ejercita el camino. El
     * control positivo se puso rojo primero, así que no se publicó una medición
     * hueca.
     */
    mkdirSync(join(raiz, 'src'), { recursive: true });
    writeFileSync(join(raiz, 'src', 'sonda.test.ts'), 'export const a = 1;\n');
    /**
     * 🔴 P99 · Y el fixture ejercita LOS TRES flujos, no sólo Vitest.
     *
     * Medido: con el escenario mínimo el espía sólo registraba `vitest list` —el
     * gate cortaba antes de llegar a `tsc` y a Playwright—, así que el claim
     * «llega a `npx` para sus herramientas pesadas» estaba acreditado en un
     * tercio. Con un `e2e/` poblado y un alias `typecheck` que nombre un
     * proyecto, los tres caminos se recorren de verdad.
     */
    mkdirSync(join(raiz, 'e2e'), { recursive: true });
    writeFileSync(join(raiz, 'e2e', 'sonda.spec.ts'), 'export const b = 1;\n');
    writeFileSync(join(raiz, 'tsconfig.json'), JSON.stringify({ include: ['src'] }));
    writeFileSync(join(raiz, 'npx'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(marca)}\nexit 1\n`);
    chmodSync(join(raiz, 'npx'), 0o755);
    return {
      marca,
      env: {
        ...process.env,
        PATH: `${raiz}:${process.env['PATH'] ?? ''}`,
        PAYME_RAIZ_VERIFICACION: raiz,
      },
    };
  }

  const invocaciones = (marca: string): string =>
    existsSync(marca) ? readFileSync(marca, 'utf8').trim() : '';

  it('✅ CONTROL POSITIVO · corrido como script, el CLI SÍ invoca sus herramientas', () => {
    // Sin esto, «cero invocaciones al importar» pasaría igual con un espía roto o
    // con un CLI que no llama a nada: «no ejecuta al importarse» y «no ejecuta
    // nunca» son indistinguibles, y el caso de abajo mediría en vacío.
    const { marca, env } = montarEspia();
    try {
      spawnSync(process.execPath, [CLI, '--aliases'], { env, encoding: 'utf8' });
      const registro = invocaciones(marca);
      expect(registro, 'el espía no registró nada: el escenario no está midiendo lo que dice')
        .not.toBe('');
      // 🔴 Los TRES flujos que el docblock declara cubiertos, cada uno afirmado.
      for (const herramienta of ['vitest', 'playwright', 'tsc']) {
        expect(registro, `el fixture no llega a «${herramienta}»: el claim lo incluye sin acreditarlo`)
          .toMatch(new RegExp(herramienta));
      }
    } finally {
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  it('🔴 IMPORTADO · cero invocaciones del CLI, no sólo cero salida', () => {
    const { marca, env } = montarEspia();
    try {
      const r = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(LIB).href)};`],
        { env, encoding: 'utf8' },
      );
      // 🔴 LA AFIRMACIÓN NUEVA: el EFECTO, no la salida. Un `adjudicarPoblacion()`
      // silencioso en la rama importada deja esto ≠ '' aunque no imprima nada.
      expect(
        invocaciones(marca),
        'importar el módulo EJECUTÓ herramientas del CLI: silencio no es inacción',
      ).toBe('');
      // Y las tres señales terminales se conservan: cubren el caso ruidoso, que
      // es distinto y también hay que cerrarlo.
      expect(r.status, 'importar el módulo terminó ≠0: el CLI corrió y llamó a `process.exit`')
        .toBe(0);
      expect(r.signal, 'importar el módulo mató el proceso').toBeNull();
      expect(`${r.stdout}${r.stderr}`.trim(), 'importar el módulo produjo salida del CLI')
        .toBe('');
    } finally {
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  /**
   * 🔴 P99 · UN EFECTO QUE NO PASA POR `npx` — la frontera que el espía no ve.
   *
   * El centinela anterior observaba el ejecutable literal `npx`, y Codex midió
   * que `invalidar('corrida')` y `invalidar('build')` —que **borran** el reporte
   * y `dist/`— lo dejaban 3/3 verde desde la rama importada. **Dos de esos sinks
   * son los que usa el workflow.**
   *
   * El espía no puede cubrirlos: no son procesos, son llamadas a `rm`. Se cubren
   * observando **el disco**, que es donde el efecto se ve. Junto con la
   * separación lib/entrypoint —que quita la rama importada entera— esto cierra
   * el flanco por los dos lados: estructura y observación.
   */
  it('🔴 IMPORTADO · no borra el reporte ni el artefacto · efectos NO-npx', () => {
    const { marca, env } = montarEspia();
    const raiz = dirname(marca);
    try {
      const reporte = join(raiz, '.vitest-corrida.json');
      const dist = join(raiz, 'dist');
      writeFileSync(reporte, '{"testResults":[]}');
      mkdirSync(dist, { recursive: true });
      writeFileSync(join(dist, 'index.html'), '<html></html>');
      // Control de plantado: si el escenario no existiera, «no se borró» sería
      // cierto por vacuidad y este caso mediría la nada.
      expect(existsSync(reporte) && existsSync(dist), 'el escenario no se plantó').toBe(true);

      spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(LIB).href)};`],
        { env, encoding: 'utf8' },
      );

      expect(existsSync(reporte), 'importar la lib BORRÓ el reporte de la corrida').toBe(true);
      expect(existsSync(dist), 'importar la lib BORRÓ el artefacto del build').toBe(true);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('🔴 y el CLI real sigue respondiendo a una invocación directa', () => {
    // El guard podría «arreglarse» apagando el CLI entero. Esto lo impide.
    const r = spawnSync(process.execPath, [CLI, '--modo-inexistente'], { encoding: 'utf8' });
    expect(r.status, 'el CLI no respondió a una invocación directa').not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/modo desconocido/);
  });
});

/**
 * 🔴 P99 · LA LIB NO INVOCA NADA EN SU NIVEL SUPERIOR — guarda ESTRUCTURAL.
 *
 * Los casos de arriba observan **efectos**: procesos que pasan por `npx` y
 * borrados en disco. Eso deja un flanco que medí y declaro: **una llamada de
 * sólo lectura no deja rastro observable.** Con `adjudicarAliases()` inyectado en
 * la lib —que sólo lee `package.json` y acumula fallas— los cuatro casos de
 * arriba quedan **4/4 verdes**, porque no hay nada que ver.
 *
 * No se cierra observando mejor: se cierra **mirando la forma del archivo**. La
 * superficie importable puede declarar cuanto quiera, pero **no puede invocar en
 * su nivel superior** — ni siquiera algo inofensivo. Es la misma forma que el
 * resto del arnés: declarar lo bueno (sólo declaraciones) en vez de enumerar lo
 * malo (qué llamadas están prohibidas).
 */
describe('🔴 la superficie importable sólo DECLARA', () => {
  it('🔴 ninguna invocación en el nivel superior de `aliasesLib.mjs`', () => {
    const lineas = readFileSync(LIB, 'utf8').split('\n');
    /**
     * Una invocación de nivel superior empieza en la columna 0 y tiene forma de
     * llamada. Las declaraciones (`function`, `const`, `export`, `import`) y todo
     * lo indentado —o sea, lo que vive DENTRO de una función— no cuentan.
     */
    const invocaciones = lineas
      .map((l, i) => ({ l, n: i + 1 }))
      .filter(({ l }) => /^[A-Za-z_$][\w$]*\s*\(/.test(l))
      .map(({ l, n }) => `${n}: ${l.trim().slice(0, 60)}`);
    expect(
      invocaciones,
      'la superficie importable EJECUTA algo al cargarse:\n  ' + invocaciones.join('\n  '),
    ).toEqual([]);
  });

  it('✅ CONTROL POSITIVO · el reconocedor SÍ ve una invocación cuando la hay', () => {
    // Sin esto, un regex roto daría «cero invocaciones» sobre cualquier archivo y
    // el caso de arriba pasaría por vacuidad, que es el falso verde de siempre.
    const muestra = ['const a = 1;', 'adjudicarAliases();', '  invalidar("build");'];
    const halladas = muestra.filter((l) => /^[A-Za-z_$][\w$]*\s*\(/.test(l));
    expect(halladas, 'el reconocedor no distingue una invocación top-level')
      .toEqual(['adjudicarAliases();']);
  });
});
