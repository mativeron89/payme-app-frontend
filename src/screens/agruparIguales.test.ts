import { describe, expect, it } from 'vitest';
import type { ItemPropioDeMesa } from '../api/misMesas';
import type { MovementDetailItem } from '../api/types';
import { agruparDelPago, agruparPropios, nombreConCantidad } from './agruparIguales';

/**
 * D240 punto 16 · los ítems iguales juntos en el detalle de Mesas, con la
 * cantidad antes. Iguales: mismo nombre (sin espacios de más), mismo precio por
 * unidad y enteros. Las porciones y lo que no alcanza para afirmarlo, no.
 */

const propio = (itemId: string, name: string, amountCents: number, extra: Partial<ItemPropioDeMesa> = {}): ItemPropioDeMesa => ({
  itemId, name, amountCents, quantity: 1, fractionBps: 10000, ...extra,
});

const movimiento = (name: string, price: number, extra: Partial<MovementDetailItem> = {}): MovementDetailItem => ({
  name,
  price_cents: price,
  quantity: 1,
  category: 'other',
  amount_cents: price,
  fraction_bps: 10000,
  declared_fraction_bps: null,
  ...extra,
} as MovementDetailItem);

const ver = (gs: ReturnType<typeof agruparPropios>) => gs.map((g) => [nombreConCantidad(g.cantidad, g.primero.name), g.montoCents]);

describe('D240 punto 16 · agruparPropios («Tus mesas»)', () => {
  it('dos unidades iguales: un renglón «2 × Agua mineral» con la suma', () => {
    expect(ver(agruparPropios([propio('a', 'Agua mineral', 4000), propio('b', 'Agua mineral', 4000)])))
      .toEqual([['2 × Agua mineral', 8000]]);
  });

  it('el grupo queda donde apareció el primero, aunque no estén seguidos', () => {
    expect(ver(agruparPropios([
      propio('a', 'Agua mineral', 4000),
      propio('b', 'Pizza', 18500),
      propio('c', 'Agua mineral', 4000),
    ]))).toEqual([['2 × Agua mineral', 8000], ['Pizza', 18500]]);
  });

  it('la key del grupo es la del primero', () => {
    expect(agruparPropios([propio('a', 'Agua', 4000), propio('b', 'Agua', 4000)]).map((g) => g.key)).toEqual(['a']);
  });

  it('los espacios de más no separan: «Agua mineral » es «Agua mineral»', () => {
    expect(ver(agruparPropios([propio('a', 'Agua mineral ', 4000), propio('b', 'Agua  mineral', 4000)])))
      .toEqual([['2 × Agua mineral ', 8000]]);
  });

  it('mayúsculas distintas no se juntan (H)', () => {
    expect(agruparPropios([propio('a', 'Agua Mineral', 4000), propio('b', 'Agua mineral', 4000)])).toHaveLength(2);
  });

  it('el mismo nombre con otro precio no se junta', () => {
    expect(agruparPropios([propio('a', 'Agua mineral', 4000), propio('b', 'Agua mineral', 4500)])).toHaveLength(2);
  });

  it('las mitades no se juntan, ni entre sí ni con un entero (H)', () => {
    expect(agruparPropios([
      propio('a', 'Agua mineral', 2000, { fractionBps: 5000 }),
      propio('b', 'Agua mineral', 2000, { fractionBps: 5000 }),
      propio('c', 'Agua mineral', 4000),
    ])).toHaveLength(3);
  });

  it('suma cantidades, no renglones: una línea de 2 y una de 1 dan «3 ×»', () => {
    expect(ver(agruparPropios([
      propio('a', 'Tacos', 20000, { quantity: 2 }),
      propio('b', 'Tacos', 10000),
    ]))).toEqual([['3 × Tacos', 30000]]);
  });

  it('un monto que no se divide exacto por la cantidad no se junta (no hay precio por unidad que afirmar)', () => {
    expect(agruparPropios([
      propio('a', 'Tacos', 20001, { quantity: 2 }),
      propio('b', 'Tacos', 10000),
    ])).toHaveLength(2);
  });

  it('una línea de cantidad 2 sola dice «2 × Tacos al pastor»', () => {
    expect(ver(agruparPropios([propio('a', 'Tacos al pastor', 20000, { quantity: 2 })])))
      .toEqual([['2 × Tacos al pastor', 20000]]);
  });
});

describe('D240 punto 16 · agruparDelPago (historial)', () => {
  it('dentro del pago, «2 × Agua mineral» con el precio por unidad del dueño', () => {
    const gs = agruparDelPago('m1', [movimiento('Agua mineral', 4000), movimiento('Tagliatelle', 11500), movimiento('Agua mineral', 4000)]);
    expect(gs.map((g) => [nombreConCantidad(g.cantidad, g.primero.name), g.montoCents, g.key]))
      .toEqual([['2 × Agua mineral', 8000, 'm1:0'], ['Tagliatelle', 11500, 'm1:1']]);
  });

  it('en «igual» (sin monto) se juntan los declarados «entero» y queda sin monto', () => {
    const gs = agruparDelPago('m1', [
      movimiento('Agua', 4000, { amount_cents: null, fraction_bps: null, declared_fraction_bps: 10000 }),
      movimiento('Agua', 4000, { amount_cents: null, fraction_bps: null, declared_fraction_bps: 10000 }),
    ]);
    expect(gs).toHaveLength(1);
    expect(gs[0]?.cantidad).toBe(2);
    expect(gs[0]?.montoCents).toBeNull();
  });

  it('«Declaraste entero» no se junta con «sin declarar», y las declaradas ½ no se juntan', () => {
    expect(agruparDelPago('m1', [
      movimiento('Agua', 4000, { amount_cents: null, fraction_bps: null, declared_fraction_bps: 10000 }),
      movimiento('Agua', 4000, { amount_cents: null, fraction_bps: null, declared_fraction_bps: null }),
    ])).toHaveLength(2);
    expect(agruparDelPago('m1', [
      movimiento('Agua', 4000, { amount_cents: null, fraction_bps: null, declared_fraction_bps: 5000 }),
      movimiento('Agua', 4000, { amount_cents: null, fraction_bps: null, declared_fraction_bps: 5000 }),
    ])).toHaveLength(2);
  });

  it('en consumo una porción no se junta', () => {
    expect(agruparDelPago('m1', [
      movimiento('Agua', 4000, { amount_cents: 2000, fraction_bps: 5000 }),
      movimiento('Agua', 4000, { amount_cents: 2000, fraction_bps: 5000 }),
    ])).toHaveLength(2);
  });
});

describe('nombreConCantidad', () => {
  it('la cantidad va ANTES y sólo desde 2', () => {
    expect(nombreConCantidad(1, 'Agua')).toBe('Agua');
    expect(nombreConCantidad(2, 'Agua')).toBe('2 × Agua');
  });
});
