import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';

const ejecutar = promisify(execFile);

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SCRIPT = join(AQUI, 'reportar-flaky.sh');
const CI_YML = join(RAIZ, '.github', 'workflows', 'ci.yml');

/**
 * ORDEN DEL BIBLIOTECARIO · 2026-08-10 · «hacelo RUIDOSO, sin bloquear».
 *
 * `retries: 2` en CI hace que un test que falla y pasa al reintentar salga
 * reportado como «flaky» con exit 0: **la corrida queda verde y publica**. Es
 * la conducta de «re-correr hasta que dé verde», ya integrada en la config.
 *
 * La decisión NO fue sacar los reintentos —un parpadeo de red en el runner
 * bloquearía un deploy sano— sino que la degradación **se vea**.
 *
 * ## 🔴 El modo de falla de ESTE script es el INVERSO del de `publicar-vercel`
 *
 * Aquél debe CORTAR cuando el hook no acepta. Éste **no debe cortar jamás**: un
 * paso de reporte que tumba el job convierte un informe en una compuerta, que
 * es exactamente lo que no se pidió. Por eso la propiedad central de abajo no
 * es «reporta bien» sino **«sale 0 pase lo que pase»**.
 *
 * ## Y la propiedad que protege al paso de al lado
 *
 * `- run: npx playwright test` es el que gatea la publicación. La tentación
 * natural era capturarle la salida con un pipe — y el shell por defecto de un
 * `run:` es `bash -e`, **sin `pipefail`**: el exit de playwright se lo comería
 * `tee` y la compuerta quedaría abierta en silencio. Por eso el resultado se
 * lee de un JSON, en un paso aparte, y acá se fija que ese `run:` siga pelado.
 */

const tmp = mkdtempSync(join(tmpdir(), 'flaky-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function conJson(nombre: string, contenido: string): string {
  const p = join(tmp, nombre);
  writeFileSync(p, contenido);
  return p;
}

async function correr(arg: string): Promise<{ code: number; salida: string }> {
  try {
    const { stdout, stderr } = await ejecutar('bash', [SCRIPT, arg], { cwd: RAIZ });
    return { code: 0, salida: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, salida: (err.stdout ?? '') + (err.stderr ?? '') };
  }
}

describe('EJECUTANDO · el reporte de flaky informa y NO bloquea', () => {
  it('✅ flaky > 0 · avisa fuerte, y aun así sale 0', async () => {
    const p = conJson('tres.json', JSON.stringify({ stats: { expected: 80, flaky: 3 } }));
    const { code, salida } = await correr(p);
    expect(code).toBe(0);
    // `::warning::` es lo que GitHub muestra destacado en vez de enterrarlo.
    expect(salida).toContain('::warning');
    expect(salida).toContain('3');
    // Y dice explícitamente que no frena, para que nadie lo lea como bloqueo.
    expect(salida.toLowerCase()).toContain('publica igual');
  });

  it('✅ flaky = 0 · lo dice en voz alta · un cero callado se confunde con no haber corrido', async () => {
    const p = conJson('cero.json', JSON.stringify({ stats: { expected: 83, flaky: 0 } }));
    const { code, salida } = await correr(p);
    expect(code).toBe(0);
    expect(salida).toContain('flaky: 0');
    expect(salida).not.toContain('::warning');
  });

  /**
   * 🔴 LA PROPIEDAD CENTRAL. Si alguna de estas cae, un paso de REPORTE estaría
   * en condiciones de tumbar el job y frenar un deploy sano.
   */
  it.each([
    ['el JSON no existe', 'no-existe.json'],
    ['el JSON está roto', 'roto.json'],
    ['el JSON no trae stats.flaky', 'sinflaky.json'],
    ['no le pasan argumento', ''],
  ])('🔴 sale 0 aunque %s', async (_caso, archivo) => {
    const mapa: Record<string, string> = {
      'roto.json': 'esto no es json {{{',
      'sinflaky.json': JSON.stringify({ stats: { expected: 83 } }),
    };
    const arg = archivo === '' ? '' : archivo in mapa ? conJson(archivo, mapa[archivo]) : join(tmp, archivo);
    const { code, salida } = await correr(arg);
    expect(code).toBe(0);
    // Y NUNCA es mudo: «no apareció» leído como «no corrió» es la trampa del día.
    expect(salida.trim().length).toBeGreaterThan(0);
    expect(salida).toContain('No bloqueo');
  });

  it('🔴 SONDA · el script no lleva `set -e`, que lo volvería fail-closed', () => {
    const fuente = readFileSync(SCRIPT, 'utf8');
    // `set -uo pipefail` sí; `set -e`/`set -euo` no.
    expect(fuente).toMatch(/^set -uo pipefail$/m);
    expect(fuente).not.toMatch(/^set -e/m);
  });
});

describe('POR LECTURA · el paso que GATEA no se tocó', () => {
  const yml = readFileSync(CI_YML, 'utf8');

  it('🔴 `npx playwright test` sigue pelado · sin pipe, sin redirección', () => {
    const linea = yml.split('\n').find((l) => l.includes('npx playwright test'));
    expect(linea, 'desapareció el paso de playwright').toBeDefined();
    expect(linea!.trim()).toBe('- run: npx playwright test');
    // Un `| tee` acá se comería el exit code: el shell de un `run:` es `bash -e`
    // SIN `pipefail`. La compuerta quedaría abierta sin que nadie lo note.
    expect(linea).not.toContain('|');
    expect(linea).not.toContain('>');
  });

  it('🔴 el reporte corre en un paso APARTE, con `if: always()`', () => {
    expect(yml).toContain('scripts/reportar-flaky.sh');
    const i = yml.indexOf('Reportar flaky');
    expect(i).toBeGreaterThan(-1);
    // El `if: always()` tiene que estar en ESE paso, no en cualquier lado.
    expect(yml.slice(i, i + 240)).toContain('if: always()');
  });

  it('🔴 y el reporte va DESPUÉS de playwright y ANTES de publicar', () => {
    const pw = yml.indexOf('npx playwright test');
    const rep = yml.indexOf('scripts/reportar-flaky.sh');
    const pub = yml.indexOf('publicar-vercel.sh');
    expect(pw).toBeLessThan(rep);
    expect(rep).toBeLessThan(pub);
  });
});

describe('POR LECTURA · el JSON que alimenta el reporte existe en la config', () => {
  const cfg = readFileSync(join(RAIZ, 'playwright.config.ts'), 'utf8');

  it('🔴 el reporter json está SÓLO en CI y escribe donde el script lo busca', () => {
    expect(cfg).toContain("['json', { outputFile: 'test-results/resultados.json' }]");
    const yml = readFileSync(CI_YML, 'utf8');
    expect(yml).toContain('test-results/resultados.json');
  });

  it('🔴 y esa ruta está gitignoreada · un artefacto de corrida no entra al árbol', async () => {
    // `check-ignore` sale 1 si NO está ignorado, así que el rechazo ES el fallo.
    const { stdout } = await ejecutar('git', ['check-ignore', 'test-results'], { cwd: RAIZ });
    expect(stdout.trim()).toBe('test-results');
  });
});
