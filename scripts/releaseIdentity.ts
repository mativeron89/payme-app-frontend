import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export type ArtefactoRelease = 'app' | 'landing';

export interface MarcadorReleaseLimpio {
  readonly schema: 1;
  readonly artifact: ArtefactoRelease;
  readonly commit_sha: string;
  readonly tree_sha: string;
  readonly clean: true;
}

export interface MarcadorReleaseSucio {
  readonly schema: 1;
  readonly artifact: ArtefactoRelease;
  readonly commit_sha: string;
  readonly tree_sha: string;
  readonly clean: false;
  readonly dirty_path: string;
}

export type MarcadorRelease = MarcadorReleaseLimpio | MarcadorReleaseSucio;

export interface CrearMarcadorRelease {
  readonly artefacto: ArtefactoRelease;
  readonly commitSha: string;
  readonly treeSha: string;
  /** Primer registro de `git status --porcelain`, o null si está limpio. */
  readonly cambio: string | null;
}

const SHA_GIT = /^[0-9a-f]{40}$/;

function exigirSha(nombre: string, valor: string): void {
  if (!SHA_GIT.test(valor)) throw new Error(`${nombre} no es un SHA Git exacto de 40 hexadecimales`);
}

export function crearMarcadorRelease(entrada: CrearMarcadorRelease): MarcadorRelease {
  exigirSha('commit_sha', entrada.commitSha);
  exigirSha('tree_sha', entrada.treeSha);
  if (entrada.cambio === null) {
    return {
      schema: 1,
      artifact: entrada.artefacto,
      commit_sha: entrada.commitSha,
      tree_sha: entrada.treeSha,
      clean: true,
    };
  }
  const cambio = entrada.cambio.trim();
  if (!cambio || cambio.includes('\n') || cambio.length > 200) {
    throw new Error('dirty_path no es un registro porcelain acotado');
  }
  return {
    schema: 1,
    artifact: entrada.artefacto,
    commit_sha: entrada.commitSha,
    tree_sha: entrada.treeSha,
    clean: false,
    dirty_path: cambio,
  };
}

export function serializarMarcadorRelease(marcador: MarcadorRelease): string {
  return `${JSON.stringify(marcador)}\n`;
}

function git(cwd: string, argumentos: readonly string[]): string {
  return execFileSync('git', [...argumentos], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Lee la misma señal que el sentinel: cualquier cambio previo al build queda
 * declarado. No excluye `vercel.json`, archivos conocidos ni un proveedor.
 */
export function leerMarcadorGit(cwd: string, artefacto: ArtefactoRelease): MarcadorRelease {
  const commitSha = git(cwd, ['rev-parse', 'HEAD']);
  const treeSha = git(cwd, ['rev-parse', 'HEAD^{tree}']);
  const estado = git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']);
  const cambio = estado ? estado.split('\n')[0]!.trim() : null;
  return crearMarcadorRelease({ artefacto, commitSha, treeSha, cambio });
}

function esMapa(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function parsearMarcador(cuerpo: string): MarcadorRelease {
  if (Buffer.byteLength(cuerpo, 'utf8') > 4096) throw new Error('marker demasiado grande');
  let valor: unknown;
  try {
    valor = JSON.parse(cuerpo);
  } catch {
    throw new Error('marker no es JSON');
  }
  if (!esMapa(valor)) throw new Error('marker no es objeto');
  const limpio = valor['clean'] === true;
  const clavesEsperadas = limpio
    ? ['artifact', 'clean', 'commit_sha', 'schema', 'tree_sha']
    : ['artifact', 'clean', 'commit_sha', 'dirty_path', 'schema', 'tree_sha'];
  if (JSON.stringify(Object.keys(valor).sort()) !== JSON.stringify(clavesEsperadas)) {
    throw new Error('shape de marker desconocido');
  }
  if (valor['schema'] !== 1 || (valor['artifact'] !== 'app' && valor['artifact'] !== 'landing') ||
      typeof valor['commit_sha'] !== 'string' || typeof valor['tree_sha'] !== 'string' ||
      typeof valor['clean'] !== 'boolean') {
    throw new Error('marker mal formado');
  }
  exigirSha('commit_sha', valor['commit_sha']);
  exigirSha('tree_sha', valor['tree_sha']);
  if (valor['clean']) {
    return {
      schema: 1,
      artifact: valor['artifact'],
      commit_sha: valor['commit_sha'],
      tree_sha: valor['tree_sha'],
      clean: true,
    };
  }
  if (typeof valor['dirty_path'] !== 'string' || !valor['dirty_path'].trim() ||
      valor['dirty_path'].includes('\n') || valor['dirty_path'].length > 200) {
    throw new Error('dirty_path mal formado');
  }
  return {
    schema: 1,
    artifact: valor['artifact'],
    commit_sha: valor['commit_sha'],
    tree_sha: valor['tree_sha'],
    clean: false,
    dirty_path: valor['dirty_path'],
  };
}

export interface ObjetivoRelease {
  /** Nombre seguro para logs; la URL jamás se imprime. */
  readonly nombre: string;
  readonly artefacto: ArtefactoRelease;
  readonly url: string;
}

export interface VerificarReleaseBlackBox {
  readonly esperada: { readonly commitSha: string; readonly treeSha: string };
  readonly objetivos: readonly ObjetivoRelease[];
  readonly maxIntentos?: number;
  readonly timeoutMs?: number;
  readonly esperaInicialMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly log?: (linea: string) => void;
}

export interface EvidenciaRelease {
  readonly nombre: string;
  readonly artefacto: ArtefactoRelease;
  readonly muestras: 2;
  readonly body_sha256: string;
}

const dormir = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

async function leerCuerpoAcotado(respuesta: Response): Promise<string> {
  const reader = respuesta.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > 4_096) {
        await reader.cancel();
        throw new Error('marker demasiado grande');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function leerConTimeout(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const respuesta = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    return await leerCuerpoAcotado(respuesta);
  } finally {
    clearTimeout(timer);
  }
}

async function medirObjetivo(
  objetivo: ObjetivoRelease,
  esperada: { readonly commitSha: string; readonly treeSha: string },
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const cuerpo = await leerConTimeout(objetivo.url, timeoutMs, fetchImpl);
    const marker = parsearMarcador(cuerpo);
    const exacto = marker.clean && marker.artifact === objetivo.artefacto &&
      marker.commit_sha === esperada.commitSha && marker.tree_sha === esperada.treeSha;
    return exacto ? createHash('sha256').update(cuerpo).digest('hex') : null;
  } catch {
    return null;
  }
}

/**
 * Prototipo local de DETECCIÓN post-publicación. No previene el side effect, no
 * promueve artefactos y no ejecuta rollback.
 */
export async function verificarReleaseBlackBox(
  entrada: VerificarReleaseBlackBox,
): Promise<EvidenciaRelease[]> {
  exigirSha('commit esperado', entrada.esperada.commitSha);
  exigirSha('tree esperado', entrada.esperada.treeSha);
  const maxIntentos = entrada.maxIntentos ?? 5;
  const timeoutMs = entrada.timeoutMs ?? 2_000;
  const esperaInicialMs = entrada.esperaInicialMs ?? 100;
  if (!Number.isInteger(maxIntentos) || maxIntentos < 2 || maxIntentos > 10) {
    throw new Error('maxIntentos debe estar entre 2 y 10');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('timeoutMs debe estar entre 1 y 30000');
  }
  if (!Number.isInteger(esperaInicialMs) || esperaInicialMs < 0 || esperaInicialMs > 5_000) {
    throw new Error('esperaInicialMs debe estar entre 0 y 5000');
  }
  if (entrada.objetivos.length !== 2 ||
      JSON.stringify(entrada.objetivos.map((o) => o.artefacto).sort()) !==
        JSON.stringify(['app', 'landing'])) {
    throw new Error('se exige exactamente un objetivo App y uno Landing');
  }
  const nombres = new Set<string>();
  const urls = new Set<string>();
  for (const objetivo of entrada.objetivos) {
    if (!/^[a-z0-9_-]{1,32}$/i.test(objetivo.nombre) || nombres.has(objetivo.nombre)) {
      throw new Error('los nombres de objetivo deben ser opacos, acotados y únicos');
    }
    let url: URL;
    try {
      url = new URL(objetivo.url);
    } catch {
      throw new Error('la URL de objetivo no es válida');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        urls.has(objetivo.url)) {
      throw new Error('las URLs deben ser HTTP(S), únicas y sin credenciales embebidas');
    }
    nombres.add(objetivo.nombre);
    urls.add(objetivo.url);
  }

  const fetchImpl = entrada.fetchImpl ?? fetch;
  const log = entrada.log ?? (() => undefined);
  let vectorAnterior: string | null = null;
  let rondasConjuntas = 0;
  let mejorParcial: string[] = [];
  for (let intento = 1; intento <= maxIntentos; intento++) {
    const hashes = new Map<string, string>();
    for (const objetivo of entrada.objetivos) {
      const hash = await medirObjetivo(objetivo, entrada.esperada, timeoutMs, fetchImpl);
      if (hash) {
        hashes.set(objetivo.nombre, hash);
        log(`${objetivo.nombre}: ronda=${intento} exacto sha256=${hash}`);
      } else {
        log(`${objetivo.nombre}: ronda=${intento} no-acreditado`);
      }
    }
    const exactos = entrada.objetivos.filter((objetivo) => hashes.has(objetivo.nombre));
    if (exactos.length > mejorParcial.length) mejorParcial = exactos.map((o) => o.nombre);
    if (exactos.length === entrada.objetivos.length) {
      const vector = entrada.objetivos.map((o) => `${o.nombre}:${hashes.get(o.nombre)}`).join('|');
      rondasConjuntas = vector === vectorAnterior ? rondasConjuntas + 1 : 1;
      vectorAnterior = vector;
      log(`release: ronda=${intento} conjunta=${rondasConjuntas}/2`);
      if (rondasConjuntas === 2) {
        return entrada.objetivos.map((objetivo) => ({
          nombre: objetivo.nombre,
          artefacto: objetivo.artefacto,
          muestras: 2,
          body_sha256: hashes.get(objetivo.nombre)!,
        }));
      }
    } else {
      vectorAnterior = null;
      rondasConjuntas = 0;
    }
    if (intento < maxIntentos) {
      const espera = Math.min(esperaInicialMs * (2 ** (intento - 1)), 1_000);
      await dormir(espera);
    }
  }
  if (mejorParcial.length > 0 && mejorParcial.length < entrada.objetivos.length) {
    const faltantes = entrada.objetivos.filter((o) => !mejorParcial.includes(o.nombre)).map((o) => o.nombre);
    throw new Error(
      `release parcial posible: ${mejorParcial.join(', ')} exacto; ` +
        `${faltantes.join(', ') || 'la ronda conjunta'} no acreditada`,
    );
  }
  throw new Error('release no reunió dos rondas conjuntas, estables y exactas');
}
