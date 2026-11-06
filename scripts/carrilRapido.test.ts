import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'scripts/carril-rapido.mjs');
const policyPath = join(root, 'carriles.json');
const realPolicy = () => JSON.parse(readFileSync(policyPath, 'utf8')) as { rapido: string[]; prohibidas: string[]; version_sola: string[] };
// Sólo las fixtures tienen docs/**. Nunca modifica la política real del repo.
const syntheticPolicy = () => ({ ...realPolicy(), rapido: ['CHANGELOG.md', 'docs/**'] });
type Context = {
  put: (path: string, value: string) => void;
  dir: string;
  git: (...args: string[]) => string;
  base: string;
};
type Change = (ctx: Context) => void;
type Options = { policy?: ReturnType<typeof realPolicy>; cwd?: string; indexOnly?: boolean };
// Repos sintéticos por caso, sin red ni datos reales. Cambios sólo de índice no pasan por add.
function scenario(change: Change, options: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'payme-carriles-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (path: string, value: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), value); };
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('carriles.json', JSON.stringify(options.policy ?? realPolicy()));
    put('CHANGELOG.md', 'base\n'); put('docs/permitido.md', 'base\n');
    put('docs/DESPLIEGUE_GATEADO.md', 'base\n'); put('src/App.tsx', 'base\n');
    put('package.json', JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    put('package-lock.json', JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
    git('add', '--', 'carriles.json', 'CHANGELOG.md', 'docs/permitido.md', 'docs/DESPLIEGUE_GATEADO.md', 'src/App.tsx', 'package.json', 'package-lock.json');
    git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    change({ put, dir, git, base });
    if (!options.indexOnly) {
      const paths = git('ls-files', '--modified', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
      if (paths.length) git('add', '--', ...paths);
    }
    git('commit', '--allow-empty', '-qm', 'cambio'); const head = git('rev-parse', 'HEAD');
    return spawnSync(process.execPath, [cli, base, head], { cwd: join(dir, options.cwd ?? ''), encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function version(next: string, extra = false): Change {
  return ({ put }) => {
    put('package.json', JSON.stringify({ name: 'fixture', version: next, ...(extra ? { scripts: { test: 'true' } } : {}) }));
    put('package-lock.json', JSON.stringify({ version: next, packages: { '': { version: next } } }));
  };
}
const changeLog: Change = ({ put }) => put('CHANGELOG.md', 'cambio\n');
const deniedDocs = ['docs/CLAUDE.md', 'docs/AGENTS.md', 'docs/.claude/settings.json', 'docs/.env',
  'docs/SECRETOS_EJEMPLO.env', 'docs/usuarios.csv', 'docs/contract-mirror/schemas/x.js', 'docs/sentinela.test.ts'];
const rejected = (r: ReturnType<typeof scenario>) => {
  expect(r.error).toBeUndefined();
  expect(r.status, r.stderr).toBe(1);
  expect(r.stderr).toContain('requiere carril normal:');
};
describe('D744/D748 · C119c · CLI contra commits', () => {
  it('A1 CHANGELOG positivo; src negativo', () => {
    expect(scenario(changeLog).status).toBe(0);
    rejected(scenario(({ put }) => put('src/App.tsx', 'cambio\n')));
  });
  it('A2 prohibida gana con permiso sintético y control positivo en la misma política', () => {
    const policy = syntheticPolicy();
    expect(scenario(({ put }) => put('docs/permitido.md', 'cambio\n'), { policy }).status).toBe(0);
    rejected(scenario(({ put }) => put('docs/DESPLIEGUE_GATEADO.md', 'cambio\n'), { policy }));
  });
  it('política real exacta y spec explícitamente prohibida', () => {
    expect(realPolicy().rapido).toEqual(['CHANGELOG.md']);
    expect(realPolicy().prohibidas).toContain('e2e/inicio-pestanas-misma-altura.spec.ts');
  });
  it('A3 docs nuevos y la spec rechazados por conducta', () => {
    for (const path of [...deniedDocs, 'e2e/inicio-pestanas-misma-altura.spec.ts']) {
      rejected(scenario(({ put }) => put(path, 'MARCADOR SINTÉTICO\n')));
    }
  });
  it('A3 symlink, +x y submódulo desde docs y src con permiso sintético', () => {
    for (const cwd of ['docs', 'src']) {
      rejected(scenario(({ dir }) => { rmSync(join(dir, 'CHANGELOG.md')); symlinkSync('destino-inexistente', join(dir, 'CHANGELOG.md')); }, { cwd }));
      rejected(scenario(({ dir }) => chmodSync(join(dir, 'CHANGELOG.md'), 0o755), { cwd }));
      rejected(scenario(({ git, base }) => git('update-index', '--add', '--cacheinfo', `160000,${base},docs/submodulo`), { cwd, policy: syntheticPolicy(), indexOnly: true }));
    }
  });
  it('A3 package +x, borrado de CHANGELOG y desconocidos rechazados', () => {
    rejected(scenario(ctx => { version('1.2.4')(ctx); chmodSync(join(ctx.dir, 'package.json'), 0o755); }));
    rejected(scenario(({ dir }) => rmSync(join(dir, 'CHANGELOG.md'))));
    rejected(scenario(({ put }) => put('sin-clasificar.txt', 'x')));
  });
  it('A3 positivo desde src exige full-tree, sin taparlo con negativos', () => {
    const result = scenario(changeLog, { cwd: 'src' });
    expect(result.status, result.stderr).toBe(0);
  });
  it('A3 no UTF-8 sólo de índice exige vacío cierra con política sintética', () => {
    rejected(scenario(({ git, dir }) => {
      const blob = git('hash-object', '-w', '--stdin');
      // El byte ff sólo se crea en el índice de Git: nunca en el filesystem de macOS.
      execFileSync('bash', ['-c', 'git update-index --add --cacheinfo "120000,$1,$(printf \'docs/\\377.md\')"', 'fixture', blob], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    }, { policy: syntheticPolicy(), indexOnly: true }));
  });
  it('A3 versión ascendente estricta y texto exacto; sin cambios extra', () => {
    expect(scenario(version('1.2.4')).status).toBe(0);
    for (const v of ['1.2.2', 'v1.2.4', '1.2.4-beta', '01.2.4']) rejected(scenario(version(v)));
    rejected(scenario(version('1.2.4', true)));
    rejected(scenario(({ put }) => put('package.json', '{"name":"fixture","version":"1.2.4"}')));
    rejected(scenario(ctx => { version('1.2.4')(ctx); ctx.put('package.json', '{ "name": "fixture", "version": "1.2.4" }'); }));
    // Versión igual con diferencia real: no puede morir por rango vacío.
    rejected(scenario(({ put }) => put('package.json', '{ "name":"fixture","version":"1.2.3"}')));
    rejected(scenario(ctx => { version('1.2.4')(ctx); ctx.put('package.json', '{"name":"fixture","scripts":{"test":"MARCADOR"},"scripts":{},"version":"1.2.4"}'); }));
  });
  it('A3 política de la base aunque la rama se autoautorice', () => {
    rejected(scenario(({ put }) => {
      put('carriles.json', JSON.stringify({ ...realPolicy(), prohibidas: [], rapido: ['src/App.tsx', 'carriles.json'] }));
      put('src/App.tsx', 'cambio\n');
    }));
  });
});
