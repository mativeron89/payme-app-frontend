import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUENTE = readFileSync(join(RAIZ, 'vercel.ts'), 'utf8');
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
  /**
   * 🔴 **La fuente es `vercel.ts` y el temporal sigue siendo `.mjs`, a
   * propósito.** Se evalúan los BYTES EXACTOS del archivo real bajo node ESM,
   * sin loader ni dependencia nueva. Y eso vale doble: si alguien mete
   * sintaxis sólo-TypeScript en `vercel.ts`, esta evaluación se cae y todos
   * los casos de abajo se ponen rojos. El archivo tiene que seguir siendo
   * TypeScript válido **y** ESM plano, porque no sabemos si Vercel lo compila.
   */
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

describe('vercel.ts · aislamiento causal por identidad de proyecto', () => {
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

  /**
   * 🔴 **ACÁ CAMBIÓ EL COMPORTAMIENTO, y es el corazón de este commit.**
   *
   * Antes estos seis valores hacían `throw` y el test exigía `status !== 0` con
   * `config === null`. Eso fallaba cerrado para las rutas y **abierto para el
   * candado**: sin config emitida, `deploymentEnabled` no llegaba nunca y
   * `main` volvía a desplegar solo. Un binding ausente en el panel de Vercel
   * —que este repo no puede observar— alcanzaba para perderlo, en silencio.
   *
   * Ahora un artefacto desconocido **emite la configuración igual**, con el
   * candado puesto y las listas vacías. La garantía de aislamiento no se
   * debilita: listas vacías es exactamente lo que recibe `landing`.
   */
  it.each([
    [undefined, 'ausente'], ['', 'vacía'], ['APP', 'mayúsculas'],
    ['application', 'parecido'], ['landing-preview', 'sufijo'], [' app', 'espacio'],
  ])('valor %s (%s) CONSERVA el candado y no recibe ninguna ruta', (artifact, _caso) => {
    const r = ejecutar(artifact);
    expect(r.status, r.salida).toBe(0);
    exigirComun(r.config!);
    expect(r.config!['rewrites'], 'un artefacto desconocido recibió rutas de app').toEqual([]);
    expect(r.config!['headers']).toEqual([]);
  });

  /**
   * El testigo de que `exigirComun` no es decorativo: se afirma el candado
   * SOLO, por su valor, en el caso que antes no llegaba a existir.
   */
  it('🔴 sin la variable en el entorno, el candado igual sale puesto', () => {
    const r = ejecutar(undefined);
    expect(r.status, r.salida).toBe(0);
    expect(r.config!['git']).toEqual({ deploymentEnabled: { main: false } });
  });

  it.each([
    ['default implícito', (s: string) => s.replace(
      'const artifact = process.env.PAYME_VERCEL_ARTIFACT;',
      "const artifact = process.env.PAYME_VERCEL_ARTIFACT ?? 'app';",
    ), undefined],
    ['valor parecido', (s: string) => s.replace("const esApp = artifact === 'app';", "const esApp = !!artifact?.startsWith('app');"), 'application'],
    // Muta la DECLARACIÓN, no los usos: `replaceAll('esApp','true')` rompía
    // también `const esApp = …` y el mutante quedaba distinguido por un error
    // de sintaxis en vez de por conducta compartida, que es lo que se vigila.
    ['reglas compartidas', (s: string) => s.replace("const esApp = artifact === 'app';", 'const esApp = true;'), 'landing'],
    ['🔴 candado detrás del artefacto', (s: string) => s.replace(
      '  git: { deploymentEnabled: { main: false } },',
      '  ...(esApp ? { git: { deploymentEnabled: { main: false } } } : {}),',
    ), undefined],
    ['🔴 throw reintroducido', (s: string) => s.replace(
      "const esApp = artifact === 'app';",
      "if (artifact !== 'app' && artifact !== 'landing') throw new Error('x');\nconst esApp = artifact === 'app';",
    ), undefined],
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
