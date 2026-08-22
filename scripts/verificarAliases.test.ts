import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallasDeAliases, faltantesDeColeccion, fuentesSinProyecto } from './verificar-aliases.mjs';

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
 * 🔴 P90 · EL CALLSITE DEL DISPATCHER, no sólo los helpers.
 *
 * Codex midió que retirar `adjudicarAliases()` del branch `--aliases` dejaba
 * estos tests **18/18 verdes**: probaban que las funciones puras deciden bien,
 * no que el ejecutable las llame. Es la misma clase que el P85 cerró en el arnés
 * YAML —un centinela apuntado al helper y no al seam— y por eso no alcanza con
 * un test más de `fallasDeAliases`.
 *
 * Esto invoca el EJECUTABLE sobre un árbol de prueba con un alias roto. Si el
 * dispatcher deja de llamar al helper, el mensaje no aparece y el caso cae.
 */
describe('🔴 el ejecutable LLAMA a la adjudicación, no sólo la exporta', () => {
  it('🔴 un alias roto en un árbol de prueba sale por el gate REAL', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'payme-aliases-'));
    try {
      writeFileSync(
        join(tmp, 'package.json'),
        JSON.stringify({ name: 'prueba', scripts: { test: 'true' } }),
      );
      const r = spawnSync(
        process.execPath,
        [join(AQUI, 'verificar-aliases.mjs'), '--aliases'],
        { env: { ...process.env, PAYME_RAIZ_VERIFICACION: tmp }, encoding: 'utf8' },
      );
      // 🔴 El oráculo es el MENSAJE del helper, no el exit code: en un árbol de
      // prueba el gate falla por varias razones a la vez, y un exit ≠0 no diría
      // cuál. Lo que acredita el cableado es que aparezca ESTA falla.
      expect(
        `${r.stdout}${r.stderr}`,
        'el dispatcher no pasó por `fallasDeAliases`: el alias roto no fue denunciado',
      ).toMatch(/alias «test» no es el adjudicado/);
      expect(r.status, 'el gate aprobó un árbol con el alias roto').not.toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

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
  const ES_TEST = /\.test\.[cm]?[jt]sx?$/;
  const ES_FUENTE_TS = /\.[cm]?tsx?$/;

  it('🔴 `.test.tsx` cuenta como test — el archivo real que se escapaba', () => {
    expect(ES_TEST.test('walletRouteGuard.test.tsx')).toBe(true);
    expect(existsSync(join(RAIZ, 'src/walletRouteGuard.test.tsx')),
      'el archivo que motivó el hallazgo dejó de existir: este caso ya no mide lo que dice')
      .toBe(true);
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
