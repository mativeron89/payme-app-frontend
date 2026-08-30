import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  calcularDigestRaiz,
  configBosaCanonico,
  sellarArtefactoRelease,
  serializarJsonCanonico,
  type ArchivoRelease,
  type ManifiestoArtefactoRelease,
} from './releaseArtifact';

const AQUI = dirname(new URL(import.meta.url).pathname);
const REPO_REAL = dirname(AQUI);
const temporales: string[] = [];

interface Fixture {
  readonly base: string;
  readonly repo: string;
  readonly stage: string;
  readonly build: string;
  readonly commit: string;
  readonly tree: string;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function escribir(ruta: string, contenido: string | Buffer): void {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido);
}

function fixture(artifact: 'app' | 'landing' = 'app'): Fixture {
  // macOS expone tmpdir como /var, alias de /private/var. El gate exige la
  // ruta real a propósito: un caller productivo también debe entregarla así.
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'payme-release-artifact-')));
  temporales.push(base);
  const repo = join(base, 'repo');
  const stage = join(base, 'stage');
  mkdirSync(repo);
  mkdirSync(stage);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.name', 'PayMe test');
  git(repo, 'config', 'user.email', 'test@payme.invalid');
  escribir(join(repo, '.gitignore'), 'dist/\ndist-landing/\n');
  escribir(join(repo, 'tracked.txt'), 'estable\n');
  git(repo, 'add', '.gitignore', 'tracked.txt');
  git(repo, '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'fixture');
  const build = join(repo, artifact === 'app' ? 'dist' : 'dist-landing');
  escribir(join(build, 'index.html'), '<!doctype html><title>PayMe</title>\n');
  escribir(join(build, 'assets', 'app.js'), 'globalThis.payme = true;\n');
  return {
    base,
    repo,
    stage,
    build,
    commit: git(repo, 'rev-parse', 'HEAD'),
    tree: git(repo, 'rev-parse', 'HEAD^{tree}'),
  };
}

function sellar(f: Fixture, artifact: 'app' | 'landing' = 'app', hook?: () => void) {
  return sellarArtefactoRelease({
    repoDir: f.repo,
    stageDir: f.stage,
    artifact,
    expectedCommit: f.commit,
    expectedTree: f.tree,
    afterPackageForTest: hook,
  });
}

function verificarTransportado(
  f: Fixture,
  artifact: 'app' | 'landing',
  resultado: ReturnType<typeof sellarArtefactoRelease>,
  overrides: Partial<Record<'artifact' | 'commit' | 'tree' | 'manifest' | 'root', string>> = {},
) {
  return spawnSync(process.execPath, [
    join(AQUI, 'verify-release-artifact.mjs'),
    '--stage', f.stage,
    '--artifact', overrides.artifact ?? artifact,
    '--commit', overrides.commit ?? f.commit,
    '--tree', overrides.tree ?? f.tree,
    '--manifest-sha256', overrides.manifest ?? resultado.manifest_sha256,
    '--root-sha256', overrides.root ?? resultado.root_sha256,
  ], { cwd: REPO_REAL, encoding: 'utf8' });
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

afterEach(() => {
  while (temporales.length > 0) rmSync(temporales.pop()!, { recursive: true, force: true });
});

describe('sellado canónico y Build Output API v3', () => {
  it.each(['app', 'landing'] as const)('%s · copia bytes, identidad exacta y manifiesto reproducible', (artifact) => {
    const f = fixture(artifact);
    const resultado = sellar(f, artifact);
    const staticDir = join(f.stage, '.vercel', 'output', 'static');
    const markerTexto = readFileSync(join(staticDir, 'release.json'), 'utf8');
    const manifiestoTexto = readFileSync(join(f.stage, 'release-manifest.json'), 'utf8');
    const manifiesto = JSON.parse(manifiestoTexto) as ManifiestoArtefactoRelease;

    expect(readFileSync(join(f.stage, '.vercel', 'output', 'config.json'), 'utf8'))
      .toBe(configBosaCanonico(artifact));
    expect(readFileSync(join(staticDir, 'index.html'))).toEqual(readFileSync(join(f.build, 'index.html')));
    expect(JSON.parse(markerTexto)).toEqual({
      artifact,
      clean: true,
      commit_sha: f.commit,
      schema: 1,
      tree_sha: f.tree,
    });
    expect(manifiesto).toMatchObject({
      artifact,
      clean: true,
      commit_sha: f.commit,
      hash_algorithm: 'sha256',
      manifest_scope: '.vercel/output',
      schema: 1,
      tree_sha: f.tree,
    });
    expect(manifiesto.files.map((archivo) => archivo.path)).toEqual([
      'config.json',
      'static/assets/app.js',
      'static/index.html',
      'static/release.json',
    ]);
    expect(manifiesto.files.find((archivo) => archivo.path === 'static/release.json')).toEqual({
      path: 'static/release.json',
      sha256: sha256(markerTexto),
      size: Buffer.byteLength(markerTexto),
    });
    expect(calcularDigestRaiz(manifiesto.files)).toBe(manifiesto.root_sha256);
    expect(resultado).toEqual({
      artifact,
      commit_sha: f.commit,
      files: 4,
      manifest_sha256: sha256(manifiestoTexto),
      root_sha256: manifiesto.root_sha256,
      tree_sha: f.tree,
    });

    const stage2 = join(f.base, 'stage-2');
    mkdirSync(stage2);
    const segundo = sellarArtefactoRelease({
      repoDir: f.repo,
      stageDir: stage2,
      artifact,
      expectedCommit: f.commit,
      expectedTree: f.tree,
    });
    expect(segundo.root_sha256).toBe(resultado.root_sha256);
    expect(readFileSync(join(stage2, 'release-manifest.json'), 'utf8'))
      .toBe(manifiestoTexto);
    expect(git(f.repo, 'status', '--porcelain=v1', '--untracked-files=all')).toBe('');
  });

  it('el digest raíz exige orden, SHA-256 y tamaños canónicos', () => {
    const valido: ArchivoRelease[] = [
      { path: 'a', size: 1, sha256: 'a'.repeat(64) },
      { path: 'b', size: 2, sha256: 'b'.repeat(64) },
    ];
    expect(calcularDigestRaiz(valido)).toMatch(/^[0-9a-f]{64}$/);
    expect(() => calcularDigestRaiz([...valido].reverse())).toThrow(/canónica/);
    expect(() => calcularDigestRaiz([{ path: 'a', size: -1, sha256: 'a'.repeat(64) }]))
      .toThrow(/canónica/);
    expect(() => calcularDigestRaiz([{ path: 'a', size: 1, sha256: 'no-es-sha' }]))
      .toThrow(/canónica/);
  });

  it('el JSON canónico no depende del orden de inserción', () => {
    expect(serializarJsonCanonico({ z: 1, a: { y: 2, b: true } }))
      .toBe('{"a":{"b":true,"y":2},"z":1}\n');
  });
});

describe('guardas fail-closed y mutantes', () => {
  it('🔴 rechaza commit o tree distintos a la orden', () => {
    const f = fixture();
    expect(() => sellarArtefactoRelease({
      repoDir: f.repo,
      stageDir: f.stage,
      artifact: 'app',
      expectedCommit: 'a'.repeat(40),
      expectedTree: f.tree,
    })).toThrow(/commit\/tree/);
    expect(() => sellarArtefactoRelease({
      repoDir: f.repo,
      stageDir: f.stage,
      artifact: 'app',
      expectedCommit: f.commit,
      expectedTree: 'b'.repeat(40),
    })).toThrow(/commit\/tree/);
  });

  it('🔴 rechaza worktree sucio antes y no genera config desplegable', () => {
    const f = fixture();
    escribir(join(f.repo, 'tracked.txt'), 'mutado\n');
    expect(() => sellar(f)).toThrow(/no está limpio \(antes\)/);
    expect(() => readFileSync(join(f.stage, '.vercel/output/config.json'))).toThrow();
  });

  it('🔴 remide worktree después del empaquetado', () => {
    const f = fixture();
    expect(() => sellar(f, 'app', () => escribir(join(f.repo, 'tracked.txt'), 'mutado\n')))
      .toThrow(/no está limpio \(después\)/);
    expect(() => readFileSync(join(f.stage, '.vercel/output/config.json'))).toThrow();
  });

  it('🔴 detecta que el build cambió durante la copia', () => {
    const f = fixture();
    expect(() => sellar(f, 'app', () => escribir(join(f.build, 'index.html'), 'otro build\n')))
      .toThrow(/build cambió/);
    expect(() => readFileSync(join(f.stage, '.vercel/output/config.json'))).toThrow();
  });

  it('🔴 detecta manipulación de la copia antes de emitir config', () => {
    const f = fixture();
    const copiada = join(f.stage, '.vercel/output/static/assets/app.js');
    expect(() => sellar(f, 'app', () => escribir(copiada, 'manipulado\n')))
      .toThrow(/salida no coincide/);
    expect(() => readFileSync(join(f.stage, '.vercel/output/config.json'))).toThrow();
  });

  it('🔴 config v3 debe conservar bytes exactos', () => {
    const f = fixture();
    const config = join(f.stage, '.vercel/output/config.json');
    expect(() => sellar(f, 'app', () => escribir(config, '{"version":2}\n')))
      .toThrow(/config\.json BOSA/);
    expect(() => readFileSync(config)).toThrow();
  });

  it.each([
    ['app', 'landing'],
    ['landing', 'app'],
  ] as const)('🔴 %s no acepta que le planten la config de %s', (propio, ajeno) => {
    const f = fixture(propio);
    const config = join(f.stage, '.vercel/output/config.json');
    expect(() => sellar(f, propio, () => escribir(config, configBosaCanonico(ajeno))))
      .toThrow(/config\.json BOSA/);
    expect(() => readFileSync(config)).toThrow();
  });

  it('🔴 un build sin index.html nunca se vuelve desplegable', () => {
    const f = fixture();
    rmSync(join(f.build, 'index.html'));
    expect(() => sellar(f)).toThrow(/index\.html/);
    expect(() => readFileSync(join(f.stage, '.vercel/output/config.json'))).toThrow();
  });

  it('🔴 el censo BOSA rechaza extras, functions y middleware', () => {
    const f = fixture();
    const extra = join(f.stage, '.vercel/output/functions/extra.func/.vc-config.json');
    expect(() => sellar(f, 'app', () => escribir(extra, '{}\n')))
      .toThrow(/output BOSA.*extras|functions\/middleware/);
    expect(() => readFileSync(join(f.stage, '.vercel/output/config.json'))).toThrow();
  });

  it('🔴 rechaza symlinks y hardlinks, aunque apunten a archivos regulares', () => {
    const f = fixture();
    symlinkSync('/etc/hosts', join(f.build, 'escape'));
    expect(() => sellar(f)).toThrow(/symlink/);

    rmSync(join(f.build, 'escape'));
    linkSync(join(f.build, 'index.html'), join(f.build, 'alias.html'));
    expect(() => sellar(f)).toThrow(/hardlink/);
  });

  it('🔴 stage debe ser canónico, externo y vacío', () => {
    const f = fixture();
    escribir(join(f.stage, 'residuo'), 'x');
    expect(() => sellar(f)).toThrow(/empezar vacío/);

    const interno = join(f.repo, 'stage');
    mkdirSync(interno);
    expect(() => sellarArtefactoRelease({
      repoDir: f.repo,
      stageDir: interno,
      artifact: 'app',
      expectedCommit: f.commit,
      expectedTree: f.tree,
    })).toThrow(/fuera del repo/);
  });

  it('🔴 reserva sus marcadores y rechaza rutas o material de credenciales', () => {
    const f = fixture();
    escribir(join(f.build, 'release.json'), '{}');
    expect(() => sellar(f)).toThrow(/ruta reservada/);

    rmSync(join(f.build, 'release.json'));
    escribir(join(f.build, '.env.production'), 'NO_DEBE_COPIARSE=1\n');
    expect(() => sellar(f)).toThrow(/ruta sensible/);

    rmSync(join(f.build, '.env.production'));
    escribir(join(f.build, 'bundle.js'), `const secreto = "sk_live_${'a'.repeat(24)}";\n`);
    expect(() => sellar(f)).toThrow(/material secreto/);
  });

  it('🔴 un objeto especial no entra al manifiesto', () => {
    const f = fixture();
    execFileSync('mkfifo', [join(f.build, 'fifo-real')]);
    expect(() => sellar(f)).toThrow(/objeto no regular/);
    expect(() => readFileSync(join(f.stage, '.vercel/output/config.json'))).toThrow();
  });
});

describe('revalidacion independiente despues del transporte', () => {
  it.each(['app', 'landing'] as const)('%s · acredita todos los bytes y ambas identidades', (artifact) => {
    const f = fixture(artifact);
    const resultado = sellar(f, artifact);
    const verificado = verificarTransportado(f, artifact, resultado);
    expect(verificado.stderr).toBe('');
    expect(verificado.status).toBe(0);
    expect(JSON.parse(verificado.stdout)).toEqual({
      artifact,
      commit_sha: f.commit,
      files: 4,
      manifest_sha256: resultado.manifest_sha256,
      root_sha256: resultado.root_sha256,
      tree_sha: f.tree,
      verified: true,
    });
  });

  it('🔴 detecta bytes alterados o extras despues del sellado', () => {
    const f = fixture();
    const resultado = sellar(f);
    escribir(join(f.stage, '.vercel/output/static/index.html'), 'alterado\n');
    let verificado = verificarTransportado(f, 'app', resultado);
    expect(verificado.status).toBe(1);
    expect(verificado.stderr).toMatch(/bytes BOSA|manifiesto/);

    const g = fixture();
    const segundo = sellar(g);
    escribir(join(g.stage, '.vercel/output/static/extra.js'), 'extra\n');
    verificado = verificarTransportado(g, 'app', segundo);
    expect(verificado.status).toBe(1);
    expect(verificado.stderr).toMatch(/bytes BOSA|manifiesto/);
  });

  it('🔴 detecta manifiesto, config e identidad publica alterados', () => {
    const f = fixture();
    const resultado = sellar(f);
    escribir(join(f.stage, 'release-manifest.json'), '{}\n');
    expect(verificarTransportado(f, 'app', resultado).stderr).toMatch(/SHA-256 del manifiesto/);

    const g = fixture();
    const segundo = sellar(g);
    escribir(join(g.stage, '.vercel/output/config.json'), '{"version":2}\n');
    expect(verificarTransportado(g, 'app', segundo).stderr).toMatch(/config\.json BOSA/);

    const h = fixture();
    const tercero = sellar(h);
    escribir(join(h.stage, '.vercel/output/static/release.json'), '{}\n');
    expect(verificarTransportado(h, 'app', tercero).stderr).toMatch(/bytes BOSA|release\.json/);
  });

  it('🔴 rechaza symlink o hardlink introducido durante el transporte', () => {
    const f = fixture();
    const resultado = sellar(f);
    const index = join(f.stage, '.vercel/output/static/index.html');
    rmSync(index);
    symlinkSync('/etc/hosts', index);
    expect(verificarTransportado(f, 'app', resultado).stderr).toMatch(/symlink|directorio real/);

    const g = fixture();
    const segundo = sellar(g);
    const alias = join(g.stage, '.vercel/output/static/alias.html');
    linkSync(join(g.stage, '.vercel/output/static/index.html'), alias);
    expect(verificarTransportado(g, 'app', segundo).stderr).toMatch(/hardlink/);
  });

  it('🔴 commit, tree, artifact y hashes esperados son parte de la orden', () => {
    const f = fixture();
    const resultado = sellar(f);
    expect(verificarTransportado(f, 'app', resultado, { commit: 'a'.repeat(40) }).status).toBe(1);
    expect(verificarTransportado(f, 'app', resultado, { tree: 'b'.repeat(40) }).status).toBe(1);
    expect(verificarTransportado(f, 'app', resultado, { artifact: 'landing' }).status).toBe(1);
    expect(verificarTransportado(f, 'app', resultado, { manifest: 'c'.repeat(64) }).status).toBe(1);
    expect(verificarTransportado(f, 'app', resultado, { root: 'd'.repeat(64) }).status).toBe(1);
  });

  it('🔴 argumentos desconocidos no exponen sus valores', () => {
    const resultado = spawnSync(process.execPath, [
      join(AQUI, 'verify-release-artifact.mjs'),
      '--token', 'SECRETO_QUE_NO_DEBE_LOGUEARSE',
    ], { cwd: REPO_REAL, encoding: 'utf8' });
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('argumentos CLI invalidos');
    expect(resultado.stderr).not.toContain('SECRETO_QUE_NO_DEBE_LOGUEARSE');
  });
});

// Los bytes que la orden APP-FE-META-PUBLIC-BOSA-ISOLATION-04 fija en su
// §Configuración, transcritos a mano A PROPÓSITO: son el ancla contra el
// documento. Si alguien cambia la derivación, este par se pone rojo antes que
// cualquier test que use la derivación para medirse a sí misma.
const CONFIG_APP_DE_LA_ORDEN =
  '{"routes":[{"dest":"/index.html","headers":{"Cache-Control":"no-store",' +
  '"Referrer-Policy":"no-referrer"},"src":"^/privacy$"},{"dest":"/index.html",' +
  '"headers":{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"},' +
  '"src":"^/facebook-data-deletion/[^/]+$"}],"version":3}\n';
const CONFIG_LANDING_DE_LA_ORDEN = '{"version":3}\n';

/** Los otros dos jueces reescriben los bytes; ninguno puede importar el sellador. */
const FUENTE_JUEZ_LOCAL = readFileSync(join(AQUI, 'verify-release-artifact.mjs'), 'utf8');
const FUENTE_JUEZ_INLINE = readFileSync(
  join(REPO_REAL, '.github/workflows/release-prebuilt-stage.yml'),
  'utf8',
);

describe('config BOSA derivada del enum cerrado app|landing', () => {
  it('App y Landing valen exactamente los bytes de la orden', () => {
    expect(configBosaCanonico('app')).toBe(CONFIG_APP_DE_LA_ORDEN);
    expect(configBosaCanonico('landing')).toBe(CONFIG_LANDING_DE_LA_ORDEN);
  });

  it('🔴 las dos configs son distintas: no hay una sola compartida', () => {
    expect(configBosaCanonico('app')).not.toBe(configBosaCanonico('landing'));
  });

  it('Landing no declara routes, así que esas rutas no nacen en ese origen', () => {
    const landing = JSON.parse(configBosaCanonico('landing')) as Record<string, unknown>;
    expect(Object.keys(landing)).toEqual(['version']);
    expect(landing.version).toBe(3);
    expect('routes' in landing).toBe(false);
  });

  it('App declara EXACTAMENTE las dos rutas Meta, ancladas y sin claves extra', () => {
    const app = JSON.parse(configBosaCanonico('app')) as {
      version: unknown;
      routes: Record<string, unknown>[];
    };
    expect(Object.keys(app).sort()).toEqual(['routes', 'version']);
    expect(app.version).toBe(3);
    expect(app.routes).toHaveLength(2);
    expect(app.routes.map((ruta) => ruta.src)).toEqual([
      '^/privacy$',
      '^/facebook-data-deletion/[^/]+$',
    ]);
    for (const ruta of app.routes) {
      // Censo CERRADO de claves: una denylist de `has`/`status`/`continue`
      // dejaría pasar la próxima clave que Vercel invente.
      expect(Object.keys(ruta).sort()).toEqual(['dest', 'headers', 'src']);
      expect(ruta.dest).toBe('/index.html');
      expect(ruta.headers).toEqual({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      const src = ruta.src as string;
      expect(src.startsWith('^')).toBe(true);
      expect(src.endsWith('$')).toBe(true);
    }
  });

  it('los src anclados casan su ruta y NADA más: no son catch-all', () => {
    const app = JSON.parse(configBosaCanonico('app')) as { routes: { src: string }[] };
    const [privacidad, borrado] = app.routes.map((ruta) => new RegExp(ruta.src));
    expect(privacidad!.test('/privacy')).toBe(true);
    expect(borrado!.test('/facebook-data-deletion/ABCdef_-0123456789xyz0')).toBe(true);
    for (const ajena of [
      '/', '/index.html', '/assets/app.js', '/privacy/extra', '/xprivacy',
      '/privacyx', '/facebook-data-deletion', '/facebook-data-deletion/',
      '/facebook-data-deletion/a/b', '/otra/facebook-data-deletion/abc',
    ]) {
      expect(privacidad!.test(ajena)).toBe(false);
      expect(borrado!.test(ajena)).toBe(false);
    }
  });

  it('🔴 un artifact fuera del enum no hereda un default: falla cerrado', () => {
    for (const invalido of ['App', 'APP', 'landing ', '', 'preview', '__proto__', 'constructor']) {
      expect(() => configBosaCanonico(invalido as 'app')).toThrow(/app o landing/);
    }
  });
});

describe('deriva entre los tres jueces de la config BOSA', () => {
  // Cada juez se mide contra la DERIVACIÓN de producción, no contra una copia
  // tipeada acá: si el sellador cambia, los tres tienen que moverse con él.
  const cuerpo = (artifact: 'app' | 'landing'): string => configBosaCanonico(artifact).trimEnd();

  it.each([
    ['juez local transportado', () => FUENTE_JUEZ_LOCAL],
    ['juez inline del workflow', () => FUENTE_JUEZ_INLINE],
  ])('%s reescribe los MISMOS bytes que el sellador', (_nombre, fuente) => {
    const texto = fuente();
    // Cuerpo + `\n` escapado: pina también el newline final del JSON canónico.
    expect(texto).toContain(`${cuerpo('app')}\\n`);
    expect(texto).toContain(`${cuerpo('landing')}\\n`);
  });

  it.each([
    ['juez local transportado', () => FUENTE_JUEZ_LOCAL],
    ['juez inline del workflow', () => FUENTE_JUEZ_INLINE],
  ])('%s adjudica por Map cerrado con exactamente app y landing', (_nombre, fuente) => {
    const texto = fuente();
    const mapa = texto.slice(texto.indexOf('CONFIG_BOSA = new Map(['));
    expect(mapa.startsWith('CONFIG_BOSA = new Map([')).toBe(true);
    const cierre = mapa.indexOf(']);');
    expect(cierre).toBeGreaterThan(0);
    const cuerpoMapa = mapa.slice(0, cierre);
    expect([...cuerpoMapa.matchAll(/\n\s*\['(app|landing)',/g)].map((m) => m[1]))
      .toEqual(['app', 'landing']);
  });

  it('control positivo: el detector de deriva ve una config ajena', () => {
    // Si esto pasara, `toContain` estaría midiendo nada.
    expect(FUENTE_JUEZ_LOCAL).not.toContain('{"routes":[],"version":3}');
    expect(FUENTE_JUEZ_INLINE).not.toContain('{"routes":[],"version":3}');
  });
});

describe('config cruzado rechazado por el juez local transportado', () => {
  it.each([
    ['app', 'landing'],
    ['landing', 'app'],
  ] as const)('🔴 %s sellado con la config de %s plantada después no verifica', (propio, ajeno) => {
    const f = fixture(propio);
    const resultado = sellar(f, propio);
    escribir(join(f.stage, '.vercel/output/config.json'), configBosaCanonico(ajeno));
    const verificado = verificarTransportado(f, propio, resultado);
    expect(verificado.status).toBe(1);
    expect(verificado.stderr).toMatch(/config\.json BOSA no es el del artifact/);
  });

  it('🔴 el juez local no acepta la MISMA config para los dos artefactos', () => {
    // Población: un juez que aceptara ambas en ambos daría 4 verdes.
    const veredictos: boolean[] = [];
    for (const propio of ['app', 'landing'] as const) {
      const f = fixture(propio);
      const resultado = sellar(f, propio);
      veredictos.push(verificarTransportado(f, propio, resultado).status === 0);
      escribir(join(f.stage, '.vercel/output/config.json'),
        configBosaCanonico(propio === 'app' ? 'landing' : 'app'));
      veredictos.push(verificarTransportado(f, propio, resultado).status === 0);
    }
    expect(veredictos).toEqual([true, false, true, false]);
  });

  it('🔴 el config entra al manifiesto y al digest raíz con sus bytes reales', () => {
    const app = fixture('app');
    const landing = fixture('landing');
    const rApp = sellar(app, 'app');
    sellar(landing, 'landing');
    const mApp = JSON.parse(
      readFileSync(join(app.stage, 'release-manifest.json'), 'utf8'),
    ) as ManifiestoArtefactoRelease;
    const mLanding = JSON.parse(
      readFileSync(join(landing.stage, 'release-manifest.json'), 'utf8'),
    ) as ManifiestoArtefactoRelease;
    const configDe = (m: ManifiestoArtefactoRelease) =>
      m.files.find((archivo) => archivo.path === 'config.json');

    expect(configDe(mApp)).toEqual({
      path: 'config.json',
      sha256: sha256(configBosaCanonico('app')),
      size: Buffer.byteLength(configBosaCanonico('app')),
    });
    expect(configDe(mLanding)).toEqual({
      path: 'config.json',
      sha256: sha256(configBosaCanonico('landing')),
      size: Buffer.byteLength(configBosaCanonico('landing')),
    });
    // El digest raíz DEPENDE de los bytes del config, y hay que probarlo
    // AISLANDO esa variable: comparar el root de App contra el de Landing no
    // serviría, porque su release.json también difiere y el verde vendría de
    // ahí. Se recalcula el mismo manifiesto de App con la única sustitución del
    // config y se exige que el digest se mueva.
    expect(mApp.files.map((a) => a.path)).toContain('config.json');
    expect(mLanding.files.map((a) => a.path)).toContain('config.json');
    const conConfigAjena = mApp.files.map((archivo) => archivo.path === 'config.json'
      ? {
        path: 'config.json',
        sha256: sha256(configBosaCanonico('landing')),
        size: Buffer.byteLength(configBosaCanonico('landing')),
      }
      : archivo);
    expect(calcularDigestRaiz(mApp.files)).toBe(rApp.root_sha256);
    expect(calcularDigestRaiz(conConfigAjena)).not.toBe(rApp.root_sha256);
    // Y un manifiesto que OMITIERA config.json también cambia el digest: ése es
    // el mutante «manifest/digest que omite config» de la orden.
    expect(calcularDigestRaiz(mApp.files.filter((a) => a.path !== 'config.json')))
      .not.toBe(rApp.root_sha256);
  });
});

describe('CLI Node 20 con vite-node lockeado y sin logs de secretos', () => {
  it('acredita que el binario disponible coincide con package-lock.json', () => {
    const lock = JSON.parse(readFileSync(join(REPO_REAL, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { version?: string }>;
    };
    const version = lock.packages?.['node_modules/vite-node']?.version;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    const salida = execFileSync(join(REPO_REAL, 'node_modules/.bin/vite-node'), ['--version'], {
      cwd: REPO_REAL,
      encoding: 'utf8',
    });
    expect(salida).toContain(`vite-node/${version}`);
  });

  it('el runner Node 20 devuelve sólo el resumen canónico', () => {
    const f = fixture();
    const salida = execFileSync(process.execPath, [
      join(AQUI, 'release-artifact.mjs'),
      '--artifact', 'app',
      '--repo', f.repo,
      '--stage', f.stage,
      '--commit', f.commit,
      '--tree', f.tree,
    ], { cwd: REPO_REAL, encoding: 'utf8' });
    expect(JSON.parse(salida)).toMatchObject({
      artifact: 'app',
      commit_sha: f.commit,
      files: 4,
      tree_sha: f.tree,
    });
  });

  it('rechaza argumentos desconocidos sin imprimir sus valores', () => {
    const resultado = spawnSync(process.execPath, [
      join(AQUI, 'release-artifact.mjs'),
      '--token', 'SECRETO_QUE_NO_DEBE_LOGUEARSE',
    ], { cwd: REPO_REAL, encoding: 'utf8' });
    expect(resultado.status).toBe(1);
    expect(resultado.stderr).toContain('argumentos CLI inválidos');
    expect(resultado.stderr).not.toContain('SECRETO_QUE_NO_DEBE_LOGUEARSE');
  });
});
