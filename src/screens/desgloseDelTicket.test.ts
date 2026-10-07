import { describe, expect, it } from 'vitest';
import { desgloseDelTicket } from './desgloseDelTicket';

/**
 * D209 · D215 · cuándo «Ver el ticket» muestra subtotal e IVA, y cuándo la
 * diferencia contra el impreso NO es una lectura mala (IVA agregado).
 */
const totales = { subtotal_cents: 36207, tax_cents: 5793 };

describe('desgloseDelTicket', () => {
  it('🔴 IVA incluido: los ítems suman el total impreso', () => {
    expect(desgloseDelTicket({ sumaItems: 42000, ticketValido: true, impreso: 42000, totales })).toEqual({
      tipo: 'incluido', subtotalCents: 36207, ivaCents: 5793, totalCents: 42000,
    });
  });

  it('🔴 IVA agregado: los ítems suman EXACTO el subtotal', () => {
    expect(desgloseDelTicket({ sumaItems: 36207, ticketValido: true, impreso: 42000, totales })).toEqual({
      tipo: 'agregado', subtotalCents: 36207, ivaCents: 5793, totalCents: 42000,
    });
  });

  it.each([
    ['sin totales', { sumaItems: 42000, ticketValido: true, impreso: 42000, totales: null }],
    ['sin total impreso', { sumaItems: 42000, ticketValido: true, impreso: null, totales }],
    ['ticket incompleto', { sumaItems: 42000, ticketValido: false, impreso: 42000, totales }],
    ['ítems editados que ya no cierran', { sumaItems: 40000, ticketValido: true, impreso: 42000, totales }],
    ['un centavo arriba del subtotal', { sumaItems: 36208, ticketValido: true, impreso: 42000, totales }],
    ['totales que no cierran con el impreso', { sumaItems: 42000, ticketValido: true, impreso: 42001, totales }],
  ])('%s: «ninguno», la pantalla queda como antes', (_caso, entrada) => {
    expect(desgloseDelTicket(entrada)).toEqual({ tipo: 'ninguno' });
  });

  it('con IVA cero y los ítems en el total, es «incluido», nunca «agregado»', () => {
    const sinIva = { subtotal_cents: 42000, tax_cents: 0 };
    expect(desgloseDelTicket({ sumaItems: 42000, ticketValido: true, impreso: 42000, totales: sinIva }).tipo)
      .toBe('incluido');
  });
});
