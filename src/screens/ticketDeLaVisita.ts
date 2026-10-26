import type { MesaDetail } from '../api/types';
import type { ItemDeVisita } from '../api/tusRestaurantes';
import { fractionAmount } from '../utils/money';
import { bpsLabel, bpsValido } from './mesaItemsView';

/**
 * D479/D482 · AF-1 · «+ Ver todo el ticket» dentro de una visita de «Tus
 * restaurantes» (Claude Design 0.261, 1p): a lo tuyo, que ya mostró la visita,
 * se le suma lo que eligieron los demás y lo que nadie eligió, leído de
 * `GET /api/mesas/:code` (el mismo contrato que `TicketDigitalDialog`).
 *
 * 🔴 Nunca quién: la mesa no publica identidades por ítem y esto no lee
 * `active_staff`, nombres de comensales ni la parte de nadie. Por ítem se usa
 * sólo lo agregado del dueño: `my_bps` (lo mío) y `remaining_bps` (lo que nadie
 * tomó). Lo de los demás es lo que queda: `10000 − remaining − mío`.
 *
 * El monto de una porción de otro o de lo que nadie eligió es la porción nominal
 * de la línea (`fractionAmount`, la misma de la vista previa de la mesa): puede
 * diferir en un centavo del que fija el cobro, que reparte el residuo. Lo tuyo
 * sale de Estadísticas, exacto.
 */

export type TipoDeFila = 'otro' | 'libre' | 'ticket';

export interface FilaDelTicket {
  readonly tipo: TipoDeFila;
  readonly name: string;
  /** Lo que antecede al nombre: «½», «2», o `null`. */
  readonly prefijo: string | null;
  readonly amountCents: number;
}

/**
 * Lo que va delante del nombre (AF-2, handoff 2.195.0 §3): la cantidad sólo
 * cuando la línea entera es tuya y tiene más de una unidad («2 Agua mineral»);
 * si no, la porción («½ Tiramisú»). La mitad de una línea de 2 no es «1 agua».
 */
export function prefijoDeItem(fractionBps: number, quantity: number | null): string | null {
  if (fractionBps >= 10000) return quantity !== null && quantity > 1 ? String(quantity) : null;
  return bpsLabel(fractionBps);
}

/** Lo propio de Estadísticas con su prefijo. */
export function prefijoDeLoMio(item: ItemDeVisita): string | null {
  return prefijoDeItem(item.fractionBps, item.quantity);
}

function linea(price: unknown, quantity: unknown): number | null {
  return typeof price === 'number' && Number.isSafeInteger(price) && price >= 0
    && typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity >= 1
    && Number.isSafeInteger(price * quantity) ? price * quantity : null;
}

function porcion(lineaCents: number, bps: number): number {
  return bps >= 10000 ? lineaCents : fractionAmount(lineaCents, bps);
}

/**
 * Las filas que «Ver todo el ticket» AGREGA a lo tuyo, en el orden de la mesa.
 *
 * - Por consumo: por cada línea, lo de los demás («Lo eligió otro») y lo que
 *   nadie eligió (como en ¿Qué consumiste?, sin rótulo: la porción va delante).
 * - Partes iguales: la visita no tiene platos tuyos; se agrega el ticket entero,
 *   sin decir quién eligió qué.
 * - Un dato de tenencia que no se puede leer en alguna línea: el ticket entero,
 *   sin afirmar quién eligió nada (nunca un «Lo eligió otro» inventado).
 *
 * `null` si la mesa no trae ítems legibles: la pantalla lo muestra como error.
 */
export function filasDelTicket(mesa: Pick<MesaDetail, 'division_mode' | 'items'>): FilaDelTicket[] | null {
  if (!Array.isArray(mesa.items)) return null;
  const lineas: { name: string; quantity: number; total: number; mio: unknown; queda: unknown }[] = [];
  for (const it of mesa.items) {
    const total = linea(it?.price_cents, it?.quantity);
    if (typeof it?.name !== 'string' || it.name.trim() === '' || total === null) return null;
    lineas.push({ name: it.name, quantity: it.quantity, total, mio: it.my_bps, queda: it.remaining_bps });
  }
  const ticketEntero = (): FilaDelTicket[] => lineas.map((l) => ({
    tipo: 'ticket', name: l.name, prefijo: l.quantity > 1 ? String(l.quantity) : null, amountCents: l.total,
  }));
  if (mesa.division_mode !== 'consumo') return ticketEntero();
  const legibles = lineas.every((l) => bpsValido(l.mio) && bpsValido(l.queda) && (l.mio as number) + (l.queda as number) <= 10000);
  if (!legibles) return ticketEntero();
  const filas: FilaDelTicket[] = [];
  for (const l of lineas) {
    const mio = l.mio as number;
    const libre = l.queda as number;
    const otros = 10000 - libre - mio;
    if (otros > 0) {
      filas.push({ tipo: 'otro', name: l.name, prefijo: prefijoDeItem(otros, l.quantity), amountCents: porcion(l.total, otros) });
    }
    if (libre > 0) {
      filas.push({ tipo: 'libre', name: l.name, prefijo: prefijoDeItem(libre, l.quantity), amountCents: porcion(l.total, libre) });
    }
  }
  return filas;
}
