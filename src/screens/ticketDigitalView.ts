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

  return {
    code: mesa.code,
    restaurantName: mesa.restaurant.name,
    items,
    totalCents: mesa.total_cents,
  };
}
