import { describe, it, expect, vi } from 'vitest';
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
  env: NodeJS.ProcessEnv;
  base: string;
};
type Change = (ctx: Context) => void;
type Options = {
  policy?: ReturnType<typeof realPolicy>;
  useBaseCli?: boolean;
  cwd?: string;
  indexOnly?: boolean;
  prepareBase?: Change;
  revisions?: (ctx: Context, head: string) => string[];
  cliEnv?: (ctx: Context) => NodeJS.ProcessEnv;
};
// Repos sintéticos por caso, sin red ni datos reales. Cambios sólo de índice no pasan por add.
function scenario(change: Change, options: Options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'payme-carriles-'));
  const env = { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args: string[]) => execFileSync('git', args, {
    cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const put = (path: string, value: string) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), value); };
  try {
    git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    put('carriles.json', JSON.stringify(options.policy ?? realPolicy()));
    put('CHANGELOG.md', 'base\n'); put('docs/permitido.md', 'base\n');
    put('docs/DESPLIEGUE_GATEADO.md', 'base\n'); put('src/App.tsx', 'base\n');
    put('package.json', JSON.stringify({ name: 'fixture', version: '1.2.3' }));
    put('package-lock.json', JSON.stringify({ version: '1.2.3', packages: { '': { version: '1.2.3' } } }));
    options.prepareBase?.({ put, dir, git, base: '', env });
    git('add', '--', 'carriles.json', 'CHANGELOG.md', 'docs/permitido.md', 'docs/DESPLIEGUE_GATEADO.md', 'src/App.tsx', 'package.json', 'package-lock.json');
    if (options.useBaseCli) {
      put('scripts/carril-rapido.mjs', readFileSync(cli, 'utf8'));
      git('add', '--', 'scripts/carril-rapido.mjs');
    }
    git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
    const ctx = { put, dir, git, base, env };
    change(ctx);
    if (!options.indexOnly) {
      const paths = git('ls-files', '--modified', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
      if (paths.length) git('add', '--', ...paths);
    }
    git('commit', '--allow-empty', '-qm', 'cambio'); const head = git('rev-parse', 'HEAD');
    const args = options.revisions?.(ctx, head) ?? [base, head];
    const baseCli = join(dir, '.git/carril-base.mjs');
    if (options.useBaseCli) writeFileSync(baseCli, execFileSync('git', ['show', `${base}:scripts/carril-rapido.mjs`], { cwd: dir, env }));
    return spawnSync(process.execPath, [options.useBaseCli ? baseCli : cli, ...args], {
      cwd: join(dir, options.cwd ?? ''), env: { ...env, ...options.cliEnv?.(ctx) }, encoding: 'utf8',
    });
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
const rejected = (r: ReturnType<typeof scenario>, code: 1 | 2) => {
  expect(r.error).toBeUndefined();
  expect(r.status, r.stderr).toBe(code);
};
describe('D744/D748 · C119c · CLI contra commits', () => {
  it('el helper falla si el motivo del rechazo cambia de código', () => {
    const protegida = scenario(({ put }) => put('src/App.tsx', 'cambio'));
    const vacia = scenario(() => {});
    const invalida = scenario(changeLog, { revisions: ({ base }, head) => [base, head, 'extra'] });
    expect(() => rejected(protegida, 2)).toThrow();
    expect(() => rejected(vacia, 2)).toThrow();
    expect(() => rejected(invalida, 2)).toThrow();
  });

  it('A1 CHANGELOG positivo; src negativo', () => {
    expect(scenario(changeLog).status).toBe(0);
    rejected(scenario(({ put }) => put('src/App.tsx', 'cambio\n')), 1);
  });
  it('A2 prohibida gana con permiso sintético y control positivo en la misma política', () => {
    const policy = syntheticPolicy();
    expect(scenario(({ put }) => put('docs/permitido.md', 'cambio\n'), { policy }).status).toBe(0);
    rejected(scenario(({ put }) => put('docs/DESPLIEGUE_GATEADO.md', 'cambio\n'), { policy }), 1);
  });
  it('política real exacta y spec explícitamente prohibida', () => {
    expect(realPolicy().rapido).toEqual(['CHANGELOG.md']);
    expect(realPolicy().prohibidas).toContain('e2e/inicio-pestanas-misma-altura.spec.ts');
  });
  it('A3 docs nuevos y la spec rechazados por conducta', () => {
    for (const path of [...deniedDocs, 'e2e/inicio-pestanas-misma-altura.spec.ts']) {
      rejected(scenario(({ put }) => put(path, 'MARCADOR SINTÉTICO\n')), path === 'e2e/inicio-pestanas-misma-altura.spec.ts' ? 1 : 2);
    }
  });
  it('A3 symlink, +x y submódulo desde docs y src con permiso sintético', () => {
    for (const cwd of ['docs', 'src']) {
      rejected(scenario(({ dir }) => { rmSync(join(dir, 'CHANGELOG.md')); symlinkSync('destino-inexistente', join(dir, 'CHANGELOG.md')); }, { cwd }), 2);
      rejected(scenario(({ dir }) => chmodSync(join(dir, 'CHANGELOG.md'), 0o755), { cwd }), 2);
      rejected(scenario(({ git, base }) => git('update-index', '--add', '--cacheinfo', `160000,${base},docs/submodulo`), { cwd, policy: syntheticPolicy(), indexOnly: true }), 2);
    }
  });
  it('A3 package +x, borrado de CHANGELOG y desconocidos rechazados', () => {
    rejected(scenario(ctx => { version('1.2.4')(ctx); chmodSync(join(ctx.dir, 'package.json'), 0o755); }), 2);
    rejected(scenario(({ dir }) => rmSync(join(dir, 'CHANGELOG.md'))), 2);
    rejected(scenario(({ put }) => put('sin-clasificar.txt', 'x')), 2);
  });
  it('A3 positivo desde src exige full-tree, sin taparlo con negativos', () => {
    const result = scenario(changeLog, { cwd: 'src' });
    expect(result.status, result.stderr).toBe(0);
  });
  it('A3 no UTF-8 sólo de índice exige vacío cierra con política sintética', () => {
    rejected(scenario(({ git, dir, env }) => {
      const blob = git('hash-object', '-w', '--stdin');
      // El byte ff sólo se crea en el índice de Git: nunca en el filesystem de macOS.
      execFileSync('bash', ['-c', 'git update-index --add --cacheinfo "120000,$1,$(printf \'docs/\\377.md\')"', 'fixture', blob], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    }, { policy: syntheticPolicy(), indexOnly: true }), 2);
  });
  it('A3 versión ascendente estricta y texto exacto; sin cambios extra', () => {
    expect(scenario(version('1.2.4')).status).toBe(0);
    for (const v of ['1.2.2', 'v1.2.4', '1.2.4-beta', '01.2.4']) rejected(scenario(version(v)), 2);
    rejected(scenario(version('1.2.4', true)), 2);
    rejected(scenario(({ put }) => put('package.json', '{"name":"fixture","version":"1.2.4"}')), 2);
    rejected(scenario(ctx => { version('1.2.4')(ctx); ctx.put('package.json', '{ "name": "fixture", "version": "1.2.4" }'); }), 2);
    // Versión igual con diferencia real: no puede morir por rango vacío.
    rejected(scenario(({ put }) => {
      put('package.json', '{ "name":"fixture","version":"1.2.3"}');
      put('package-lock.json', '{ "version":"1.2.3","packages":{"":{"version":"1.2.3"}}}');
    }), 2);
    rejected(scenario(ctx => { version('1.2.4')(ctx); ctx.put('package.json', '{"name":"fixture","scripts":{"test":"MARCADOR"},"scripts":{},"version":"1.2.4"}'); }), 2);
  });
  it('A3 política de la base aunque la rama se autoautorice', () => {
    rejected(scenario(({ put }) => {
      put('carriles.json', JSON.stringify({ ...realPolicy(), prohibidas: [], rapido: ['src/App.tsx', 'carriles.json'] }));
      put('src/App.tsx', 'cambio\n');
    }), 1);
  });
});

describe('C140 · historial y estados del carril', () => {
  it('distingue una ruta protegida, una ruta normal, un rango vacío y uso inválido', () => {
    expect(scenario(({ put }) => put('src/App.tsx', 'nuevo')).status).toBe(1);
    expect(scenario(({ put }) => put('README.md', 'nuevo')).status).toBe(2);
    expect(scenario(() => {}).status).toBe(3);
    expect(scenario(changeLog, { revisions: ({ base }, head) => [base, head, 'extra'] }).status).toBe(4);
    expect(scenario(changeLog, { revisions: ({ base }, head) => [base.slice(0, 12), head] }).status).toBe(4);
  });

  it('rechaza el SHA corto de la cabeza antes de consultar Git', () => {
    const result = scenario(changeLog, { revisions: ({ base }, head) => [base, head.slice(0, 12)] });
    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('uso:');
  });

  it.each(['/src/**', 'src\0'])('rechaza la regla prohibida inválida %j', rule => {
    const result = scenario(changeLog, { policy: { ...realPolicy(), prohibidas: [rule] } });
    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('política inválida');
  });

  it('rechaza una raíz huérfana unida por merge aunque no haya delta contra ella', () => {
    const result = scenario(changeLog, {
      revisions: ({ base, git }, head) => {
        const tree = git('rev-parse', `${head}^{tree}`);
        const orphan = git('commit-tree', tree, '-m', 'raíz ajena');
        const merge = git('commit-tree', tree, '-p', head, '-p', orphan, '-m', 'merge de raíz ajena');
        return [base, merge];
      },
    });
    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('commit sin padre');
  });

  it('desactiva commit-graph en cada llamada a Git', () => {
    const result = scenario(changeLog, {
      revisions: ({ put, dir, base }, head) => {
        put('fixture-bin/git', '#!/bin/sh\ncase " $* " in *" -c core.commitGraph=false "*) ;; *) exit 79 ;; esac\nPATH="$FIXTURE_PATH" exec git "$@"\n');
        chmodSync(join(dir, 'fixture-bin/git'), 0o755);
        return [base, head];
      },
      cliEnv: ({ dir, env }) => ({
        PATH: `${join(dir, 'fixture-bin')}:${env.PATH}`,
        FIXTURE_PATH: env.PATH,
      }),
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('rechaza una base hermana aunque el diff entre puntas sólo tenga CHANGELOG', () => {
    const result = scenario(changeLog, {
      revisions: ({ base, git }, head) => {
        const sibling = git('commit-tree', git('rev-parse', `${base}^{tree}`), '-p', base, '-m', 'hermano');
        return [sibling, head];
      },
    });
    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('ancestro');
  });

  it('rechaza una política inválida y exige la pareja declarada de versión', () => {
    expect(scenario(changeLog, { policy: { ...realPolicy(), rapido: ['docs/../CHANGELOG.md'] } }).status).toBe(4);
    expect(scenario(changeLog, { policy: { ...realPolicy(), rapido: [''] } }).status).toBe(4);
    expect(scenario(version('1.2.4'), { policy: { ...realPolicy(), version_sola: [] } }).status).toBe(2);
  });

  it('encuentra una ruta protegida en un commit intermedio revertido', () => {
    const result = scenario(({ git, put }) => {
      put('src/App.tsx', 'temporal\n');
      git('add', '--', 'src/App.tsx'); git('commit', '-qm', 'intermedio');
      put('src/App.tsx', 'base\n'); put('CHANGELOG.md', 'final\n');
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('src/App.tsx');
  });

  it('inspecciona el segundo padre del merge aunque el primer diff esté vacío', () => {
    const result = scenario(changeLog, {
      revisions: ({ base, git }, head) => {
        const otherParent = git('commit-tree', git('rev-parse', `${base}^{tree}`), '-p', base, '-m', 'rama lateral');
        const merge = git('commit-tree', git('rev-parse', `${head}^{tree}`), '-p', head, '-p', otherParent, '-m', 'merge');
        return [head, merge];
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).rutas).toEqual(['CHANGELOG.md']);
  });

  it('acepta varios cambios de versión coherentes y enumera cada ruta una vez', () => {
    const result = scenario(ctx => {
      version('1.2.4')(ctx);
      ctx.git('add', '--', 'package.json', 'package-lock.json'); ctx.git('commit', '-qm', 'primero');
      version('1.2.5')(ctx); changeLog(ctx);
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).rutas.sort()).toEqual(['CHANGELOG.md', 'package-lock.json', 'package.json']);
  });

  it('no obedece diff.relative al ejecutarse desde docs', () => {
    const result = scenario(({ git, put }) => {
      git('config', 'diff.relative', 'true');
      put('docs/CHANGELOG.md', 'señuelo'); put('src/App.tsx', 'nuevo');
    }, { cwd: 'docs' });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('src/App.tsx');
  });

  it.each(['diff.ignoreSubmodules', '.gitmodules local'])('no deja ocultar un gitlink con %s', source => {
    const result = scenario(({ git, put, base }) => {
      if (source === 'diff.ignoreSubmodules') git('config', source, 'all');
      else put('.gitmodules', '[submodule "fixture"]\n path = docs/gitlink\n ignore = all\n');
      put('CHANGELOG.md', 'nuevo'); git('add', '--', 'CHANGELOG.md');
      git('update-index', '--add', '--cacheinfo', `160000,${base},docs/gitlink`);
    }, { indexOnly: true });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('docs/gitlink');
  });

  it('ignora un reemplazo que esconde la ruta protegida', () => {
    const result = scenario(({ put }) => put('src/App.tsx', 'nuevo'), {
      revisions: ({ base, git }, head) => {
        const replacement = git('commit-tree', git('rev-parse', `${base}^{tree}`), '-p', base, '-m', 'reemplazo');
        git('replace', head, replacement);
        return [base, head];
      },
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('src/App.tsx');
  });

  it('rechaza un graft local aun si la historia visible daría rápido', () => {
    const result = scenario(changeLog, {
      revisions: ({ put, base }, head) => {
        put('.git/info/grafts', `${head} ${base}\n`);
        return [base, head];
      },
    });
    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('grafts');
  });

  it('rechaza un graft alternativo y un graft predeterminado con symlink colgante', () => {
    const alternate = scenario(changeLog, {
      revisions: ({ put, base }, head) => { put('grafts-local', `${head} ${base}\n`); return [base, head]; },
      cliEnv: () => ({ GIT_GRAFT_FILE: 'grafts-local' }),
    });
    expect(alternate.status, alternate.stderr).toBe(4);
    expect(alternate.stderr).toContain('grafts');
    const dangling = scenario(changeLog, {
      revisions: ({ dir, base }, head) => {
        symlinkSync('ausente', join(dir, '.git/info/grafts'));
        return [base, head];
      },
    });
    expect(dangling.status, dangling.stderr).toBe(4);
    expect(dangling.stderr).toContain('grafts');
  });

  it('fija el archivo de grafts en cada llamada a Git', () => {
    const result = scenario(changeLog, {
      revisions: ({ put, dir, base }, head) => {
        put('fixture-bin/git', '#!/bin/sh\n[ "$GIT_GRAFT_FILE" = /dev/null ] || exit 79\nPATH="$FIXTURE_PATH" exec git "$@"\n');
        chmodSync(join(dir, 'fixture-bin/git'), 0o755);
        return [base, head];
      },
      cliEnv: ({ dir, env }) => ({
        PATH: `${join(dir, 'fixture-bin')}:${env.PATH}`,
        FIXTURE_PATH: env.PATH,
        GIT_GRAFT_FILE: 'ausente',
      }),
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('rechaza un repositorio con historia superficial', () => {
    const result = scenario(changeLog, {
      revisions: ({ put, base }, head) => { put('.git/shallow', `${base}\n`); return [base, head]; },
    });
    expect(result.status, result.stderr).toBe(4);
    expect(result.stderr).toContain('historia incompleta');
  });

  it('las fixtures no heredan GIT_DIR ni escriben en el repo señuelo', () => {
    const decoy = mkdtempSync(join(tmpdir(), 'payme-carril-senuelo-'));
    const decoyEnv = { PATH: process.env.PATH, HOME: decoy, XDG_CONFIG_HOME: decoy, GIT_CONFIG_NOSYSTEM: '1' };
    const gitDecoy = (...args: string[]) => execFileSync('git', args, { cwd: decoy, env: decoyEnv, encoding: 'utf8' }).trim();
    try {
      gitDecoy('init', '-q');
      gitDecoy('config', 'user.name', 'Señuelo');
      gitDecoy('config', 'user.email', 'senuelo@example.invalid');
      gitDecoy('commit', '--allow-empty', '-qm', 'señuelo');
      const before = gitDecoy('rev-parse', 'HEAD');
      vi.stubEnv('GIT_DIR', join(decoy, '.git'));
      expect(scenario(changeLog).status).toBe(0);
      expect(gitDecoy('rev-parse', 'HEAD')).toBe(before);
      expect(gitDecoy('config', 'user.name')).toBe('Señuelo');
    } finally {
      vi.unstubAllEnvs();
      rmSync(decoy, { recursive: true, force: true });
    }
  });
});

describe('C140 · bordes de la política', () => {
  it('ve el origen protegido al renombrarlo hacia un destino rápido sintético', () => {
    const result = scenario(({ git }) => {
      git('config', 'diff.renames', 'true');
      git('mv', 'src/App.tsx', 'docs/App.tsx');
    }, { indexOnly: true, policy: syntheticPolicy() });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('src/App.tsx');
  });

  it('un prefijo termina en barra y un archivo regular nuevo sí puede entrar', () => {
    const policy = syntheticPolicy();
    expect(scenario(({ put }) => put('docs/nuevo.md', 'nuevo'), { policy }).status).toBe(0);
    expect(scenario(({ put }) => put('docsX.md', 'nuevo'), { policy }).status).toBe(2);
    expect(scenario(({ put }) => put('docsX/nuevo.md', 'nuevo'), { policy }).status).toBe(2);
  });

  it('rechaza un symlink nuevo y un ejecutable nuevo aun con permiso para la ruta', () => {
    const policy = syntheticPolicy();
    expect(scenario(({ dir }) => symlinkSync('ausente', join(dir, 'docs/link.md')), { policy }).status).toBe(2);
    expect(scenario(({ put, dir }) => {
      put('docs/ejecutable.md', 'nuevo'); chmodSync(join(dir, 'docs/ejecutable.md'), 0o755);
    }, { policy }).status).toBe(2);
  });

  it('desde docs conserva el mode del padre al pasar de ejecutable a regular', () => {
    const result = scenario(({ dir }) => chmodSync(join(dir, 'CHANGELOG.md'), 0o644), {
      cwd: 'docs', prepareBase: ({ dir }) => chmodSync(join(dir, 'CHANGELOG.md'), 0o755),
    });
    expect(result.status, result.stderr).toBe(2);
  });

  it('consulta literalmente el nombre aunque contenga sintaxis de pathspec', () => {
    const path = ':(glob)marcador.md';
    const policy = { ...realPolicy(), rapido: [path] };
    const result = scenario(({ git }) => {
      const blob = git('hash-object', '-w', '--stdin');
      git('update-index', '--add', '--cacheinfo', `100644,${blob},${path}`);
    }, { policy, indexOnly: true });
    expect(result.status, result.stderr).toBe(0);
  });

  it('no deja que un salto de versión autorice una ruta desconocida', () => {
    const result = scenario(ctx => { version('1.2.4')(ctx); ctx.put('sin-clasificar.txt', 'nuevo'); });
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('sin-clasificar.txt');
  });

  it.each(['package.json', 'package-lock.json'])('rechaza otra clave que copie la versión en %s', path => {
    const withExtra = (v: string, ctx: Context) => {
      version(v)(ctx);
      const full = join(ctx.dir, path);
      const manifest = JSON.parse(readFileSync(full, 'utf8'));
      manifest.description = v;
      ctx.put(path, JSON.stringify(manifest));
    };
    const result = scenario(ctx => withExtra('1.2.4', ctx), { prepareBase: ctx => withExtra('1.2.3', ctx) });
    expect(result.status, result.stderr).toBe(2);
  });

  it('rechaza un lock con raíz atrasada o con otra integridad', () => {
    const lock = (version: string, root: string, integrity: string) =>
      JSON.stringify({ version, packages: { '': { version: root }, 'node_modules/fixture': { integrity } } });
    const prepareBase: Change = ({ put }) => put('package-lock.json', lock('1.2.3', '1.2.3', 'original'));
    for (const next of [lock('1.2.4', '1.2.3', 'original'), lock('1.2.4', '1.2.4', 'distinta')]) {
      const result = scenario(ctx => {
        version('1.2.4')(ctx); ctx.put('package-lock.json', next);
      }, { prepareBase });
      expect(result.status, result.stderr).toBe(2);
    }
  });

  it('usa los bytes de la herramienta de base aunque el candidato sustituya el script', () => {
    const result = scenario(({ put }) => {
      put('scripts/carril-rapido.mjs', 'console.log("cli-candidata");\n');
      put('src/App.tsx', 'nuevo');
    }, {
      useBaseCli: true,
      revisions: ({ base, dir, env }, head) => {
        const candidate = spawnSync(process.execPath, [join(dir, 'scripts/carril-rapido.mjs'), base, head], {
          cwd: dir, env, encoding: 'utf8',
        });
        expect(candidate.status, candidate.stderr).toBe(0);
        expect(candidate.stdout.trim()).toBe('cli-candidata');
        return [base, head];
      },
    });
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('src/App.tsx');
  });
});
