import { describe, expect, it } from 'vitest';
import type { MesaDetail } from '../api/types';
import { ticketDigitalView } from './ticketDigitalView';

const mesa = {
  code: 'PA-1234',
  restaurant: { id: 'r-1', name: 'Casa Azul', category: 'mexican', address: 'Privada 123' },
  total_cents: 42000,
  items: [
    {
      id: 'item-1', name: 'Tacos', category: 'mexican', price_cents: 14000, quantity: 3,
      status: 'locked', remaining_bps: 0, my_bps: 0, locked_by_me: false, lock_expires_at: null,
    },
  ],
} as MesaDetail;

describe('ticketDigitalView', () => {
  it('proyecta sólo restaurante, código, ítems/cantidad/precio y total', () => {
    expect(ticketDigitalView(mesa, 'PA-1234')).toEqual({
      code: 'PA-1234',
      restaurantName: 'Casa Azul',
      items: [{ name: 'Tacos', quantity: 3, unitPriceCents: 14000 }],
      totalCents: 42000,
    });
    expect(JSON.stringify(ticketDigitalView(mesa, 'PA-1234'))).not.toContain('Privada');
    expect(JSON.stringify(ticketDigitalView(mesa, 'PA-1234'))).not.toContain('locked');
  });

  it('D209 · con `ticket_totals` del dueño, el subtotal y el IVA; sin la clave, como antes', () => {
    const conTotales = { ...mesa, ticket_totals: { subtotal_cents: 36207, tax_cents: 5793 } } as MesaDetail;
    expect(ticketDigitalView(conTotales, 'PA-1234').totals).toEqual({ subtotalCents: 36207, taxCents: 5793 });
    expect('totals' in ticketDigitalView(mesa, 'PA-1234')).toBe(false);
  });

  it.each([
    ['no suman el total de la mesa', { subtotal_cents: 36207, tax_cents: 5794 }],
    ['subtotal cero', { subtotal_cents: 0, tax_cents: 42000 }],
    ['IVA negativo', { subtotal_cents: 43000, tax_cents: -1000 }],
    ['una clave de más', { subtotal_cents: 36207, tax_cents: 5793, total_cents: 42000 }],
    ['no es objeto', [36207, 5793]],
  ])('🔴 D209 · `ticket_totals` que %s: falla cerrado, como el resto del visor', (_caso, ticketTotals) => {
    expect(() => ticketDigitalView({ ...mesa, ticket_totals: ticketTotals } as unknown as MesaDetail, 'PA-1234'))
      .toThrow('ticket_digital_malformed');
  });

  it('falla cerrado si el código o los campos visibles no son válidos', () => {
    expect(() => ticketDigitalView(mesa, 'PA-9999')).toThrow('ticket_digital_malformed');
    expect(() => ticketDigitalView({ ...mesa, total_cents: -1 }, 'PA-1234')).toThrow('ticket_digital_malformed');
    expect(() => ticketDigitalView({ ...mesa, items: [{ ...mesa.items[0]!, quantity: 0 }] }, 'PA-1234'))
      .toThrow('ticket_digital_malformed');
  });
});
