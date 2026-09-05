import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
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
import ts from 'typescript';
import { fallasDeAliases } from './aliasesLib.mjs';

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
 * Se montan **tres sensores ortogonales** y cada uno mide una sola cosa: los
 * entrypoints locales invocados (①), los gestores de paquetes alcanzados por el
 * `PATH` (②) y los procesos creados **por los siete exports instrumentados de
 * `node:child_process`** (③). Ese tercero observa una población enumerada, no el
 * universo de procesos: el alcance exacto está declarado en su docblock.
 * Ninguno habla por los otros — tratarlos como equivalentes fue el falso oráculo
 * de `0.161.6`. Con eso:
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
 * ② **efecto observable** — importar la lib no invoca herramientas locales (①),
 *    no alcanza gestores por el `PATH` (②), no crea procesos **por los siete
 *    exports instrumentados** (③), y **no borra el reporte ni el artefacto** (los
 *    dos sinks de disco que Codex midió verdes, y que el workflow usa). Cada
 *    ausencia va con el sensor que la acredita: en el camino local ② queda vacío
 *    por construcción, así que atribuirle a ①②③ un mismo efecto sería falso;
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
   * 🔴 **EL ESPÍA OBSERVA LOS ENTRYPOINTS, NO EL `PATH`. Y el cambio no es de
   * estilo: el observable viejo dejó de existir.**
   *
   * Hasta `0.161.4` el CLI resolvía sus herramientas por nombre y las ejecutaba
   * a través del `PATH`, así que un ejecutable de mentira al frente del `PATH`
   * era un espía correcto. Desde `0.161.5` el CLI **sólo** admite entrypoints
   * dentro del `node_modules` de la raíz verificada, invocados por ruta
   * absoluta con `process.execPath`: **no pasa por el `PATH` en ningún caso**.
   *
   * Un espía sobre el `PATH` no se volvió menos exacto — se volvió **ciego**, y
   * este archivo lo dijo solo al ponerse rojo: *«el espía no registró nada: el
   * escenario no está midiendo lo que dice»*. Ese rojo fue correcto y por eso el
   * arreglo no es adaptarlo para que calle, sino **mover el sensor a la única
   * superficie que el CLI toca hoy**.
   *
   * Cada entrypoint falso registra su `process.argv` COMPLETO, así que la marca
   * acredita las tres cosas a la vez: que se invocó, que se invocó con
   * `process.execPath`, y que el segundo argumento es la ruta ABSOLUTA del
   * entrypoint dentro de `node_modules` — no un nombre que el sistema pudiera
   * resolver en otro lado.
   *
   * ⚠️ **Cero red, cero instalación, cero gestor de paquetes.** Los entrypoints
   * son archivos que este mismo test escribe; no hay `npx` ni fallback posible.
   */
  function montarEntrypoints(raiz: string, marca: string): void {
    /** `.js` bajo `node_modules` se carga como CommonJS; `.mjs`, como ESM. */
    const registrar = (rel: string, salida: string, esm: boolean) => {
      const abs = join(raiz, 'node_modules', rel);
      mkdirSync(dirname(abs), { recursive: true });
      const req = esm
        ? "import { appendFileSync } from 'node:fs';"
        : "const { appendFileSync } = require('node:fs');";
      writeFileSync(
        abs,
        `${req}\n`
          + `appendFileSync(${JSON.stringify(marca)}, JSON.stringify(process.argv) + '\\n');\n`
          + `process.stdout.write(${JSON.stringify(salida)});\n`,
      );
    };
    // Salidas mínimas y plausibles: el objetivo es que el CLI recorra los TRES
    // caminos, no fingir un resultado verde que nadie midió.
    registrar(join('typescript', 'bin', 'tsc'), `${join(raiz, 'src', 'sonda.test.ts')}\n`, false);
    registrar(join('vitest', 'vitest.mjs'), `${join(raiz, 'src', 'sonda.test.ts')}\n`, true);
    registrar(
      join('@playwright', 'test', 'cli.js'),
      JSON.stringify({ config: { rootDir: join(raiz, 'e2e') }, suites: [{ file: 'sonda.spec.ts' }] }),
      false,
    );
  }

  /**
   * 🔴 **TRES SENSORES ORTOGONALES, y ninguno habla por los otros.**
   *
   * El candidato anterior tenía UNO —los entrypoints locales— y con él afirmó
   * tres cosas distintas. Codex lo tumbó con el contraejemplo exacto: agregó una
   * llamada **ADITIVA** a `npx` dentro de `entrypointLocal`, conservando la
   * invocación local. Los entrypoints quedaron registrados, el test siguió
   * verde, y el gestor corrió seis veces. **«Marca de entrypoints vacía» nunca
   * significó «cero gestores» ni «cero procesos».**
   *
   * Lo que cada sensor mide, y **sólo** eso:
   *
   * ```
   * ① entrypoints  argv de los tres entrypoints locales    ⇒ «se invocó la herramienta local»
   * ② gestores     npx/npm/yarn/pnpm/corepack en el PATH   ⇒ «se buscó afuera»
   * ③ procesos     los 7 exports envueltos de child_process ⇒ «se creó uno de esos procesos»
   * ```
   *
   * 🔴 **ALCANCE EXACTO DE ③, porque decir «todo proceso» era otra
   * sobredeclaración.** El preload envuelve una **población enumerada de siete
   * exports** de `node:child_process`:
   *
   * ```
   * execFileSync · spawnSync · execSync · exec · execFile · spawn · fork
   * ```
   *
   * **Qué cubre eso, medido:** `aliasesLib.mjs` usa hoy únicamente `execFileSync`
   * —import en su cabecera y tres call sites, para TypeScript, Vitest y
   * Playwright—, y las campañas versionadas de este archivo usan `execFileSync`
   * y `spawnSync`. O sea que la población instrumentada **cubre las puertas que
   * el objeto auditado y las campañas ejercitan hoy**.
   *
   * ⚠️ **Y qué NO cubre, sin extrapolar:** `ChildProcess.prototype.spawn` como
   * superficie independiente, las APIs internas de Node y cualquier API futura.
   * Una enumeración de siete métodos **no acredita un universo**, y un hijo
   * creado por una puerta que no está en esa lista no dejaría rastro en ③.
   *
   * 📌 **Genealogía del error, medida commit por commit** —porque documentar de
   * memoria es cómo se propaga—:
   *
   * ```
   * 85b21d5d   «TODO hijo» 0 · «de ninguna forma» 0 · «de la forma que sea» 0
   * 8e83ff53   «TODO hijo» 1 · «de ninguna forma» 2 · «de la forma que sea» 0
   * faf219e3   «TODO hijo» 1 · «de ninguna forma» 2 · «de la forma que sea» 1
   * ```
   *
   * Las tres primeras nacieron con los sensores, en `8e83ff53`. La cuarta se
   * agregó en `faf219e3` — **el commit que venía a corregir sobredeclaraciones**.
   *
   * ③ es el único de los tres que puede hablar de procesos, y lo hace **sobre esa
   * población**: parchea `child_process`
   * mediante `--require`, que corre **antes** que el módulo principal, así que la
   * vista queda tomada antes de que cualquier `import` ESM fije su binding.
   * Verificado con una sonda propia antes de usarlo — un sensor que no se prueba
   * es una suposición con nombre técnico.
   *
   * ⚠️ Los shims de ② son **inertes**: registran y salen ≠0. No ejecutan el
   * gestor real, no instalan y no abren red. Y están al frente del `PATH` a
   * propósito: si el CLI vuelve a resolver por ahí, el sensor lo ve en vez de
   * que la llamada se vaya a la red de verdad.
   */
  const GESTORES = ['npx', 'npm', 'yarn', 'pnpm', 'corepack'] as const;

  const marcasDe = (raiz: string) => ({
    entrypoints: join(raiz, 'invocaciones.txt'),
    gestores: join(raiz, 'gestores.txt'),
    procesos: join(raiz, 'procesos.txt'),
  });

  /**
   * 🔴 **EL SENSOR ③ NO PUEDE CAMBIAR EL OBJETO QUE AUDITA, y en `0.161.7` lo
   * cambiaba.**
   *
   * `aliasesLib.mjs:194` tiene una guarda que denuncia `NODE_OPTIONS` definida,
   * porque un preload puede volver no-op a los gates. El sensor de procesos se
   * instalaba justamente con `NODE_OPTIONS=--require …`, así que **disparaba la
   * guarda que venía a auditar** —medido: «la variable NODE_OPTIONS está
   * definida y puede volver no-op a los gates»— y ningún caso afirmaba que ese
   * rojo no apareciera. El efecto observador, en su forma más literal.
   *
   * El aislamiento es que el preload **retira la variable después de parchear**:
   * el parche vive en el proceso, no en la variable, así que sacarla no lo
   * desarma y el programa auditado ve `NODE_OPTIONS === undefined`. Verificado
   * con una sonda mínima antes de construir sobre esto.
   *
   * `aislado: false` deja la variable puesta **a propósito**: es la sonda de
   * causalidad, y sirve para probar que el aislamiento es lo que evita el rojo y
   * no una casualidad del escenario.
   */
  function montarSensores(
    raiz: string,
    { aislado = true }: { aislado?: boolean } = {},
  ): { readonly env: NodeJS.ProcessEnv } {
    const m = marcasDe(raiz);
    for (const archivo of Object.values(m)) writeFileSync(archivo, '');

    const dirShim = join(raiz, 'shim');
    mkdirSync(dirShim, { recursive: true });
    for (const g of GESTORES) {
      const ruta = join(dirShim, g);
      writeFileSync(ruta, `#!/bin/sh\necho "${g} $*" >> ${JSON.stringify(m.gestores)}\nexit 1\n`);
      chmodSync(ruta, 0o755);
    }

    const censo = join(raiz, 'censo-procesos.cjs');
    writeFileSync(
      censo,
      "const cp = require('node:child_process');\n"
        + "const { appendFileSync } = require('node:fs');\n"
        + `const LOG = ${JSON.stringify(m.procesos)};\n`
        + "for (const nombre of ['execFileSync','spawnSync','execSync','exec','execFile','spawn','fork']) {\n"
        + "  const orig = cp[nombre];\n"
        + "  if (typeof orig !== 'function') continue;\n"
        + "  cp[nombre] = function (...args) {\n"
        + "    appendFileSync(LOG, nombre + ' ' + JSON.stringify(args[0]) + '\\n');\n"
        + "    return orig.apply(this, args);\n"
        + "  };\n"
        + "}\n"
        + (aislado
          ? "// Aislamiento: el parche ya está puesto; la variable se retira ANTES de que\n"
            + "// el módulo auditado evalúe sus guardas de entorno.\n"
            + "delete process.env.NODE_OPTIONS;\n"
          : "// SONDA DE CAUSALIDAD: sin este retiro, la guarda de aliasesLib denuncia\n"
            + "// NODE_OPTIONS y el instrumental contamina la medición.\n"),
    );

    return {
      env: {
        ...process.env,
        PATH: `${dirShim}:${process.env['PATH'] ?? ''}`,
        NODE_OPTIONS: `--require ${censo}`,
      },
    };
  }

  /** Lee un sensor. Devuelve '' cuando no registró nada. */
  const leer = (archivo: string): string =>
    existsSync(archivo) ? readFileSync(archivo, 'utf8').trim() : '';

  /** Los tres entrypoints que el CLI puede tocar, en el orden en que se afirman. */
  const ENTRYPOINTS_ESPERADOS: ReadonlyArray<readonly [string, string]> = [
    ['tsc', join('typescript', 'bin', 'tsc')],
    ['vitest', join('vitest', 'vitest.mjs')],
    ['playwright', join('@playwright', 'test', 'cli.js')],
  ];

  /**
   * `conEntrypoints: false` monta el MISMO árbol sin `node_modules`: es el
   * control rojo, y su valor está en ser idéntico salvo por esa ausencia.
   */
  function montarEspia(conEntrypoints = true, opciones: { aislado?: boolean } = {}): {
    readonly marca: string;
    readonly marcas: { entrypoints: string; gestores: string; procesos: string };
    readonly env: NodeJS.ProcessEnv;
    readonly raiz: string;
  } {
    const raiz = mkdtempSync(join(tmpdir(), 'payme-espia-'));
    const marca = join(raiz, 'invocaciones.txt');
    /**
     * 🔴 P101 · EL FIXTURE ES ROTO A PROPÓSITO — es lo que hace visible el efecto.
     *
     * Con un `package.json` sano, `adjudicarAliases()` corre y **no deja nada**:
     * cero fallas, cero disco y cero procesos **de los siete exports
     * instrumentados**. Con los aliases rotos, cualquier
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
     * y **nunca llega a invocar la herramienta**: los sensores no registran nada
     * y el caso target pasaría sobre un escenario que no ejercita el camino. El
     * control positivo se puso rojo primero, así que no se publicó una medición
     * hueca. (Cuando esto se escribió el camino terminaba en `npx`; hoy termina
     * en el entrypoint local, y la razón del fixture no cambió.)
     */
    mkdirSync(join(raiz, 'src'), { recursive: true });
    writeFileSync(join(raiz, 'src', 'sonda.test.ts'), 'export const a = 1;\n');
    /**
     * 🔴 P99 · Y el fixture ejercita LOS TRES flujos, no sólo Vitest.
     *
     * Medido: con el escenario mínimo sólo se registraba el listado de Vitest
     * —el gate cortaba antes de llegar a TypeScript y a Playwright—, así que el
     * claim «invoca sus tres herramientas» estaba acreditado en un tercio. Con
     * un `e2e/` poblado y un alias `typecheck` que nombre un proyecto, los tres
     * caminos se recorren de verdad.
     */
    mkdirSync(join(raiz, 'e2e'), { recursive: true });
    writeFileSync(join(raiz, 'e2e', 'sonda.spec.ts'), 'export const b = 1;\n');
    writeFileSync(join(raiz, 'tsconfig.json'), JSON.stringify({ include: ['src'] }));
    if (conEntrypoints) montarEntrypoints(raiz, marca);
    const { env } = montarSensores(raiz, opciones);
    return { marca, marcas: marcasDe(raiz), env: { ...env, PAYME_RAIZ_VERIFICACION: raiz }, raiz };
  }

  const invocaciones = (marca: string): string =>
    existsSync(marca) ? readFileSync(marca, 'utf8').trim() : '';

  it('✅ CONTROL POSITIVO · corrido como script, el CLI SÍ invoca sus herramientas', () => {
    // Sin esto, «cero invocaciones al importar» pasaría igual con un espía roto o
    // con un CLI que no llama a nada: «no ejecuta al importarse» y «no ejecuta
    // nunca» son indistinguibles, y el caso de abajo mediría en vacío.
    const { marca, marcas, env } = montarEspia();
    try {
      const r = spawnSync(process.execPath, [CLI, '--aliases'], { env, encoding: 'utf8' });
      /**
       * 🔴 **EL INSTRUMENTAL NO CONTAMINA AL AUDITADO, y se afirma acá.**
       *
       * `0.161.7` instalaba el sensor ③ con `NODE_OPTIONS` y con eso disparaba
       * la guarda de `aliasesLib` que denuncia esa variable. El rojo estaba en
       * la salida y ningún caso lo miraba. Ahora se mira: si el aislamiento del
       * preload se rompe, este `expect` cae, y la sonda de causalidad de más
       * abajo prueba que es el aislamiento —y no el escenario— lo que lo evita.
       */
      expect(
        `${r.stdout}${r.stderr}`,
        'el instrumental contaminó al auditado: apareció el diagnóstico de NODE_OPTIONS',
      ).not.toMatch(/NODE_OPTIONS/);
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
      /**
       * 🔴 Se afirma el `argv` COMPLETO de cada invocación, no el nombre del
       * comando. El defecto P101 de este mismo archivo fue comparar por
       * substring —`/tsc/` matcheaba el `tsconfig.json` del argumento de al
       * lado— y acá el riesgo es el mismo con otra ropa: un path que CONTENGA
       * «vitest» no acredita que se haya invocado el entrypoint de Vitest.
       *
       * `argv[0]` es el ejecutable y `argv[1]` el script: afirmarlos por
       * IGUALDAD prueba las tres cosas juntas —que se invocó, que fue con
       * `process.execPath`, y que el script es la ruta absoluta dentro de
       * `node_modules`—.
       */
      const raiz = dirname(marca);
      const argvs: string[][] = registro
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[]);

      for (const [herramienta, rel] of ENTRYPOINTS_ESPERADOS) {
        const esperado = join(raiz, 'node_modules', rel);
        const invocacion = argvs.find((a) => a[1] === esperado);
        expect(
          invocacion,
          `el fixture no invoca «${herramienta}» por su entrypoint local ` +
            `(esperaba argv[1] === ${esperado}; hubo ${argvs.length} invocación(es))`,
        ).toBeDefined();
        expect(
          invocacion![0],
          `«${herramienta}» no se invocó con process.execPath`,
        ).toBe(process.execPath);
      }

      /**
       * 🔴 Los otros dos sensores, afirmados por separado y con su propio
       * significado. Ninguno se deduce del primero: el contraejemplo de Codex
       * fue exactamente una llamada ADITIVA a `npx` que dejaba ① intacto.
       */
      expect(
        leer(marcas.gestores),
        'el CLI invocó un gestor de paquetes teniendo los entrypoints locales',
      ).toBe('');
      const procesos = leer(marcas.procesos).split('\n').filter(Boolean);
      expect(
        procesos.length,
        `se crearon ${procesos.length} procesos y sólo se esperaban los 3 entrypoints:\n${procesos.join('\n')}`,
      ).toBe(3);
      for (const linea of procesos) {
        expect(linea, `un proceso no salió por process.execPath: ${linea}`)
          .toContain(JSON.stringify(process.execPath));
      }
    } finally {
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **SONDA DE CAUSALIDAD · prueba que el aislamiento es la causa.**
   *
   * El caso de arriba afirma que el diagnóstico de `NODE_OPTIONS` **no** aparece.
   * Por sí sola, esa afirmación no distingue «el aislamiento funciona» de «el
   * escenario nunca lo habría disparado». Acá se corre el MISMO montaje con el
   * aislamiento retirado —el preload no borra la variable— y se exige que el
   * diagnóstico **sí** aparezca.
   *
   * Los dos juntos cierran la causalidad: con retiro no está, sin retiro está.
   * Es el control positivo del instrumento, no del código auditado — y es
   * exactamente lo que faltó en `0.161.7`, donde el rojo existía y nadie lo
   * miraba.
   */
  it('🔴 SONDA · sin el aislamiento del preload, la política SÍ denuncia NODE_OPTIONS', () => {
    const { marca, env } = montarEspia(true, { aislado: false });
    try {
      const r = spawnSync(process.execPath, [CLI, '--aliases'], { env, encoding: 'utf8' });
      expect(
        `${r.stdout}${r.stderr}`,
        'sin aislamiento la política NO denunció NODE_OPTIONS: la sonda no está midiendo lo que dice',
      ).toMatch(/la variable NODE_OPTIONS está definida/);
    } finally {
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **CONTROL ROJO · el complemento sin el cual el positivo no dice nada.**
   *
   * El árbol es el MISMO —mismo `package.json` roto, mismo `src/`, mismo `e2e/`,
   * mismo `tsconfig.json`— y la única diferencia es que no hay `node_modules`.
   * Esa igualdad es lo que hace que el contraste signifique algo: si cambiaran
   * dos cosas a la vez, el resultado no sería atribuible a la ausencia de los
   * entrypoints.
   *
   * Los dos juntos son lo que este archivo existe para distinguir: **«no ejecuta
   * al importarse» y «no ejecuta nunca» son indistinguibles con un solo lado.**
   *
   * ## Qué acredita cada aserción
   *
   * - sensor ① vacío ⇒ **no se invocó ningún entrypoint local**;
   * - sensor ② vacío ⇒ **no se alcanzó ningún gestor de paquetes**;
   * - sensor ③ vacío ⇒ **no se creó ningún proceso por los siete exports
   *   instrumentados** de `node:child_process`. **No es «ningún proceso» a
   *   secas:** el preload envuelve una población enumerada, no el universo — ver
   *   la nota de alcance del sensor ③.
   *   Las tres se afirman por separado: `0.161.6` decía la tercera midiendo sólo
   *   la primera, y ése fue el falso oráculo que Codex tumbó;
   * - las tres firmas ⇒ el diagnóstico es **estable y nombra la causa real**
   *   («no está instalado en node_modules»), no un accidente del intento;
   * - la ausencia de un error de módulo no encontrado ⇒ el CLI **ni siquiera
   *   intentó** invocar un entrypoint inexistente. Si lo intentara, Node
   *   fallaría con «Cannot find module» y ese texto llegaría a la salida por el
   *   `catch` del gate. Es la diferencia observable entre *fallar cerrado* y
   *   *fallar al chocarse*.
   */
  it('🔴 CONTROL ROJO · sin entrypoints locales: cero invocaciones y falla cerrada estable', () => {
    const { marca, marcas, env } = montarEspia(false);
    try {
      const r = spawnSync(process.execPath, [CLI, '--aliases'], { env, encoding: 'utf8' });
      const salida = `${r.stdout}${r.stderr}`;

      /**
       * 🔴 Las tres afirmaciones, **una por sensor**, y ninguna deducida de otra:
       * ① no se invocó ningún entrypoint local · ② no se buscó afuera · ③ no se
       * creó ningún proceso **por los siete exports instrumentados**. La versión
       * anterior decía ③ midiendo sólo ①, y ése fue el falso oráculo.
       */
      expect(leer(marcas.entrypoints), 'se invocó un entrypoint local').toBe('');
      expect(leer(marcas.gestores), 'se invocó un gestor de paquetes').toBe('');
      expect(leer(marcas.procesos), 'se creó al menos un proceso hijo').toBe('');
      expect(r.status, 'el gate no falló cerrado').not.toBe(0);
      for (const herramienta of ['TypeScript', 'Vitest', 'Playwright']) {
        expect(
          salida,
          `no nombró a «${herramienta}» como ausente: el diagnóstico no es estable`,
        ).toContain(`${herramienta} no está instalado en «node_modules»`);
      }
      expect(
        salida,
        'hubo un error de resolución de módulo: el CLI intentó invocar un entrypoint inexistente',
      ).not.toMatch(/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
    } finally {
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **CAMPAÑA MUTANTE AUTOMATIZADA · el contraejemplo de Codex, versionado.**
   *
   * El candidato anterior afirmó que su test mataba «el retorno a npx». No lo
   * mataba: aquel mutante **reemplazaba** la invocación local por `npx`, así que
   * lo que se ponía rojo era el sensor ① por ausencia de entrypoints — moría por
   * el motivo equivocado. Codex agregó una llamada **ADITIVA**, que conserva la
   * local, y el test siguió verde con el gestor corriendo seis veces.
   *
   * Este caso deja ese contraejemplo adentro de la suite, así que la próxima vez
   * no depende de que a alguien se le ocurra. Y afirma **las tres cosas que lo
   * vuelven concluyente**:
   *
   * 1. el sensor ① **no ve nada raro** —los entrypoints se invocan igual—, que
   *    es exactamente por qué el oráculo viejo era falso;
   * 2. el sensor ② **sí registra** el gestor: el camino mutado fue alcanzado, y
   *    el shim inerte lo prueba sin ejecutar nada real ni abrir red;
   * 3. el sensor ③ cuenta **más procesos que entrypoints**, que es la forma
   *    independiente de ver lo mismo.
   *
   * Se muta una COPIA en un temporal: `aliasesLib.mjs` está fuera de la allowlist
   * de esta orden y el árbol de trabajo no se toca. La copia es autosuficiente
   * porque el CLI sólo importa de la lib y la lib sólo importa builtins.
   */
  it('🔴 CAMPAÑA · una llamada ADITIVA a npx dentro de entrypointLocal la ven ② y ③, no ①', () => {
    const base = mkdtempSync(join(tmpdir(), 'payme-campana-'));
    const { marca, marcas, env } = montarEspia();
    try {
      copyFileSync(join(AQUI, 'aliasesLib.mjs'), join(base, 'aliasesLib.mjs'));
      copyFileSync(CLI, join(base, 'verificar-aliases.mjs'));

      const libCopia = join(base, 'aliasesLib.mjs');
      const original = readFileSync(libCopia, 'utf8');
      const ancla = '  const abs = join(RAIZ, \'node_modules\', rel);';
      expect(original, 'la copia no contiene el ancla a mutar').toContain(ancla);
      /**
       * La mutación es ADITIVA a propósito: conserva la resolución local y le
       * agrega la salida al gestor. Es el caso que el oráculo viejo no veía.
       */
      writeFileSync(
        libCopia,
        original.replace(
          ancla,
          `${ancla}\n  try { execFileSync('npx', ['--version'], { stdio: 'ignore' }); } catch { /* inerte */ }`,
        ),
      );

      const r = spawnSync(process.execPath, [join(base, 'verificar-aliases.mjs'), '--aliases'], {
        env,
        encoding: 'utf8',
      });
      expect(r.signal, 'el CLI mutado murió por señal').toBeNull();

      const entrypoints = leer(marcas.entrypoints).split('\n').filter(Boolean);
      const gestores = leer(marcas.gestores).split('\n').filter(Boolean);
      const procesos = leer(marcas.procesos).split('\n').filter(Boolean);

      expect(
        entrypoints.length,
        'el sensor ① dejó de ver los entrypoints: el mutante no es aditivo y no reproduce el caso',
      ).toBe(3);
      expect(
        gestores.length,
        'el sensor ② no registró ningún gestor: el camino mutado NO fue alcanzado',
      ).toBeGreaterThan(0);
      expect(gestores.every((l) => l.startsWith('npx ')), `②: ${gestores.join(' · ')}`).toBe(true);
      expect(
        procesos.length,
        'el sensor ③ no vio procesos de más: no es independiente de ①',
      ).toBeGreaterThan(entrypoints.length);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  /**
   * 🔴 **CAMPAÑA · UN HIJO SILENCIOSO AL IMPORTAR, que sólo ③ puede ver.**
   *
   * Las dos campañas anteriores mutan cosas que ① o ② alcanzan a registrar. Esta
   * introduce, **en el cuerpo del módulo** —o sea al importarlo, sin CLI de por
   * medio—, un proceso hijo que no es ninguno de los tres entrypoints ni ningún
   * gestor de paquetes. Es el caso que ningún sensor de `0.161.6` podía ver y que
   * ② tampoco ve: **la única red que lo atrapa es el censo de `child_process`.**
   *
   * Por eso las tres aserciones importan y ninguna sobra:
   *
   * ```
   * ① entrypoints   VACÍO   ← el hijo no es una herramienta conocida
   * ② gestores      VACÍO   ← ni pasa por el PATH
   * ③ procesos      ≠ VACÍO ← y aun así se creó: sólo este sensor lo sostiene
   * ```
   *
   * El binario elegido es `/bin/echo` con la salida descartada: inerte, local,
   * sin red y sin efectos. Lo que se prueba es **que se creó un proceso**, no qué
   * hizo.
   */
  it('🔴 CAMPAÑA · un hijo silencioso al importar muere SÓLO por el sensor de procesos', () => {
    const base = mkdtempSync(join(tmpdir(), 'payme-silencioso-'));
    const { marca, marcas, env } = montarEspia();
    try {
      const libCopia = join(base, 'aliasesLib.mjs');
      copyFileSync(LIB, libCopia);
      const original = readFileSync(libCopia, 'utf8');
      /**
       * La mutación va al final del módulo: se ejecuta con el `import`, que es
       * exactamente la conducta que este archivo existe para prohibir.
       */
      writeFileSync(
        libCopia,
        `${original}\n`
          + "import { spawnSync as __sp } from 'node:child_process';\n"
          + "__sp('/bin/echo', ['efecto-al-importar'], { stdio: 'ignore' });\n",
      );

      const r = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(libCopia).href)};`],
        { env, encoding: 'utf8' },
      );
      expect(r.signal, 'el import mutado murió por señal').toBeNull();

      expect(
        leer(marcas.entrypoints),
        '① registró algo: el mutante no es ajeno a los entrypoints y no reproduce el caso',
      ).toBe('');
      expect(
        leer(marcas.gestores),
        '② registró algo: el mutante pasó por el PATH y no reproduce el caso',
      ).toBe('');
      const procesos = leer(marcas.procesos);
      expect(
        procesos,
        '③ no vio el hijo silencioso: el camino mutado NO fue alcanzado o el censo no cubre esta forma',
      ).not.toBe('');
      expect(procesos, `③: ${procesos}`).toMatch(/\/bin\/echo/);
    } finally {
      rmSync(base, { recursive: true, force: true });
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
   * adjudicar / acreditar  →  empuja a `fallas`              ← observable A
   * invalidar              →  BORRA del disco                ← observable B
   * listar poblaciones     →  CREA UN PROCESO HIJO           ← observables ① y ③
   * cualquiera que LANCE   →  rechaza el import (F=-1)       ← observable D
   * ```
   *
   * ⚠️ **La tercera fila decía «lanza `npx`», y desde `0.161.5` eso es historia:**
   * la lib resuelve sus herramientas dentro de `node_modules` y las invoca con
   * `process.execPath`. Lo que se observa hoy es **la creación del proceso**, no
   * el nombre del ejecutable.
   *
   * 🔴 **Y la atribuye ① y ③, NO ②.** En la ruta sana el proceso es un entrypoint
   * local invocado con `process.execPath`: lo registra ① —por su `argv`— y lo
   * cuenta ③ —por el censo de `child_process`—. **② queda VACÍO**, porque sólo
   * registra gestores de paquetes alcanzados por el `PATH`, y esa ruta no pasa
   * por el `PATH`.
   *
   * Esto no es una interpretación: el **control positivo del camino sano** exige
   * ② vacío; por separado, la campaña aditiva ejecuta únicamente la copia mutada
   * y exige ② no vacío cuando esa copia agrega la salida a `npx`. Este párrafo
   * decía «los tres sensores» y con eso **contradecía a esas dos pruebas**, unas
   * líneas más arriba.
   *
   * 🔴 P103 · ALCANCE DECLARADO — LO QUE ESTE OBSERVER PUEDE Y NO PUEDE.
   *
   * **Puede:** detectar que una función exportada se ejecutó al importar, cuando
   * esa ejecución deja uno de tres rastros —fallas acumuladas, borrado en disco,
   * o **la creación de un proceso por alguno de los siete exports instrumentados
   * de `node:child_process`**: ese censo no depende del ejecutable ni del `PATH`,
   * pero **sí depende de la puerta usada**, y la población está enumerada—.
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
   * excepción; un `length = 0` limpia el contador. **Ningún sensor in-process
   * cierra esto** — la salida es instrumentar desde afuera, con un preload que
   * envuelva el módulo y escriba a un canal que el auditado no conoce.
   *
   * 🔴 **Y ese camino ya NO está sin implementar del todo: la mitad existe.**
   * `montarSensores()` instala un preload externo sobre **`child_process`** —el
   * sensor ③— que escribe a un archivo cuyo path el módulo auditado no recibe.
   * Fue la corrección de `0.161.8`, y es la razón por la que un hijo silencioso
   * creado al importar queda capturado aunque el módulo no imprima nada.
   *
   * ⚠️ **Lo que sigue SIN implementar es la instrumentación externa de `fs`**, y
   * por eso los bypasses que **compensan o limpian sin pasar por los siete
   * exports instrumentados**
   * —tragar una excepción, vaciar el contador, reescribir lo que borró— siguen
   * fuera del alcance de este observer. Se declaran, no se cierran.
   *
   * 📌 La distinción importa y por eso va escrita: **«ahora vemos procesos» no es
   * «ahora vemos todo».** Un límite declarado es honesto; uno tácito se lee como
   * resuelto, y una versión anterior de este párrafo decía que el preload externo
   * no estaba implementado cuando ya lo estaba — el error simétrico.
   *
   * 🔴 **Y el claim se acota a lo que el observer deriva de verdad:** cubre las
   * funciones exportadas **que dejan uno de los tres rastros**. `fallasDeAliases`,
   * `faltantesDeColeccion` y `fuentesSinProyecto` son exports **puros** —calculan
   * y devuelven, sin tocar nada— y por construcción **ningún sensor los ve**. No
   * es un hueco del observer: es que no hay efecto que observar.
   */
  it('🔴 IMPORTADO · cero EFECTOS · el oráculo que no enumera formas', () => {
    const { marca, marcas, env } = montarEspia();
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
      /**
       * ③ ningún canal instrumentado registró efectos — y se afirma **sensor por
       * sensor**. Esto no demuestra ausencia universal de ejecución: acredita
       * únicamente que no hubo entrypoints locales, gestores por `PATH` ni
       * procesos a través de los siete exports censados. `0.161.7` montaba los
       * tres y leía sólo el primero mientras el docblock decía que los tres
       * quedaban acreditados: la misma operación de medir un subconjunto y
       * afirmar el total.
       */
      expect(leer(marcas.entrypoints), 'importar la lib invocó un entrypoint local').toBe('');
      expect(leer(marcas.gestores), 'importar la lib alcanzó un gestor de paquetes').toBe('');
      expect(leer(marcas.procesos), 'importar la lib creó un proceso hijo').toBe('');
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('🔴 IMPORTADO · cero invocaciones del CLI, no sólo cero salida', () => {
    const { marca, marcas, env } = montarEspia();
    try {
      const r = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(LIB).href)};`],
        { env, encoding: 'utf8' },
      );
      // 🔴 LA AFIRMACIÓN NUEVA: el EFECTO, no la salida. Un `adjudicarPoblacion()`
      // silencioso en la rama importada deja esto ≠ '' aunque no imprima nada.
      expect(
        leer(marcas.entrypoints),
        'importar el módulo invocó un entrypoint local: silencio no es inacción',
      ).toBe('');
      expect(
        leer(marcas.gestores),
        'importar el módulo alcanzó un gestor de paquetes',
      ).toBe('');
      /**
       * 🔴 Ésta es la que ningún sensor anterior podía sostener: **cero procesos
       * creados por los siete exports instrumentados**, no sólo cero entrypoints
       * conocidos. Un hijo silencioso y ajeno a las dos primeras marcas queda
       * registrado acá **si nace por una de esas siete puertas** — que son las
       * que usan hoy la lib y las campañas.
       */
      expect(
        leer(marcas.procesos),
        'importar el módulo creó un proceso hijo',
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
 * 🔴 P104 · LOS LÍMITES, REFORMULADOS COMO INDISTINGUIBILIDAD.
 *
 * La versión anterior afirmaba «el observer NO ve esto que ejecuta» con un
 * `toBe(0)`, y Codex mostró que **no era causal**: retirar el callee del snippet
 * escondido deja **22/22**, porque `F=0` es también lo que da un snippet vacío.
 * El caso no distinguía «ejecutó y se escondió» de «no ejecutó nada» — que es,
 * literalmente, lo mismo que no distingue el observer.
 *
 * 🔴 **Así que el límite se dice como lo que es: una INDISTINGUIBILIDAD.** Se
 * comparan las dos lecturas y se afirma que **coinciden**. Eso sí es causal: el
 * día que el observer aprenda a separarlas, dejan de coincidir y el caso cae.
 *
 * ⚠️ **Lo que este caso NO prueba, y se declara:** que el snippet escondido
 * ejecute. Probarlo exige una señal fuera del proceso, que es justo lo que no
 * hay. Codex lo verificó por su lado con trazas externas —hoy ejecutan— y **esa
 * evidencia es suya, no de este archivo**. Acá se afirma la propiedad
 * verificable: el observer no las separa.
 *
 * 📌 Y la lección de la vuelta, que vale más que el caso: **una acotación sin
 * medir sus bordes es el overclaim con mejor prosa.** Acotar era la salida
 * correcta, pero la frontera acotada es una afirmación más y necesita la misma
 * evidencia que el claim ancho.
 */
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
  /** [nombre, forma escondida, forma visible, la escondida SIN su callee] */
  const LIMITES: ReadonlyArray<readonly [string, string, string, string]> = [
    [
      'un `catch` traga la excepción del fixture',
      'try { adjudicarAliases(); } catch {} fallas.length = 0;',
      'adjudicarAliases();',
      'try { } catch {} fallas.length = 0;',
    ],
    [
      'una ejecución sin rastro observable',
      'acreditarCorrida(); fallas.length = 0;',
      'acreditarCorrida();',
      'fallas.length = 0;',
    ],
  ];

  for (const [nombre, escondido, visible, sinCallee] of LIMITES) {
    it(`⚠️ LÍMITE · ${nombre} — indistinguible de no ejecutar`, () => {
      // Si esto se pone ROJO, el límite se cerró: hay que borrar el caso y
      // actualizar el alcance declarado del docblock.
      expect(
        importarCon(escondido),
        'el límite se cerró: el observer ya separa «ejecutó y se escondió» de ' +
          '«no ejecutó» — actualizá el alcance y retirá este caso',
      ).toEqual(importarCon(sinCallee));
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

/**
 * 🔴 P104 · «PURO» CON CALLBACK ES PUREZA CONDICIONAL — y la condición se versiona.
 *
 * El alcance declarado excluía tres exports por ser puros: «calculan y devuelven,
 * sin tocar nada». **Para `fallasDeAliases` eso era falso sin una precondición**:
 * recibe `existeConfig` y **lo invoca** (`aliasesLib.mjs:136-139`), así que hace
 * exactamente lo que su callback haga. Codex lo midió plantando una llamada
 * top-level cuyo callback borraba una marca privada: **22/22 con los tres
 * sensores en cero y el efecto real ocurrido.**
 *
 * 🔴 **La exclusión no era incorrecta: estaba incompleta.** «Es pura» y «es pura
 * si sus callbacks lo son» son afirmaciones distintas, y la segunda **necesita
 * que alguien verifique el callsite**. Acá se fija esa precondición.
 */
describe('🔴 la pureza de un export con callback es CONDICIONAL', () => {
  it('🔴 el callback SE INVOCA · un efecto adentro ocurre de verdad', () => {
    // Sin esto, «`fallasDeAliases` es pura» se lee como incondicional, y el
    // alcance declarado excluye del observer una función que puede hacer
    // cualquier cosa que su callsite le pase.
    let invocado = 0;
    fallasDeAliases({ test: 'x' }, () => { invocado++; return false; }, {});
    expect(invocado, 'el callback no se invocó: la precondición no aplica y hay que revisarla')
      .toBeGreaterThan(0);
  });

  it('🔴 y el ÚNICO callsite productivo le pasa un predicado sin efectos', () => {
    /**
     * La precondición que sostiene la exclusión, verificada donde vive: el
     * entrypoint le pasa `(archivo) => existsSync(...)`, que **lee y devuelve**.
     * Si alguien le pasara algo que escribe o borra, este caso se pone rojo y
     * hay que decidir —no descubrirlo tres semanas después—.
     */
    /**
     * 🔴 P105 · SE LEE CON EL PARSER, NO CON UN REGEX — y acá estuvo el defecto.
     *
     * Esto usaba `/fallasDeAliases\(([\s\S]{0,200}?)\)/`, y Codex midió que
     * **no era causal**: capturaba la DECLARACIÓN de la función como si fuera un
     * callsite, y en la invocación real **cortaba en el `)` de `(archivo`** —
     * antes de la flecha—. **Nunca miró el callback que decía verificar.**
     * Sobrevivía quitando la invocación productiva y con un callback effectful.
     *
     * ⚠️ **Y lo escribí en la misma vuelta en que retiré el AST por lexical.**
     * Descartar un enfoque no lo saca de la cabeza: lo saca del archivo.
     *
     * 📌 **El matiz que casi me hace evitar la herramienta correcta:** el AST se
     * retiró como ORÁCULO de «¿esto ejecuta?» —pregunta semántica que no puede
     * decidir, sub y sobre-aproximaba—. **Como PARSER para leer qué argumento
     * recibe una llamada es exacto**, que es justo lo que hace falta acá.
     * Retirar una herramienta de una pregunta no la retira de todas.
     */
    const sf = ts.createSourceFile('lib.mjs', readFileSync(LIB, 'utf8'), ts.ScriptTarget.ESNext, true);
    const callbacks: string[] = [];
    const visitar = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === 'fallasDeAliases'
      ) {
        // El segundo argumento es `existeConfig`, el que la función invoca.
        const cb = n.arguments[1];
        callbacks.push(cb ? cb.getText() : '(sin segundo argumento)');
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    expect(callbacks.length, 'no se encontró ningún callsite: el caso mediría en vacío')
      .toBeGreaterThan(0);
    for (const cb of callbacks) {
      expect(
        cb,
        `un callsite de \`fallasDeAliases\` pasa un callback con efectos: ${cb.replace(/\s+/g, ' ').slice(0, 80)}`,
      ).not.toMatch(/writeFileSync|rmSync|execFileSync|spawnSync|appendFileSync/);
    }
  });
});
