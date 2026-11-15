import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/ci-alcance-visible.mjs');
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'CI', GIT_AUTHOR_EMAIL: 'ci@example.invalid', GIT_COMMITTER_NAME: 'CI', GIT_COMMITTER_EMAIL: 'ci@example.invalid' };
function escenario(paths: string[], expected: boolean, opts: { rename?: boolean; badBase?: boolean; badEvent?: boolean; event?: string; diverge?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-visible-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8' }).trim();
  const put = (p: string, s: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  try {
    git('init', '-q'); put('docs/a.md', 'base\n'); git('add', 'docs/a.md'); git('commit', '-qm', 'base');
    let base = git('rev-parse', 'HEAD');
    if (opts.rename) { mkdirSync(join(dir, 'src')); git('mv', 'docs/a.md', 'src/a.ts'); }
    for (const p of paths) put(p, 'cambio\n');
    git('add', '--all'); git('commit', '--allow-empty', '-qm', 'cambio');
    const head = git('rev-parse', 'HEAD');
    if (opts.diverge) { git('checkout', '-q', '--detach', base); put('src/solo-base.ts', 'base nueva\n'); git('add', 'src/solo-base.ts'); git('commit', '-qm', 'base avanza'); base = git('rev-parse', 'HEAD'); }
    const event = opts.event ?? 'pull_request';
    const payload = event === 'push' ? { before: base, after: head } : { pull_request: { base: { sha: base }, head: { sha: head } } };
    if (opts.badBase) { if ('before' in payload) payload.before = 'a'.repeat(40); else payload.pull_request!.base.sha = 'a'.repeat(40); }
    const input = join(dir, 'event.json'), output = join(dir, 'output');
    writeFileSync(input, opts.badEvent ? '{roto' : JSON.stringify(payload)); writeFileSync(output, '');
    const r = spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { ...gitEnv, GITHUB_EVENT_NAME: event, GITHUB_EVENT_PATH: input, GITHUB_OUTPUT: output } });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(readFileSync(output, 'utf8')).toBe(`visible=${expected}\n`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
describe('D807 K1 · alcance visible cerrado y conservador', () => {
  for (const [paths, expected] of [
    [['docs/x.md'], false], [['docs/diagrama.svg'], false], [['CHANGELOG.md'], false], [['nested/NOTAS.md'], false],
    [['src/screens/X.tsx'], true], [['src/screens/X.test.tsx', 'CHANGELOG.md'], false], [['src/lib/x.test.ts'], false], [['scripts/x.test.ts'], false],
    [['e2e/x.test.ts'], true], [['package-lock.json'], true], [['package.json'], true], [['.github/workflows/ci.yml'], true],
    [['scripts/ci-x.mjs'], true], [['scripts/x.ts'], true], [['src/no-test.ts'], true], [['landing/x.test.ts'], true],
    [['.github/README.md'], true], [[], true],
  ] as const) it(`${paths.join(' + ') || 'diff vacío'} → ${expected}`, () => escenario([...paths], expected));
  it('renombre que sale de docs → true', () => escenario([], true, { rename: true }));
  it('base inalcanzable → true', () => escenario(['docs/x.md'], true, { badBase: true }));
  it('error de evento → true', () => escenario(['docs/x.md'], true, { badEvent: true }));
  it('push before/after de docs → false', () => escenario(['docs/x.md'], false, { event: 'push' }));
  it('PR usa merge-base y no incluye cambios sólo de la base', () => escenario(['docs/x.md'], false, { diverge: true }));
  it('workflow_dispatch → true', () => escenario(['docs/x.md'], true, { event: 'workflow_dispatch' }));
});
