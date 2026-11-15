import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve('scripts/ci-alcance-visible.mjs');
const gitEnv = { PATH: process.env.PATH, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'CI', GIT_AUTHOR_EMAIL: 'ci@example.invalid', GIT_COMMITTER_NAME: 'CI', GIT_COMMITTER_EMAIL: 'ci@example.invalid' };
function escenario(paths: string[], expected: boolean, opts: { rename?: boolean; badBase?: boolean; badEvent?: boolean; event?: string; diverge?: boolean; baseRef?: string; ref?: string; missingBaseRef?: boolean; missingRef?: boolean; renameInto?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-visible-'));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: gitEnv, encoding: 'utf8' }).trim();
  const put = (p: string, s: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
  try {
    git('init', '-q'); const initial = opts.renameInto ?? 'docs/a.md'; put(initial, 'base\n'); git('add', initial); git('commit', '-qm', 'base');
    let base = git('rev-parse', 'HEAD');
    if (opts.renameInto) { mkdirSync(join(dir, 'docs'), { recursive: true }); git('mv', opts.renameInto, opts.renameInto.endsWith('.tsx') ? 'docs/x.md' : 'docs/a.md'); }
    if (opts.rename) { mkdirSync(join(dir, 'src')); git('mv', 'docs/a.md', 'src/a.ts'); }
    for (const p of paths) put(p, 'cambio\n');
    git('add', '--all'); git('commit', '--allow-empty', '-qm', 'cambio');
    const head = git('rev-parse', 'HEAD');
    if (opts.diverge) { git('checkout', '-q', '--detach', base); put('src/solo-base.ts', 'base nueva\n'); git('add', 'src/solo-base.ts'); git('commit', '-qm', 'base avanza'); base = git('rev-parse', 'HEAD'); }
    const event = opts.event ?? 'pull_request';
    const payload = event === 'push' ? { before: base, after: head, ref: opts.ref ?? 'refs/heads/main' } : { pull_request: { base: { sha: base, ref: opts.baseRef ?? 'main' }, head: { sha: head } } };
    if (opts.missingBaseRef && 'pull_request' in payload) delete (payload.pull_request!.base as { ref?: string }).ref;
    if (opts.missingRef && 'before' in payload) delete (payload as { ref?: string }).ref;
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

describe('D807 K7–K11 · el salteo hereda sólo la base main', () => {
  it('K7 PR sobre feature → true', () => escenario(['docs/x.md'], true, { baseRef: 'feature' }));
  it('K8 PR sin base.ref → true', () => escenario(['docs/x.md'], true, { missingBaseRef: true }));
  it('K8 PR con base.ref vacío → true', () => escenario(['docs/x.md'], true, { baseRef: '' }));
  it('K9 push a feature → true', () => escenario(['docs/x.md'], true, { event: 'push', ref: 'refs/heads/feature' }));
  it('K9 push sin ref → true', () => escenario(['docs/x.md'], true, { event: 'push', missingRef: true }));
  it('K9 push con ref vacío → true', () => escenario(['docs/x.md'], true, { event: 'push', ref: '' }));
  it('K9 workflow_dispatch → true', () => escenario(['docs/x.md'], true, { event: 'workflow_dispatch' }));
  it('K10 PR sobre main → false', () => escenario(['docs/x.md'], false, { baseRef: 'main' }));
  it('K10 push a main → false', () => escenario(['docs/x.md'], false, { event: 'push', ref: 'refs/heads/main' }));
  for (const source of ['src/a.ts', 'src/x.tsx']) it(`K11 renombre ${source} → docs → true`, () => escenario([], true, { renameInto: source }));
  for (const path of ['scripts/README.md', 'src/docs/x.tsx', 'src/x.md.tsx']) it(`K11 ${path} → true`, () => escenario([path], true));
});
