import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const SHA_GIT = /^[0-9a-f]{40}$/;
const SHA_256 = /^[0-9a-f]{64}$/;
const MAX_ARCHIVOS = 20_000;
const MAX_ARCHIVO_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
// El verificador viaja SOLO dentro del artifact: no puede importar el sellador,
// asi que reescribe los bytes esperados. Esa duplicacion es la deriva que la
// orden manda matar, y la matan los tests que comparan estas dos constantes
// contra las que deriva scripts/releaseArtifact.ts.
const CONFIG_BOSA = new Map([
  ['app', '{"routes":[{"dest":"/index.html","headers":{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"},"src":"^/privacy$"},{"dest":"/index.html","headers":{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"},"src":"^/facebook-data-deletion/[^/]+$"}],"version":3}\n'],
  ['landing', '{"version":3}\n'],
]);

/**
 * Adjudica la config por artifact. Un Map cerrado y no un objeto: `__proto__` y
 * `constructor` no devuelven nada, y un artifact desconocido no hereda un
 * default. Aceptar cualquiera de las dos para cualquiera de los dos artefactos
 * seria exactamente el fallo que la orden prohibe.
 */
function configEsperadaDe(artifact) {
  const esperada = CONFIG_BOSA.get(artifact);
  if (typeof esperada !== 'string') throw new Error('artifact sin config BOSA adjudicada');
  return esperada;
}

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function compararTexto(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function leerArchivoSeguro(ruta) {
  let fd = null;
  try {
    fd = openSync(ruta, constants.O_RDONLY | constants.O_NOFOLLOW);
    const antes = fstatSync(fd, { bigint: true });
    if (!antes.isFile() || antes.nlink !== 1n || antes.size > BigInt(MAX_ARCHIVO_BYTES)) {
      throw new Error('el paquete contiene un objeto no regular, hardlink o demasiado grande');
    }
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(64 * 1024);
      const leidos = readSync(fd, chunk, 0, chunk.byteLength, null);
      if (leidos === 0) break;
      chunks.push(chunk.subarray(0, leidos));
      total += leidos;
      if (total > MAX_ARCHIVO_BYTES) throw new Error('un archivo excede el limite de verificacion');
    }
    const despues = fstatSync(fd, { bigint: true });
    if (antes.dev !== despues.dev || antes.ino !== despues.ino || antes.mode !== despues.mode ||
        antes.nlink !== despues.nlink || antes.size !== despues.size ||
        antes.mtimeNs !== despues.mtimeNs || antes.ctimeNs !== despues.ctimeNs ||
        BigInt(total) !== antes.size) {
      throw new Error('un archivo cambio durante su verificacion');
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function exigirDirectorioReal(ruta, nombre) {
  const estado = lstatSync(ruta, { throwIfNoEntry: false });
  if (!estado?.isDirectory() || estado.isSymbolicLink() || realpathSync(ruta) !== ruta) {
    throw new Error(`${nombre} debe ser un directorio real sin symlinks`);
  }
}

function exigirEntradasExactas(directorio, esperadas, nombre) {
  const actuales = readdirSync(directorio).sort(compararTexto);
  const canonicas = [...esperadas].sort(compararTexto);
  if (serializarValorCanonico(actuales) !== serializarValorCanonico(canonicas)) {
    throw new Error(`${nombre} contiene extras o faltantes`);
  }
}

function estaDentro(base, candidata) {
  const rel = relative(base, candidata);
  return rel !== '' && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel);
}

function exigirSegmentoSeguro(nombre) {
  if (nombre === '' || nombre === '.' || nombre === '..' || nombre !== nombre.normalize('NFC') ||
      /[\\/\u0000-\u001f\u007f]/u.test(nombre)) {
    throw new Error('el paquete contiene un nombre de ruta no canonico');
  }
}

function rutaPareceSecreto(ruta) {
  const segmentos = ruta.toLowerCase().split('/');
  return segmentos.some((segmento) =>
    segmento.startsWith('.env') ||
    segmento === '.git' ||
    segmento === '.npmrc' ||
    segmento === 'credentials.json' ||
    segmento === 'id_rsa' ||
    segmento === 'id_ed25519' ||
    segmento.endsWith('.pem') ||
    segmento.endsWith('.key') ||
    segmento.endsWith('.p12') ||
    segmento.endsWith('.pfx'));
}

function bytesParecenSecreto(bytes) {
  const texto = bytes.toString('utf8');
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(texto) ||
    /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/.test(texto) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(texto) ||
    /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/.test(texto);
}

function snapshotDirectorio(raiz) {
  const archivos = [];
  const colisiones = new Set();
  let totalBytes = 0;

  const visitar = (directorio, prefijo) => {
    const entradas = readdirSync(directorio, { withFileTypes: true })
      .sort((a, b) => compararTexto(a.name, b.name));
    for (const entrada of entradas) {
      exigirSegmentoSeguro(entrada.name);
      const rutaRelativa = prefijo ? `${prefijo}/${entrada.name}` : entrada.name;
      const clavePortable = rutaRelativa.toLowerCase();
      if (colisiones.has(clavePortable)) {
        throw new Error('el paquete contiene rutas que colisionan entre plataformas');
      }
      colisiones.add(clavePortable);
      if (rutaPareceSecreto(rutaRelativa)) throw new Error('el paquete contiene una ruta sensible');

      const ruta = join(directorio, entrada.name);
      const estado = lstatSync(ruta);
      if (estado.isSymbolicLink() || entrada.isSymbolicLink()) {
        throw new Error('el paquete contiene un symlink');
      }
      const realAntes = realpathSync(ruta);
      if (!estaDentro(raiz, realAntes)) throw new Error('una ruta escapa del paquete');
      if (estado.isDirectory() && entrada.isDirectory()) {
        visitar(ruta, rutaRelativa);
        continue;
      }
      if (!estado.isFile() || !entrada.isFile() || estado.nlink !== 1) {
        throw new Error('el paquete contiene un objeto no regular o hardlink');
      }
      const bytes = leerArchivoSeguro(ruta);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('el paquete excede el limite total');
      if (archivos.length >= MAX_ARCHIVOS) throw new Error('el paquete excede el maximo de archivos');
      if (bytesParecenSecreto(bytes)) throw new Error('el paquete contiene material secreto');
      const estadoFinal = lstatSync(ruta);
      if (estadoFinal.isSymbolicLink() || !estadoFinal.isFile() || estadoFinal.nlink !== 1 ||
          realpathSync(ruta) !== realAntes) {
        throw new Error('una ruta cambio durante su verificacion');
      }
      archivos.push({ path: rutaRelativa, size: bytes.byteLength, sha256: sha256(bytes) });
    }
  };

  visitar(raiz, '');
  return archivos.sort((a, b) => compararTexto(a.path, b.path));
}

function calcularDigestRaiz(archivos) {
  let anterior = '';
  for (const archivo of archivos) {
    if (!archivo || typeof archivo !== 'object' || Array.isArray(archivo) ||
        Object.keys(archivo).sort().join(',') !== 'path,sha256,size' ||
        typeof archivo.path !== 'string' || archivo.path === '' || archivo.path <= anterior ||
        !Number.isSafeInteger(archivo.size) || archivo.size < 0 ||
        typeof archivo.sha256 !== 'string' || !SHA_256.test(archivo.sha256)) {
      throw new Error('la lista de archivos del manifiesto no es canonica');
    }
    anterior = archivo.path;
  }
  return sha256(serializarValorCanonico(archivos.map(({ path, sha256: digest, size }) => ({
    path,
    sha256: digest,
    size,
  }))));
}

function exigirObjetoExacto(valor, claves, nombre) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) ||
      Object.keys(valor).sort().join(',') !== [...claves].sort().join(',')) {
    throw new Error(`${nombre} no tiene el schema exacto`);
  }
}

function mismosArchivos(a, b) {
  return serializarValorCanonico(a) === serializarValorCanonico(b);
}

function parsearCli(argv) {
  const permitidas = new Set([
    '--stage', '--artifact', '--commit', '--tree', '--manifest-sha256', '--root-sha256',
  ]);
  const valores = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    const clave = argv[i];
    const valor = argv[i + 1];
    if (!clave || !permitidas.has(clave) || valores.has(clave) || !valor || valor.startsWith('--')) {
      throw new Error('argumentos CLI invalidos');
    }
    valores.set(clave, valor);
  }
  if (valores.size !== permitidas.size) throw new Error('faltan argumentos CLI obligatorios');
  const artifact = valores.get('--artifact');
  if (artifact !== 'app' && artifact !== 'landing') throw new Error('artifact debe ser app o landing');
  const commit = valores.get('--commit');
  const tree = valores.get('--tree');
  const manifestSha256 = valores.get('--manifest-sha256');
  const rootSha256 = valores.get('--root-sha256');
  if (!SHA_GIT.test(commit) || !SHA_GIT.test(tree) ||
      !SHA_256.test(manifestSha256) || !SHA_256.test(rootSha256)) {
    throw new Error('los hashes esperados no tienen forma canonica');
  }
  const stage = valores.get('--stage');
  if (!isAbsolute(stage) || resolve(stage) !== stage) {
    throw new Error('stage debe ser una ruta absoluta canonica');
  }
  return { stage, artifact, commit, tree, manifestSha256, rootSha256 };
}

function verificar(entrada) {
  exigirDirectorioReal(entrada.stage, 'stage');
  exigirEntradasExactas(entrada.stage, ['.vercel', 'release-manifest.json'], 'stage');
  const vercelDir = join(entrada.stage, '.vercel');
  exigirDirectorioReal(vercelDir, '.vercel');
  exigirEntradasExactas(vercelDir, ['output'], '.vercel');
  const outputDir = join(vercelDir, 'output');
  exigirDirectorioReal(outputDir, 'output BOSA');
  exigirEntradasExactas(outputDir, ['config.json', 'static'], 'output BOSA');
  const staticDir = join(outputDir, 'static');
  exigirDirectorioReal(staticDir, 'static BOSA');

  const config = leerArchivoSeguro(join(outputDir, 'config.json'));
  if (config.toString('utf8') !== configEsperadaDe(entrada.artifact)) {
    throw new Error('config.json BOSA no es el del artifact adjudicado');
  }
  const archivos = snapshotDirectorio(outputDir);
  if (!archivos.some((archivo) => archivo.path === 'static/index.html') ||
      !archivos.some((archivo) => archivo.path === 'static/release.json')) {
    throw new Error('el paquete no contiene index.html y release.json');
  }

  const manifiestoBytes = leerArchivoSeguro(join(entrada.stage, 'release-manifest.json'));
  if (sha256(manifiestoBytes) !== entrada.manifestSha256) {
    throw new Error('el SHA-256 del manifiesto externo no coincide');
  }
  let manifiesto;
  try {
    manifiesto = JSON.parse(manifiestoBytes.toString('utf8'));
  } catch {
    throw new Error('el manifiesto externo no es JSON');
  }
  exigirObjetoExacto(manifiesto, [
    'schema', 'artifact', 'clean', 'commit_sha', 'tree_sha', 'hash_algorithm',
    'manifest_scope', 'files', 'root_sha256',
  ], 'el manifiesto');
  if (serializarJsonCanonico(manifiesto) !== manifiestoBytes.toString('utf8')) {
    throw new Error('el manifiesto externo no usa JSON canonico');
  }
  if (manifiesto.schema !== 1 || manifiesto.artifact !== entrada.artifact ||
      manifiesto.clean !== true || manifiesto.commit_sha !== entrada.commit ||
      manifiesto.tree_sha !== entrada.tree || manifiesto.hash_algorithm !== 'sha256' ||
      manifiesto.manifest_scope !== '.vercel/output' ||
      typeof manifiesto.root_sha256 !== 'string' || !SHA_256.test(manifiesto.root_sha256) ||
      !Array.isArray(manifiesto.files)) {
    throw new Error('la identidad del manifiesto no coincide con la orden');
  }
  const digest = calcularDigestRaiz(manifiesto.files);
  if (digest !== manifiesto.root_sha256 || digest !== entrada.rootSha256 ||
      !mismosArchivos(manifiesto.files, archivos)) {
    throw new Error('los bytes BOSA no coinciden con el manifiesto sellado');
  }

  const markerBytes = leerArchivoSeguro(join(staticDir, 'release.json'));
  let marker;
  try {
    marker = JSON.parse(markerBytes.toString('utf8'));
  } catch {
    throw new Error('release.json no es JSON');
  }
  exigirObjetoExacto(marker, ['schema', 'artifact', 'clean', 'commit_sha', 'tree_sha'], 'release.json');
  if (serializarJsonCanonico(marker) !== markerBytes.toString('utf8') || marker.schema !== 1 ||
      marker.artifact !== entrada.artifact || marker.clean !== true ||
      marker.commit_sha !== entrada.commit || marker.tree_sha !== entrada.tree) {
    throw new Error('release.json no coincide con la identidad esperada');
  }

  return {
    artifact: entrada.artifact,
    commit_sha: entrada.commit,
    files: archivos.length,
    manifest_sha256: entrada.manifestSha256,
    root_sha256: digest,
    tree_sha: entrada.tree,
    verified: true,
  };
}

try {
  const resultado = verificar(parsearCli(process.argv.slice(2)));
  process.stdout.write(serializarJsonCanonico(resultado));
} catch (error) {
  const mensaje = error instanceof Error ? error.message : 'error desconocido';
  process.stderr.write(`verifyReleaseArtifact: ${mensaje}\n`);
  process.exitCode = 1;
}
