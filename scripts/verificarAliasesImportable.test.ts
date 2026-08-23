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
 * 🔴 P103 · A NIVEL DE MÓDULO: la usan DOS describes.
 *
 * Estaba dentro de uno solo y el segundo no la veía. Se sube en vez de
 * copiarse: dos implementaciones de «importar una copia y mirar qué pasó»
 * es exactamente el defecto que el P85 cerró en este mismo arnés.
 */
/** Importa una copia de la lib con `extra` agregado y devuelve qué pasó. */
function importarCon(extra: string): { fallas: number; borro: boolean } {
  const raiz = mkdtempSync(join(tmpdir(), 'payme-forma-'));
  try {
    const copia = join(raiz, 'lib.mjs');
    writeFileSync(copia, `${readFileSync(LIB, 'utf8')}\n${extra}\n`);
    const reporte = join(raiz, '.vitest-corrida.json');
    writeFileSync(reporte, '{}');
    /**
     * 🔴 P102 · EL `package.json` ES SINTÁCTICAMENTE INVÁLIDO — y ésa es la
     * pieza que hace al sensor NO BORRABLE.
     *
     * Antes el fixture estaba roto pero era JSON válido, así que la ejecución
     * se detectaba por `fallas.length > 0` — **estado del propio módulo, que el
     * módulo puede limpiar**. Codex lo mostró:
     * `const x = (adjudicarAliases(), fallas.length = 0);` → **14/14 verde**
     * con el trabajo hecho: el código agregado comparte scope con el sensor y
     * lo resetea antes de que el observador lo lea.
     *
     * Con el archivo inválido, `adjudicarAliases()` **lanza en `JSON.parse`**.
     * La excepción ocurre ANTES de cualquier limpieza —no hay `length = 0` que
     * llegue a correr—, así que la señal deja de estar en manos del módulo: la
     * ejecución se prueba **por la excepción, no por un contador**.
     */
    writeFileSync(join(raiz, 'package.json'), '{ esto no es json');
    const r = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import(${JSON.stringify(pathToFileURL(copia).href)})` +
          `.then((m) => console.log('F=' + m.fallas.length)).catch(() => console.log('F=-1'));`,
      ],
      { env: { ...process.env, PAYME_RAIZ_VERIFICACION: raiz }, encoding: 'utf8' },
    );
    const m = /F=(-?\d+)/.exec(r.stdout);
    return { fallas: m ? Number(m[1]) : -1, borro: !existsSync(reporte) };
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

/**
 * 🔴 P97 · EL MÓDULO ES IMPORTABLE SIN EJECUTAR SU CLI — medido por EFECTO.
 *
 * 🔴 **Este párrafo describía la arquitectura VIEJA hasta el P100**, y por eso
 * se corrige en vez de borrarse: decía que `verificar-aliases.mjs` es «a la vez
 * CLI y módulo» con «un guard que separa esos dos usos», **que es exactamente lo
 * que el P99 retiró**. Un docblock que sobrevive al refactor que lo invalida es
 * la misma clase que el comentario de `setup-node` prometiendo versión exacta:
 * afirma una garantía donde alguien iría a verificarla.
 *
 * **Lo vigente:** la lógica vive en `aliasesLib.mjs` —importable, sin
 * dispatcher— y `verificar-aliases.mjs` es sólo el entrypoint, que nadie
 * importa. No hay guard de `main`: la estructura lo volvió innecesario.
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
 * ③ 🔴 **RETIRADA en el P101.** Acá había una tercera defensa que afirmaba que la
 *    superficie importable «sólo declara, ninguna invocación ni siquiera
 *    inofensiva». **Ese claim era falso sobre el objeto sano** —la lib evalúa
 *    `dirname`, `join`, `fileURLToPath` y `Object.freeze` en sus
 *    inicializadores— y sus dos implementaciones sucesivas fallaron en las dos
 *    direcciones. Lo que la reemplaza es el fixture ROTO de ①: con él, una
 *    llamada de sólo lectura **sí** deja rastro (`fallas > 0`), que era
 *    exactamente el hueco que la tercera defensa venía a tapar.
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
    /**
     * 🔴 P101 · EL FIXTURE ES ROTO A PROPÓSITO — es lo que hace visible el efecto.
     *
     * Con un `package.json` sano, `adjudicarAliases()` corre y **no deja nada**:
     * cero fallas, cero disco, cero procesos. Con los aliases rotos, cualquier
     * adjudicación que se ejecute deja `fallas.length > 0`, **sin importar en qué
     * forma sintáctica se la haya escrito.**
     */
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
      /**
       * 🔴 P101 · POR EJECUTABLE EXACTO, no por substring de la línea entera.
       *
       * Acá había `toMatch(new RegExp(herramienta))` sobre el registro completo,
       * y `/tsc/` matcheaba **el `tsconfig.json` del argumento de al lado**: el
       * flujo de `tsc` figuraba acreditado sin haberse invocado nunca. Vitest y
       * Playwright sí discriminaban, así que el defecto pasaba en dos de tres.
       *
       * El espía escribe una línea por invocación con sus argv; el ejecutable es
       * el PRIMER token de esa línea, y se compara por igualdad.
       */
      const invocados = registro
        .split('\n')
        .map((l) => l.trim().split(/\s+/)[0])
        .filter(Boolean);
      for (const herramienta of ['vitest', 'playwright', 'tsc']) {
        expect(
          invocados,
          `el fixture no invoca «${herramienta}»: el claim lo incluye sin acreditarlo ` +
            `(invocados: ${invocados.join(', ') || 'ninguno'})`,
        ).toContain(herramienta);
      }
    } finally {
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  /**
   * 🔴 P101 · EL ORÁCULO PRIMARIO ES CONDUCTUAL — y por qué se invirtió.
   *
   * Cuatro criterios de esta serie fueron **enumeraciones que fallan**, cada una más
   * fina y todas rotas por la misma razón: describen la FORMA de lo prohibido.
   *
   * ```
   * P97   prefijos de comando        → cayó con `void`
   * P99   líneas por regex           → cayó con `await` y el operador coma
   * P100  categorías de nodo (AST)   → cayó con `static {}` y `new f()`
   * P100  nombres en una allowlist   → cayó con un homónimo `join`
   * ```
   *
   * **El terreno que no hereda enumeración es la ejecución observada.** Un efecto
   * es un efecto se escriba como se escriba: `void f()`, `await f()`, `new f()` y
   * un `static {}` dejan **exactamente el mismo rastro**, y por eso este caso los
   * caza a los cuatro sin nombrar ninguno.
   *
   * ## Los tres sensores, y por qué cubren el espacio
   *
   * Toda función de la lib hace una de tres cosas observables:
   *
   * ```
   * adjudicar / acreditar  →  empuja a `fallas`     ← sensor ①
   * invalidar              →  BORRA del disco       ← sensor ②
   * listar poblaciones     →  lanza `npx`           ← sensor ③
   * ```
   *
   * 🔴 P103 · ALCANCE DECLARADO — LO QUE ESTE OBSERVER PUEDE Y NO PUEDE.
   *
   * **Puede:** detectar que una función exportada se ejecutó al importar, cuando
   * esa ejecución deja uno de tres rastros —fallas acumuladas, borrado en disco,
   * o un proceso lanzado por `npx`—.
   *
   * 🔴 **NO puede, y está medido:** ver una ejecución que el propio módulo
   * **capture, compense o limpie**. Los tres bypasses conocidos:
   *
   * ```
   * (adjudicarAliases(), fallas.length = 0)            limpia el contador
   * try { adjudicarAliases(); } catch {} fallas.length = 0   traga la excepción
   * acreditarCorrida(); fallas.length = 0              no parsea, no borra, no lanza
   * ```
   *
   * **La razón es estructural y vale la pena escribirla entera:** el observer y
   * el código auditado **corren en el mismo proceso**, así que toda señal que el
   * observer lee es alcanzable por el código que vigila. Un `catch` traga la
   * excepción; un `length = 0` limpia el contador. **No hay sensor in-process que
   * cierre esto** — la salida sería instrumentar desde afuera (un preload que
   * envuelva `fs`/`child_process` y escriba a un canal que el módulo no conoce).
   *
   * ⚠️ **Ese camino está identificado y NO implementado, por proporción:** el
   * arnés ya excede el riesgo que cubre —veinte vueltas, cero defectos en el
   * objeto— y este límite requiere que alguien **escriba** el bypass a propósito,
   * no que se le escape. **Un límite declarado es honesto; uno tácito se lee como
   * resuelto.**
   *
   * 🔴 **Y el claim se acota a lo que el observer deriva de verdad:** cubre las
   * funciones exportadas **que dejan uno de los tres rastros**. `fallasDeAliases`,
   * `faltantesDeColeccion` y `fuentesSinProyecto` son exports **puros** —calculan
   * y devuelven, sin tocar nada— y por construcción **ningún sensor los ve**. No
   * es un hueco del observer: es que no hay efecto que observar.
   */
  it('🔴 IMPORTADO · cero EFECTOS · el oráculo que no enumera formas', () => {
    const { marca, env } = montarEspia();
    const raiz = dirname(marca);
    try {
      const reporte = join(raiz, '.vitest-corrida.json');
      const dist = join(raiz, 'dist');
      writeFileSync(reporte, '{"testResults":[]}');
      mkdirSync(dist, { recursive: true });
      expect(existsSync(reporte) && existsSync(dist), 'el escenario no se plantó').toBe(true);

      const r = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import(${JSON.stringify(pathToFileURL(LIB).href)})` +
            `.then((m) => console.log('FALLAS=' + m.fallas.length));`,
        ],
        { env, encoding: 'utf8' },
      );

      // ① nadie adjudicó: sobre un fixture ROTO, ejecutar deja fallas
      expect(
        `${r.stdout}`.trim(),
        'importar la lib EJECUTÓ una adjudicación: el fixture roto la delató',
      ).toBe('FALLAS=0');
      // ② nadie invalidó
      expect(existsSync(reporte), 'importar la lib BORRÓ el reporte de la corrida').toBe(true);
      expect(existsSync(dist), 'importar la lib BORRÓ el artefacto del build').toBe(true);
      // ③ nadie lanzó herramientas
      expect(invocaciones(marca), 'importar la lib EJECUTÓ herramientas del CLI').toBe('');
    } finally {
      rmSync(raiz, { recursive: true, force: true });
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
 * 🔴 P101 · POR QUÉ SE RETIRÓ EL CRITERIO POR AST — falla en LAS DOS direcciones.
 *
 * Acá vivía un reconocedor que parseaba la lib y adjudicaba sus llamadas contra
 * una allowlist. Era más fino que el regex al que reemplazó, y aun así:
 *
 * ```
 * SUB-aproxima   class __X { static { adjudicarAliases(); } }  12/12 verde · fallas 0→7
 *                new adjudicarAliases();                       12/12 verde · fallas 0→7
 * SOBRE-aproxima const o = { get v() { adjudicarAliases(); } }  1 f / 11  · fallas = 0
 * ```
 *
 * Lo primero era un hueco; **lo segundo es peor**: un rojo sobre código que no
 * ejecuta nada. Una guarda que se pone roja sin defecto es una guarda que alguien
 * termina apagando, y con ella se va la que sí servía.
 *
 * Y su allowlist comparaba **spelling**: un `join` homónimo que delegaba heredó
 * el permiso del `join` legítimo. Comparar nombres no es comparar bindings.
 *
 * 📌 **La serie entera fue enumerar la FORMA de lo prohibido, cada vez más fino:**
 * prefijos → líneas → categorías de nodo → nombres. Las cuatro cayeron, y la
 * última además empezó a dar falsos rojos. **La ejecución observada no hereda esa
 * clase de error**, y por eso quedó como único oráculo: un efecto es un efecto se
 * escriba como se escriba.
 *
 * ⚠️ **Lo que se pierde, declarado:** ya no hay diagnóstico estático que diga EN
 * QUÉ LÍNEA está la llamada intrusa. El conductual dice **que** algo se ejecutó,
 * no dónde. Es un peor mensaje de error a cambio de una garantía real — y el
 * sensor que se pone rojo ya acota dónde buscar.
 */

/**
 * 🔴 P101 · LAS FORMAS QUE ATRAVESARON A CADA CRITERIO, VERSIONADAS.
 *
 * Cada una rompió el reconocedor de su vuelta. Se plantan sobre una **copia** de
 * la lib —el archivo real no se toca— y se importa esa copia: si el oráculo
 * conductual volviera a depender de la forma, estos casos lo dirían.
 *
 * El getter va como **control NEGATIVO** y es la mitad que más importa: su cuerpo
 * **no se ejecuta** al importar, así que ponerlo rojo sería un falso positivo. El
 * criterio por AST lo marcaba, y una guarda que se pone roja sin defecto es una
 * guarda que alguien termina apagando.
 */
describe('🔴 el oráculo conductual no depende de la FORMA', () => {

  const EJECUTAN: ReadonlyArray<readonly [string, string]> = [
    ['static block · rompió al AST', 'class __X { static { adjudicarAliases(); } }'],
    ['new f() · rompió al AST', 'new adjudicarAliases();'],
    ['void · rompió al regex', 'void adjudicarAliases();'],
    ['await · rompió al regex', 'await adjudicarAliases();'],
    ['operador coma · rompió al regex', 'const __c = (adjudicarAliases(), 0);'],
    [
      'homónimo · rompió a la allowlist textual',
      "const __h = ((join) => join('x'))((s) => { adjudicarAliases(); return s; });",
    ],
  ];

  for (const [nombre, forma] of EJECUTAN) {
    it(`🔴 ${nombre} → el sensor lo ve`, () => {
      /**
       * 🔴 Ejecutar es `F !== 0`, por contador O por excepción. Con el fixture
       * inválido casi siempre es lo segundo, **y eso es lo bueno**: la excepción
       * no la puede limpiar el módulo, el contador sí.
       */
      expect(
        importarCon(forma).fallas,
        `«${nombre}» ejecutó al importar y ningún sensor lo registró`,
      ).not.toBe(0);
    });
  }

  /**
   * 🔴 P102 · EL MUTANTE QUE BORRA LA SEÑAL, y su rival sin reset.
   *
   * Éste es el que rompió la vuelta anterior: el código agregado **comparte
   * scope con el sensor** y lo limpia antes de que el observador lo lea. Con el
   * contador como única señal daba **14/14 verde** con el trabajo hecho.
   *
   * Va con su **rival desnudo** —la misma llamada sin el reset— porque los dos
   * juntos son los que prueban qué está midiendo el caso: si alguna vez sólo el
   * rival cayera, volveríamos a tener un sensor borrable sin enterarnos.
   */
  const CON_Y_SIN_RESET: ReadonlyArray<readonly [string, string]> = [
    ['rival desnudo · sin reset', 'adjudicarAliases();'],
    ['ejecuta Y BORRA la señal', 'const __p = (adjudicarAliases(), fallas.length = 0);'],
    ['ejecuta y vacía por asignación', 'adjudicarAliases(); fallas.splice(0);'],
  ];

  for (const [nombre, forma] of CON_Y_SIN_RESET) {
    it(`🔴 ${nombre} → el sensor NO se puede limpiar`, () => {
      expect(
        importarCon(forma).fallas,
        `«${nombre}» ejecutó y el observador no lo vio: la señal era borrable`,
      ).not.toBe(0);
    });
  }

  it('🔴 y una invalidación se ve en el DISCO, no en las fallas', () => {
    // El segundo sensor: `invalidar` no toca `fallas`, borra. Sin este caso, el
    // oráculo quedaría acreditado sólo para la mitad de los efectos posibles.
    expect(importarCon("invalidar('corrida');").borro, 'la invalidación no dejó rastro')
      .toBe(true);
  });

  it('✅ CONTROL NEGATIVO · un getter diferido NO se cuenta · su cuerpo no corre', () => {
    const r = importarCon('const __lazy = { get v() { adjudicarAliases(); return 1; } };');
    expect(r.fallas, 'un cuerpo diferido se contó como ejecutado: falso positivo').toBe(0);
    expect(r.borro, 'un cuerpo diferido borró algo: imposible').toBe(false);
  });

  /**
   * 🔴 P102 · LA DEUDA DEL ANEXO P101B, VERSIONADA — y con la corrección.
   *
   * El fail-closed «una lib que no importa pone ROJO, nunca verde» quedó
   * acreditado **por accidente** —una colisión de identificadores en una sonda
   * ajena— y **ningún caso lo afirmaba**. Se declaró como deuda antes del
   * dictamen; acá se cierra.
   *
   * ⚠️ **Y la receta que declaramos era inexacta**, lo midió Codex: el
   * fail-closed tiene **dos canales redundantes** —el `catch` del import y el
   * fallback del parser de `F=`—, así que **retirar sólo el `catch` NO lo
   * voltea**. La única mutación letal es cambiar el valor de fallo efectivo
   * (`-1 → 0`). Lo escribimos sin medir la matriz completa; queda corregido acá.
   */
  it('🔴 una lib que NO IMPORTA pone rojo, nunca verde', () => {
    // Sintácticamente inválida: no hay módulo que cargar. Si esto devolviera 0,
    // los controles negativos de abajo estarían certificando un archivo que ni
    // siquiera parsea.
    expect(importarCon('const = ;').fallas, 'una lib que no carga se leyó como sana')
      .toBe(-1);
  });

  it('✅ CONTROL NEGATIVO · la lib SIN agregados no dispara ningún sensor', () => {
    // Ancla el escenario al objeto sano: si esto fuera rojo, todos los casos de
    // arriba estarían pasando por una razón que no es la que dicen.
    const r = importarCon('');
    expect(r.fallas, 'la lib sana ejecuta algo al importarse').toBe(0);
    expect(r.borro).toBe(false);
  });
});

/**
 * 🔴 P103 · LOS LÍMITES CONOCIDOS DEL OBSERVER, VERSIONADOS COMO TALES.
 *
 * Estos casos **no afirman que el arnés detecte los bypasses: afirman que NO los
 * detecta**, y por eso son tests y no un comentario. Un límite escrito en prosa
 * se lee y se olvida; uno versionado **se pone rojo el día que alguien lo cierre**
 * —y ahí hay que venir a borrar el caso, que es exactamente la conversación que
 * se quiere forzar—.
 *
 * ⚠️ **Es un test que documenta una debilidad, y eso incomoda a propósito.** La
 * alternativa —dejarlos sin registrar— es la que produce que en tres semanas
 * alguien lea el certificado y crea que cubre lo que no cubre.
 *
 * Cada uno va con su **control opuesto**: la misma llamada SIN el mecanismo que
 * la esconde, que sí se detecta. Los dos juntos dicen qué está midiendo el caso.
 */
describe('🔴 lo que el observer NO ve · límites medidos, no supuestos', () => {
  const LIMITES: ReadonlyArray<readonly [string, string, string]> = [
    [
      'un `catch` traga la excepción del fixture',
      'try { adjudicarAliases(); } catch {} fallas.length = 0;',
      'adjudicarAliases();',
    ],
    [
      'una ejecución sin rastro observable',
      'acreditarCorrida(); fallas.length = 0;',
      'acreditarCorrida();',
    ],
  ];

  for (const [nombre, escondido, visible] of LIMITES) {
    it(`⚠️ LÍMITE · ${nombre} — el observer NO lo ve`, () => {
      // Si esto se pone ROJO, el límite se cerró: hay que borrar el caso y
      // actualizar el alcance declarado del docblock. Es la señal de que el
      // certificado puede afirmar más de lo que afirmaba.
      expect(
        importarCon(escondido).fallas,
        'el límite se cerró: actualizá el alcance declarado y retirá este caso',
      ).toBe(0);
    });

    it(`✅ CONTROL OPUESTO · «${nombre}» sin su mecanismo SÍ se ve`, () => {
      // Sin esto, el caso de arriba pasaría igual con un observer que no mira
      // nada: «no lo detecta» y «no detecta nada» son indistinguibles.
      expect(
        importarCon(visible).fallas,
        'el control opuesto tampoco se detecta: el observer no está midiendo',
      ).not.toBe(0);
    });
  }
});
