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
 *
 * D260 · App Backend 2.176.0: la app pide siempre `stats_version=2`, y cada
 * visita trae `viaje_id`: el viaje de un ticket de viaje (su `code` es el id del
 * ticket) o `null` en una mesa. «Ver todo el ticket» abre el ticket del viaje.
 *
 * D479/D482 · AF-2 · App Backend 2.195.0: la app pide `stats_version=3`, que es la 2
 * más `quantity` en cada ítem: la cantidad de la LÍNEA del ticket, un entero ≥ 1 o
 * `null` (ticket de viaje). No afirma unidades propias: lo tuyo sigue siendo
 * `fraction_bps`. Un dueño anterior contesta la 2: se acepta igual. Todos los
 * ítems de una respuesta traen `quantity` o ninguno.
 */

import type { BaseDeConsumo } from './consumoDelMes';
import { decodePeriodo, rutaConPeriodo, type ClavePeriodo, type PeriodoConfirmado } from './periodoEstadisticas';

/** D260 · AF-2 · la negociación: la cadena exacta, sólo en esta ruta. */
export const STATS_VERSION = 'stats_version=3';

/** `/account/stats/restaurants`, con su período si lo hay, y siempre con `stats_version=3`. */
export function rutaDeTusRestaurantes(period?: ClavePeriodo): string {
  const ruta = rutaConPeriodo('/account/stats/restaurants', period);
  return ruta + (ruta.includes('?') ? '&' : '?') + STATS_VERSION;
}

export interface ItemDeVisita {
  readonly name: string;
  readonly fractionBps: number;
  readonly amountCents: number;
  /** AF-2 · la cantidad de la línea del ticket; `null` si no se conoce (o con un dueño anterior). */
  readonly quantity: number | null;
}

export interface Visita {
  readonly code: string;
  readonly createdAt: string;
  readonly divisionMode: 'consumo' | 'igual';
  readonly amountCents: number;
  readonly items: readonly ItemDeVisita[];
  /** D260 · el viaje, si la visita es un ticket de viaje (y `code` es el id del ticket); `null` en una mesa. */
  readonly viajeId: string | null;
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

function item(raw: unknown, conCantidad: boolean): ItemDeVisita {
  const esperadas = ['name', 'fraction_bps', 'amount_cents', ...(conCantidad ? ['quantity'] : [])];
  if (!objetoPlano(raw) || !claves(raw, esperadas)) malo();
  const { name, fraction_bps: f, amount_cents: a } = raw;
  if (!texto(name) || !entero(f) || f < 1 || f > 10000 || !entero(a)) malo();
  const q: unknown = conCantidad ? raw.quantity : null;
  if (q !== null && (!entero(q) || q < 1)) malo();
  return { name, fractionBps: f, amountCents: a, quantity: q === null ? null : (q as number) };
}

function visita(raw: unknown, conCantidad: boolean): Visita {
  if (!objetoPlano(raw) || !claves(raw, ['code', 'created_at', 'division_mode', 'amount_cents', 'items', 'viaje_id'])) malo();
  const { code, created_at: c, division_mode: d, amount_cents: a, items, viaje_id: viaje } = raw;
  if (!texto(code) || !fecha(c) || (d !== 'consumo' && d !== 'igual') || !entero(a) || a === 0) malo();
  if (!Array.isArray(items) || (viaje !== null && !texto(viaje))) malo();
  return { code, createdAt: c, divisionMode: d, amountCents: a, items: items.map((it) => item(it, conCantidad)), viajeId: viaje };
}

function restaurante(raw: unknown, conCantidad: boolean): RestauranteDelMes {
  if (!objetoPlano(raw) || !claves(raw, ['id', 'name', 'category', 'amount_cents', 'visits_count', 'visits'])) malo();
  const { id, name, category, amount_cents: a, visits_count: n, visits } = raw;
  if (!texto(id) || !texto(name) || !texto(category) || !entero(a) || !entero(n) || !Array.isArray(visits)) malo();
  const vs = visits.map((v) => visita(v, conCantidad));
  if (vs.length !== n || vs.length === 0) malo();
  if (vs.reduce((s, v) => s + v.amountCents, 0) !== a) malo();
  return { id, name, category, amountCents: a, visits: vs };
}

/** AF-2 · ¿los ítems traen `quantity`? Lo fija el PRIMER ítem de la respuesta; los demás tienen que coincidir. */
function primerItemConCantidad(restaurants: readonly unknown[]): boolean {
  for (const r of restaurants) {
    if (!objetoPlano(r) || !Array.isArray(r.visits)) return false;
    for (const v of r.visits) {
      if (!objetoPlano(v) || !Array.isArray(v.items)) return false;
      const primero: unknown = v.items[0];
      if (primero !== undefined) return objetoPlano(primero) && Object.prototype.hasOwnProperty.call(primero, 'quantity');
    }
  }
  return false;
}

/**
 * @param negociado `true` si el pedido llevó `stats_version=3`. Sin negociar, un
 *   ítem con `quantity` se rechaza: no lo pidió nadie.
 */
export function decodeTusRestaurantes(raw: unknown, { negociado = false }: { readonly negociado?: boolean } = {}): TusRestaurantes {
  // `period` es la única clave OPCIONAL (v2.106.0): presente, tiene que ser válida.
  const conPeriodo = objetoPlano(raw) && Object.prototype.hasOwnProperty.call(raw, 'period');
  const esperadas = ['basis', 'month_start', 'total_cents', 'restaurants', ...(conPeriodo ? ['period'] : [])];
  if (!objetoPlano(raw) || !claves(raw, esperadas)) malo();
  const period = conPeriodo ? decodePeriodo(raw.period) : null;
  if (conPeriodo && period === null) malo();
  const { basis, month_start: m, total_cents: total, restaurants } = raw;
  if ((basis !== 'consumption' && basis !== 'payments') || !fecha(m) || !entero(total) || !Array.isArray(restaurants)) malo();
  const conCantidad = negociado && primerItemConCantidad(restaurants);
  const rs = restaurants.map((r) => restaurante(r, conCantidad));
  if (new Set(rs.map((r) => r.id)).size !== rs.length) malo();
  if (rs.reduce((s, r) => s + r.amountCents, 0) !== total) malo();
  return { basis, monthStart: m, totalCents: total, restaurants: rs, period };
}

/** Cuántas visitas en total (para «N lugares · M visitas»). */
export function visitasDelMes(d: TusRestaurantes): number {
  return d.restaurants.reduce((s, r) => s + r.visits.length, 0);
}
