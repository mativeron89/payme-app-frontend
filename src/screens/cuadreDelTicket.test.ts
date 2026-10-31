import { describe, expect, it } from 'vitest';
import { desgloseDelTicket } from './desgloseDelTicket';
import { estadoDelCuadre, textoDelCuadre } from './cuadreDelTicket';

/**
 * D622 · AF-2 · mejora 4 (§5 de la especificación): cuánto sobra o falta para
 * cuadrar el ticket, y el estado «cuadra». La regla de cuándo NO cuadra es la de
 * siempre (`totalMismatch` en `CreateMesaFlow`); acá sólo se nombra.
 */
const t = (s: string, ...a: unknown[]) => s.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)]));
const NINGUNO = { tipo: 'ninguno' } as const;

describe('estadoDelCuadre · cuándo se dice algo', () => {
  it('🔴 cuadra con el centavo exacto', () => {
    expect(estadoDelCuadre({ sumaItems: 84000, impreso: 84000, desglose: NINGUNO, filasCompletas: true }))
      .toEqual({ tipo: 'cuadra', impresoCents: 84000 });
  });

  it('🔴 sobran: la suma pasa al impreso', () => {
    expect(estadoDelCuadre({ sumaItems: 88500, impreso: 84000, desglose: NINGUNO, filasCompletas: true }))
      .toEqual({ tipo: 'sobran', sumaCents: 88500, impresoCents: 84000, diferenciaCents: 4500 });
  });

  it('🔴 faltan: la suma no llega al impreso', () => {
    expect(estadoDelCuadre({ sumaItems: 79500, impreso: 84000, desglose: NINGUNO, filasCompletas: true }))
      .toEqual({ tipo: 'faltan', sumaCents: 79500, impresoCents: 84000, diferenciaCents: 4500 });
  });

  it('un centavo de diferencia es diferencia, no «cuadra»', () => {
    expect(estadoDelCuadre({ sumaItems: 84001, impreso: 84000, desglose: NINGUNO, filasCompletas: true }))
      .toEqual({ tipo: 'sobran', sumaCents: 84001, impresoCents: 84000, diferenciaCents: 1 });
  });

  it('🔴 sin total impreso no se afirma nada', () => {
    expect(estadoDelCuadre({ sumaItems: 84000, impreso: null, desglose: NINGUNO, filasCompletas: true })).toBeNull();
  });

  it('🔴 con una fila incompleta no se afirma nada', () => {
    expect(estadoDelCuadre({ sumaItems: 0, impreso: 84000, desglose: NINGUNO, filasCompletas: false })).toBeNull();
    expect(estadoDelCuadre({ sumaItems: 84000, impreso: 84000, desglose: NINGUNO, filasCompletas: false })).toBeNull();
  });
});

describe('estadoDelCuadre · con el desglose impreso (D209, D215, D218, D224)', () => {
  const totales = { subtotal_cents: 36207, tax_cents: 5793 };

  it('🔴 IVA agregado: los platos suman el subtotal y el desglose cierra → cuadra con el impreso', () => {
    const desglose = desgloseDelTicket({ sumaItems: 36207, ticketValido: true, impreso: 42000, totales });
    expect(desglose.tipo).toBe('cierra');
    expect(estadoDelCuadre({ sumaItems: 36207, impreso: 42000, desglose, filasCompletas: true }))
      .toEqual({ tipo: 'cuadra', impresoCents: 42000 });
  });

  it('🔴 descuento impreso: platos − descuento = impreso → cuadra', () => {
    const desglose = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 79000, totales: null,
      ajustes: [{ kind: 'discount', amount_cents: 5000 }],
    });
    expect(estadoDelCuadre({ sumaItems: 84000, impreso: 79000, desglose, filasCompletas: true }))
      .toEqual({ tipo: 'cuadra', impresoCents: 79000 });
  });

  it('🔴 cargo por servicio impreso: platos + servicio = impreso → cuadra', () => {
    const desglose = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 92400, totales: null,
      ajustes: [{ kind: 'service_charge', amount_cents: 8400 }],
    });
    expect(desglose.tipo).toBe('cierra');
    expect(estadoDelCuadre({ sumaItems: 84000, impreso: 92400, desglose, filasCompletas: true }))
      .toEqual({ tipo: 'cuadra', impresoCents: 92400 });
  });

  it('con los platos editados el desglose deja de cerrar y vuelve la diferencia', () => {
    const desglose = desgloseDelTicket({ sumaItems: 40000, ticketValido: true, impreso: 42000, totales });
    expect(estadoDelCuadre({ sumaItems: 40000, impreso: 42000, desglose, filasCompletas: true }))
      .toEqual({ tipo: 'faltan', sumaCents: 40000, impresoCents: 42000, diferenciaCents: 2000 });
  });
});

describe('textoDelCuadre · los textos de la especificación (§5)', () => {
  it('sobran, faltan y cuadra, con la diferencia exacta en palabras', () => {
    expect(textoDelCuadre({ tipo: 'sobran', sumaCents: 88500, impresoCents: 84000, diferenciaCents: 4500 }, t))
      .toBe('Tus platos suman $885 y el ticket dice $840: sobran $45.');
    expect(textoDelCuadre({ tipo: 'faltan', sumaCents: 79550, impresoCents: 84000, diferenciaCents: 4450 }, t))
      .toBe('Tus platos suman $795.50 y el ticket dice $840: faltan $44.50.');
    expect(textoDelCuadre({ tipo: 'cuadra', impresoCents: 84000 }, t)).toBe('Cuadra con el ticket: $840.');
  });
});
