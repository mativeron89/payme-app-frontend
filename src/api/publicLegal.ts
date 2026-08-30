import { legalTextResponse } from './contractResponses';
import { codigoValido } from '../public/publicRoute';
import type { LegalTextResponse } from './types';

/**
 * APP-FE-META-PUBLIC-COMPLIANCE-01 · el ÚNICO cliente de red de las superficies
 * públicas (`/privacy` y `/facebook-data-deletion/<code>`).
 *
 * ## Por qué no reusa `src/api/http.ts`
 *
 * No es duplicación por comodidad. `http.ts` importa `./storage` en su primera
 * línea: leer sesión, refrescarla, escribir tombstones. Las rutas públicas
 * tienen prohibido tocar sesión, cookies y `localStorage`, así que **importarlo
 * arrastraría justo lo que no puede existir acá**. Este módulo importa un solo
 * archivo del resto de la app —el decoder contractual— y nada más.
 *
 * ## Lo que este cliente NO hace, y es la lista corta a propósito
 *
 * - **Un intento.** No hay reintento automático en ningún camino. El retry de
 *   `/privacy` lo dispara la persona con un botón, y es otra invocación.
 * - **No acepta URLs de nadie.** Base de `VITE_API_URL` y dos paths literales
 *   escritos acá. Ni query, ni hash, ni respuesta, ni usuario pueden mover el
 *   host o el path — el `code` entra sólo como último segmento, ya validado
 *   contra Base64URL por `publicRoute.ts`, y se codifica igual antes de viajar.
 * - **No emite errores con contenido adentro.** Todo camino de falla devuelve
 *   una variante cerrada de la unión. Ningún `Error` de este módulo lleva el
 *   `confirmation_code`, la URL ni el cuerpo de la respuesta: no se puede
 *   filtrar por consola lo que nunca se puso en un mensaje.
 *
 * ## Un 200 no es un éxito
 *
 * `deletionStatus` responde `{status:'pending'|'completed'}` y nada más. Un 200
 * con otra forma —un `{}`, un `{status:'deleted'}`, un HTML de un proxy— es
 * **no verificable**, jamás «completada». Es la misma regla que
 * `ContractResponseError` ya aplica en el resto del repo, escrita acá para el
 * endpoint que el resto del repo no consume.
 *
 * ⚠️ **Sin riel mock, y es deliberado.** El aviso legal no se inventa ni se
 * copia (orden §Arquitectura). Un mock del aviso sería texto legal inventado
 * viviendo en el repo, que es exactamente el STOP. En `VITE_MOCK=1` estas
 * páginas consultan igual y muestran *No verificable* si no hay backend: honesto
 * y sin texto falso. Los estados se ejercitan en Playwright interceptando la
 * red, no fabricando un aviso.
 */

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const PATH_AVISO = '/api/legal/aviso_privacidad';
export const PREFIJO_STATUS = '/api/auth/facebook/data-deletion/status/';

/**
 * Deadline ÚNICO: cubre la conexión **y** la lectura del cuerpo. Un timeout que
 * sólo cubriera el `fetch` dejaría abierta la mitad interesante — un servidor
 * que contesta las cabeceras al instante y después gotea el body para siempre.
 */
export const DEADLINE_MS = 8_000;

/**
 * Cota dura del cuerpo. Un aviso de privacidad completo entra sobradísimo; lo
 * que esto corta es una respuesta que no termina nunca. Se mide **mientras se
 * lee**, no después: comprobar el largo con el body ya en memoria no acota
 * nada.
 */
export const LIMITE_BYTES = 256 * 1024;

export type LecturaAviso =
  | { readonly estado: 'ok'; readonly aviso: LegalTextResponse['legal_text'] }
  | { readonly estado: 'no-verificable' };

export type LecturaEliminacion =
  | { readonly estado: 'pendiente' }
  | { readonly estado: 'completada' }
  | { readonly estado: 'no-encontrada' }
  | { readonly estado: 'no-verificable' };

interface Opciones {
  /** Sólo lo mueven los tests; producción usa `DEADLINE_MS`. */
  readonly deadlineMs?: number;
}

/** Lee el cuerpo cortando en `limite` bytes. `null` ⇒ se pasó o no se pudo. */
async function leerAcotado(res: Response, limite: number): Promise<string | null> {
  const cuerpo = res.body;
  if (!cuerpo) {
    // Sin stream legible no hay lectura incremental posible; se acota igual
    // sobre el resultado, que es lo máximo que este camino permite afirmar.
    const texto = await res.text();
    return new TextEncoder().encode(texto).byteLength > limite ? null : texto;
  }
  const lector = cuerpo.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > limite) {
      await lector.cancel();
      return null;
    }
    trozos.push(value);
  }
  const junto = new Uint8Array(total);
  let cursor = 0;
  for (const t of trozos) {
    junto.set(t, cursor);
    cursor += t.byteLength;
  }
  return new TextDecoder().decode(junto);
}

/** El resultado crudo de una consulta pública: status HTTP + JSON, o `null`. */
interface Respuesta {
  readonly status: number;
  readonly json: unknown;
}

/**
 * UN intento contra un path fijo. Devuelve `null` ante cualquier falla de
 * transporte, deadline, MIME, tamaño o JSON — el caller decide qué significa.
 */
async function pedir(path: string, deadlineMs: number): Promise<Respuesta | null> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), deadlineMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      // Público: nunca viaja cookie, Authorization ni nada de sesión.
      credentials: 'omit',
      cache: 'no-store',
      // Un 30x se rechaza en vez de seguirse: seguirlo sería aceptar un destino
      // que no está escrito en este archivo.
      redirect: 'error',
      // El `confirmation_code` vive en el pathname de ESTA página; sin esto
      // viajaría como `Referer` de esta misma request. Es un agregado sobre la
      // lista de la orden, y está declarado en el CHANGELOG.
      referrerPolicy: 'no-referrer',
      headers: { accept: 'application/json' },
      signal: corte.signal,
    });
    /**
     * 🔴 IGUALDAD EXACTA DEL MEDIA TYPE, NO UN PREFIJO.
     *
     * Acá había `startsWith('application/json')`, y **aceptaba
     * `application/jsonp` y `application/json-evil`**: el prefijo es la misma
     * clase de defecto que una lista de lo conocido. Se normaliza —se corta en
     * el `;` de los parámetros, se recortan espacios, se baja a minúsculas— y
     * se compara por igualdad contra el único valor admitido. Cualquier otro
     * media type, y la ausencia de la cabecera, caen del lado cerrado.
     */
    const tipo = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (tipo !== 'application/json') return null;
    const texto = await leerAcotado(res, LIMITE_BYTES);
    if (texto === null) return null;
    try {
      return { status: res.status, json: JSON.parse(texto) as unknown };
    } catch {
      return null;
    }
  } catch {
    // Red, deadline, redirect rechazado, CORS. Ninguno se propaga con contenido.
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/** El aviso vigente, decodificado con el decoder contractual del repo. */
export async function leerAvisoPrivacidad(op: Opciones = {}): Promise<LecturaAviso> {
  const res = await pedir(PATH_AVISO, op.deadlineMs ?? DEADLINE_MS);
  if (!res || res.status !== 200) return { estado: 'no-verificable' };
  try {
    return { estado: 'ok', aviso: legalTextResponse(res.json).legal_text };
  } catch {
    // `ContractResponseError` nombra el endpoint, no el cuerpo — igual no se
    // propaga: un 2xx malformado es no verificable y se acabó.
    return { estado: 'no-verificable' };
  }
}

/**
 * El estado de una solicitud de eliminación.
 *
 * 🔴 **Revalida la forma del código y corta ANTES de la red.** `publicRoute.ts`
 * ya lo valida, y aun así se repite acá: este módulo es exportable y la orden
 * exige que un código inválido no produzca request. Dejarlo apoyado sólo en el
 * caller sería confiar en que el único caller de hoy siga siendo el único
 * mañana — y la guarda que protege a la red tiene que estar donde está la red.
 */
export async function leerEstadoEliminacion(
  code: string,
  op: Opciones = {},
): Promise<LecturaEliminacion> {
  if (!codigoValido(code)) return { estado: 'no-encontrada' };
  const res = await pedir(
    `${PREFIJO_STATUS}${encodeURIComponent(code)}`,
    op.deadlineMs ?? DEADLINE_MS,
  );
  if (!res) return { estado: 'no-verificable' };
  if (res.status === 404) return { estado: 'no-encontrada' };
  if (res.status !== 200) return { estado: 'no-verificable' };
  const cuerpo = res.json;
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return { estado: 'no-verificable' };
  }
  const claves = Object.keys(cuerpo as Record<string, unknown>);
  if (claves.length !== 1 || claves[0] !== 'status') return { estado: 'no-verificable' };
  const status = (cuerpo as Record<string, unknown>)['status'];
  if (status === 'pending') return { estado: 'pendiente' };
  if (status === 'completed') return { estado: 'completada' };
  return { estado: 'no-verificable' };
}
