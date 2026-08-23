import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  crearMarcadorRelease,
  leerMarcadorGit,
  serializarMarcadorRelease,
  verificarReleaseBlackBox,
} from './releaseIdentity';

const COMMIT = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const COMMIT_VIEJO = 'c'.repeat(40);

describe('marker local de identidad para App y Landing', () => {
  it.each(['app', 'landing'] as const)('%s · schema, commit y tree exactos', (artefacto) => {
    expect(crearMarcadorRelease({
      artefacto,
      commitSha: COMMIT,
      treeSha: TREE,
      cambio: null,
    })).toEqual({
      schema: 1,
      artifact: artefacto,
      commit_sha: COMMIT,
      tree_sha: TREE,
      clean: true,
    });
  });

  it('🔴 fixture Git · modificar `vercel.json` explica el sufijo sucio, no su causa remota', () => {
    const repo = mkdtempSync(join(tmpdir(), 'payme-release-git-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 'PayMe test'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 'test@payme.invalid'], { cwd: repo });
      writeFileSync(join(repo, 'vercel.json'), '{"git":{"deploymentEnabled":{"main":false}}}\n');
      execFileSync('git', ['add', 'vercel.json'], { cwd: repo });
      execFileSync('git', [
        '-c', 'core.hooksPath=/dev/null',
        '-c', 'commit.gpgSign=false',
        'commit', '-qm', 'fixture',
      ], { cwd: repo });

      expect(leerMarcadorGit(repo, 'app').clean).toBe(true);
      writeFileSync(join(repo, 'vercel.json'), '{"git":{"deploymentEnabled":{"main":true}}}\n');
      const sucio = leerMarcadorGit(repo, 'app');
      expect(sucio.clean).toBe(false);
      if (sucio.clean) throw new Error('el fixture no produjo el marker sucio esperado');
      expect(sucio.dirty_path).toBe('M vercel.json');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe('verificador black-box local · dos muestras estables', () => {
  let servidor: Server;
  let baseUrl = '';
  const conteos = new Map<string, number>();
  let responder: (ruta: string, intento: number) => string;

  const marker = (artefacto: 'app' | 'landing', commit = COMMIT, cambio: string | null = null) =>
    serializarMarcadorRelease(crearMarcadorRelease({
      artefacto,
      commitSha: commit,
      treeSha: TREE,
      cambio,
    }));

  beforeAll(async () => {
    responder = (ruta) => ruta.includes('app') ? marker('app') : marker('landing');
    servidor = createServer((req, res) => {
      const ruta = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const intento = (conteos.get(ruta) ?? 0) + 1;
      conteos.set(ruta, intento);
      res.writeHead(200, { 'content-type': 'application/json' }).end(responder(ruta, intento));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const direccion = servidor.address();
    const puerto = typeof direccion === 'object' && direccion ? direccion.port : 0;
    expect(puerto).toBeGreaterThan(0);
    baseUrl = `http://127.0.0.1:${puerto}`;
  });

  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  it('espera propagación y acredita App + Landing con dos cuerpos idénticos', async () => {
    conteos.clear();
    responder = (ruta, intento) => {
      if (ruta.includes('app') && intento === 1) return marker('app', COMMIT_VIEJO);
      return ruta.includes('app') ? marker('app') : marker('landing');
    };
    const logs: string[] = [];
    const resultado = await verificarReleaseBlackBox({
      esperada: { commitSha: COMMIT, treeSha: TREE },
      objetivos: [
        { nombre: 'app', artefacto: 'app', url: `${baseUrl}/app/release.json?token=no-loguear` },
        { nombre: 'landing', artefacto: 'landing', url: `${baseUrl}/landing/release.json?token=no-loguear` },
      ],
      maxIntentos: 4,
      timeoutMs: 200,
      esperaInicialMs: 1,
      log: (linea) => logs.push(linea),
    });

    expect(resultado.map((r) => ({ nombre: r.nombre, muestras: r.muestras }))).toEqual([
      { nombre: 'app', muestras: 2 },
      { nombre: 'landing', muestras: 2 },
    ]);
    expect(conteos.get('/app/release.json')).toBe(3);
    expect(conteos.get('/landing/release.json')).toBe(3);
    expect(logs.join('\n')).not.toContain('no-loguear');
  });

  it('🔴 release parcial: App estable + Landing sucia no se declara éxito', async () => {
    conteos.clear();
    responder = (ruta) => ruta.includes('app')
      ? marker('app')
      : marker('landing', COMMIT, 'M vercel.json');
    await expect(verificarReleaseBlackBox({
      esperada: { commitSha: COMMIT, treeSha: TREE },
      objetivos: [
        { nombre: 'app', artefacto: 'app', url: `${baseUrl}/app/release.json` },
        { nombre: 'landing', artefacto: 'landing', url: `${baseUrl}/landing/release.json` },
      ],
      maxIntentos: 2,
      timeoutMs: 200,
      esperaInicialMs: 1,
      log: () => undefined,
    })).rejects.toThrow(/parcial.*app.*landing/i);
  });

  it('🔴 TOCTOU · App no puede cambiar mientras Landing reúne sus muestras', async () => {
    conteos.clear();
    responder = (ruta, intento) => {
      if (ruta.includes('app')) return intento <= 2 ? marker('app') : marker('app', COMMIT_VIEJO);
      return intento === 1 ? marker('landing', COMMIT_VIEJO) : marker('landing');
    };
    await expect(verificarReleaseBlackBox({
      esperada: { commitSha: COMMIT, treeSha: TREE },
      objetivos: [
        { nombre: 'app', artefacto: 'app', url: `${baseUrl}/app/release.json` },
        { nombre: 'landing', artefacto: 'landing', url: `${baseUrl}/landing/release.json` },
      ],
      maxIntentos: 3,
      timeoutMs: 200,
      esperaInicialMs: 1,
      log: () => undefined,
    })).rejects.toThrow(/parcial|rondas conjuntas/i);
  });

  it('🔴 dos cuerpos alternantes nunca forman evidencia estable', async () => {
    conteos.clear();
    responder = (ruta, intento) => ruta.includes('landing')
      ? marker('landing')
      : intento % 2 === 0
        ? `${marker('app')}\n`
        : marker('app');
    await expect(verificarReleaseBlackBox({
      esperada: { commitSha: COMMIT, treeSha: TREE },
      objetivos: [
        { nombre: 'app', artefacto: 'app', url: `${baseUrl}/app/release.json` },
        { nombre: 'landing', artefacto: 'landing', url: `${baseUrl}/landing/release.json` },
      ],
      maxIntentos: 3,
      timeoutMs: 200,
      esperaInicialMs: 1,
      log: () => undefined,
    })).rejects.toThrow(/rondas conjuntas|estable/i);
  });

  it('🔴 timeout acotado: una lectura colgada no bloquea indefinidamente', async () => {
    const colgado: typeof fetch = (_input, init) => new Promise<Response>((_ok, reject) => {
      const abortar = () => reject(new Error('abortado por timeout'));
      if (init?.signal?.aborted) abortar();
      else init?.signal?.addEventListener('abort', abortar, { once: true });
    });
    const inicio = Date.now();
    await expect(verificarReleaseBlackBox({
      esperada: { commitSha: COMMIT, treeSha: TREE },
      objetivos: [
        { nombre: 'app', artefacto: 'app', url: 'http://local.invalid/app?token=no-loguear' },
        { nombre: 'landing', artefacto: 'landing', url: 'http://local.invalid/landing?token=no-loguear' },
      ],
      maxIntentos: 2,
      timeoutMs: 10,
      esperaInicialMs: 1,
      fetchImpl: colgado,
      log: (linea) => expect(linea).not.toContain('no-loguear'),
    })).rejects.toThrow(/rondas conjuntas|estable/i);
    expect(Date.now() - inicio).toBeLessThan(500);
  });

  it('🔴 el body se corta durante lectura al superar 4096 bytes', async () => {
    conteos.clear();
    responder = (ruta) => ruta.includes('app') ? 'x'.repeat(5_000) : marker('landing');
    await expect(verificarReleaseBlackBox({
      esperada: { commitSha: COMMIT, treeSha: TREE },
      objetivos: [
        { nombre: 'app', artefacto: 'app', url: `${baseUrl}/app/release.json` },
        { nombre: 'landing', artefacto: 'landing', url: `${baseUrl}/landing/release.json` },
      ],
      maxIntentos: 2,
      timeoutMs: 200,
      esperaInicialMs: 1,
      log: () => undefined,
    })).rejects.toThrow(/parcial|release/);
    expect(conteos.get('/app/release.json')).toBe(2);
  });

  it('🔴 exige exactamente el par App + Landing', async () => {
    await expect(verificarReleaseBlackBox({
      esperada: { commitSha: COMMIT, treeSha: TREE },
      objetivos: [
        { nombre: 'app-1', artefacto: 'app', url: `${baseUrl}/app/uno` },
        { nombre: 'app-2', artefacto: 'app', url: `${baseUrl}/app/dos` },
      ],
    })).rejects.toThrow(/App.*Landing/i);
  });
});
