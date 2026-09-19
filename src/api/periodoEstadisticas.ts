import { useSyncExternalStore } from 'react';

/**
 * AF-31 · el período de «Mis estadísticas» (dueño v2.106.0 · `?period=`).
 *
 * Lista CERRADA del dueño, con corte de México. El elegido se conserva al
 * navegar entre 2a, 2b y 2c: vive en memoria del módulo, no en la URL ni en el
 * almacenamiento. Al recargar vuelve a «Este mes», que es el default del dueño.
 *
 * 🔴 **Un backend anterior ignora `?period=` y devuelve el mes en curso.** Si
 * se le creyera al parámetro, «Mes pasado» mostraría los números de ESTE mes
 * con el rótulo equivocado. Por eso la pantalla sólo usa el período cuando la
 * respuesta lo CONFIRMA (`period.key` igual al pedido): si no viene, el
 * selector no se dibuja y lo que se muestra se rotula «Este mes».
 */

export const PERIODOS = ['this_month', 'last_month', 'last_3_months', 'this_year'] as const;
export type ClavePeriodo = (typeof PERIODOS)[number];

export interface PeriodoConfirmado {
  readonly key: ClavePeriodo;
  readonly start: string;
  /** `null` salvo `last_month`, donde es el inicio del mes en curso: `[start, end)`. */
  readonly end: string | null;
}

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function esClave(v: unknown): v is ClavePeriodo {
  return typeof v === 'string' && (PERIODOS as readonly string[]).includes(v);
}

function fecha(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v));
}

/**
 * `period` del dueño, con claves exactas. `null` si falta o es inválido: la
 * pantalla lo trata como un backend que no conoce el parámetro.
 */
export function decodePeriodo(raw: unknown): PeriodoConfirmado | null {
  if (!objetoPlano(raw)) return null;
  const keys = Object.keys(raw).sort();
  if (keys.length !== 3 || keys[0] !== 'end' || keys[1] !== 'key' || keys[2] !== 'start') return null;
  if (!esClave(raw.key) || !fecha(raw.start)) return null;
  if (raw.end !== null && !fecha(raw.end)) return null;
  return { key: raw.key, start: raw.start, end: raw.end };
}

/**
 * ¿La respuesta confirma el período pedido? Sólo entonces se usan sus números
 * con ese rótulo y se dibuja el selector.
 */
export function confirmaPeriodo(pedido: ClavePeriodo, raw: unknown): PeriodoConfirmado | null {
  const p = decodePeriodo(raw);
  return p !== null && p.key === pedido ? p : null;
}

/** El query string del período, para las tres rutas que lo aceptan. */
export function consultaPeriodo(clave: ClavePeriodo): string {
  return `?period=${encodeURIComponent(clave)}`;
}

/**
 * La ruta con su período, si lo hay. Concatena en vez de interpolar a propósito:
 * la guarda C-03 exige que todo `${}` de una ruta pase por `encodeURIComponent`,
 * y acá el único que hay es el de `consultaPeriodo`.
 */
export function rutaConPeriodo(ruta: string, clave?: ClavePeriodo): string {
  return clave ? ruta + consultaPeriodo(clave) : ruta;
}

// ─── El período elegido, compartido por 2a, 2b y 2c ─────────────────────────

let actual: ClavePeriodo = 'this_month';
const oyentes = new Set<() => void>();

export function periodoActual(): ClavePeriodo {
  return actual;
}

export function elegirPeriodo(clave: ClavePeriodo): void {
  if (clave === actual) return;
  actual = clave;
  for (const o of [...oyentes]) o();
}

function suscribir(o: () => void): () => void {
  oyentes.add(o);
  return () => { oyentes.delete(o); };
}

export function usePeriodoEstadisticas(): ClavePeriodo {
  return useSyncExternalStore(suscribir, periodoActual, periodoActual);
}

export function resetPeriodoParaTests(): void {
  actual = 'this_month';
  oyentes.clear();
}
