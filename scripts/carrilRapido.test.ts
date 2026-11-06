import { describe, it, expect } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'scripts/carril-rapido.mjs');
const policyPath = join(root, 'carriles.json');
// Repos sintéticos sin red ni datos reales. Cada caso usa commits reales.
function scenario(change: (put: (p: string, value: string) => void, dir: string) => void, source?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'payme-carriles-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (p: string, value: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), value); };
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('carriles.json', readFileSync(policyPath, 'utf8'));
    put('docs/nueva-documentacion.md', 'base\n');
    put('docs/DESPLIEGUE_GATEADO.md', 'base\n');
    put('src/App.tsx', 'base\n');
    put('package.json', JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    put('package-lock.json', JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
    git('add', '--', 'carriles.json', 'docs/nueva-documentacion.md', 'docs/DESPLIEGUE_GATEADO.md', 'src/App.tsx', 'package.json', 'package-lock.json');
    git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    change(put, dir);
    const paths = git('ls-files', '--modified', '--others', '--exclude-standard').split('\n').filter(Boolean);
    git('add', '--', ...paths); git('commit', '--allow-empty', '-qm', 'cambio'); const head = git('rev-parse', 'HEAD');
    const executable = join(dir, 'cli.mjs'); writeFileSync(executable, source ?? readFileSync(cli, 'utf8'));
    return spawnSync(process.execPath, [executable, base, head], { cwd: dir, encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const doc = 'docs/nueva-documentacion.md';
function version(next: string, extra = false) {
  return (put: (p: string, value: string) => void) => {
    put('package.json', JSON.stringify({ name: 'fixture', version: next, ...(extra ? { scripts: { test: 'true' } } : {}) }));
    put('package-lock.json', JSON.stringify({ version: next, packages: { '': { version: next } } }));
  };
}
const attacks = {
  base: (put: (p: string, value: string) => void) => {
    const p = JSON.parse(readFileSync(policyPath, 'utf8')) as { rapido: string[]; prohibidas: string[] };
    p.prohibidas = []; p.rapido.push('src/App.tsx', 'carriles.json');
    put('carriles.json', JSON.stringify(p)); put('src/App.tsx', 'cambio\n');
  },
  prohibition: (put: (p: string, value: string) => void) => put('docs/DESPLIEGUE_GATEADO.md', 'cambio\n'),
  mode: (put: (p: string, value: string) => void, dir: string) => { put(doc, 'cambio\n'); chmodSync(join(dir, doc), 0o755); },
  backwards: version('1.2.2'),
};
describe('D744/D748 · carril rápido, CLI contra commits', () => {
  it('A1 admite documentación medida y rechaza runtime src/', () => {
    expect(scenario(put => put(doc, 'cambio\n')).status).toBe(0);
    expect(scenario(put => put('src/App.tsx', 'cambio\n')).status).toBe(1);
  });
  it('A2 prohibida gana al permiso: docs/DESPLIEGUE_GATEADO.md real de AF', () => {
    expect(scenario(attacks.prohibition).status).toBe(1);
  });
  it('A3 rechaza symlink en ruta rápida y +x', () => {
    expect(scenario((_put, dir) => { rmSync(join(dir, doc)); symlinkSync('destino-inexistente', join(dir, doc)); }).status).toBe(1);
    expect(scenario(attacks.mode).status).toBe(1);
  });
  it('A3 versión estrictamente mayor x.y.z, sin otros cambios', () => {
    expect(scenario(version('1.2.4')).status).toBe(0);
    for (const v of ['1.2.2', '1.2.3', 'v1.2.4', '1.2.4-beta', '01.2.4']) expect(scenario(version(v)).status, v).toBe(1);
    expect(scenario(version('1.2.4', true)).status).toBe(1);
    expect(scenario(put => put('package.json', '{"name":"fixture","version":"1.2.4"}')).status).toBe(1);
  });
  it('A3 toma la política de la base aunque la rama se autoautorice', () => {
    expect(scenario(attacks.base).status).toBe(1);
  });
  it('rechaza rutas sin clasificar', () => {
    expect(scenario(put => put('sin-clasificar.txt', 'x')).status).toBe(1);
    expect(scenario(put => put('scripts/sin-clasificar.mjs', 'x')).status).toBe(1);
  });
  it('A5 mueren cuatro mutantes sobre los mismos casos de la base verde', () => {
    const source = readFileSync(cli, 'utf8');
    const mutants = [
      ["show(base, 'carriles.json')", "show(head, 'carriles.json')", attacks.base],
      ['policy.prohibidas.some(rule => matches(path, rule))', 'false', attacks.prohibition],
      ['!regularModes(path)', 'false', attacks.mode],
      ['!greater(previous, next)', 'previous === next', attacks.backwards],
    ] as const;
    for (const [from, to, attack] of mutants) {
      expect(source.split(from).length, `sitio único ${from}`).toBe(2);
      expect(scenario(attack, source.replace(from, to)).status, `mutante no detectado ${from}`).toBe(0);
      // La guarda original exige 1 para ese mismo ataque; el mutante devuelve 0.
      expect(scenario(attack).status).toBe(1);
    }
  });
});
