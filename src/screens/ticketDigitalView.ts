import type { MesaDetail } from '../api/types';

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
  /** D209 · subtotal e IVA del ticket, sólo cuando el dueño los publica. */
  readonly totals?: { readonly subtotalCents: number; readonly taxCents: number };
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

  // D209 · `mesa_detail` del dueño: la clave viene sólo cuando el total de la
  // mesa es el impreso, así que subtotal + IVA tiene que dar `total_cents`
  // exacto. Una forma que no cumple es un contrato roto, igual que lo demás.
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
      || tt.subtotal_cents + tt.tax_cents !== mesa.total_cents
    ) throw new Error('ticket_digital_malformed');
    totals = { subtotalCents: tt.subtotal_cents, taxCents: tt.tax_cents };
  }

  return {
    code: mesa.code,
    restaurantName: mesa.restaurant.name,
    items,
    totalCents: mesa.total_cents,
    ...(totals ? { totals } : {}),
  };
}
