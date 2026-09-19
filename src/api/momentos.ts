/**
 * AF-32 · «Qué comes · por momento del día» (diseño 2e) ·
 * `GET /api/account/stats/dayparts?period=` (dueño v2.109.0 · handoff
 * `docs/HANDOFF_MOMENTOS_DEL_DIA_V2.109.0.md`).
 *
 * Los CUATRO momentos vienen siempre, en ese orden, aunque estén en cero. La hora
 * es la de creación de la mesa en hora de México. Claves exactas; `period` es la
 * única opcional. Se exige que visitas y montos de los cuatro sumen los totales:
 * el anillo muestra las visitas al centro y las porciones alrededor.
 */

import type { BaseDeConsumo } from './consumoDelMes';
import { decodePeriodo, type PeriodoConfirmado } from './periodoEstadisticas';

export const MOMENTOS = ['breakfast', 'lunch', 'afternoon', 'dinner'] as const;
export type ClaveMomento = (typeof MOMENTOS)[number];

export interface MomentoDelDia {
  readonly key: ClaveMomento;
  readonly visits: number;
  readonly amountCents: number;
}

export interface MomentosDelPeriodo {
  readonly basis: BaseDeConsumo;
  readonly period: PeriodoConfirmado | null;
  readonly dayparts: readonly MomentoDelDia[];
  readonly totalCents: number;
  readonly visits: number;
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
  throw new Error('stats_dayparts_response_malformed');
}

export function decodeMomentos(raw: unknown): MomentosDelPeriodo {
  const conPeriodo = objetoPlano(raw) && Object.prototype.hasOwnProperty.call(raw, 'period');
  const esperadas = ['basis', 'dayparts', 'total_cents', 'visits', ...(conPeriodo ? ['period'] : [])];
  if (!objetoPlano(raw) || !claves(raw, esperadas)) malo();
  const period = conPeriodo ? decodePeriodo(raw.period) : null;
  if (conPeriodo && period === null) malo();
  const { basis, dayparts, total_cents: total, visits } = raw;
  if ((basis !== 'consumption' && basis !== 'payments') || !Array.isArray(dayparts) || !entero(total) || !entero(visits)) malo();
  if (dayparts.length !== MOMENTOS.length) malo();
  const lista = dayparts.map((d, i): MomentoDelDia => {
    if (!objetoPlano(d) || !claves(d, ['key', 'visits', 'amount_cents'])) malo();
    if (d.key !== MOMENTOS[i] || !entero(d.visits) || !entero(d.amount_cents)) malo();
    return { key: MOMENTOS[i], visits: d.visits, amountCents: d.amount_cents };
  });
  if (lista.reduce((s, d) => s + d.visits, 0) !== visits) malo();
  if (lista.reduce((s, d) => s + d.amountCents, 0) !== total) malo();
  return { basis, period, dayparts: lista, totalCents: total, visits };
}
