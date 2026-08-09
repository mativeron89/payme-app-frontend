import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
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

/**
 * 🔴 DÓNDE VIVE EL ARNÉS, corregido.
 *
 * La versión anterior escribía `RAIZ/.tsprobe.json` — **nombre fijo, en la raíz
 * observable del repo**. Tres problemas, y el tercero es el grave:
 *
 *   1. ensucia la raíz, que es justo donde todo el mundo mira;
 *   2. dos corridas simultáneas se pisan el archivo y se sabotean entre sí;
 *   3. si el proceso moría entre el `writeFileSync` y el `finally`, el residuo
 *      quedaba en el árbol de trabajo — y `.gitignore` lo tapaba, así que ni
 *      siquiera aparecía en `git status`.
 *
 * Ahora vive en `node_modules/.cache/payme-tsprobe-XXXX/`, con `mkdtemp`:
 * único por corrida, fuera de todo lo que se audita, y en un directorio que ya
 * es descartable por definición.
 *
 * ⚠️ Y NO en `/tmp`, que fue el primer intento: desde ahí la resolución de
 * tipos arranca en un directorio sin `node_modules` y `tsc` muere con
 * `TS2688: Cannot find type definition file for 'vite/client'`. La sonda
 * "fallaba" por el arnés y no por el aislamiento. Lo detectó la sonda INVERSA.
 * Debajo de `node_modules/` la resolución sube y encuentra todo, y además el
 * `extends`, el `include` y el `exclude` se escriben ABSOLUTOS para que la
 * ubicación deje de importar.
 */
const CACHE = join(RAIZ, 'node_modules', '.cache');
const arneses: string[] = [];

afterAll(() => {
  // Red de seguridad: el `finally` de cada compilación ya limpia lo suyo, y
  // esto cubre el caso de que un test explote antes de llegar al `finally`.
  for (const dir of arneses) rmSync(dir, { recursive: true, force: true });
  arneses.length = 0;
});

/**
 * Compila el programa de producción REAL más un archivo sonda, sin tocar
 * `src/`: el tsconfig hereda de `tsconfig.json` —mismas `compilerOptions`,
 * mismos `exclude`— y sólo suma la sonda al `include`.
 *
 * @returns la salida de `tsc` (vacía si compiló limpio).
 */
function compilarConSonda(cuerpo: string): string {
  mkdirSync(CACHE, { recursive: true });
  const dir = mkdtempSync(join(CACHE, 'payme-tsprobe-'));
  arneses.push(dir);
  const sonda = join(dir, 'sonda.ts');
  writeFileSync(sonda, cuerpo);
  const config = join(dir, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({
    extends: join(RAIZ, 'tsconfig.json'),
    include: [join(RAIZ, 'src'), sonda],
    exclude: [join(RAIZ, 'src/**/*.test.ts'), join(RAIZ, 'src/**/*.test.tsx')],
  }));
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', config], {
      cwd: RAIZ, stdio: 'pipe', encoding: 'utf8',
    });
    return '';
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return `${err.stdout ?? ''}${err.stderr ?? ''}`;
  } finally {
    // Éxito Y error: el temporal se borra acá, y `afterAll` es la red.
    rmSync(dir, { recursive: true, force: true });
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

/**
 * 🔴 EL CENSO · ningún `.ts`/`.tsx` del repo queda fuera de todo proyecto.
 *
 * El censo existía como una tabla en un mensaje entre sesiones — o sea, no
 * existía: los mensajes se pierden y una tabla escrita a mano nace vieja el
 * día que alguien agrega un archivo.
 *
 * Acá se DERIVA. `tsc --listFilesOnly` dice qué archivos entran de verdad en
 * cada programa —resolviendo `include`, `exclude` y el grafo de imports, que
 * es justo lo que una lista manual no puede hacer— y se compara contra el
 * árbol real.
 *
 * ## Qué se rompe si esto falta
 *
 * Un archivo fuera de todo proyecto **no se typechequea nunca**. Vitest y Vite
 * transpilan sin verificar tipos, así que el archivo compila y corre igual, y
 * se pudre en silencio hasta que rompe en runtime. Ya pasó: `scripts/` y
 * `landing/` estuvieron sin cobertura hasta la ORDEN 2A.
 *
 * `docs/CENSO_PROYECTOS_TS.md` explica el reparto para quien lea; **la
 * autoridad es este test**, no el documento.
 */
describe('censo de cobertura TypeScript', () => {
  const PROYECTOS = [
    'tsconfig.json', 'tsconfig.test.json', 'tsconfig.node.json', 'tsconfig.e2e.json',
  ] as const;

  /** Los `.ts`/`.tsx` del repo que un proyecto incluye de verdad. */
  function archivosDe(proyecto: string): string[] {
    const salida = execFileSync('npx', ['tsc', '-p', proyecto, '--noEmit', '--listFilesOnly'], {
      cwd: RAIZ, stdio: 'pipe', encoding: 'utf8',
    });
    return salida
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.includes('node_modules') && /\.tsx?$/.test(l))
      .map((l) => relative(RAIZ, resolve(RAIZ, l)));
  }

  /** Todo `.ts`/`.tsx` versionado, según git — no un `glob` propio. */
  function archivosDelRepo(): string[] {
    const salida = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
      cwd: RAIZ, stdio: 'pipe', encoding: 'utf8',
    });
    return salida.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  it('🔴 CERO huérfanos: todo archivo está en al menos un proyecto', () => {
    const cubiertos = new Set(PROYECTOS.flatMap((p) => archivosDe(p)));
    const todos = archivosDelRepo();

    // Dos sondas antes de la afirmación. Sin ellas, un `git ls-files` que
    // devolviera vacío o un `tsc` que no listara nada darían verde sin mirar.
    expect(todos.length, 'git no listó ningún .ts: el censo pasaría en vacío').toBeGreaterThan(100);
    expect(cubiertos.size, 'ningún proyecto listó archivos').toBeGreaterThan(100);

    const huerfanos = todos.filter((f) => !cubiertos.has(f));
    expect(huerfanos, `sin typecheck: ${huerfanos.join(' · ')}`).toEqual([]);
  }, 120_000);

  it('🔴 el documento del censo nombra exactamente los proyectos que existen', () => {
    // Que el doc no envejezca sin que nadie lo note: si mañana aparece un
    // quinto proyecto y nadie lo explica, esto se pone rojo.
    const doc = readFileSync(join(RAIZ, 'docs/CENSO_PROYECTOS_TS.md'), 'utf8');
    const enDoc = [...doc.matchAll(/`(tsconfig(?:\.[a-z0-9]+)?\.json)`/g)].map((m) => m[1]!);
    expect(new Set(enDoc), 'el doc no coincide con los proyectos reales').toEqual(new Set(PROYECTOS));
  });
});
