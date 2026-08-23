import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * 🔴 P96 · EL GUARD DE `main`, CUSTODIADO — y en su ARCHIVO PROPIO.
 *
 * `verificar-aliases.mjs` es a la vez CLI y módulo: el workflow lo invoca con
 * `node`, y los centinelas le importan sus patrones productivos. El guard que
 * separa esos dos usos existe desde el P94 y **ningún test lo vigilaba**:
 * forzarlo con `if (false)` dejaba el archivo de tests en 41/41 verde mientras
 * el CLI se ejecutaba —censos y procesos hijos incluidos— dentro de un import.
 *
 * ⚠️ **Vive acá y no con los demás por una razón medida:** el otro archivo
 * importa el módulo estáticamente, así que el mutante lo mata **al cargar** y
 * Vitest reporta «no tests» en vez de una hoja causal. Un rojo sin diagnóstico
 * es peor evidencia que un rojo que dice qué se rompió. Este archivo **no
 * importa nada del módulo**: lo ejecuta en un proceso hijo y mira el resultado.
 */
describe('🔴 el módulo es importable sin ejecutar su CLI', () => {
  const MODULO = pathToFileURL(join(AQUI, 'verificar-aliases.mjs')).href;

  it('🔴 importarlo sale 0, sin señal y sin una línea de salida', () => {
    const r = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `import ${JSON.stringify(MODULO)};`],
      { encoding: 'utf8' },
    );
    expect(r.status, 'importar el módulo terminó ≠0: el CLI corrió y llamó a `process.exit`')
      .toBe(0);
    expect(r.signal, 'importar el módulo mató el proceso').toBeNull();
    expect(`${r.stdout}${r.stderr}`.trim(), 'importar el módulo produjo salida del CLI')
      .toBe('');
  });

  it('✅ CONTROL POSITIVO · invocado como script SÍ hace su trabajo', () => {
    // Sin esto, el caso de arriba pasaría igual con un módulo que no hace nada:
    // «no ejecuta el CLI al importarse» y «no tiene CLI» son indistinguibles.
    const r = spawnSync(process.execPath, [join(AQUI, 'verificar-aliases.mjs'), '--modo-inexistente'], {
      encoding: 'utf8',
    });
    expect(r.status, 'el CLI no respondió a una invocación directa').not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/modo desconocido/);
  });
});
