/**
 * AF-29 · n165 · «Tus restaurantes» (diseño 2b) · `GET /api/account/stats/restaurants`
 * (dueño v2.104.0 · `contract-mirror/routes/account.js`, handoff
 * `docs/HANDOFF_TUS_RESTAURANTES_V2.104.0.md`).
 *
 * Decodificador de **claves exactas**: la respuesta es sólo de la cuenta propia y
 * no trae otros comensales, el total de la mesa ni su propina; un campo de más
 * se rechaza en vez de mostrarse. Cualquier rechazo es un error de la pantalla,
 * con «Reintentar», nunca una lista a medias.
 *
 * Se exige lo que el dueño garantiza y la pantalla necesita para no decir dos
 * cosas distintas: el total es la suma de los restaurantes y cada restaurante la
 * suma de sus visitas (el handoff lo declara y un test del dueño lo exige), y
 * `visits_count` es cuántas visitas vienen. Los ítems NO se suman contra la
 * visita: en base `payments` la visita incluye la propina y los ítems no.
 */

import type { BaseDeConsumo } from './consumoDelMes';
import { decodePeriodo, type PeriodoConfirmado } from './periodoEstadisticas';

export interface ItemDeVisita {
  readonly name: string;
  readonly fractionBps: number;
  readonly amountCents: number;
}

export interface Visita {
  readonly code: string;
  readonly createdAt: string;
  readonly divisionMode: 'consumo' | 'igual';
  readonly amountCents: number;
  readonly items: readonly ItemDeVisita[];
}

export interface RestauranteDelMes {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly amountCents: number;
  readonly visits: readonly Visita[];
}

export interface TusRestaurantes {
  readonly basis: BaseDeConsumo;
  readonly monthStart: string;
  readonly totalCents: number;
  readonly restaurants: readonly RestauranteDelMes[];
  /**
   * AF-31 · v2.106.0 · el período que usó el dueño. `null` con un backend
   * anterior, que no lo publica (y que ignora `?period=`).
   */
  readonly period: PeriodoConfirmado | null;
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

function entero(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

function texto(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function fecha(v: unknown): v is string {
  return texto(v) && Number.isFinite(Date.parse(v));
}

function malo(): never {
  throw new Error('stats_restaurants_response_malformed');
}

function item(raw: unknown): ItemDeVisita {
  if (!objetoPlano(raw) || !claves(raw, ['name', 'fraction_bps', 'amount_cents'])) malo();
  const { name, fraction_bps: f, amount_cents: a } = raw;
  if (!texto(name) || !entero(f) || f < 1 || f > 10000 || !entero(a)) malo();
  return { name, fractionBps: f, amountCents: a };
}

function visita(raw: unknown): Visita {
  if (!objetoPlano(raw) || !claves(raw, ['code', 'created_at', 'division_mode', 'amount_cents', 'items'])) malo();
  const { code, created_at: c, division_mode: d, amount_cents: a, items } = raw;
  if (!texto(code) || !fecha(c) || (d !== 'consumo' && d !== 'igual') || !entero(a) || a === 0) malo();
  if (!Array.isArray(items)) malo();
  return { code, createdAt: c, divisionMode: d, amountCents: a, items: items.map(item) };
}

function restaurante(raw: unknown): RestauranteDelMes {
  if (!objetoPlano(raw) || !claves(raw, ['id', 'name', 'category', 'amount_cents', 'visits_count', 'visits'])) malo();
  const { id, name, category, amount_cents: a, visits_count: n, visits } = raw;
  if (!texto(id) || !texto(name) || !texto(category) || !entero(a) || !entero(n) || !Array.isArray(visits)) malo();
  const vs = visits.map(visita);
  if (vs.length !== n || vs.length === 0) malo();
  if (vs.reduce((s, v) => s + v.amountCents, 0) !== a) malo();
  return { id, name, category, amountCents: a, visits: vs };
}

export function decodeTusRestaurantes(raw: unknown): TusRestaurantes {
  // `period` es la única clave OPCIONAL (v2.106.0): presente, tiene que ser válida.
  const conPeriodo = objetoPlano(raw) && Object.prototype.hasOwnProperty.call(raw, 'period');
  const esperadas = ['basis', 'month_start', 'total_cents', 'restaurants', ...(conPeriodo ? ['period'] : [])];
  if (!objetoPlano(raw) || !claves(raw, esperadas)) malo();
  const period = conPeriodo ? decodePeriodo(raw.period) : null;
  if (conPeriodo && period === null) malo();
  const { basis, month_start: m, total_cents: total, restaurants } = raw;
  if ((basis !== 'consumption' && basis !== 'payments') || !fecha(m) || !entero(total) || !Array.isArray(restaurants)) malo();
  const rs = restaurants.map(restaurante);
  if (new Set(rs.map((r) => r.id)).size !== rs.length) malo();
  if (rs.reduce((s, r) => s + r.amountCents, 0) !== total) malo();
  return { basis, monthStart: m, totalCents: total, restaurants: rs, period };
}

/** Cuántas visitas en total (para «N lugares · M visitas»). */
export function visitasDelMes(d: TusRestaurantes): number {
  return d.restaurants.reduce((s, r) => s + r.visits.length, 0);
}

/**
 * El orden de las cocinas, con la MISMA regla del dueño para `consumption_month`
 * (monto de mayor a menor, empate por nombre, `other` al final). Sirve para que
 * cada restaurante lleve el color de su cocina en el anillo de 2a: los dos salen
 * del mismo total.
 */
export function ordenDeCocinas(d: TusRestaurantes): string[] {
  const porCocina = new Map<string, number>();
  for (const r of d.restaurants) porCocina.set(r.category, (porCocina.get(r.category) ?? 0) + r.amountCents);
  return [...porCocina.entries()]
    .sort(([a, ma], [b, mb]) => {
      if (a === 'other' && b !== 'other') return 1;
      if (b === 'other' && a !== 'other') return -1;
      return mb - ma || a.localeCompare(b);
    })
    .map(([c]) => c);
}
