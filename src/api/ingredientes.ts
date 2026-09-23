/**
 * AF-38 · n168 · «Qué comes · por ingrediente» (diseño 2d) ·
 * `GET /api/account/stats/ingredients?period=` (dueño v2.115.0 · handoff
 * `docs/HANDOFF_POR_INGREDIENTE_V2.115.0.md`).
 *
 * El grupo lo deduce el dueño del NOMBRE del plato (decisión de Mati): es una
 * estimación y `estimated` lo dice. Claves exactas; `period` es la única
 * opcional, como en el resto de «Mis estadísticas».
 *
 * - `groups`: sólo los que tienen monto > 0. `times` son VISITAS con al menos un
 *   plato del grupo; `amount_cents` lo tuyo por esos platos (sin propina).
 * - `total_cents` = suma de `groups`: se exige.
 * - Una `key` que el front no conoce NO rompe: se suma a «Otros» (`agruparIngredientes`).
 * - n178 · desde v2.125.0 cada grupo trae además `dish_count`: platos DISTINTOS del
 *   grupo (restaurante + nombre normalizado, la clave de `/stats/dishes`), así la
 *   suma de los grupos es `distinct_dishes`. **Aditivo:** un dueño anterior no lo
 *   manda y la vista queda como antes. Todos los grupos lo traen o ninguno: una
 *   respuesta mezclada no es de ninguna versión del dueño y se rechaza.
 */

import type { BaseDeConsumo } from './consumoDelMes';
import { decodePeriodo, type PeriodoConfirmado } from './periodoEstadisticas';

/** Las claves que el front sabe rotular (handoff v2.115.0). */
export const GRUPOS_CONOCIDOS = ['meat', 'seafood', 'pasta', 'veggie', 'dessert', 'drinks', 'alcohol', 'other'] as const;
export type ClaveGrupo = (typeof GRUPOS_CONOCIDOS)[number];

export interface GrupoCrudo {
  readonly key: string;
  readonly times: number;
  readonly amountCents: number;
  /** n178 · platos distintos del grupo; `null` con un dueño anterior a v2.125.0. */
  readonly dishCount: number | null;
}

export interface IngredientesDelPeriodo {
  readonly basis: BaseDeConsumo;
  readonly period: PeriodoConfirmado | null;
  readonly classifierVersion: string;
  readonly estimated: boolean;
  readonly groups: readonly GrupoCrudo[];
  readonly totalCents: number;
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
  throw new Error('stats_ingredients_response_malformed');
}

export function decodeIngredientes(raw: unknown): IngredientesDelPeriodo {
  const conPeriodo = objetoPlano(raw) && Object.prototype.hasOwnProperty.call(raw, 'period');
  const esperadas = ['basis', 'classifier_version', 'estimated', 'groups', 'total_cents', ...(conPeriodo ? ['period'] : [])];
  if (!objetoPlano(raw) || !claves(raw, esperadas)) malo();
  const period = conPeriodo ? decodePeriodo(raw.period) : null;
  if (conPeriodo && period === null) malo();
  const { basis, classifier_version: version, estimated, groups, total_cents: total } = raw;
  if (basis !== 'consumption' && basis !== 'payments') malo();
  if (!texto(version) || typeof estimated !== 'boolean' || !Array.isArray(groups) || !entero(total)) malo();
  const vistas = new Set<string>();
  // n178 · la forma la fija el PRIMER grupo; los demás tienen que coincidir.
  const conPlatos = groups.length > 0 && objetoPlano(groups[0])
    && Object.prototype.hasOwnProperty.call(groups[0], 'dish_count');
  const clavesDeGrupo = ['key', 'times', 'amount_cents', ...(conPlatos ? ['dish_count'] : [])];
  const lista = groups.map((g): GrupoCrudo => {
    if (!objetoPlano(g) || !claves(g, clavesDeGrupo)) malo();
    if (!texto(g.key) || vistas.has(g.key)) malo();
    // El dueño sólo manda grupos con monto > 0, y cada uno con al menos una visita.
    if (!entero(g.times) || g.times < 1 || !entero(g.amount_cents) || g.amount_cents < 1) malo();
    // Con monto > 0 hay al menos un plato: un cero sería incoherente.
    if (conPlatos && (!entero(g.dish_count) || g.dish_count < 1)) malo();
    vistas.add(g.key);
    return {
      key: g.key,
      times: g.times,
      amountCents: g.amount_cents,
      dishCount: conPlatos ? (g.dish_count as number) : null,
    };
  });
  if (lista.reduce((s, g) => s + g.amountCents, 0) !== total) malo();
  return { basis, period, classifierVersion: version, estimated, groups: lista, totalCents: total };
}

export interface GrupoParaMostrar {
  readonly key: ClaveGrupo;
  readonly amountCents: number;
  /**
   * Visitas con al menos un plato del grupo. `null` cuando en «Otros» se sumó una
   * clave desconocida: las visitas de dos grupos no se suman (una misma visita
   * puede estar en los dos), y el front no inventa el número.
   */
  readonly times: number | null;
  /**
   * n178 · platos distintos del grupo, o `null` sin el dato del dueño. A
   * diferencia de las visitas, SÍ se suman al juntar claves en «Otros»: el dueño
   * cuenta cada plato en un solo grupo, así que los conjuntos no se pisan.
   */
  readonly dishCount: number | null;
}

function esConocida(k: string): k is ClaveGrupo {
  return (GRUPOS_CONOCIDOS as readonly string[]).includes(k);
}

/**
 * Los grupos como se muestran: las claves desconocidas se suman a «Otros»; el
 * orden es monto de mayor a menor, empate por clave, y **«Otros» siempre al
 * final** aunque sea el mayor (decisión de Mati). El dueño ya ordena así; se
 * vuelve a ordenar porque sumar a «Otros» puede cambiar su monto.
 */
export function agruparIngredientes(groups: readonly GrupoCrudo[]): GrupoParaMostrar[] {
  const conocidos: GrupoParaMostrar[] = [];
  let otros: { amountCents: number; times: number | null; dishCount: number | null } | null = null;
  for (const g of groups) {
    if (esConocida(g.key) && g.key !== 'other') {
      conocidos.push({ key: g.key, amountCents: g.amountCents, times: g.times, dishCount: g.dishCount });
      continue;
    }
    otros = otros === null
      ? { amountCents: g.amountCents, times: g.times, dishCount: g.dishCount }
      : {
          amountCents: otros.amountCents + g.amountCents,
          times: null,
          dishCount: otros.dishCount !== null && g.dishCount !== null ? otros.dishCount + g.dishCount : null,
        };
  }
  conocidos.sort((a, b) => b.amountCents - a.amountCents || a.key.localeCompare(b.key));
  if (otros !== null) {
    // Una sola clave en «Otros» (la propia o una desconocida sola) conserva sus
    // visitas; dos o más sumadas quedan en `null` (arriba).
    conocidos.push({ key: 'other', amountCents: otros.amountCents, times: otros.times, dishCount: otros.dishCount });
  }
  return conocidos;
}
