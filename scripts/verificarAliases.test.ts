import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fallasDeAliases,
  faltantesDeColeccion,
  fuentesSinProyecto,
  ES_TEST,
  ES_FUENTE_TS,
} from './aliasesLib.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

/**
 * 🔴 P88 · LAS REGRESIONES DEL «ALIAS vs HERRAMIENTA».
 *
 * Codex mostró que el arnés adjudicaba el TEXTO de los comandos del workflow sin
 * ligarlos con lo que esos comandos ejecutan. Tres falsos verdes reproducidos:
 * `scripts.test: "true"` (npm test sale 0 sin Vitest), excluir `scripts/**` de la
 * config (verde recolectando 84 archivos en vez de 96) y aliases no-op de
 * typecheck/build.
 *
 * Acá viven las formas versionadas. **La lógica que corre el gate es la misma que
 * corre este archivo** —`fallasDeAliases` y `faltantesDeColeccion` se importan
 * del propio ejecutable, no se reimplementan—, que es la lección del P85 aplicada
 * de entrada: un test que probara una copia no acreditaría el gate.
 */
describe('🔴 el alias ejecuta su herramienta', () => {
  const SANOS = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).scripts;
  const sinConfig = (): boolean => false;

  it('✅ CONTROL POSITIVO · los scripts REALES del repo pasan', () => {
    // Sin esto, cualquier `toEqual([])` de abajo podría estar pasando porque la
    // función no mira nada. Y ata la allowlist al `package.json` vivo: si alguien
    // cambia un alias sin venir acá, este caso —no otro— se pone rojo.
    expect(fallasDeAliases(SANOS, sinConfig, {})).toEqual([]);
  });

  const MUTANTES: ReadonlyArray<readonly [string, Record<string, string>]> = [
    ['test no-op (`true`)', { test: 'true' }],
    ['test apuntado a otro runner', { test: 'jest' }],
    ['typecheck sin tsc', { typecheck: 'echo ok' }],
    ['build sin vite', { build: 'true' }],
    ['build:landing sin su config', { 'build:landing': 'vite build' }],
  ];

  for (const [nombre, parche] of MUTANTES) {
    it(`🔴 ${nombre} → RECHAZADO`, () => {
      const fallas = fallasDeAliases({ ...SANOS, ...parche }, sinConfig, {});
      expect(fallas.join(' · '), `el gate no rechazó «${nombre}»`)
        .toMatch(new RegExp(Object.keys(parche)[0]!.replace(':', ':')));
    });
  }

  /**
   * 🔴 P90 · LOS HOOKS DE CICLO DE VIDA · el TOCTOU.
   *
   * npm los corre **entre la aprobación del gate y la herramienta**: un
   * `pretest` que recorta la config deja `npm test` en 0 con 84 archivos y 1084
   * tests, sin los 13 de `scripts/`; un `prebuild` con `build.write=false`
   * transforma 110 módulos, sale 0 y no escribe nada.
   *
   * No se cierran enumerando `pre*`/`post*` —eso sería la denylist que costó
   * ocho vueltas abandonar— sino **declarando el conjunto entero de scripts**.
   */
  const HOOKS: readonly string[] = ['pretest', 'pretypecheck', 'prebuild', 'postbuild', 'prepare'];
  for (const hook of HOOKS) {
    it(`🔴 el hook «${hook}» → RECHAZADO por no estar en el conjunto`, () => {
      expect(
        fallasDeAliases({ ...SANOS, [hook]: 'node recortar-config.js' }, sinConfig, {}).join(' · '),
        `un ${hook} puede cambiar lo que la herramienta ve DESPUÉS de este gate`,
      ).toMatch(new RegExp(hook));
    });
  }

  it('🔴 cualquier script NO adjudicado es rojo, sin nombrarlo', () => {
    // La forma positiva: no hace falta anticipar el nombre. Lo que cierra la
    // clase es que el conjunto sea exacto, no que la lista de malos sea larga.
    expect(fallasDeAliases({ ...SANOS, cualquiera: 'true' }, sinConfig, {}).join(' · '))
      .toMatch(/cualquiera/);
  });

  it('🔴 un alias AUSENTE es tan rojo como uno cambiado', () => {
    const { test: _, ...sinTest } = SANOS;
    expect(fallasDeAliases(sinTest, sinConfig, {}).join(' · ')).toMatch(/ausente/);
  });

  it('🔴 `.npmrc` versionado → RECHAZADO · cambia el ejecutor de TODO script npm', () => {
    // La frontera del P88 · condición 3, decidida acá: se rechaza el archivo
    // entero en vez de enumerar sus claves malas.
    const fallas = fallasDeAliases(SANOS, (f: string) => f === '.npmrc', {});
    expect(fallas.join(' · ')).toMatch(/\.npmrc/);
  });

  const VARIABLES = ['npm_config_script_shell', 'NODE_OPTIONS', 'BASH_ENV'] as const;
  for (const v of VARIABLES) {
    it(`🔴 ${v} en el entorno → RECHAZADO`, () => {
      // Mismo vector que el arnés YAML cierra del lado del workflow, cerrado
      // también del lado del ejecutor: una variable así no deja rastro en el repo.
      expect(fallasDeAliases(SANOS, sinConfig, { [v]: '/usr/bin/true' }).join(' · '))
        .toMatch(new RegExp(v));
    });
  }
});

describe('🔴 la colección REAL cubre la población en disco', () => {
  it('✅ CONTROL POSITIVO · si el runner recolecta todo, no hay falta', () => {
    expect(faltantesDeColeccion(['a.test.ts', 'b.test.ts'], ['a.test.ts', 'b.test.ts']))
      .toEqual([]);
  });

  it('🔴 un archivo que existe y NO se recolecta aparece como FALTA', () => {
    // El falso verde de Codex: excluir `scripts/**` dejaba 84 archivos verdes
    // **sin un solo test de `scripts/`**. El volumen de verdes no acredita
    // población — por eso se compara contra el disco y no contra un número.
    expect(faltantesDeColeccion(['src/a.test.ts', 'scripts/b.test.ts'], ['src/a.test.ts']))
      .toEqual(['scripts/b.test.ts']);
  });

  it('🔴 población VACÍA es roja, no verde en vacío', () => {
    // Un `[]` puede significar «nada falta» o «no miré nada»: acá se fija cuál.
    expect(faltantesDeColeccion([], [])).not.toEqual([]);
  });

  it('🔴 la pertenencia es EXACTA: un path PREFIJO de otro no cuenta como recolectado', () => {
    // La clase que el gate del espejo ya pagó con `grep -F` anclado sólo por la
    // izquierda, y el censo con prefijos de cadena en vez de tokens.
    expect(faltantesDeColeccion(['e2e/pago.spec.ts'], ['e2e/pago.spec.ts.bak']))
      .toEqual(['e2e/pago.spec.ts']);
  });
});

/**
 * 🔴 LA COBERTURA DE LOS PROYECTOS TS · el miembro de la clase que ningún
 * dictamen nombró y que apareció al enumerarla.
 *
 * Medido en este repo: `include: []` da exit **2** —tsc falla cerrado, no es
 * vector—, pero **`include: ['src/main.tsx']` da exit 0 compilando 1 archivo de
 * 78**, y sacar `tsconfig.node.json` del alias deja **15 fuentes** sin compilar
 * con el typecheck en verde.
 *
 * ⚠️ Y la trampa del instrumento, que casi me hace "arreglar" un tsconfig sano:
 * la cobertura se mide con `--listFiles` (lo que tsc PROCESA), no con
 * `showConfig.files` (las RAÍCES). Con el segundo, un módulo importado por su
 * test figuraba como huérfano siendo que sí se chequea.
 */
describe('🔴 los proyectos de typecheck cubren todo el TypeScript', () => {
  it('✅ CONTROL POSITIVO · si todo está cubierto, no hay huérfanos', () => {
    expect(fuentesSinProyecto(['src/a.ts', 'e2e/b.ts'], ['src/a.ts', 'e2e/b.ts', 'src/lib.ts']))
      .toEqual([]);
  });

  it('🔴 una fuente que ningún proyecto compila aparece como HUÉRFANA', () => {
    expect(fuentesSinProyecto(['src/a.ts', 'scripts/b.ts'], ['src/a.ts']))
      .toEqual(['scripts/b.ts']);
  });

  it('🔴 población VACÍA es roja: «nada huérfano» y «no miré» no son lo mismo', () => {
    expect(fuentesSinProyecto([], [])).not.toEqual([]);
  });
});

/**
 * 🔴 P94 · LA INVALIDACIÓN EFECTIVA, probada por CONDUCTA.
 *
 * El sello por `mtime` que había acá tapaba el exploit del reporte viejo **y su
 * instrumento era manipulable**: `touch` a un `dist` viejo lo hacía pasar como
 * recién escrito, sin correr el build. Se arregló una instancia de «no midas con
 * un instrumento que el atacante mueve» **con otro instrumento que el atacante
 * mueve**.
 *
 * Ahora el resultado se BORRA antes de la herramienta, y su existencia después
 * es la prueba: no hay fecha que falsificar. Estos casos invocan el EJECUTABLE,
 * no una función pura, porque lo que hay que acreditar es que el borrado ocurre
 * de verdad — un test que llamara a `invalidar()` directo probaría la función y
 * no el cable, que es el defecto que este mismo commit corrige en otro lado.
 */
/**
 * 🔴 P90 · EL UNIVERSO DE EXTENSIONES, que es donde estuvo el defecto.
 *
 * El gate derivaba los tests con `/\.test\.ts$/` y `src/walletRouteGuard.test.tsx`
 * **existe y Vitest lo recolecta**: la igualdad era exacta contra una población
 * incompleta. Excluir los `tsx` dejaba el gate en 0 con `npm test` bajando de
 * 1313 a 1253 tests.
 *
 * ⚠️ El defecto no fue olvidarse del `tsx`: fue **escribir la extensión a mano**.
 */
describe('🔴 el universo cubre todas las extensiones efectivas', () => {
  /**
   * 🔴 P94 · SE IMPORTAN, NO SE RE-DECLARAN — y acá estuvo el defecto.
   *
   * Este bloque definía sus PROPIAS copias de los dos patrones. Revertir el del
   * módulo al defectuoso —`/\.test\.ts$/`, el que dejaba escapar
   * `walletRouteGuard.test.tsx`— dejaba este archivo en **41/41 verde**: el
   * centinela vigilaba una copia que nadie toca.
   *
   * Es la clase del P85 por TERCERA vez en la jornada, cometida en el commit
   * donde la lección estaba fresca. La forma que corta no es entenderla mejor,
   * es el gesto mecánico: **un centinela referencia el MISMO objeto que usa
   * producción, por `import`; si el módulo no lo exporta, exportarlo es parte
   * del arreglo.** Al fijar un patrón en un test, buscar ese literal en el
   * módulo: si aparece dos veces, una es la falsa.
   */

  it('🔴 `.test.tsx` cuenta como test — el archivo real que se escapaba', () => {
    expect(ES_TEST.test('walletRouteGuard.test.tsx')).toBe(true);
    expect(existsSync(join(RAIZ, 'src/walletRouteGuard.test.tsx')),
      'el archivo que motivó el hallazgo dejó de existir: este caso ya no mide lo que dice')
      .toBe(true);
  });

  /**
   * 🔴 P94 · EL CONTROL COMPUESTO: patrón + CONFIG + archivo real.
   *
   * Que `ES_TEST` cubra `.tsx` no alcanza — la población efectiva la deciden DOS
   * cosas, y el falso verde salía de mirar una sola. Este caso liga las tres:
   * el archivo existe, el patrón productivo lo reconoce, **y la config de Vitest
   * lo incluye**. Estrechar cualquiera de las dos primeras rompe acá; estrechar
   * la config rompe el gate `--aliases`, que compara disco contra colección real.
   */
  it('🔴 COMPUESTO · el archivo, el patrón productivo Y la config lo cubren', () => {
    const archivo = 'src/walletRouteGuard.test.tsx';
    expect(existsSync(join(RAIZ, archivo)), 'el archivo que motivó el hallazgo ya no existe')
      .toBe(true);
    expect(ES_TEST.test(archivo), 'el patrón productivo dejó de reconocer `.tsx`').toBe(true);
    const cfg = readFileSync(join(RAIZ, 'vite.config.ts'), 'utf8');
    const include = /include:\s*\[([^\]]*)\]/.exec(cfg)?.[1] ?? '';
    expect(include, 'la config de Vitest no lo incluye: el patrón lo ve y el runner no')
      .toMatch(/\{ts,tsx\}/);
  });

  for (const f of ['a.test.ts', 'a.test.mts', 'a.test.cts', 'a.test.js', 'a.test.jsx']) {
    it(`🔴 «${f}» también cuenta`, () => expect(ES_TEST.test(f)).toBe(true));
  }

  it('🔴 y un archivo que NO es test no entra', () => {
    // Control positivo del patrón: si matcheara todo, el universo sería basura y
    // el gate se pondría rojo por archivos que ningún runner debe recolectar.
    expect(ES_TEST.test('router.ts')).toBe(false);
    expect(ES_TEST.test('testigo.ts')).toBe(false);
  });

  for (const f of ['x.ts', 'x.tsx', 'x.mts', 'x.cts']) {
    it(`🔴 «${f}» entra al universo TS de typecheck`, () =>
      expect(ES_FUENTE_TS.test(f)).toBe(true));
  }
});

describe('🔴 la invalidación borra de verdad', () => {
  const correr = (args: readonly string[], raiz: string) =>
    spawnSync(process.execPath, [join(AQUI, 'verificar-aliases.mjs'), ...args], {
      env: { ...process.env, PAYME_RAIZ_VERIFICACION: raiz },
      encoding: 'utf8',
    });

  it('🔴 `--invalidar build` borra el `dist` anterior', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'payme-inval-'));
    try {
      mkdirSync(join(tmp, 'dist'));
      writeFileSync(join(tmp, 'dist', 'index.html'), '<html>viejo</html>');
      expect(existsSync(join(tmp, 'dist')), 'el escenario no se plantó').toBe(true);
      correr(['--invalidar', 'build'], tmp);
      expect(existsSync(join(tmp, 'dist')), 'el artefacto viejo sobrevivió a la invalidación')
        .toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('🔴 `--invalidar corrida` borra el reporte anterior', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'payme-inval-'));
    try {
      writeFileSync(join(tmp, '.vitest-corrida.json'), '{"testResults":[]}');
      correr(['--invalidar', 'corrida'], tmp);
      expect(existsSync(join(tmp, '.vitest-corrida.json')), 'el reporte viejo sobrevivió')
        .toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('🔴 un objetivo NO adjudicado no se borra · fail-closed', () => {
    // Sin esto, `--invalidar <lo-que-sea>` sería un `rm -rf` con argumento libre
    // dentro de un gate de CI. La allowlist es la guarda, y se afirma.
    const tmp = mkdtempSync(join(tmpdir(), 'payme-inval-'));
    try {
      writeFileSync(join(tmp, 'importante.txt'), 'no se toca');
      const r = correr(['--invalidar', 'importante.txt'], tmp);
      expect(existsSync(join(tmp, 'importante.txt')), 'el gate borró algo no adjudicado')
        .toBe(true);
      expect(r.status, 'un objetivo no adjudicado tiene que ser rojo').not.toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/**
 * 🔴 P96 · UN CENTINELA DE CAJA NEGRA POR CABLE — el eslabón que faltaba.
 *
 * Los casos de arriba prueban que cada FUNCIÓN decide bien. Codex midió que eso
 * **no afirma que el `main` la LLAME**: retirar el caller de `acreditarArtefacto`
 * dejaba 41/41 y el CLI aprobaba una raíz **sin `dist`**; retirar
 * `adjudicarPoblacion()` o `adjudicarProyectosTs()` del modo `--aliases` dejaba
 * 41/41 con un test no recolectado y un `.mts` huérfano pasando.
 *
 * Es la misma clase del P85 y del P90 **un eslabón más adentro**: allá el
 * centinela apuntaba al helper en vez de a la política; acá apunta a la función
 * en vez de al dispatcher que la invoca. Tres capas, el mismo error.
 *
 * 🔴 **Se cierra igual para todos, y por eso es una TABLA y no cinco casos
 * sueltos:** cada cable tiene un fixture que lo hace fallar **a él**, y se afirma
 * su diagnóstico propio. Retirar un caller mata **exactamente** su fila. Un cable
 * nuevo se agrega acá, y si alguien lo olvida, no hay fila que lo cubra por
 * accidente.
 *
 * ⚠️ **El oráculo es el DIAGNÓSTICO, no el exit code.** En un árbol de prueba el
 * gate falla por varias razones a la vez —no hay `node_modules`, faltan
 * aliases—, así que un exit ≠0 no diría cuál cable actuó. La firma sí.
 */
describe('🔴 el `main` LLAMA a cada validador · uno por cable', () => {
  const SANO = {
    dev: 'vite',
    test: 'vitest run --reporter=default --reporter=json --outputFile=.vitest-corrida.json',
    typecheck:
      'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json && ' +
      'tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.e2e.json',
    build: 'tsc --noEmit -p tsconfig.json && vite build',
    'build:landing': 'vite build --config vite.landing.config.ts',
    preview: 'vite preview',
    e2e: 'playwright test',
  };

  const CABLES: ReadonlyArray<{
    readonly cable: string;
    readonly args: readonly string[];
    readonly montar: (raiz: string) => void;
    readonly firma: RegExp;
  }> = [
    {
      cable: '--aliases → adjudicarAliases',
      args: ['--aliases'],
      montar: (r) =>
        writeFileSync(join(r, 'package.json'), JSON.stringify({ scripts: { ...SANO, test: 'true' } })),
      firma: /alias «test» no es el adjudicado/,
    },
    {
      cable: '--aliases → adjudicarProyectosTs',
      args: ['--aliases'],
      montar: (r) => {
        writeFileSync(join(r, 'package.json'), JSON.stringify({ scripts: { ...SANO, typecheck: 'tsc --noEmit' } }));
      },
      // Sin ningún `-p`, el alias no nombra proyectos: sólo lo dice esta función.
      firma: /no nombra ningún proyecto/,
    },
    {
      /**
       * 🔴 **La guarda que impide salir a la red desde una RAIZ sintética.**
       *
       * Sin ella, un `-p` que apunta a un tsconfig inexistente igual llegaba a
       * `npx tsc`, y desde un directorio sin `node_modules` eso no resuelve
       * TypeScript: baja del registro el paquete homónimo que no es el
       * compilador. En CI, con caché fría, ~35 s por proyecto — cuatro
       * proyectos, 142 s, y un caso con límite de 5 s reportando 142 306 ms.
       *
       * Este caso fija la conducta nueva: el proyecto se comprueba en disco y
       * la falla se nombra, sin ejecutar nada.
       */
      cable: '--aliases → adjudicarProyectosTs (proyecto inexistente)',
      args: ['--aliases'],
      montar: (r) => {
        writeFileSync(join(r, 'package.json'), JSON.stringify({
          scripts: { ...SANO, typecheck: 'tsc --noEmit -p tsconfig.inexistente.json' },
        }));
      },
      firma: /el proyecto «tsconfig\.inexistente\.json» del alias `typecheck` no existe en disco/,
    },
    {
      cable: '--aliases → adjudicarPoblacion',
      args: ['--aliases'],
      montar: (r) => writeFileSync(join(r, 'package.json'), JSON.stringify({ scripts: SANO })),
      // Sin archivos e2e en disco, sólo la acreditación de colección se queja.
      firma: /Playwright: no se encontró NINGÚN archivo/,
    },
    {
      cable: '--corrida → acreditarCorrida',
      args: ['--corrida'],
      montar: () => {},
      firma: /no existe `\.vitest-corrida\.json`/,
    },
    {
      cable: '--artefacto → acreditarArtefacto',
      args: ['--artefacto', 'dist'],
      montar: () => {},
      firma: /el build no dejó «dist»/,
    },
  ];

  for (const { cable, args, montar, firma } of CABLES) {
    it(`🔴 ${cable} · retirar el caller deja este caso rojo`, () => {
      const tmp = mkdtempSync(join(tmpdir(), 'payme-cable-'));
      try {
        montar(tmp);
        const r = spawnSync(process.execPath, [join(AQUI, 'verificar-aliases.mjs'), ...args], {
          env: { ...process.env, PAYME_RAIZ_VERIFICACION: tmp },
          encoding: 'utf8',
        });
        expect(`${r.stdout}${r.stderr}`, `el \`main\` no pasó por «${cable}»`).toMatch(firma);
        expect(r.status, `«${cable}» no puso el gate en rojo`).not.toBe(0);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  }

});
