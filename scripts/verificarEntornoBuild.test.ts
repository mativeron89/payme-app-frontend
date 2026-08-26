import { execFileSync, spawnSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/verificar-entorno-build.mjs');
const AUTORIZADOS = ['.env.development', '.env.local.example', '.env.mock'];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'payme-env-build-'));
  mkdirSync(join(root, 'landing'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  for (const name of AUTORIZADOS) writeFileSync(join(root, name), '# fixture pública\n');
  execFileSync('git', ['add', '--', ...AUTORIZADOS], { cwd: root });
  return root;
}

function ejecutar(root: string) {
  return spawnSync(process.execPath, [SCRIPT, '--repo', root], { encoding: 'utf8' });
}

describe('guarda exacta del ambiente de build', () => {
  it('la población versionada real coincide exactamente con la allowlist', () => {
    const tracked = execFileSync('git', ['ls-files', '-z', '--', '.env*'], { encoding: 'utf8' })
      .split('\0').filter(Boolean).sort();
    expect(tracked).toEqual(AUTORIZADOS);
  });

  it('acepta únicamente las tres fixtures públicas versionadas', () => {
    const result = ejecutar(fixture());
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('3 fixtures públicas exactas');
  });

  it('la entrada CLI no queda muda cuando el path del script atraviesa un symlink', () => {
    const root = fixture();
    const link = join(root, 'guard-link.mjs');
    symlinkSync(SCRIPT, link);
    const result = spawnSync(process.execPath, [link, '--repo', root], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('entorno build OK');
  });

  it.each([
    ['root local', (root: string) => writeFileSync(join(root, '.env.development.local'), 'SECRETO=x\n')],
    ['landing', (root: string) => writeFileSync(join(root, 'landing', '.env.production'), 'SECRETO=x\n')],
    ['symlink allowlisted', (root: string) => {
      writeFileSync(join(root, 'target'), '# fixture\n');
      symlinkSync('target', join(root, '.env.mock'));
    }],
    ['hardlink allowlisted', (root: string) => linkSync(join(root, '.env.development'), join(root, 'hardlink'))],
  ])('rechaza %s', (_name, mutate) => {
    const root = fixture();
    if (_name === 'symlink allowlisted') {
      unlinkSync(join(root, '.env.mock'));
    }
    mutate(root);
    const result = ejecutar(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('entorno build inválido');
  });
});
