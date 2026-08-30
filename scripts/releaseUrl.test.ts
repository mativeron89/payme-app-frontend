import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calcularDigestRaiz,
  configBosaCanonico,
  serializarJsonCanonico,
  type ArchivoRelease,
  type ManifiestoArtefactoRelease,
} from './releaseArtifact';

const AQUI = dirname(new URL(import.meta.url).pathname);
const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const temporales: string[] = [];
const servidores: Server[] = [];

interface FixtureUrl {
  readonly stage: string;
  readonly artifact: 'app' | 'landing';
  readonly manifestSha256: string;
  readonly rootSha256: string;
  readonly cuerpos: ReadonlyMap<string, Buffer>;
}

/** Mismas rutas que sondea el verificador, escritas acá a propósito. */
const SONDA_CODE_META = 'PAYMESONDABOSA0000000000';
const RUTAS_META = ['/privacy', `/facebook-data-deletion/${SONDA_CODE_META}`];
const HEADERS_META: Readonly<Record<string, string>> = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
};

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function escribir(ruta: string, contenido: string | Buffer): void {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
}

function fixture(artifact: 'app' | 'landing' = 'app'): FixtureUrl {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'payme-release-url-')));
  temporales.push(base);
  const stage = join(base, 'stage');
  const output = join(stage, '.vercel', 'output');
  const staticDir = join(output, 'static');
  mkdirSync(staticDir, { recursive: true });
  const marker = serializarJsonCanonico({
    artifact,
    clean: true,
    commit_sha: COMMIT,
    schema: 1,
    tree_sha: TREE,
  });
  const cuerpos = new Map<string, Buffer>([
    ['/assets/app.js', Buffer.from('globalThis.payme = true;\n')],
    ['/index.html', Buffer.from('<!doctype html><title>PayMe</title>\n')],
    ['/release.json', Buffer.from(marker)],
  ]);
  for (const [ruta, bytes] of cuerpos) escribir(join(staticDir, ruta.slice(1)), bytes);
  const config = Buffer.from(configBosaCanonico(artifact));
  escribir(join(output, 'config.json'), config);
  const archivos: ArchivoRelease[] = [
    { path: 'config.json', size: config.byteLength, sha256: sha256(config) },
    ...[...cuerpos.entries()].map(([ruta, bytes]) => ({
      path: `static${ruta}`,
      size: bytes.byteLength,
      sha256: sha256(bytes),
    })),
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const manifiesto: ManifiestoArtefactoRelease = {
    schema: 1,
    artifact,
    clean: true,
    commit_sha: COMMIT,
    tree_sha: TREE,
    hash_algorithm: 'sha256',
    manifest_scope: '.vercel/output',
    files: archivos,
    root_sha256: calcularDigestRaiz(archivos),
  };
  const texto = serializarJsonCanonico(manifiesto as unknown as Parameters<typeof serializarJsonCanonico>[0]);
  escribir(join(stage, 'release-manifest.json'), texto);
  return {
    stage,
    artifact,
    manifestSha256: sha256(texto),
    rootSha256: manifiesto.root_sha256,
    cuerpos,
  };
}

async function servidor(
  cuerpos: ReadonlyMap<string, Buffer>,
  mutar?: (ruta: string, bytes: Buffer) => { status?: number; body?: Buffer; location?: string },
) {
  const hits = new Map<string, number>();
  const instantes = new Map<string, number[]>();
  const server = createServer((req, res) => {
    const ruta = req.url ?? '/';
    hits.set(ruta, (hits.get(ruta) ?? 0) + 1);
    instantes.set(ruta, [...(instantes.get(ruta) ?? []), Date.now()]);
    const original = cuerpos.get(ruta === '/' ? '/index.html' : ruta);
    if (!original) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const cambio = mutar?.(ruta, original) ?? {};
    res.statusCode = cambio.status ?? 200;
    if (cambio.location) res.setHeader('location', cambio.location);
    res.end(cambio.body ?? original);
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('servidor de test sin puerto');
  return { hits, instantes, url: `http://127.0.0.1:${address.port}/` };
}

function ejecutar(f: FixtureUrl, url: string, extra: readonly string[] = []) {
  const args = [
    join(AQUI, 'verify-release-url.mjs'),
    '--stage', f.stage,
    '--url', url,
    '--artifact', f.artifact,
    '--commit', COMMIT,
    '--tree', TREE,
    '--manifest-sha256', f.manifestSha256,
    '--root-sha256', f.rootSha256,
    ...extra,
  ];
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: AQUI,
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

afterEach(async () => {
  while (servidores.length > 0) {
    const server = servidores.pop()!;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  while (temporales.length > 0) rmSync(temporales.pop()!, { recursive: true, force: true });
});

interface RespuestaMeta {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: Buffer;
}

/**
 * Servidor que además de los estáticos sellados atiende las dos rutas Meta. El
 * responder recibe la ruta y devuelve la respuesta cruda: así cada mutante
 * planta UNA desviación (status, cabecera faltante, valor distinto) sin tocar
 * el resto del contrato.
 */
async function servidorMeta(
  cuerpos: ReadonlyMap<string, Buffer>,
  responder: (ruta: string) => RespuestaMeta | null,
) {
  const metaHits: string[] = [];
  const server = createServer((req, res) => {
    const ruta = req.url ?? '/';
    const meta = responder(ruta);
    if (meta) {
      metaHits.push(ruta);
      for (const [clave, valor] of Object.entries(meta.headers)) res.setHeader(clave, valor);
      res.statusCode = meta.status;
      res.end(meta.body ?? Buffer.alloc(0));
      return;
    }
    const original = cuerpos.get(ruta === '/' ? '/index.html' : ruta);
    if (!original) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.end(original);
  });
  servidores.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('servidor de test sin puerto');
  return { metaHits, url: `http://127.0.0.1:${address.port}/` };
}

/** App conforme: 200, las dos cabeceras exactas y el index sellado. */
const appConforme = (index: Buffer) => (ruta: string): RespuestaMeta | null =>
  RUTAS_META.includes(ruta) ? { status: 200, headers: { ...HEADERS_META }, body: index } : null;

/** Landing conforme: 404 y NINGUNA cabecera Meta. */
const landingConforme = (ruta: string): RespuestaMeta | null =>
  RUTAS_META.includes(ruta) ? { status: 404, headers: {} } : null;

describe('compuerta remota de las dos rutas Meta · preparada, no armada', () => {
  it('sin --bosa-routes NO se emite una sola request a las rutas Meta', async () => {
    const f = fixture();
    const web = await servidorMeta(f.cuerpos, appConforme(f.cuerpos.get('/index.html')!));
    const resultado = await ejecutar(f, web.url);
    expect(resultado.code).toBe(0);
    // El default es inerte: ésta es la propiedad que la orden exige HOY.
    expect(web.metaHits).toEqual([]);
    expect(JSON.parse(resultado.stdout).bosa_routes).toBe('skipped');
  });

  it('--bosa-routes skip explícito tampoco sondea', async () => {
    const f = fixture();
    const web = await servidorMeta(f.cuerpos, appConforme(f.cuerpos.get('/index.html')!));
    const resultado = await ejecutar(f, web.url, ['--bosa-routes', 'skip']);
    expect(resultado.code).toBe(0);
    expect(web.metaHits).toEqual([]);
  });

  it('🔴 un modo de sonda desconocido no cae al default: falla cerrado', async () => {
    const f = fixture();
    const web = await servidorMeta(f.cuerpos, appConforme(f.cuerpos.get('/index.html')!));
    const resultado = await ejecutar(f, web.url, ['--bosa-routes', 'quizas']);
    expect(resultado.code).toBe(1);
    expect(resultado.stderr).toContain('modo de sonda BOSA invalido');
    expect(web.metaHits).toEqual([]);
  });

  it('App conforme: sondea las DOS rutas y las acredita', async () => {
    const f = fixture('app');
    const web = await servidorMeta(f.cuerpos, appConforme(f.cuerpos.get('/index.html')!));
    const resultado = await ejecutar(f, web.url, ['--bosa-routes', 'probe']);
    expect(resultado.stderr).toBe('');
    expect(resultado.code).toBe(0);
    expect(web.metaHits).toEqual(RUTAS_META);
    expect(JSON.parse(resultado.stdout).bosa_routes).toBe('probed');
    expect(resultado.stdout).not.toContain(web.url);
  });

  it('Landing conforme: 404 sin cabeceras Meta en las DOS rutas', async () => {
    const f = fixture('landing');
    const web = await servidorMeta(f.cuerpos, landingConforme);
    const resultado = await ejecutar(f, web.url, ['--bosa-routes', 'probe']);
    expect(resultado.stderr).toBe('');
    expect(resultado.code).toBe(0);
    expect(web.metaHits).toEqual(RUTAS_META);
    expect(JSON.parse(resultado.stdout).bosa_routes).toBe('probed');
  });

  it.each([
    ['App contesta 404 en una ruta Meta', 'app', (index: Buffer) => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: ruta === '/privacy' ? 404 : 200, headers: { ...HEADERS_META }, body: index }
        : null, /no respondio 200/],
    ['App pierde Referrer-Policy', 'app', (index: Buffer) => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: 200, headers: { 'cache-control': 'no-store' }, body: index }
        : null, /cabeceras exactas/],
    ['App pierde Cache-Control', 'app', (index: Buffer) => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: 200, headers: { 'referrer-policy': 'no-referrer' }, body: index }
        : null, /cabeceras exactas/],
    ['App sirve otro valor de Cache-Control', 'app', (index: Buffer) => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: 200, headers: { ...HEADERS_META, 'cache-control': 'max-age=0' }, body: index }
        : null, /cabeceras exactas/],
    ['App redirige en vez de servir', 'app', (index: Buffer) => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: 308, headers: { ...HEADERS_META, location: '/' }, body: index }
        : null, /no respondio 200/],
    ['App sirve otro cuerpo que el index sellado', 'app', () => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: 200, headers: { ...HEADERS_META }, body: Buffer.from('otra cosa distinta\n') }
        : null, /tamano|index sellado/],
  ] as const)('🔴 %s deja la compuerta en rojo', async (_nombre, artifact, hacer, patron) => {
    const f = fixture(artifact);
    const web = await servidorMeta(f.cuerpos, hacer(f.cuerpos.get('/index.html')!));
    const resultado = await ejecutar(f, web.url, ['--bosa-routes', 'probe']);
    expect(resultado.code).toBe(1);
    expect(resultado.stderr).toMatch(patron);
    expect(resultado.stderr).not.toContain(web.url);
  });

  it.each([
    ['Landing contesta 200 en una ruta Meta', (index: Buffer) => (ruta: string) =>
      RUTAS_META.includes(ruta) ? { status: 200, headers: {}, body: index } : null,
    /no respondio 404/],
    ['Landing sirve Cache-Control Meta en su 404', () => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: 404, headers: { 'cache-control': 'no-store' } }
        : null, /no le corresponde/],
    ['Landing sirve Referrer-Policy Meta en su 404', () => (ruta: string) =>
      RUTAS_META.includes(ruta)
        ? { status: 404, headers: { 'referrer-policy': 'no-referrer' } }
        : null, /no le corresponde/],
  ] as const)('🔴 %s deja la compuerta en rojo', async (_nombre, hacer, patron) => {
    const f = fixture('landing');
    const web = await servidorMeta(f.cuerpos, hacer(f.cuerpos.get('/index.html')!));
    const resultado = await ejecutar(f, web.url, ['--bosa-routes', 'probe']);
    expect(resultado.code).toBe(1);
    expect(resultado.stderr).toMatch(patron);
    expect(resultado.stderr).not.toContain(web.url);
  });

  it('🔴 el manifiesto se adjudica ANTES de sondear: artifact ajeno no emite request', async () => {
    const f = fixture('landing');
    const web = await servidorMeta(f.cuerpos, landingConforme);
    // El manifiesto dice landing; la orden dice app. Se corta antes de la red.
    const resultado = await ejecutar(
      { ...f, artifact: 'app' },
      web.url,
      ['--bosa-routes', 'probe'],
    );
    expect(resultado.code).toBe(1);
    expect(web.metaHits).toEqual([]);
  });
});

describe('verificacion black-box del deployment staged', () => {
  it('verifica todos los static en dos rondas sin revelar la URL', async () => {
    const f = fixture();
    const web = await servidor(f.cuerpos);
    const resultado = await ejecutar(f, web.url);
    expect(resultado).toEqual({
      code: 0,
      stderr: '',
      stdout: serializarJsonCanonico({
        artifact: 'app',
        bosa_routes: 'skipped',
        commit_sha: COMMIT,
        files: 3,
        rounds: 2,
        tree_sha: TREE,
        verified: true,
      }),
    });
    expect([...web.hits.entries()].sort()).toEqual([
      ['/', 2],
      ['/assets/app.js', 2],
      ['/index.html', 2],
      ['/release.json', 2],
    ]);
    const rondasIndex = web.instantes.get('/') ?? [];
    expect(rondasIndex).toHaveLength(2);
    expect(rondasIndex[1]! - rondasIndex[0]!).toBeGreaterThanOrEqual(20);
    expect(resultado.stdout).not.toContain(web.url);
  });

  it('🔴 un byte remoto distinto deja el stage en rojo', async () => {
    const f = fixture();
    const web = await servidor(f.cuerpos, (ruta, bytes) => ({
      body: ruta === '/assets/app.js' ? Buffer.from(`${bytes.toString('utf8')}x`) : bytes,
    }));
    const resultado = await ejecutar(f, web.url);
    expect(resultado.code).toBe(1);
    expect(resultado.stderr).toMatch(/tamano|SHA-256/);
    expect(resultado.stderr).not.toContain(web.url);
  });

  it('🔴 no sigue redirects', async () => {
    const f = fixture();
    const web = await servidor(f.cuerpos, (ruta, bytes) => ruta === '/release.json'
      ? { status: 302, location: '/index.html', body: Buffer.alloc(0) }
      : { body: bytes });
    const resultado = await ejecutar(f, web.url);
    expect(resultado.code).toBe(1);
    expect(resultado.stderr).toContain('200 directo');
  });

  it('🔴 producción sólo admite HTTPS *.vercel.app sin query, usuario ni fragmento', async () => {
    const f = fixture();
    const secreto = 'SECRETO_EN_QUERY';
    const resultado = await ejecutar(f, `https://evil.example/?token=${secreto}`);
    expect(resultado.code).toBe(1);
    expect(resultado.stderr).toContain('contrato de origen');
    expect(resultado.stderr).not.toContain(secreto);
  });

  it('🔴 producción rechaza puertos no estándar aunque el host sea vercel.app', async () => {
    const f = fixture();
    const resultado = await ejecutar(f, 'https://payme-app-abc.vercel.app:8443/');
    expect(resultado.code).toBe(1);
    expect(resultado.stderr).toContain('contrato de origen');
  });
});
