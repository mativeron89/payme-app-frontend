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
const MODULO = join(AQUI, 'verificar-aliases.mjs');

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
 * ## 🔴 LÍMITE DECLARADO DE ESTE CENTINELA — leer antes de confiar en él
 *
 * **Acredita contra la frontera `npx` + las señales terminales, NO contra la
 * ausencia total de efectos.** El espía observa un único ejecutable literal, así
 * que un efecto que no pase por `npx` **no lo ve**. Codex lo midió: desde la rama
 * importada, `invalidar('corrida')` —que borra `.vitest-corrida.json`—,
 * `invalidar('build')` —que borra `dist/`— y `adjudicarAliases()` dejan este
 * archivo **3/3 verde**, con el import en exit 0 y silencioso. Dos de esos sinks
 * son los que el workflow usa en `ci.yml:63-64,89-90`.
 *
 * ⚠️ **El fixture positivo alcanza a Vitest; no acredita Playwright ni `tsc`.**
 * Que el CLI también los invoque por `npx` es cierto por lectura, no por esta
 * medición.
 *
 * **El camino que cerraría la clase está identificado y NO implementado:**
 * separar el módulo de exports puros del entrypoint con efectos, de modo que no
 * exista una rama importada capaz de ejecutar nada. Queda **disponible, no
 * ordenado** — el arnés cierra acá en nominal-bueno por decisión de producto, y
 * este límite es parte del certificado, no una omisión.
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
    writeFileSync(join(raiz, 'package.json'), JSON.stringify({ scripts: {} }));
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
      spawnSync(process.execPath, [MODULO, '--aliases'], { env, encoding: 'utf8' });
      expect(
        invocaciones(marca),
        'el espía no registró nada: el escenario no está midiendo lo que dice',
      ).not.toBe('');
    } finally {
      rmSync(dirname(marca), { recursive: true, force: true });
    }
  });

  it('🔴 IMPORTADO · cero invocaciones del CLI, no sólo cero salida', () => {
    const { marca, env } = montarEspia();
    try {
      const r = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', `import ${JSON.stringify(pathToFileURL(MODULO).href)};`],
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

  it('🔴 y el CLI real sigue respondiendo a una invocación directa', () => {
    // El guard podría «arreglarse» apagando el CLI entero. Esto lo impide.
    const r = spawnSync(process.execPath, [MODULO, '--modo-inexistente'], { encoding: 'utf8' });
    expect(r.status, 'el CLI no respondió a una invocación directa').not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/modo desconocido/);
  });
});
