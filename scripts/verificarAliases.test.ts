import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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
