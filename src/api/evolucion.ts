/**
 * AF-31 · n167 · «Evolución» (diseño 2f) · `GET /api/account/stats/evolution`
 * (dueño v2.108.0 · handoff `docs/HANDOFF_EVOLUCION_V2.108.0.md`).
 *
 * Siempre los últimos 6 meses calendario de México, del más viejo al actual,
 * con los vacíos incluidos. Claves exactas, y se exige lo que el dueño declara
 * para que las barras y las columnas no digan cosas distintas:
 * - exactamente 6 meses, en orden creciente;
 * - cada mes: sus categorías suman su total, sin ceros ni repetidas;
 * - `total_cents` = la suma de los meses;
 * - `avg_per_month_cents` = total ÷ 6 truncado, CON los meses vacíos adentro.
 */

import type { BaseDeConsumo, CategoriaDelMes } from './consumoDelMes';

export interface MesDeEvolucion {
  readonly monthStart: string;
  readonly totalCents: number;
  readonly visits: number;
  readonly categories: readonly CategoriaDelMes[];
}

export interface Evolucion {
  readonly basis: BaseDeConsumo;
  readonly months: readonly MesDeEvolucion[];
  readonly totalCents: number;
  readonly avgPerMonthCents: number;
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

function malo(): never {
  throw new Error('stats_evolution_response_malformed');
}

function categoria(raw: unknown): CategoriaDelMes {
  if (!objetoPlano(raw) || !claves(raw, ['category', 'amount_cents', 'visits'])) malo();
  const { category, amount_cents: a, visits } = raw;
  if (typeof category !== 'string' || category.length === 0 || !entero(a) || a === 0 || !entero(visits)) malo();
  return { category, amountCents: a, visits };
}

function mes(raw: unknown): MesDeEvolucion {
  if (!objetoPlano(raw) || !claves(raw, ['month_start', 'total_cents', 'visits', 'categories'])) malo();
  const { month_start: m, total_cents: total, visits, categories } = raw;
  if (typeof m !== 'string' || !Number.isFinite(Date.parse(m)) || !entero(total) || !entero(visits)) malo();
  if (!Array.isArray(categories)) malo();
  const cats = categories.map(categoria);
  if (new Set(cats.map((c) => c.category)).size !== cats.length) malo();
  if (cats.reduce((s, c) => s + c.amountCents, 0) !== total) malo();
  return { monthStart: m, totalCents: total, visits, categories: cats };
}

export function decodeEvolucion(raw: unknown): Evolucion {
  if (!objetoPlano(raw) || !claves(raw, ['basis', 'months', 'total_cents', 'avg_per_month_cents'])) malo();
  const { basis, months, total_cents: total, avg_per_month_cents: avg } = raw;
  if ((basis !== 'consumption' && basis !== 'payments') || !Array.isArray(months) || !entero(total) || !entero(avg)) malo();
  if (months.length !== 6) malo();
  const ms = months.map(mes);
  for (let i = 1; i < ms.length; i += 1) {
    if (Date.parse(ms[i].monthStart) <= Date.parse(ms[i - 1].monthStart)) malo();
  }
  if (ms.reduce((s, m) => s + m.totalCents, 0) !== total) malo();
  if (Math.floor(total / 6) !== avg) malo();
  return { basis, months: ms, totalCents: total, avgPerMonthCents: avg };
}

/**
 * El orden de las cocinas en los seis meses juntos, con la regla del dueño
 * (monto desc, empate por nombre, `other` al final). Da un color fijo por cocina
 * en todas las columnas.
 */
export function cocinasDeLaEvolucion(e: Evolucion): string[] {
  const suma = new Map<string, number>();
  for (const m of e.months) for (const c of m.categories) suma.set(c.category, (suma.get(c.category) ?? 0) + c.amountCents);
  return [...suma.entries()]
    .sort(([a, ma], [b, mb]) => {
      if ((a === 'other') !== (b === 'other')) return a === 'other' ? 1 : -1;
      return mb - ma || a.localeCompare(b);
    })
    .map(([c]) => c);
}
