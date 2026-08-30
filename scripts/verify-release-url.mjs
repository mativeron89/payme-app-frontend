import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_GIT = /^[0-9a-f]{40}$/;
const SHA_256 = /^[0-9a-f]{64}$/;
const MAX_ARCHIVOS = 20_000;
const MAX_ARCHIVO_BYTES = 64 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const ESPERA_ENTRE_RONDAS_MS = process.env.NODE_ENV === 'test' ? 25 : 5_000;

// --- Compuerta remota de las dos rutas Meta -------------------------------
// PREPARADA, NO ARMADA. `--bosa-routes` es opcional y su default es `skip`:
// esta orden deja el codigo listo y prohibe ejecutar la sonda contra un
// deployment real. Una orden posterior la enciende pasando `probe`.
const BOSA_ROUTES_MODOS = new Set(['skip', 'probe']);

// Codigo sintetico de sonda: Base64URL canonico de 24 caracteres (24 % 4 === 0,
// sin bits de relleno que validar). No identifica a nadie y no existe.
const SONDA_CODE_META = 'PAYMESONDABOSA0000000000';

const RUTAS_META_BOSA = ['/privacy', `/facebook-data-deletion/${SONDA_CODE_META}`];

// Claves en minuscula: Headers.get() es case-insensitive por spec, asi que la
// sonda no puede exigir casing. El casing exacto lo custodia el config sellado.
const HEADERS_META_BOSA = [
  ['cache-control', 'no-store'],
  ['referrer-policy', 'no-referrer'],
];

/**
 * Contrato remoto cerrado por artifact. App sirve las dos rutas; Landing NO las
 * tiene y debe contestar 404 SIN las cabeceras Meta. Un Map: un artifact sin
 * entrada no hereda default y la sonda no corre.
 */
const CONTRATO_RUTAS_META = new Map([
  ['app', { status: 200, cabeceras: 'exigidas' }],
  ['landing', { status: 404, cabeceras: 'ausentes' }],
]);

function serializarValorCanonico(valor) {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'number') {
    if (typeof valor === 'number' && !Number.isSafeInteger(valor)) {
      throw new Error('el JSON canonico solo admite enteros seguros');
    }
    return JSON.stringify(valor);
  }
  if (typeof valor === 'string') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(serializarValorCanonico).join(',')}]`;
  if (typeof valor !== 'object') throw new Error('el JSON canonico contiene un tipo invalido');
  return `{${Object.keys(valor).sort().map((clave) =>
    `${JSON.stringify(clave)}:${serializarValorCanonico(valor[clave])}`).join(',')}}`;
}

function serializarJsonCanonico(valor) {
  return `${serializarValorCanonico(valor)}\n`;
}

function leerArchivoSeguro(ruta) {
  let fd = null;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const antes = fstatSync(fd, { bigint: true });
    if (!antes.isFile() || antes.nlink !== 1n || antes.size > BigInt(MAX_ARCHIVO_BYTES)) {
      throw new Error('el manifiesto local no es un archivo regular seguro');
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const leidos = readSync(fd, chunk, 0, chunk.byteLength, null);
      if (leidos === 0) break;
      chunks.push(chunk.subarray(0, leidos));
      total += leidos;
      if (total > MAX_ARCHIVO_BYTES) throw new Error('el manifiesto local excede el limite');
    }
    const despues = fstatSync(fd, { bigint: true });
    if (antes.dev !== despues.dev || antes.ino !== despues.ino || antes.mode !== despues.mode ||
        antes.nlink !== despues.nlink || antes.size !== despues.size ||
        antes.mtimeNs !== despues.mtimeNs || antes.ctimeNs !== despues.ctimeNs ||
        BigInt(total) !== antes.size) {
      throw new Error('el manifiesto local cambio durante su lectura');
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function parsearCli(argv) {
  const obligatorias = new Set([
    '--stage', '--url', '--artifact', '--commit', '--tree', '--manifest-sha256', '--root-sha256',
  ]);
  const opcionales = new Set(['--bosa-routes']);
  const valores = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const clave = argv[i];
    const valor = argv[i + 1];
    if (!clave || (!obligatorias.has(clave) && !opcionales.has(clave)) || valores.has(clave) ||
        !valor || valor.startsWith('--')) {
      throw new Error('argumentos CLI invalidos');
    }
    valores.set(clave, valor);
  }
  for (const clave of obligatorias) {
    if (!valores.has(clave)) throw new Error('faltan argumentos CLI obligatorios');
  }
  const bosaRoutes = valores.get('--bosa-routes') ?? 'skip';
  if (!BOSA_ROUTES_MODOS.has(bosaRoutes)) throw new Error('modo de sonda BOSA invalido');
  const artifact = valores.get('--artifact');
  const commit = valores.get('--commit');
  const tree = valores.get('--tree');
  const manifestSha256 = valores.get('--manifest-sha256');
  const rootSha256 = valores.get('--root-sha256');
  if ((artifact !== 'app' && artifact !== 'landing') || !SHA_GIT.test(commit) ||
      !SHA_GIT.test(tree) || !SHA_256.test(manifestSha256) || !SHA_256.test(rootSha256)) {
    throw new Error('la identidad esperada no tiene forma canonica');
  }
  return {
    stage: valores.get('--stage'),
    url: valores.get('--url'),
    artifact,
    commit,
    tree,
    manifestSha256,
    rootSha256,
    bosaRoutes,
  };
}

function validarUrlBase(texto) {
  let url;
  try {
    url = new URL(texto);
  } catch {
    throw new Error('la URL staged no es valida');
  }
  const loopbackDeTest = process.env.NODE_ENV === 'test' &&
    url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '::1');
  if ((!loopbackDeTest && url.protocol !== 'https:') ||
      (!loopbackDeTest && !url.hostname.endsWith('.vercel.app')) ||
      (!loopbackDeTest && url.port !== '') ||
      url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '' ||
      (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('la URL staged no cumple el contrato de origen');
  }
  url.pathname = '/';
  return url;
}

function urlDeArchivo(base, path) {
  if (!path.startsWith('static/')) throw new Error('el manifiesto contiene un path no servido');
  const relativo = path.slice('static/'.length);
  const segmentos = relativo.split('/');
  if (segmentos.length === 0 || segmentos.some((s) => s === '' || s === '.' || s === '..')) {
    throw new Error('el manifiesto contiene un path no canonico');
  }
  const url = new URL(segmentos.map(encodeURIComponent).join('/'), base);
  if (url.origin !== base.origin || !url.pathname.startsWith('/')) {
    throw new Error('un path remoto escapa del deployment');
  }
  return url;
}

async function leerRespuestaExacta(response, esperado) {
  if (response.status !== 200 || response.redirected || !response.body) {
    throw new Error('un archivo staged no respondio 200 directo');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > esperado || total > MAX_ARCHIVO_BYTES) {
      await reader.cancel();
      throw new Error('un archivo staged excede el tamano sellado');
    }
    chunks.push(Buffer.from(value));
  }
  if (total !== esperado) throw new Error('un archivo staged tiene otro tamano');
  return Buffer.concat(chunks, total);
}

async function verificarUrl(url, archivo) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'PayMe-Release-Verifier/1' },
    });
    const bytes = await leerRespuestaExacta(response, archivo.size);
    if (createHash('sha256').update(bytes).digest('hex') !== archivo.sha256) {
      throw new Error('un archivo staged no coincide con su SHA-256');
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('timeout verificando un archivo staged');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function verificarArchivo(base, archivo) {
  await verificarUrl(urlDeArchivo(base, archivo.path), archivo);
}

/**
 * Sonda UNA ruta Meta contra el contrato de su artifact. Nunca deja escapar la
 * URL ni el error crudo del runtime: todo mensaje que sale de aca es literal.
 * `index` es el archivo sellado que App debe servir en ambas rutas; en Landing
 * no se lee cuerpo porque un 404 no tiene tamano sellado que acotarlo.
 */
async function sondearRutaMeta(base, ruta, contrato, index) {
  const url = new URL(ruta.slice(1), base);
  if (url.origin !== base.origin || url.pathname !== ruta || url.search !== '' || url.hash !== '') {
    throw new Error('una ruta Meta escapa del deployment');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'PayMe-Release-Verifier/1' },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('timeout sondeando una ruta Meta');
    }
    throw new Error('no se pudo sondear una ruta Meta');
  }
  try {
    if (response.status !== contrato.status) {
      throw new Error(`una ruta Meta no respondio ${contrato.status}`);
    }
    for (const [clave, valor] of HEADERS_META_BOSA) {
      const servido = response.headers.get(clave);
      if (contrato.cabeceras === 'exigidas' && servido !== valor) {
        throw new Error('una ruta Meta no sirvio las cabeceras exactas');
      }
      if (contrato.cabeceras === 'ausentes' && servido !== null) {
        throw new Error('una ruta Meta sirvio una cabecera que no le corresponde');
      }
    }
    if (contrato.cabeceras === 'exigidas') {
      const bytes = await leerRespuestaExacta(response, index.size);
      if (createHash('sha256').update(bytes).digest('hex') !== index.sha256) {
        throw new Error('una ruta Meta no sirvio el index sellado');
      }
    } else {
      await response.body?.cancel();
    }
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Compuerta remota completa. Se llama DESPUES de adjudicar artifact, manifiesto
 * e identidad: si el contrato del artifact no existe, no se emite una sola
 * request.
 */
async function sondearRutasMeta(base, artifact, index) {
  const contrato = CONTRATO_RUTAS_META.get(artifact);
  if (!contrato) throw new Error('artifact sin contrato de rutas Meta');
  for (const ruta of RUTAS_META_BOSA) await sondearRutaMeta(base, ruta, contrato, index);
}

async function main() {
  const entrada = parsearCli(process.argv.slice(2));
  const aqui = dirname(fileURLToPath(import.meta.url));
  const stageReal = realpathSync(entrada.stage);
  if (stageReal !== entrada.stage) throw new Error('stage no es una ruta canonica');
  execFileSync(process.execPath, [
    join(aqui, 'verify-release-artifact.mjs'),
    '--stage', stageReal,
    '--artifact', entrada.artifact,
    '--commit', entrada.commit,
    '--tree', entrada.tree,
    '--manifest-sha256', entrada.manifestSha256,
    '--root-sha256', entrada.rootSha256,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const manifiesto = JSON.parse(
    leerArchivoSeguro(join(stageReal, 'release-manifest.json')).toString('utf8'),
  );
  const archivos = manifiesto.files.filter((archivo) => archivo.path.startsWith('static/'));
  if (archivos.length === 0 || archivos.length > MAX_ARCHIVOS ||
      archivos.length !== manifiesto.files.length - 1) {
    throw new Error('el manifiesto no separa config y static de forma exacta');
  }
  // Adjudicacion ANTES de cualquier sonda: el manifiesto debe declarar el mismo
  // artifact que la orden, y ese artifact debe tener contrato remoto cerrado.
  if (manifiesto.artifact !== entrada.artifact || !CONTRATO_RUTAS_META.has(entrada.artifact)) {
    throw new Error('el manifiesto no adjudica el artifact de la orden');
  }
  const base = validarUrlBase(entrada.url);
  const index = archivos.find((archivo) => archivo.path === 'static/index.html');
  if (!index) throw new Error('el manifiesto no contiene el index publico');
  for (let ronda = 0; ronda < 2; ronda += 1) {
    for (const archivo of archivos) await verificarArchivo(base, archivo);
    await verificarUrl(base, index);
    if (ronda === 0) {
      await new Promise((resolve) => setTimeout(resolve, ESPERA_ENTRE_RONDAS_MS));
    }
  }
  if (entrada.bosaRoutes === 'probe') await sondearRutasMeta(base, entrada.artifact, index);
  process.stdout.write(serializarJsonCanonico({
    artifact: entrada.artifact,
    bosa_routes: entrada.bosaRoutes === 'probe' ? 'probed' : 'skipped',
    commit_sha: entrada.commit,
    files: archivos.length,
    rounds: 2,
    tree_sha: entrada.tree,
    verified: true,
  }));
}

try {
  await main();
} catch (error) {
  const mensaje = error instanceof Error ? error.message : 'error desconocido';
  process.stderr.write(`verifyReleaseUrl: ${mensaje}\n`);
  process.exitCode = 1;
}
