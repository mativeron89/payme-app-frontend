import { sumaDeTipo, ticketAdjustmentsOf } from '../api/contractResponses';
import type { MesaDetail, TicketAdjustment, TicketTotals } from '../api/types';
import { desgloseDelTicket, type DesgloseDelTicket, type FilaDelDesglose, type LoQueNoSeReparte } from './desgloseDelTicket';

export interface TicketDigitalItem {
  readonly name: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface TicketDigitalView {
  readonly code: string;
  readonly restaurantName: string;
  readonly items: readonly TicketDigitalItem[];
  readonly totalCents: number;
  /**
   * D209 · subtotal e IVA del ticket, sólo cuando el dueño los publica.
   * L1 · `ivaAparte`: el IVA se agregó al final (D215), así que el total de la
   * mesa es el subtotal y el impreso es subtotal + IVA.
   */
  readonly totals?: { readonly subtotalCents: number; readonly taxCents: number; readonly ivaAparte: boolean };
  /** D218 · la suma de los descuentos impresos, sólo cuando el dueño los publica. */
  readonly discountCents?: number;
  /**
   * D224 · una fila v2 (con cargo por servicio) cuyo total impreso se pudo
   * deducir sin ambigüedad: las filas en el orden de la cuenta, terminando en el
   * total impreso, y lo que no se reparte.
   */
  readonly desglose?: { readonly filas: readonly FilaDelDesglose[]; readonly aparte: LoQueNoSeReparte };
  /**
   * D224 · una fila v2 cuyo impreso NO se pudo deducir: como la mesa con
   * descuento de hoy, el total de los consumos y las líneas aparte.
   */
  readonly apartes?: { readonly descuentoCents: number; readonly servicioCents: number };
}

function enteroSeguro(value: unknown, min: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}

/**
 * Proyección deliberadamente mínima de GET mesa para el visor histórico.
 * Excluye dirección, RFC, estados/tenencias e identidades de otros comensales.
 */
export function ticketDigitalView(mesa: MesaDetail, expectedCode: string): TicketDigitalView {
  if (
    mesa.code !== expectedCode
    || typeof mesa.restaurant?.name !== 'string'
    || mesa.restaurant.name.trim().length === 0
    || !enteroSeguro(mesa.total_cents, 0)
    || !Array.isArray(mesa.items)
  ) throw new Error('ticket_digital_malformed');

  const items = mesa.items.map((item) => {
    if (
      typeof item.name !== 'string'
      || item.name.trim().length === 0
      || !enteroSeguro(item.quantity, 1)
      || !enteroSeguro(item.price_cents, 0)
    ) throw new Error('ticket_digital_malformed');
    return {
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.price_cents,
    };
  });

  const base = {
    code: mesa.code,
    restaurantName: mesa.restaurant.name,
    items,
    totalCents: mesa.total_cents,
  };

  // D218 · D224 · los ajustes van PRIMERO: con una fila v2 (cargo por servicio,
  // App Backend 2.168.0) el dueño publica también `ticket_totals`, con otra
  // identidad, y el control de siempre de abajo lo rechazaría.
  const ajustes = ajustesDeLaMesa(mesa.ticket_adjustments);
  if (ajustes) {
    const descuento = sumaDeTipo(ajustes, 'discount');
    const servicio = sumaDeTipo(ajustes, 'service_charge');
    if (servicio === 0 && mesa.ticket_totals === undefined) {
      // D218 · una fila v1: sólo descuentos y sin totales. Igual que hoy: el
      // total de los consumos y el descuento aparte.
      return { ...base, discountCents: descuento };
    }
    // D224 · una fila v2. La mesa no guarda el impreso: se deduce con las dos
    // identidades del dueño y se muestra SÓLO si da un único total que cierra
    // (la misma cuenta que «¿Cómo dividen?», `desgloseDelTicket`). Si no, como
    // la mesa con descuento de hoy: nunca un total inventado (plan D).
    const totales = totalesDeUnaFilaV2(mesa.ticket_totals);
    const candidatos = totales
      ? [totales.subtotal_cents + (totales.tax_cents ?? 0) + servicio - descuento,
        totales.subtotal_cents + (totales.tax_cents ?? 0) + servicio]
      : [mesa.total_cents + servicio - descuento];
    const cierran = [...new Set(candidatos)]
      .map((impreso) => desgloseDelTicket({ sumaItems: mesa.total_cents, ticketValido: true, impreso, totales, ajustes }))
      .filter((d): d is Extract<DesgloseDelTicket, { tipo: 'cierra' }> => d.tipo === 'cierra');
    if (cierran.length === 1) return { ...base, desglose: { filas: cierran[0]!.filas, aparte: cierran[0]!.aparte } };
    return { ...base, apartes: { descuentoCents: descuento, servicioCents: servicio } };
  }

  // D209 · `mesa_detail` del dueño: la clave viene sólo cuando el total de la
  // mesa es el impreso, así que subtotal + IVA tiene que dar `total_cents`
  // exacto. Una forma que no cumple es un contrato roto, igual que lo demás.
  // L1 · con `totals_version=2` (App Backend 2.165.0) también sale con IVA
  // agregado: entonces el total de la mesa es el subtotal (D215).
  let totals: TicketDigitalView['totals'];
  if (mesa.ticket_totals !== undefined) {
    const raw: unknown = mesa.ticket_totals;
    const tt = typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
    if (
      !tt
      || Object.keys(tt).length !== 2
      || !enteroSeguro(tt.subtotal_cents, 1)
      || !enteroSeguro(tt.tax_cents, 0)
      || (tt.subtotal_cents + tt.tax_cents !== mesa.total_cents && tt.subtotal_cents !== mesa.total_cents)
    ) throw new Error('ticket_digital_malformed');
    totals = {
      subtotalCents: tt.subtotal_cents,
      taxCents: tt.tax_cents,
      // IVA cero con subtotal = total cumple las dos: es «incluido», nada aparte.
      ivaAparte: tt.subtotal_cents + tt.tax_cents !== mesa.total_cents,
    };
  }

  return { ...base, ...(totals ? { totals } : {}) };
}

/**
 * D218 · D224 · `ticket_adjustments` de la mesa, con la forma del dueño: de 1 a
 * 10, `{kind: 'discount' | 'service_charge', amount_cents > 0}`. Sin la clave,
 * `null`; con una forma que no cumple, el contrato está roto.
 */
function ajustesDeLaMesa(raw: unknown): TicketAdjustment[] | null {
  if (raw === undefined) return null;
  const ajustes = ticketAdjustmentsOf(raw);
  if (!ajustes) throw new Error('ticket_digital_malformed');
  return ajustes;
}

/** D224 · `ticket_totals` de una fila v2: `{subtotal_cents > 0, tax_cents? ≥ 0}`, sin otras claves. */
function totalesDeUnaFilaV2(raw: unknown): TicketTotals | null {
  if (raw === undefined) return null;
  const tt = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (
    !tt
    || Object.keys(tt).some((k) => k !== 'subtotal_cents' && k !== 'tax_cents')
    || !enteroSeguro(tt.subtotal_cents, 1)
    || (tt.tax_cents !== undefined && !enteroSeguro(tt.tax_cents, 0))
  ) throw new Error('ticket_digital_malformed');
  return tt.tax_cents === undefined
    ? { subtotal_cents: tt.subtotal_cents }
    : { subtotal_cents: tt.subtotal_cents, tax_cents: tt.tax_cents as number };
}
