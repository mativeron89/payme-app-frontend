/**
 * AF-31 · n166 (sólo platos) · «Qué comes» (diseño 2c) · `GET /api/account/stats/dishes`
 * (dueño v2.107.0 · handoff `docs/HANDOFF_PLATOS_V2.107.0.md`).
 *
 * Claves exactas, como el resto de «Mis estadísticas»: un campo de más —lo que
 * eligió otra persona, por ejemplo— se rechaza. `period` es la única opcional.
 *
 * - `dishes`: como máximo 5, en el orden del dueño (`times` desc, monto, nombre).
 * - `times` son VISITAS, no porciones: media porción cuenta 1. Se rotula «veces».
 * - `distinct_dishes`: cuántos platos distintos hubo; nunca menos que los listados.
 * - En base `payments` el monto es lo cobrado por ítem, sin propina.
 *
 * D479/D482 · AF-2 · con `dishes_version=2` (dueño 2.195.0, `docs/HANDOFF_PLATOS_V2.md`)
 * los platos vienen AGRUPADOS por parecido entre restaurantes: cada uno trae
 * `restaurants` (dónde se pidió) en lugar de `restaurant`. La forma nueva se
 * acepta SÓLO si se negoció; la de siempre se sigue aceptando (un dueño anterior
 * ignora el parámetro). Todos los platos de una respuesta tienen la misma forma:
 * una respuesta mezclada no es de ninguna versión del dueño y se rechaza. Las dos
 * formas se leen a la misma estructura, con `restaurants` de un elemento en v1.
 */

import type { BaseDeConsumo } from './consumoDelMes';
import { decodePeriodo, rutaConPeriodo, type ClavePeriodo, type PeriodoConfirmado } from './periodoEstadisticas';

/** AF-2 · la negociación, la cadena exacta del dueño. La usan platos e ingredientes. */
export const DISHES_VERSION = 'dishes_version=2';

/** Una ruta de estadísticas con su período, si lo hay, y siempre con `dishes_version=2`. */
export function conVersionDePlatos(ruta: string, period?: ClavePeriodo): string {
  const conPeriodo = rutaConPeriodo(ruta, period);
  return conPeriodo + (conPeriodo.includes('?') ? '&' : '?') + DISHES_VERSION;
}

/** `/account/stats/dishes`, con su período si lo hay, y siempre con `dishes_version=2`. */
export function rutaDePlatos(period?: ClavePeriodo): string {
  return conVersionDePlatos('/account/stats/dishes', period);
}

/** Un restaurante donde se pidió el plato: sus visitas con el plato y lo tuyo por él ahí. */
export interface LugarDelPlato {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly times: number;
  readonly amountCents: number;
}

export interface PlatoDelPeriodo {
  readonly name: string;
  readonly times: number;
  readonly amountCents: number;
  /** Dónde se pidió, en el orden del dueño. En la forma de siempre, un solo lugar. */
  readonly restaurants: readonly LugarDelPlato[];
}

export interface PlatosDelPeriodo {
  readonly basis: BaseDeConsumo;
  readonly period: PeriodoConfirmado | null;
  readonly distinctDishes: number;
  readonly dishes: readonly PlatoDelPeriodo[];
  /** AF-2 · `true` si el dueño mandó la forma agrupada (`dishes_version=2`). */
  readonly agrupados: boolean;
}

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function claves(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const reales = Object.keys(v).sort();
  const quiero = [...esperadas].sort();
  return reales.length === quiero.length && reales.every((k, i) => k === quiero[i]);
}

const entero = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const texto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function malo(): never {
  throw new Error('stats_dishes_response_malformed');
}

function platoV1(raw: unknown): PlatoDelPeriodo {
  if (!objetoPlano(raw) || !claves(raw, ['name', 'restaurant', 'times', 'amount_cents'])) malo();
  const r = raw.restaurant;
  if (!objetoPlano(r) || !claves(r, ['id', 'name', 'category'])) malo();
  if (!texto(raw.name) || !texto(r.id) || !texto(r.name) || !texto(r.category)) malo();
  if (!entero(raw.times) || raw.times < 1 || !entero(raw.amount_cents)) malo();
  return {
    name: raw.name,
    times: raw.times,
    amountCents: raw.amount_cents,
    restaurants: [{ id: r.id, name: r.name, category: r.category, times: raw.times, amountCents: raw.amount_cents }],
  };
}

/**
 * AF-2 · un plato agrupado. Se exige lo que el handoff declara: al menos un lugar,
 * sin repetir, y las visitas y el monto del plato son la suma de sus lugares (una
 * visita es de un solo restaurante).
 */
function platoV2(raw: unknown): PlatoDelPeriodo {
  if (!objetoPlano(raw) || !claves(raw, ['name', 'times', 'amount_cents', 'restaurants'])) malo();
  if (!texto(raw.name) || !entero(raw.times) || raw.times < 1 || !entero(raw.amount_cents)) malo();
  if (!Array.isArray(raw.restaurants) || raw.restaurants.length === 0) malo();
  const lugares = raw.restaurants.map((r): LugarDelPlato => {
    if (!objetoPlano(r) || !claves(r, ['id', 'name', 'category', 'times', 'amount_cents'])) malo();
    if (!texto(r.id) || !texto(r.name) || !texto(r.category)) malo();
    if (!entero(r.times) || r.times < 1 || !entero(r.amount_cents)) malo();
    return { id: r.id, name: r.name, category: r.category, times: r.times, amountCents: r.amount_cents };
  });
  if (new Set(lugares.map((l) => l.id)).size !== lugares.length) malo();
  if (lugares.reduce((n, l) => n + l.times, 0) !== raw.times) malo();
  if (lugares.reduce((n, l) => n + l.amountCents, 0) !== raw.amount_cents) malo();
  return { name: raw.name, times: raw.times, amountCents: raw.amount_cents, restaurants: lugares };
}

/**
 * @param negociado `true` si el pedido llevó `dishes_version=2`. Sin negociar, la
 *   forma agrupada se rechaza: no la pidió nadie.
 */
export function decodePlatos(raw: unknown, { negociado = false }: { readonly negociado?: boolean } = {}): PlatosDelPeriodo {
  const conPeriodo = objetoPlano(raw) && Object.prototype.hasOwnProperty.call(raw, 'period');
  const esperadas = ['basis', 'distinct_dishes', 'dishes', ...(conPeriodo ? ['period'] : [])];
  if (!objetoPlano(raw) || !claves(raw, esperadas)) malo();
  const period = conPeriodo ? decodePeriodo(raw.period) : null;
  if (conPeriodo && period === null) malo();
  const { basis, distinct_dishes: distintos, dishes } = raw;
  if ((basis !== 'consumption' && basis !== 'payments') || !entero(distintos) || !Array.isArray(dishes)) malo();
  if (dishes.length > 5) malo();
  // La forma la fija el PRIMER plato; los demás tienen que coincidir (cada lector exige sus claves exactas).
  const agrupados = negociado && dishes.length > 0 && objetoPlano(dishes[0])
    && Object.prototype.hasOwnProperty.call(dishes[0], 'restaurants');
  const lista = dishes.map(agrupados ? platoV2 : platoV1);
  if (distintos < lista.length) malo();
  return { basis, period, distinctDishes: distintos, dishes: lista, agrupados };
}
