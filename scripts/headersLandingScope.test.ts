import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = readFileSync(join(RAIZ, 'vercel.mjs'), 'utf8');
const DOC = readFileSync(join(RAIZ, 'docs', 'HARDENING_LANDING_LOCAL.md'), 'utf8');
const PATHS = ['/privacy', '/facebook-data-deletion/:code'];
const PARES = [
  { key: 'Cache-Control', value: 'no-store' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
];

interface Resultado {
  readonly status: number | null;
  readonly config: Record<string, unknown> | null;
  readonly salida: string;
}

function ejecutar(artifact: string | undefined, fuente = FUENTE): Resultado {
  const temporal = mkdtempSync(join(tmpdir(), 'payme-vercel-config-'));
  const modulo = join(temporal, 'vercel.mjs');
  writeFileSync(modulo, fuente);
  const script = `import(${JSON.stringify(`file://${modulo}`)})` +
    `.then(m=>process.stdout.write(JSON.stringify(m.config)))` +
    `.catch(e=>{process.stderr.write(String(e.message));process.exitCode=1})`;
  const env = { ...process.env };
  delete env.PAYME_VERCEL_ARTIFACT;
  if (artifact !== undefined) env.PAYME_VERCEL_ARTIFACT = artifact;
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8', env,
  });
  rmSync(temporal, { recursive: true, force: true });
  let config: Record<string, unknown> | null = null;
  if (r.status === 0) config = JSON.parse(r.stdout) as Record<string, unknown>;
  return { status: r.status, config, salida: `${r.stdout}${r.stderr}` };
}

function exigirComun(config: Record<string, unknown>): void {
  expect(Object.keys(config).sort()).toEqual(['git', 'headers', 'rewrites']);
  expect(config['git']).toEqual({ deploymentEnabled: { main: false } });
}

describe('vercel.mjs · aislamiento causal por identidad de proyecto', () => {
  it('app obtiene exactamente dos rewrites y dos reglas de headers', () => {
    const r = ejecutar('app');
    expect(r.status, r.salida).toBe(0);
    exigirComun(r.config!);
    expect(r.config!['rewrites']).toEqual(PATHS.map((source) => ({
      source, destination: '/index.html',
    })));
    expect(r.config!['headers']).toEqual(PATHS.map((source) => ({ source, headers: PARES })));
  });

  it('landing conserva el gate Git pero no recibe ninguna regla Meta', () => {
    const r = ejecutar('landing');
    expect(r.status, r.salida).toBe(0);
    exigirComun(r.config!);
    expect(r.config!['rewrites']).toEqual([]);
    expect(r.config!['headers']).toEqual([]);
  });

  it.each([
    [undefined, 'ausente'], ['', 'vacía'], ['APP', 'mayúsculas'],
    ['application', 'parecido'], ['landing-preview', 'sufijo'], [' app', 'espacio'],
  ])('valor %s (%s) falla antes de exportar configuración', (artifact, _caso) => {
    const r = ejecutar(artifact);
    expect(r.status, r.salida).not.toBe(0);
    expect(r.config).toBeNull();
  });

  it.each([
    ['default implícito', (s: string) => s.replace(
      'const artifact = process.env.PAYME_VERCEL_ARTIFACT;',
      "const artifact = process.env.PAYME_VERCEL_ARTIFACT ?? 'app';",
    ), undefined],
    ['valor parecido', (s: string) => s.replace("artifact !== 'app'", "!artifact?.startsWith('app')"), 'application'],
    ['reglas compartidas', (s: string) => s.replaceAll("artifact === 'app'", 'true'), 'landing'],
    ['regla global', (s: string) => s.replace("'/privacy'", "'/(.*)'"), 'app'],
    ['headers incompletos', (s: string) => s.replace("  { key: 'Referrer-Policy', value: 'no-referrer' },\n", ''), 'app'],
    ['ruta equivocada', (s: string) => s.replace("'/facebook-data-deletion/:code'", "'/facebook-delete/:code'"), 'app'],
    ['auto-deploy reactivado', (s: string) => s.replace('main: false', 'main: true'), 'app'],
  ])('🔴 MUTANTE · %s queda distinguido', (_nombre, mutar, artifact) => {
    const original = ejecutar(artifact);
    const mutado = ejecutar(artifact, mutar(FUENTE));
    const forma = (r: Resultado): string => JSON.stringify({ status: r.status, config: r.config });
    expect(forma(mutado)).not.toBe(forma(original));
  });

  it('documenta bindings externos y el bloqueo de release', () => {
    expect(DOC).toContain('PAYME_VERCEL_ARTIFACT');
    expect(DOC).toContain('payme-app=app');
    expect(DOC).toContain('payme-landing=landing');
    expect(DOC).toContain('NO_VERIFICABLE_BLOQUEANTE_DE_RELEASE');
  });
});
