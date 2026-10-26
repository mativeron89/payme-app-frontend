import { useSyncExternalStore } from 'react';

/**
 * D484 · D486 · varias fotos de un ticket largo (App Backend 2.196.0, PR77),
 * contrato `contract-mirror/contract/ocr-pages-v1.json`.
 *
 * Mati: «Otra idea: sacar mas de una foto para tickets largos...implementala».
 * D486: hasta 4 fotos, cada foto es una lectura dentro del tope vigente, también
 * en Viajes, y el visor pasa las partes deslizando de costado.
 *
 * - **Sin la capacidad** (`features.ocr_pages` ausente, mal formada o apagada)
 *   la app queda exactamente como antes: un escaneo es una foto y ningún pedido
 *   negocia `pages_version=1` ni `ticket_image_version=2`.
 * - **Con la capacidad**, la pantalla de escaneo ofrece «Agregar otra parte» y
 *   el pedido con dos o más fotos negocia `pages_version=1` (el campo `images`).
 * - 🔴 **`enabled` no dice que la foto del ticket esté encendida** (auditoría de
 *   PR77, O3): eso lo dice sólo `features.ticket_image`. Las dos capacidades no
 *   se mezclan; `ticket_image_version=2` va sólo con las dos encendidas.
 * - 🔴 **El tope total de bytes es del dueño** (O1): se lee de
 *   `max_total_bytes`, nunca se fija acá. El front comprime cada parte para no
 *   pasarlo.
 */

export const CONTRATO_OCR_PAGINAS = 'payme.app.ocr_pages/v1';

/** La negociación exacta del dueño (`negotiation_param` = `negotiation_value`). */
export const PARAMETRO_OCR_PAGINAS = 'pages_version';
export const VALOR_OCR_PAGINAS = '1';

/** Las claves exactas de `features.ocr_pages` (`capacidad.claves` del contrato). */
export const CLAVES_CAPACIDAD_OCR_PAGINAS = [
  'supported', 'enabled', 'max_pages', 'max_total_bytes', 'negotiation_param', 'negotiation_value',
] as const;

/**
 * El rango que este front sabe mostrar: de 2 (si no, no hay «otra parte») a 4,
 * el CHECK del dueño (`page_index` 0..3, D486). Otro valor puede ser otra
 * semántica: apaga.
 */
export const MINIMO_DE_PARTES = 2;
export const MAXIMO_DE_PARTES = 4;

export interface CapacidadOcrPaginas {
  /** Cuántas fotos admite un escaneo. */
  readonly maxPartes: number;
  /** La suma de las fotos, en bytes, que admite el dueño. */
  readonly maxBytesTotales: number;
}

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const claves = Object.keys(v).sort();
  const quiero = [...esperadas].sort();
  return claves.length === quiero.length && claves.every((c, i) => c === quiero[i]);
}

/**
 * `features.ocr_pages` → encendida sólo con la forma exacta del dueño: las seis
 * claves, `supported` y `enabled` en `true`, la negociación `pages_version=1`,
 * `max_pages` entero de 2 a 4 y `max_total_bytes` entero positivo. Cualquier
 * otra cosa la apaga.
 */
export function decodeCapacidadOcrPaginas(config: unknown): CapacidadOcrPaginas | null {
  if (!objetoPlano(config) || !objetoPlano(config.features)) return null;
  const raw = config.features.ocr_pages;
  if (!objetoPlano(raw) || !clavesExactas(raw, CLAVES_CAPACIDAD_OCR_PAGINAS)) return null;
  if (raw.supported !== true || raw.enabled !== true) return null;
  if (raw.negotiation_param !== PARAMETRO_OCR_PAGINAS || raw.negotiation_value !== VALOR_OCR_PAGINAS) return null;
  const partes = raw.max_pages;
  if (typeof partes !== 'number' || !Number.isSafeInteger(partes) || partes < MINIMO_DE_PARTES || partes > MAXIMO_DE_PARTES) {
    return null;
  }
  const bytes = raw.max_total_bytes;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 1) return null;
  return { maxPartes: partes, maxBytesTotales: bytes };
}

// ─── El estado ────────────────────────────────────────────────────────────
//
// Sin request propia: la alimenta `api.getConfig`, como la foto del ticket.
// Mientras no llegue la primera config, la app se comporta como apagada.

let actual: CapacidadOcrPaginas | null = null;
const oyentes = new Set<() => void>();

function misma(a: CapacidadOcrPaginas | null, b: CapacidadOcrPaginas | null): boolean {
  if (!a || !b) return a === b;
  return a.maxPartes === b.maxPartes && a.maxBytesTotales === b.maxBytesTotales;
}

export function aplicarConfigOcrPaginas(config: unknown): boolean {
  const siguiente = decodeCapacidadOcrPaginas(config);
  if (!misma(siguiente, actual)) {
    actual = siguiente;
    for (const oyente of [...oyentes]) oyente();
  }
  return actual !== null;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}
const instantanea = (): CapacidadOcrPaginas | null => actual;

/** La capacidad encendida, o `null` (apagada o todavía sin config). */
export function useCapacidadOcrPaginas(): CapacidadOcrPaginas | null {
  return useSyncExternalStore(suscribir, instantanea, instantanea);
}

/** Para la fachada: la capacidad vigente al armar el pedido. */
export function capacidadOcrPaginas(): CapacidadOcrPaginas | null {
  return actual;
}

export function reiniciarOcrPaginasParaTests(): void {
  actual = null;
  for (const oyente of [...oyentes]) oyente();
}

// ─── Antes de subir ───────────────────────────────────────────────────────

/** Por qué no se sube un escaneo de varias fotos: el dueño lo rechazaría igual. */
export type RechazoDePartes = 'muchas_partes' | 'partes_pesadas';

/**
 * El tope local, el mismo que el dueño (`too_many_pages`, `pages_too_large`):
 * con mala señal, subir 20 MB para que el servidor los rechace es un minuto
 * perdido en la mesa. `null` = se puede subir.
 */
export function rechazoLocalDePartes(tamanos: readonly number[], capacidad: CapacidadOcrPaginas): RechazoDePartes | null {
  if (tamanos.length > capacidad.maxPartes) return 'muchas_partes';
  const total = tamanos.reduce((s, n) => s + n, 0);
  return total > capacidad.maxBytesTotales ? 'partes_pesadas' : null;
}

/**
 * El techo de cada parte cuando el ticket va en varias fotos: lo que entra si
 * todas las partes llegan a su techo, y nunca más que el de una foto suelta.
 * Así la suma de las partes no pasa el tope del dueño aunque ninguna llegue al
 * objetivo de bytes.
 */
export function techoPorParte(capacidad: CapacidadOcrPaginas, techoDeUnaFoto: number): number {
  return Math.min(techoDeUnaFoto, Math.floor(capacidad.maxBytesTotales / capacidad.maxPartes));
}

// ─── El seam del mock ─────────────────────────────────────────────────────

export const CLAVE_OCR_PAGINAS_MOCK = 'payme.app.mock.ocr_pages.v1';

function leerLocal(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}

/**
 * El bloque que publica la config del mock:
 * - sin seam: no existe (el backend de antes de 2.196.0);
 * - `encendido`: el `valor` del contrato (hasta 4 fotos, 24 MiB entre todas).
 */
export function capacidadOcrPaginasMock(): Record<string, unknown> | undefined {
  if (leerLocal(CLAVE_OCR_PAGINAS_MOCK) !== 'encendido') return undefined;
  return {
    supported: true,
    enabled: true,
    max_pages: 4,
    max_total_bytes: 25165824,
    negotiation_param: PARAMETRO_OCR_PAGINAS,
    negotiation_value: VALOR_OCR_PAGINAS,
  };
}
