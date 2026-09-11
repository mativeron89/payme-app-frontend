/**
 * Tipos de `leer-zip.mjs` — el lector de entradas de un `trace.zip`.
 *
 * Es un `.mjs` porque lo consume el gate desde `node` sin pasar por el bundler. Sus tipos
 * se declaran acá en vez de usar `as any` en el test, que el gobierno del repo prohíbe —
 * misma convención que `aliasesLib.d.mts` y `extraer-origenes.d.mts`.
 */

/** CRC32 incremental, alimentado chunk a chunk mientras el stream avanza. */
export function crc32Parcial(buf: Uint8Array, previo?: number): number;

/** Cierra el acumulado incremental y devuelve el CRC32 final. */
export function crc32Final(acumulado: number): number;

/**
 * Topes contra zip bombs. Un trace real de Playwright está muy por debajo de los tres:
 * superarlos significa que el zip no es lo que este gate espera, y se lanza.
 */
export const LIMITES: Readonly<{
  MAX_ENTRADAS: number;
  MAX_BYTES_POR_ENTRADA: number;
  MAX_BYTES_TOTALES: number;
}>;

/**
 * Importa `yauzl` desde `playwright-core/lib/utilsBundle` y verifica su forma antes de
 * devolverlo. Lanza si el bundle interno cambió: es API interna y puede moverse entre
 * versiones, así que se aborta en vez de degradar.
 */
export function cargarYauzl(): Promise<unknown>;

export interface EntradasLeidas {
  /** TODAS las entradas del zip. Hace falta para saber si la traza abrió navegador. */
  readonly nombres: readonly string[];
  /** Sólo las entradas que `quiero(nombre)` aceptó, ya verificadas por CRC. */
  readonly contenidos: Readonly<Record<string, Buffer>>;
}

/**
 * Lee del zip únicamente las entradas que `quiero` acepta.
 *
 * Lanza —nunca devuelve vacío ambiguo— ante: nombre duplicado, CRC que no coincide con
 * `entry.crc32`, tamaño por encima de los límites, o cualquier error de stream. El
 * descriptor se cierra siempre, también en el camino de error.
 */
export function leerEntradas(ruta: string, quiero: (nombre: string) => boolean): Promise<EntradasLeidas>;
