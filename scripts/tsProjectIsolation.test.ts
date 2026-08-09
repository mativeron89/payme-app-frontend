import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ⭐ LA SONDA, CONVERTIDA EN GATE — el código que se despacha no puede ver Node.
 *
 * ## Por qué existe
 *
 * En la ORDEN 2A afirmé que `types: ["vite/client"]` alcanzaba para que
 * `src/` no viera los tipos de Node. El argumento era **cierto** y contestaba
 * otra pregunta: `types` gobierna la inclusión AUTOMÁTICA de globals, no lo que
 * entra por un `import`. Una sonda `process.env` en `src/` **compiló limpio** —
 * los tests importaban `vitest`, y vitest arrastra `@types/node` por el grafo
 * de módulos.
 *
 * Se arregló separando los tests en su propio proyecto. **Pero la verificación
 * fue MANUAL y de una sola vez**, y un comentario llegó a decir que "hay un
 * test que lo fija" cuando no lo había. Esto lo vuelve cierto.
 *
 * ## Por qué NO alcanza con leer el `tsconfig.json`
 *
 * Un test que afirmara *"`types` no contiene `node`"* sería exactamente la
 * clase de verificación que falló la primera vez: **mira la configuración, no
 * el efecto**. Acá se compila de verdad, con el programa REAL —los mismos
 * `include`/`exclude`, las mismas `compilerOptions`— más una sonda, y se exige
 * que `tsc` la rechace.
 *
 * Si algún día alguien agrega `"node"` a `types`, o vuelve a meter los tests
 * en el proyecto de producción, **este test se pone rojo** en vez de que el
 * aislamiento se pierda en silencio.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

let temporal: string | null = null;
/**
 * ⚠️ El tsconfig de la sonda tiene que vivir EN LA RAÍZ DEL REPO, no en el
 * temporal. Medido: desde `/tmp` la resolución de tipos arranca en ese
 * directorio, que no tiene `node_modules`, y `tsc` muere con
 * `TS2688: Cannot find type definition file for 'vite/client'` — o sea que la
 * sonda "fallaba" por el arnés y no por el aislamiento. **Lo detectó la sonda
 * INVERSA**, que también dio rojo cuando debía compilar.
 *
 * El nombre NO empieza con `tsconfig` a propósito: el test de más abajo
 * enumera los proyectos con `/^tsconfig…/` y un residuo lo confundiría.
 */
const CONFIG_SONDA = join(RAIZ, '.tsprobe.json');

afterAll(() => {
  if (temporal) rmSync(temporal, { recursive: true, force: true });
  temporal = null;
  rmSync(CONFIG_SONDA, { force: true });
});

/**
 * Compila el programa de producción REAL más un archivo sonda, sin tocar
 * `src/`: el tsconfig hereda de `tsconfig.json` —mismas `compilerOptions`,
 * mismos `exclude`— y sólo suma la sonda al `include`.
 *
 * @returns la salida de `tsc` (vacía si compiló limpio).
 */
function compilarConSonda(cuerpo: string): string {
  const dir = temporal ?? mkdtempSync(join(tmpdir(), 'payme-tsprobe-'));
  temporal = dir;
  const sonda = join(dir, 'sonda.ts');
  writeFileSync(sonda, cuerpo);
  writeFileSync(CONFIG_SONDA, JSON.stringify({
    extends: './tsconfig.json',
    include: ['./src', sonda],
    exclude: ['./src/**/*.test.ts', './src/**/*.test.tsx'],
  }));
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', CONFIG_SONDA], {
      cwd: RAIZ, stdio: 'pipe', encoding: 'utf8',
    });
    return '';
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    rmSync(CONFIG_SONDA, { force: true });
  }
}

describe('el programa de producción NO ve los tipos de Node', () => {
  it('🔴 una sonda con `process` y `Buffer` en `src/` es RECHAZADA', () => {
    const salida = compilarConSonda(
      'export const a = process.env.HOME;\nexport const b = Buffer.from("x");\n',
    );
    expect(salida, 'la sonda compiló limpio: el aislamiento NO existe').not.toBe('');
    expect(salida).toMatch(/Cannot find name 'process'/);
    expect(salida).toMatch(/Cannot find name 'Buffer'/);
  }, 120_000);

  it('⭐ y la sonda INVERSA compila: el arnés no rechaza cualquier cosa', () => {
    // Sin esto, un tsconfig roto haría fallar la sonda de arriba por el motivo
    // equivocado y el test pasaría igual — verde por la razón incorrecta.
    const salida = compilarConSonda('export const a: string = "sin globals de Node";\n');
    expect(salida, `el arnés falla con código inocente:\n${salida}`).toBe('');
  }, 120_000);

  it('los cuatro proyectos existen y `typecheck` los corre a todos', () => {
    const proyectos = readdirSync(RAIZ).filter((f) => /^tsconfig(\..+)?\.json$/.test(f)).sort();
    expect(proyectos).toEqual([
      'tsconfig.e2e.json', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.test.json',
    ]);
    const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    for (const p of proyectos) {
      expect(pkg.scripts.typecheck, `\`typecheck\` no corre ${p}`).toContain(p);
    }
  });
});
