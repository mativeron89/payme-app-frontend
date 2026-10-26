import { execFile, execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 🔴 D493 · LOS TRES SCRIPTS DEL SALTEO DE MAIN, EJECUTADOS.
 *
 * `despliegue.test.ts` prueba que el workflow los CABLEA; acá se prueba lo que
 * HACEN, corriéndolos como los corre Actions: un proceso con su env, contra un
 * repo git temporal y una API de GitHub falsa en loopback.
 *
 *   · `ci-verificar-needs.mjs`: un shard rojo, un check rojo, un salteo sin
 *     decisión o cualquier cosa rara ⇒ ≠0 (el job `build` cae).
 *   · `ci-ya-probado.mjs`: sólo `probado=true` con una CI de PR exitosa del
 *     mismo SHA, su marca con el mismo árbol y una base ancestro. Consulta
 *     caída, SHA sin PR verde, base no ancestro o árbol distinto ⇒ `false`
 *     (suite completa). Y sale 0 igual: la consulta no frena la CI.
 *   · `ci-marcar-probado.mjs`: la marca sale del merge ref del PR, y es la que
 *     `ci-ya-probado` acepta para el SHA que llega a main.
 */
const AQUI = dirname(fileURLToPath(import.meta.url));
const VERIFICAR = join(AQUI, 'ci-verificar-needs.mjs');
const DECIDIR = join(AQUI, 'ci-ya-probado.mjs');
const MARCAR = join(AQUI, 'ci-marcar-probado.mjs');

interface Corrida { code: number; out: string; salida: string }

function correr(script: string, env: Record<string, string | undefined>, cwd: string): Promise<Corrida> {
  const dir = mkdtempSync(join(tmpdir(), 'payme-ci-salida-'));
  const salidaArchivo = join(dir, 'output');
  writeFileSync(salidaArchivo, '');
  const limpio: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME };
  for (const [k, v] of Object.entries({ GITHUB_OUTPUT: salidaArchivo, ...env })) if (v !== undefined) limpio[k] = v;
  return new Promise((ok) => {
    execFile(process.execPath, [script], { cwd, env: limpio, encoding: 'utf8' }, (err, out, errOut) => {
      const salida = readFileSync(salidaArchivo, 'utf8');
      rmSync(dir, { recursive: true, force: true });
      ok({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, out: `${out}${errOut}`, salida });
    });
  });
}

// ─── el verificador de needs ─────────────────────────────────────────────────

const needs = (decidir: string, probado: string | undefined, checks: string, playwright: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    decidir: { result: decidir, outputs: probado === undefined ? {} : { probado } },
    checks: { result: checks, outputs: {} },
    playwright: { result: playwright, outputs: {} },
    ...extra,
  });
const PUSH_MAIN = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' };
const PR = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/98/merge' };

describe('D493 · ci-verificar-needs: el primer paso de `build` frena lo que no está en verde', () => {
  const casos: ReadonlyArray<readonly [string, string, Record<string, string>, number]> = [
    ['✅ suite completa en verde (PR)', needs('success', 'false', 'success', 'success'), PR, 0],
    ['✅ suite completa en verde (push a main sin marca)', needs('success', 'false', 'success', 'success'), PUSH_MAIN, 0],
    ['✅ main con el árbol ya probado: checks y shards salteados', needs('success', 'true', 'skipped', 'skipped'), PUSH_MAIN, 0],
    ['🔴 un shard rojo ⇒ build rojo', needs('success', 'false', 'success', 'failure'), PR, 1],
    ['🔴 un shard cancelado ⇒ build rojo', needs('success', 'false', 'success', 'cancelled'), PR, 1],
    ['🔴 checks rojo ⇒ build rojo', needs('success', 'false', 'failure', 'success'), PR, 1],
    ['🔴 salteados SIN la decisión de main ⇒ build rojo', needs('success', 'false', 'skipped', 'skipped'), PUSH_MAIN, 1],
    ['🔴 probado=true en un PR ⇒ build rojo', needs('success', 'true', 'skipped', 'skipped'), PR, 1],
    ['🔴 probado=true y un shard que corrió y falló ⇒ build rojo', needs('success', 'true', 'skipped', 'failure'), PUSH_MAIN, 1],
    ['🔴 decidir rojo ⇒ build rojo', needs('failure', undefined, 'skipped', 'skipped'), PUSH_MAIN, 1],
    ['🔴 decidir sin respuesta ⇒ build rojo', needs('success', undefined, 'success', 'success'), PR, 1],
    ['🔴 un valor raro de probado ⇒ build rojo', needs('success', 'si', 'skipped', 'skipped'), PUSH_MAIN, 1],
    ['🔴 un job de más en needs ⇒ build rojo', needs('success', 'false', 'success', 'success', { otro: { result: 'success' } }), PR, 1],
    ['🔴 NEEDS que no es JSON ⇒ build rojo', '{roto', PR, 1],
  ];
  for (const [nombre, valor, evento, esperado] of casos) {
    it(nombre, async () => {
      const r = await correr(VERIFICAR, { NEEDS: valor, ...evento }, AQUI);
      expect(r.code, r.out).toBe(esperado);
    });
  }
  it('🔴 sin NEEDS ⇒ build rojo', async () => {
    expect((await correr(VERIFICAR, PR, AQUI)).code).toBe(1);
  });
});

// ─── un repo con base, head y el merge ref de un PR ──────────────────────────

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'sonda', GIT_AUTHOR_EMAIL: 'sonda@ejemplo.invalid',
  GIT_COMMITTER_NAME: 'sonda', GIT_COMMITTER_EMAIL: 'sonda@ejemplo.invalid',
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();

let repo = '';
let base = '';
let head = '';
let merge = '';
let ajeno = '';
const arbol = (sha: string) => git(repo, 'rev-parse', `${sha}^{tree}`);

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'payme-ci-repo-'));
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'base\n');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'base');
  base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '-b', 'pr');
  writeFileSync(join(repo, 'b.txt'), 'cambio del PR\n');
  git(repo, 'add', 'b.txt');
  git(repo, 'commit', '-q', '-m', 'head del PR');
  head = git(repo, 'rev-parse', 'HEAD');
  // El merge ref de GitHub: un merge de head sobre la base, aunque sea fast-forward.
  git(repo, 'checkout', '-q', '--detach', base);
  git(repo, 'merge', '-q', '--no-ff', '-m', 'merge ref', head);
  merge = git(repo, 'rev-parse', 'HEAD');
  // Un commit que NO es ancestro de head.
  git(repo, 'checkout', '-q', '-b', 'otra', base);
  writeFileSync(join(repo, 'c.txt'), 'otra rama\n');
  git(repo, 'add', 'c.txt');
  git(repo, 'commit', '-q', '-m', 'ajeno');
  ajeno = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '--detach', head);
});
afterAll(() => { if (repo) rmSync(repo, { recursive: true, force: true }); });

// ─── la API de GitHub, falsa ─────────────────────────────────────────────────

interface Estado {
  status: number;
  runs: unknown[];
  artefactos: Record<string, unknown[]>;
  pedidos: string[];
}
const estado: Estado = { status: 200, runs: [], artefactos: {}, pedidos: [] };
let servidor: Server;
let api = '';
const WORKFLOW = 315931082;
const RUN_ACTUAL = 900;

beforeAll(async () => {
  servidor = createServer((req, res) => {
    const url = req.url ?? '';
    estado.pedidos.push(url);
    if (req.headers.authorization !== 'Bearer clave-de-prueba') { res.writeHead(401).end('{}'); return; }
    if (estado.status !== 200) { res.writeHead(estado.status).end('{}'); return; }
    const json = (v: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v)); };
    if (url === `/repos/o/r/actions/runs/${RUN_ACTUAL}`) return json({ id: RUN_ACTUAL, workflow_id: WORKFLOW });
    if (url.startsWith(`/repos/o/r/actions/workflows/${WORKFLOW}/runs?`)) return json({ workflow_runs: estado.runs });
    const m = /^\/repos\/o\/r\/actions\/runs\/(\d+)\/artifacts/.exec(url);
    if (m) return json({ artifacts: estado.artefactos[m[1]!] ?? [] });
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const dir = servidor.address();
  api = `http://127.0.0.1:${typeof dir === 'object' && dir ? dir.port : 0}`;
});
afterAll(() => new Promise<void>((ok) => servidor.close(() => ok())));

const runPr = (extra: Record<string, unknown> = {}) => ({
  id: 77, event: 'pull_request', status: 'completed', conclusion: 'success', head_sha: head, workflow_id: WORKFLOW, ...extra,
});
const marca = (t: string, b: string, extra: Record<string, unknown> = {}) => ({
  name: `ci-probado-arbol-${t}-base-${b}`, expired: false, ...extra,
});
const decidir = (env: Record<string, string | undefined> = {}) =>
  correr(DECIDIR, {
    ...PUSH_MAIN, GITHUB_SHA: head, GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: String(RUN_ACTUAL),
    GITHUB_API_URL: api, CONSULTA_GH: 'clave-de-prueba', ...env,
  }, repo);
const preparar = (runs: unknown[], artefactos: Record<string, unknown[]>, status = 200) => {
  estado.status = status;
  estado.runs = runs;
  estado.artefactos = artefactos;
  estado.pedidos = [];
};

describe('D493 · ci-ya-probado: main saltea la suite SÓLO con el árbol ya probado', () => {
  it('✅ CONTROL POSITIVO · CI de PR verde, marca del mismo árbol y base ancestro ⇒ probado=true', async () => {
    preparar([runPr()], { 77: [marca(arbol(merge), base)] });
    expect(arbol(merge), 'el merge ref de un PR al día tiene el árbol de su head').toBe(arbol(head));
    const r = await decidir();
    expect(r.code, r.out).toBe(0);
    expect(r.salida).toBe('probado=true\n');
  });

  const FALSOS: ReadonlyArray<readonly [string, () => void, Record<string, string | undefined>?]> = [
    ['🔴 consulta caída (HTTP 500) ⇒ suite completa', () => preparar([runPr()], { 77: [marca(arbol(merge), base)] }, 500)],
    ['🔴 SHA sin CI de PR verde ⇒ suite completa', () => preparar([], {})],
    ['🔴 la CI del PR falló ⇒ suite completa', () => preparar([runPr({ conclusion: 'failure' })], { 77: [marca(arbol(merge), base)] })],
    ['🔴 la base de la marca NO es ancestro ⇒ suite completa', () => preparar([runPr()], { 77: [marca(arbol(merge), ajeno)] })],
    ['🔴 la marca es de otro árbol ⇒ suite completa', () => preparar([runPr()], { 77: [marca(arbol(ajeno), base)] })],
    ['🔴 la corrida de PR no dejó marca ⇒ suite completa', () => preparar([runPr()], { 77: [] })],
    ['🔴 la marca venció ⇒ suite completa', () => preparar([runPr()], { 77: [marca(arbol(merge), base, { expired: true })] })],
    ['🔴 la corrida es de otro workflow ⇒ suite completa', () => preparar([runPr({ workflow_id: 1 })], { 77: [marca(arbol(merge), base)] })],
    ['🔴 la corrida es de otro SHA ⇒ suite completa', () => preparar([runPr({ head_sha: ajeno })], { 77: [marca(arbol(merge), base)] })],
    ['🔴 la corrida no es de pull_request ⇒ suite completa', () => preparar([runPr({ event: 'push' })], { 77: [marca(arbol(merge), base)] })],
    ['🔴 sin token ⇒ suite completa', () => preparar([runPr()], { 77: [marca(arbol(merge), base)] }), { CONSULTA_GH: undefined }],
    ['🔴 la API no responde ⇒ suite completa', () => preparar([runPr()], { 77: [marca(arbol(merge), base)] }), { GITHUB_API_URL: 'http://127.0.0.1:9' }],
  ];
  for (const [nombre, plantar, env] of FALSOS) {
    it(nombre, async () => {
      plantar();
      const r = await decidir(env ?? {});
      expect(r.code, `la consulta no puede frenar la CI:\n${r.out}`).toBe(0);
      expect(r.salida).toBe('probado=false\n');
    });
  }

  it('🔴 en un PR ni consulta: suite completa', async () => {
    preparar([runPr()], { 77: [marca(arbol(merge), base)] });
    const r = await decidir(PR);
    expect(r.salida).toBe('probado=false\n');
    expect(estado.pedidos).toEqual([]);
  });

  it('🔴 un push a otra rama ⇒ suite completa', async () => {
    preparar([runPr()], { 77: [marca(arbol(merge), base)] });
    const r = await decidir({ GITHUB_REF: 'refs/heads/otra' });
    expect(r.salida).toBe('probado=false\n');
  });
});

describe('D493 · ci-marcar-probado: la marca sale del merge ref del PR', () => {
  it('✅ deja árbol y base del merge ref, y ci-ya-probado la acepta para el head que llega a main', async () => {
    git(repo, 'checkout', '-q', '--detach', merge);
    try {
      const r = await correr(MARCAR, PR, repo);
      expect(r.code, r.out).toBe(0);
      const nombre = `ci-probado-arbol-${arbol(merge)}-base-${base}`;
      expect(r.salida).toBe(`nombre=${nombre}\n`);
      expect(JSON.parse(readFileSync(join(repo, '.ci-probado'), 'utf8'))).toEqual({ arbol: arbol(merge), base, merge });

      // Ida y vuelta: esa misma marca, en la corrida del PR, habilita el salteo.
      git(repo, 'checkout', '-q', '--detach', head);
      preparar([runPr()], { 77: [{ name: nombre, expired: false }] });
      expect((await decidir()).salida).toBe('probado=true\n');
    } finally {
      rmSync(join(repo, '.ci-probado'), { force: true });
      git(repo, 'checkout', '-q', '--detach', head);
    }
  });

  it('🔴 fuera de un PR no deja marca', async () => {
    git(repo, 'checkout', '-q', '--detach', merge);
    try {
      const r = await correr(MARCAR, PUSH_MAIN, repo);
      expect(r.code).not.toBe(0);
      expect(r.salida).toBe('');
    } finally {
      git(repo, 'checkout', '-q', '--detach', head);
    }
  });

  it('🔴 si HEAD no es un merge ref no deja marca', async () => {
    const r = await correr(MARCAR, PR, repo);
    expect(r.code).not.toBe(0);
    expect(r.salida).toBe('');
  });
});
