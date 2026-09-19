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
 */

import type { BaseDeConsumo } from './consumoDelMes';
import { decodePeriodo, type PeriodoConfirmado } from './periodoEstadisticas';

export interface PlatoDelPeriodo {
  readonly name: string;
  readonly restaurant: { readonly id: string; readonly name: string; readonly category: string };
  readonly times: number;
  readonly amountCents: number;
}

export interface PlatosDelPeriodo {
  readonly basis: BaseDeConsumo;
  readonly period: PeriodoConfirmado | null;
  readonly distinctDishes: number;
  readonly dishes: readonly PlatoDelPeriodo[];
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

function plato(raw: unknown): PlatoDelPeriodo {
  if (!objetoPlano(raw) || !claves(raw, ['name', 'restaurant', 'times', 'amount_cents'])) malo();
  const r = raw.restaurant;
  if (!objetoPlano(r) || !claves(r, ['id', 'name', 'category'])) malo();
  if (!texto(raw.name) || !texto(r.id) || !texto(r.name) || !texto(r.category)) malo();
  if (!entero(raw.times) || raw.times < 1 || !entero(raw.amount_cents)) malo();
  return {
    name: raw.name,
    restaurant: { id: r.id, name: r.name, category: r.category },
    times: raw.times,
    amountCents: raw.amount_cents,
  };
}

export function decodePlatos(raw: unknown): PlatosDelPeriodo {
  const conPeriodo = objetoPlano(raw) && Object.prototype.hasOwnProperty.call(raw, 'period');
  const esperadas = ['basis', 'distinct_dishes', 'dishes', ...(conPeriodo ? ['period'] : [])];
  if (!objetoPlano(raw) || !claves(raw, esperadas)) malo();
  const period = conPeriodo ? decodePeriodo(raw.period) : null;
  if (conPeriodo && period === null) malo();
  const { basis, distinct_dishes: distintos, dishes } = raw;
  if ((basis !== 'consumption' && basis !== 'payments') || !entero(distintos) || !Array.isArray(dishes)) malo();
  if (dishes.length > 5) malo();
  const lista = dishes.map(plato);
  if (distintos < lista.length) malo();
  return { basis, period, distinctDishes: distintos, dishes: lista };
}
