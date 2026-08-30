import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_GIT = /^[0-9a-f]{40}$/;
const SHA_256 = /^[0-9a-f]{64}$/;
const MAX_ARCHIVOS = 20_000;
const MAX_ARCHIVO_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const RELEASE_MARKER = 'release.json';
const RELEASE_MANIFEST = 'release-manifest.json';

export type ArtefactoRelease = 'app' | 'landing';

/**
 * Cabeceras Meta de las dos rutas públicas de cumplimiento. Los nombres viajan
 * con el casing exacto que el edge debe emitir: el juez compara bytes, no
 * claves normalizadas, así que un `cache-control` en minúsculas es otro config.
 */
const HEADERS_META_BOSA: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

/**
 * Las DOS únicas rutas BOSA del artefacto App, en su orden de serialización.
 * Cada `src` es PCRE anclado en ambos extremos: sin `^`/`$` la regla dejaría de
 * ser una ruta y pasaría a ser un prefijo, que es un catch-all encubierto.
 * `[^/]+` mantiene el código en un único segmento.
 */
const RUTAS_META_BOSA: readonly string[] = [
  '^/privacy$',
  '^/facebook-data-deletion/[^/]+$',
];

/**
 * Config Build Output API v3 derivada ÚNICAMENTE del enum cerrado del artefacto.
 * No lee env, hostname ni proyecto: si el artefacto no es `app` ni `landing`
 * falla cerrado en vez de elegir un default. Landing NO declara `routes`, así
 * que esas dos rutas no nacen en ese origen.
 */
export function configBosaCanonico(artifact: ArtefactoRelease): string {
  if (artifact === 'landing') return serializarJsonCanonico({ version: 3 });
  if (artifact === 'app') {
    return serializarJsonCanonico({
      version: 3,
      routes: RUTAS_META_BOSA.map((src) => ({
        src,
        dest: '/index.html',
        headers: { ...HEADERS_META_BOSA },
      })),
    });
  }
  throw new Error('artifact debe ser app o landing');
}

export interface ArchivoRelease {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}

export interface ManifiestoArtefactoRelease {
  readonly schema: 1;
  readonly artifact: ArtefactoRelease;
  readonly clean: true;
  readonly commit_sha: string;
  readonly tree_sha: string;
  readonly hash_algorithm: 'sha256';
  readonly manifest_scope: '.vercel/output';
  readonly files: readonly ArchivoRelease[];
  readonly root_sha256: string;
}

export interface SellarArtefactoRelease {
  /** Raíz canónica y absoluta del worktree Git. */
  readonly repoDir: string;
  /** Directorio canónico, absoluto, vacío y FUERA del repo. */
  readonly stageDir: string;
  readonly artifact: ArtefactoRelease;
  readonly expectedCommit: string;
  readonly expectedTree: string;
  /** Seam determinista para mutantes TOCTOU. El CLI nunca lo expone. */
  readonly afterPackageForTest?: () => void;
}

export interface ResultadoArtefactoRelease {
  readonly artifact: ArtefactoRelease;
  readonly commit_sha: string;
  readonly tree_sha: string;
  readonly files: number;
  readonly root_sha256: string;
  readonly manifest_sha256: string;
}

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

function serializarValorCanonico(valor: Json): string {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'number') {
    if (typeof valor === 'number' && !Number.isSafeInteger(valor)) {
      throw new Error('el JSON canónico sólo admite enteros seguros');
    }
    return JSON.stringify(valor);
  }
  if (typeof valor === 'string') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(serializarValorCanonico).join(',')}]`;
  const mapa = valor as { readonly [key: string]: Json };
  return `{${Object.keys(mapa).sort().map((clave) =>
    `${JSON.stringify(clave)}:${serializarValorCanonico(mapa[clave]!)}`).join(',')}}`;
}

export function serializarJsonCanonico(valor: Json): string {
  return `${serializarValorCanonico(valor)}\n`;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function compararTextoCanonico(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function leerArchivoSeguro(ruta: string): Buffer {
  let fd: number | null = null;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const antes = fstatSync(fd, { bigint: true });
    if (!antes.isFile() || antes.nlink !== 1n || antes.size > BigInt(MAX_ARCHIVO_BYTES)) {
      throw new Error('el artefacto contiene un objeto no regular, hardlink o demasiado grande');
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const leidos = readSync(fd, chunk, 0, chunk.byteLength, null);
      if (leidos === 0) break;
      chunks.push(chunk.subarray(0, leidos));
      total += leidos;
      if (total > MAX_ARCHIVO_BYTES) throw new Error('un archivo excede el límite de sellado');
    }
    const despues = fstatSync(fd, { bigint: true });
    if (antes.dev !== despues.dev || antes.ino !== despues.ino || antes.mode !== despues.mode ||
        antes.nlink !== despues.nlink || antes.size !== despues.size ||
        antes.mtimeNs !== despues.mtimeNs || antes.ctimeNs !== despues.ctimeNs ||
        BigInt(total) !== antes.size) {
      throw new Error('un archivo cambió durante su lectura segura');
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function exigirSha(nombre: string, valor: string): void {
  if (!SHA_GIT.test(valor)) throw new Error(`${nombre} debe ser un SHA Git exacto`);
}

function crearMarkerRelease(
  artifact: ArtefactoRelease,
  commitSha: string,
  treeSha: string,
): string {
  return serializarJsonCanonico({
    artifact,
    clean: true,
    commit_sha: commitSha,
    schema: 1,
    tree_sha: treeSha,
  });
}

function rutaCanonicaAbsoluta(nombre: string, ruta: string): string {
  if (!isAbsolute(ruta) || resolve(ruta) !== ruta) {
    throw new Error(`${nombre} debe ser una ruta absoluta canónica, sin traversal`);
  }
  const estado = lstatSync(ruta, { throwIfNoEntry: false });
  if (!estado?.isDirectory() || estado.isSymbolicLink()) {
    throw new Error(`${nombre} debe ser un directorio real`);
  }
  const real = realpathSync(ruta);
  if (real !== ruta) throw new Error(`${nombre} no puede atravesar symlinks`);
  return real;
}

function estaDentro(base: string, candidata: string): boolean {
  const rel = relative(base, candidata);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

function git(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error('no se pudo acreditar el estado Git');
  }
}

function exigirGitExacto(
  repoDir: string,
  expectedCommit: string,
  expectedTree: string,
  momento: 'antes' | 'después',
): void {
  const raiz = realpathSync(git(repoDir, ['rev-parse', '--show-toplevel']));
  const commit = git(repoDir, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const tree = git(repoDir, ['rev-parse', '--verify', 'HEAD^{tree}']);
  const estado = git(repoDir, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (raiz !== repoDir) throw new Error(`el repo no es el worktree raíz (${momento})`);
  if (commit !== expectedCommit || tree !== expectedTree) {
    throw new Error(`commit/tree no coinciden con la orden (${momento})`);
  }
  if (estado !== '') throw new Error(`el worktree no está limpio (${momento})`);
}

function exigirSegmentoSeguro(nombre: string): void {
  if (nombre === '' || nombre === '.' || nombre === '..' || nombre !== nombre.normalize('NFC') ||
      /[\\/\u0000-\u001f\u007f]/u.test(nombre)) {
    throw new Error('el artefacto contiene un nombre de ruta no canónico');
  }
}

function rutaPareceSecreto(ruta: string): boolean {
  const segmentos = ruta.toLowerCase().split('/');
  return segmentos.some((segmento) =>
    segmento.startsWith('.env') ||
    segmento === '.git' ||
    segmento === '.vercel' ||
    segmento === '.npmrc' ||
    segmento === 'credentials.json' ||
    segmento === 'id_rsa' ||
    segmento === 'id_ed25519' ||
    segmento.endsWith('.pem') ||
    segmento.endsWith('.key') ||
    segmento.endsWith('.p12') ||
    segmento.endsWith('.pfx'));
}

function bytesParecenSecreto(bytes: Buffer): boolean {
  const texto = bytes.toString('utf8');
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(texto) ||
    /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/.test(texto) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(texto) ||
    /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/.test(texto);
}

interface SnapshotOptions {
  readonly allowReleaseFiles: boolean;
}

function snapshotDirectorio(raiz: string, options: SnapshotOptions): ArchivoRelease[] {
  const archivos: ArchivoRelease[] = [];
  let totalBytes = 0;
  const colisiones = new Set<string>();

  const visitar = (directorio: string, prefijo: string): void => {
    const entradas = readdirSync(directorio, { withFileTypes: true })
      .sort((a, b) => compararTextoCanonico(a.name, b.name));
    for (const entrada of entradas) {
      exigirSegmentoSeguro(entrada.name);
      const rutaRelativa = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
      const clavePortable = rutaRelativa.toLowerCase();
      if (colisiones.has(clavePortable)) {
        throw new Error('el artefacto contiene rutas que colisionan entre plataformas');
      }
      colisiones.add(clavePortable);
      const ruta = join(directorio, entrada.name);
      const estado = lstatSync(ruta);
      if (estado.isSymbolicLink() || entrada.isSymbolicLink()) {
        throw new Error('el artefacto contiene un symlink');
      }
      const realAntes = realpathSync(ruta);
      if (!estaDentro(raiz, realAntes)) throw new Error('una ruta escapa del artefacto');
      if (estado.isDirectory() && entrada.isDirectory()) {
        visitar(ruta, rutaRelativa);
        continue;
      }
      if (!estado.isFile() || !entrada.isFile() || estado.nlink !== 1) {
        throw new Error('el artefacto contiene un objeto no regular o hardlink');
      }
      if (!options.allowReleaseFiles &&
          (rutaRelativa === RELEASE_MARKER || rutaRelativa === RELEASE_MANIFEST)) {
        throw new Error('el build ocupa una ruta reservada de release');
      }
      if (rutaPareceSecreto(rutaRelativa)) {
        throw new Error('el artefacto contiene una ruta sensible prohibida');
      }
      if (estado.size > MAX_ARCHIVO_BYTES) throw new Error('un archivo excede el límite de sellado');
      totalBytes += estado.size;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('el artefacto excede el límite total de sellado');
      if (archivos.length >= MAX_ARCHIVOS) throw new Error('el artefacto excede el máximo de archivos');
      const bytes = leerArchivoSeguro(ruta);
      if (bytes.byteLength !== estado.size) throw new Error('un archivo cambió durante su lectura');
      const estadoFinal = lstatSync(ruta);
      const realDespues = realpathSync(ruta);
      if (estadoFinal.isSymbolicLink() || !estadoFinal.isFile() || estadoFinal.nlink !== 1 ||
          realAntes !== realDespues || !estaDentro(raiz, realDespues)) {
        throw new Error('una ruta cambió durante su lectura segura');
      }
      if (bytesParecenSecreto(bytes)) throw new Error('el artefacto contiene material secreto prohibido');
      archivos.push({ path: rutaRelativa, size: bytes.byteLength, sha256: sha256(bytes) });
    }
  };

  visitar(raiz, '');
  return archivos.sort((a, b) => compararTextoCanonico(a.path, b.path));
}

function listaCanonica(archivos: readonly ArchivoRelease[]): string {
  return serializarValorCanonico(archivos.map((archivo) => ({
    path: archivo.path,
    sha256: archivo.sha256,
    size: archivo.size,
  })));
}

export function calcularDigestRaiz(archivos: readonly ArchivoRelease[]): string {
  let anterior = '';
  for (const archivo of archivos) {
    if (!archivo.path || archivo.path <= anterior || !Number.isSafeInteger(archivo.size) ||
        archivo.size < 0 || !SHA_256.test(archivo.sha256)) {
      throw new Error('la lista de archivos no es canónica');
    }
    anterior = archivo.path;
  }
  return sha256(listaCanonica(archivos));
}

function mismosArchivos(a: readonly ArchivoRelease[], b: readonly ArchivoRelease[]): boolean {
  return listaCanonica(a) === listaCanonica(b);
}

function copiarSnapshot(
  fuente: string,
  destino: string,
  archivos: readonly ArchivoRelease[],
): void {
  for (const archivo of archivos) {
    const segmentos = archivo.path.split('/');
    const destinoArchivo = join(destino, ...segmentos);
    const destinoPadre = join(destino, ...segmentos.slice(0, -1));
    mkdirSync(destinoPadre, { recursive: true, mode: 0o755 });
    const bytesFuente = leerArchivoSeguro(join(fuente, ...segmentos));
    if (bytesFuente.byteLength !== archivo.size || sha256(bytesFuente) !== archivo.sha256) {
      throw new Error('la fuente cambió antes de copiarse desde su descriptor');
    }
    writeFileSync(destinoArchivo, bytesFuente, { flag: 'wx', mode: 0o644 });
    const estado = lstatSync(destinoArchivo);
    if (!estado.isFile() || estado.isSymbolicLink() || estado.nlink !== 1 ||
        estado.size !== archivo.size || sha256(leerArchivoSeguro(destinoArchivo)) !== archivo.sha256) {
      throw new Error('la copia sellada no coincide con la fuente medida');
    }
  }
}

function crearManifiesto(
  artifact: ArtefactoRelease,
  commitSha: string,
  treeSha: string,
  archivos: readonly ArchivoRelease[],
): ManifiestoArtefactoRelease {
  return {
    schema: 1,
    artifact,
    clean: true,
    commit_sha: commitSha,
    tree_sha: treeSha,
    hash_algorithm: 'sha256',
    manifest_scope: '.vercel/output',
    files: archivos,
    root_sha256: calcularDigestRaiz(archivos),
  };
}

function jsonDelManifiesto(manifiesto: ManifiestoArtefactoRelease): string {
  return serializarJsonCanonico(manifiesto as unknown as Json);
}

function exigirDirectorioReal(ruta: string, nombre: string): void {
  const estado = lstatSync(ruta, { throwIfNoEntry: false });
  if (!estado?.isDirectory() || estado.isSymbolicLink() || realpathSync(ruta) !== ruta) {
    throw new Error(`${nombre} debe ser un directorio real sin symlinks`);
  }
}

function exigirEntradasExactas(
  directorio: string,
  esperadas: readonly string[],
  nombre: string,
): void {
  const actuales = readdirSync(directorio).sort(compararTextoCanonico);
  const canonicas = [...esperadas].sort(compararTextoCanonico);
  if (serializarValorCanonico(actuales) !== serializarValorCanonico(canonicas)) {
    throw new Error(`${nombre} contiene extras o faltantes`);
  }
}

function exigirCensoBosa(outputDir: string, configEsperada: string): ArchivoRelease[] {
  exigirDirectorioReal(outputDir, 'output BOSA');
  exigirEntradasExactas(outputDir, ['config.json', 'static'], 'el output BOSA');
  const staticDir = join(outputDir, 'static');
  exigirDirectorioReal(staticDir, 'static BOSA');
  const configPath = join(outputDir, 'config.json');
  const estadoConfig = lstatSync(configPath, { throwIfNoEntry: false });
  if (!estadoConfig?.isFile() || estadoConfig.isSymbolicLink() || estadoConfig.nlink !== 1 ||
      leerArchivoSeguro(configPath).toString('utf8') !== configEsperada) {
    throw new Error('config.json BOSA no tiene los bytes v3 exactos');
  }
  const archivos = snapshotDirectorio(outputDir, { allowReleaseFiles: true });
  if (!archivos.some((archivo) => archivo.path === 'config.json') ||
      !archivos.some((archivo) => archivo.path === 'static/index.html') ||
      !archivos.some((archivo) => archivo.path === 'static/release.json') ||
      archivos.some((archivo) =>
        archivo.path.startsWith('functions/') || archivo.path.startsWith('middleware/'))) {
    throw new Error(
      'el censo BOSA contiene functions/middleware o perdió config.json, index.html o release.json',
    );
  }
  return archivos;
}

function exigirCensoStage(stageDir: string, conManifiesto: boolean): void {
  exigirEntradasExactas(
    stageDir,
    conManifiesto ? ['.vercel', RELEASE_MANIFEST] : ['.vercel'],
    'stageDir',
  );
  const vercelDir = join(stageDir, '.vercel');
  exigirDirectorioReal(vercelDir, '.vercel');
  exigirEntradasExactas(vercelDir, ['output'], '.vercel');
}

export function sellarArtefactoRelease(entrada: SellarArtefactoRelease): ResultadoArtefactoRelease {
  if (entrada.artifact !== 'app' && entrada.artifact !== 'landing') {
    throw new Error('artifact debe ser app o landing');
  }
  exigirSha('expectedCommit', entrada.expectedCommit);
  exigirSha('expectedTree', entrada.expectedTree);
  const repoDir = rutaCanonicaAbsoluta('repoDir', entrada.repoDir);
  const stageDir = rutaCanonicaAbsoluta('stageDir', entrada.stageDir);
  if (estaDentro(repoDir, stageDir) || estaDentro(stageDir, repoDir) || repoDir === stageDir) {
    throw new Error('stageDir debe estar completamente fuera del repo');
  }
  if (readdirSync(stageDir).length !== 0) throw new Error('stageDir debe empezar vacío');

  exigirGitExacto(repoDir, entrada.expectedCommit, entrada.expectedTree, 'antes');
  const buildDir = join(repoDir, entrada.artifact === 'app' ? 'dist' : 'dist-landing');
  const buildReal = rutaCanonicaAbsoluta('directorio de build', buildDir);
  if (!estaDentro(repoDir, buildReal)) throw new Error('el build debe vivir dentro del repo');
  const fuenteInicial = snapshotDirectorio(buildReal, { allowReleaseFiles: false });
  if (fuenteInicial.length === 0) throw new Error('el build está vacío');

  const vercelDir = join(stageDir, '.vercel');
  const outputDir = join(vercelDir, 'output');
  const staticDir = join(outputDir, 'static');
  mkdirSync(staticDir, { recursive: true, mode: 0o755 });
  copiarSnapshot(buildReal, staticDir, fuenteInicial);

  const marker = crearMarkerRelease(
    entrada.artifact,
    entrada.expectedCommit,
    entrada.expectedTree,
  );
  const markerPath = join(staticDir, RELEASE_MARKER);
  writeFileSync(markerPath, marker, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  const configPath = join(outputDir, 'config.json');
  const configEsperada = configBosaCanonico(entrada.artifact);
  const markerBytes = Buffer.from(marker, 'utf8');
  const configBytes = Buffer.from(configEsperada, 'utf8');
  const archivosBosaEsperados: ArchivoRelease[] = [
    ...fuenteInicial.map((archivo) => ({ ...archivo, path: `static/${archivo.path}` })),
    { path: 'static/release.json', size: markerBytes.byteLength, sha256: sha256(markerBytes) },
    { path: 'config.json', size: configBytes.byteLength, sha256: sha256(configBytes) },
  ].sort((a, b) => compararTextoCanonico(a.path, b.path));
  const manifiestoPath = join(stageDir, RELEASE_MANIFEST);
  let configCreado = false;
  let manifiestoCreado = false;
  try {
    writeFileSync(configPath, configEsperada, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    configCreado = true;

    entrada.afterPackageForTest?.();

    const fuenteFinal = snapshotDirectorio(buildReal, { allowReleaseFiles: false });
    if (!mismosArchivos(fuenteInicial, fuenteFinal)) {
      throw new Error('el build cambió durante el sellado');
    }
    exigirCensoStage(stageDir, false);
    const archivosBosa = exigirCensoBosa(outputDir, configEsperada);
    if (!mismosArchivos(archivosBosaEsperados, archivosBosa)) {
      throw new Error('la salida no coincide con el build y marcador medidos');
    }
    const manifiesto = crearManifiesto(
      entrada.artifact,
      entrada.expectedCommit,
      entrada.expectedTree,
      archivosBosa,
    );
    const manifiestoTexto = jsonDelManifiesto(manifiesto);
    exigirGitExacto(repoDir, entrada.expectedCommit, entrada.expectedTree, 'después');
    writeFileSync(manifiestoPath, manifiestoTexto, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o644,
    });
    manifiestoCreado = true;

    exigirCensoStage(stageDir, true);
    const archivosFinales = exigirCensoBosa(outputDir, configEsperada);
    const manifiestoFinal = leerArchivoSeguro(manifiestoPath);
    if (!mismosArchivos(archivosBosaEsperados, archivosFinales) ||
        !mismosArchivos(archivosBosa, archivosFinales) ||
        manifiestoFinal.toString('utf8') !== manifiestoTexto ||
        calcularDigestRaiz(archivosFinales) !== manifiesto.root_sha256) {
      throw new Error('el paquete BOSA no coincide con su manifiesto externo');
    }
    exigirGitExacto(repoDir, entrada.expectedCommit, entrada.expectedTree, 'después');

    return {
      artifact: entrada.artifact,
      commit_sha: entrada.expectedCommit,
      tree_sha: entrada.expectedTree,
      files: archivosBosa.length,
      root_sha256: manifiesto.root_sha256,
      manifest_sha256: sha256(manifiestoFinal),
    };
  } catch (error) {
    if (manifiestoCreado) unlinkSync(manifiestoPath);
    if (configCreado) unlinkSync(configPath);
    throw error;
  }
}

function parsearCli(argv: readonly string[]): SellarArtefactoRelease {
  const permitidas = new Set(['--artifact', '--repo', '--stage', '--commit', '--tree']);
  const valores = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const clave = argv[i];
    const valor = argv[i + 1];
    if (!clave || !permitidas.has(clave) || valores.has(clave) || !valor || valor.startsWith('--')) {
      throw new Error('argumentos CLI inválidos');
    }
    valores.set(clave, valor);
  }
  if (valores.size !== permitidas.size) throw new Error('faltan argumentos CLI obligatorios');
  const artifact = valores.get('--artifact');
  if (artifact !== 'app' && artifact !== 'landing') throw new Error('artifact debe ser app o landing');
  return {
    artifact,
    repoDir: valores.get('--repo')!,
    stageDir: valores.get('--stage')!,
    expectedCommit: valores.get('--commit')!,
    expectedTree: valores.get('--tree')!,
  };
}

export function ejecutarCliReleaseArtifact(argv: readonly string[]): number {
  try {
    const resultado = sellarArtefactoRelease(parsearCli(argv));
    process.stdout.write(serializarJsonCanonico(resultado as unknown as Json));
    return 0;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'error desconocido';
    process.stderr.write(`releaseArtifact: ${mensaje}\n`);
    return 1;
  }
}

function esEntradaViteNode(): boolean {
  const ejecutado = process.argv[1];
  return typeof ejecutado === 'string' && import.meta.url === pathToFileURL(ejecutado).href;
}

if (esEntradaViteNode()) {
  process.exitCode = ejecutarCliReleaseArtifact(process.argv.slice(2));
}
