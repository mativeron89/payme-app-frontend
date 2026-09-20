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

  it('falla cerrado si el código o los campos visibles no son válidos', () => {
    expect(() => ticketDigitalView(mesa, 'PA-9999')).toThrow('ticket_digital_malformed');
    expect(() => ticketDigitalView({ ...mesa, total_cents: -1 }, 'PA-1234')).toThrow('ticket_digital_malformed');
    expect(() => ticketDigitalView({ ...mesa, items: [{ ...mesa.items[0]!, quantity: 0 }] }, 'PA-1234'))
      .toThrow('ticket_digital_malformed');
  });
});
