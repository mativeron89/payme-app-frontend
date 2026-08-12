import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SCRIPT = join(AQUI, 'auditar-secretos.sh');
const temporales: string[] = [];

function git(dir: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  return result.stdout.trim();
}

function repoConCambio(lineaAgregada: string): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), 'payme-secret-gate-'));
  temporales.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts', 'auditar-secretos.sh'));
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'probe@payme.invalid');
  git(dir, 'config', 'user.name', 'PayMe probe');
  git(dir, 'add', '--', 'README.md', 'scripts/auditar-secretos.sh');
  git(dir, 'commit', '-qm', 'baseline');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'src', 'probe.tsx'), `${lineaAgregada}\n`);
  git(dir, 'add', '--', 'src/probe.tsx');
  git(dir, 'commit', '-qm', 'cambio');
  return { dir, base };
}

afterEach(() => {
  for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('auditoría de secretos', () => {
  it('un password real no se vuelve benigno por usar el mismo texto que autocomplete', () => {
    // Se construye para que el instrumento pueda auditar este mismo commit sin
    // confundir el fixture del test con una credencial agregada al producto.
    const tokenHtml = ['current', 'password'].join('-');
    const { dir, base } = repoConCambio(`const password = '${tokenHtml}';`);

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, 'la excepción de autocomplete ocultó un password asignado').toBe(1);
  });

  it('los tokens HTML de autocomplete, por sí solos, siguen siendo benignos', () => {
    const { dir, base } = repoConCambio(
      "const input = { autoComplete: mode === 'login' ? 'current-password' : 'new-password' };",
    );

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('cero valores con forma de secreto');
    expect(result.status).toBe(0);
  });

  it('un token HTML benigno no puede ocultar un secreto real en la misma línea', () => {
    // Se arma en runtime para que el propio test no contenga un valor con forma
    // de clave y pueda ser auditado por el instrumento que está probando.
    const secretoFalso = ['sk', 'live', 'A'.repeat(24)].join('_');
    const { dir, base } = repoConCambio(
      `const input = { autoComplete: 'current-password', apiKey: '${secretoFalso}' };`,
    );

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, 'el token benigno eximió la línea completa').toBe(1);
  });

  it('CI entrega una base alcanzable y no vacía tanto en push como en PR', () => {
    const ci = readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('fetch-depth: 0');
    expect(ci).toContain("github.event.pull_request.base.sha || github.event.before || 'HEAD^'");
    expect(ci).toContain('bash scripts/auditar-secretos.sh');
  });
});
