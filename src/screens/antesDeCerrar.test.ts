import { describe, expect, it } from 'vitest';
import type { MesaItem } from '../api/types';
import { elegidosAlGuardar, elegidosRegistrados, lineasElegidas, seleccionCierraLaMesa } from './antesDeCerrar';

/**
 * D240 punto 8 · la hoja antes de que la mesa se cierre. Lo que se prueba acá:
 * cuándo un «Listo» cierra la mesa (la regla del dueño: todo plato sin nada por
 * elegir) y qué lista ve la persona.
 */

function item(over: Partial<MesaItem> = {}): MesaItem {
  return {
    id: 'i-1',
    name: 'Plato',
    category: 'other',
    price_cents: 10000,
    quantity: 1,
    status: 'available',
    remaining_bps: 10000,
    my_bps: 0,
    locked_by_me: false,
    lock_expires_at: null,
    ...over,
  } as MesaItem;
}

const consumo = (items: MesaItem[], borrador: Array<[string, number]>) => seleccionCierraLaMesa(
  { items },
  (i) => i.remaining_bps,
  () => 0,
  new Map(borrador),
);

describe('D240 punto 8 · seleccionCierraLaMesa (consumo)', () => {
  it('los dos platos libres, elegidos enteros: cierra', () => {
    expect(consumo([item({ id: 'a' }), item({ id: 'b' })], [['a', 10000], ['b', 10000]])).toBe(true);
  });

  it('uno elegido a la mitad: no cierra', () => {
    expect(consumo([item({ id: 'a' }), item({ id: 'b' })], [['a', 10000], ['b', 5000]])).toBe(false);
  });

  it('un plato sin elegir: no cierra', () => {
    expect(consumo([item({ id: 'a' }), item({ id: 'b' })], [['a', 10000]])).toBe(false);
  });

  it('otra persona ya tomó un plato entero y el borrador cubre el otro: cierra', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 0 }), item({ id: 'b' })], [['b', 10000]])).toBe(true);
  });

  it('quedaba ½ y el borrador toma esa ½: cierra', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 5000 })], [['a', 5000]])).toBe(true);
  });

  it('un borrador viejo que ya no entra (pide más de lo que queda): no avisa', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 5000 })], [['a', 10000]])).toBe(false);
  });

  it('sin borrador no cierra nada, aunque todo esté tomado', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 0 })], [])).toBe(false);
  });

  it('un dato desconocido del dueño: no avisa', () => {
    expect(consumo([item({ id: 'a', remaining_bps: undefined as unknown as number })], [['a', 10000]])).toBe(false);
    expect(consumo([item({ id: 'a', remaining_bps: 10001 })], [['a', 10000]])).toBe(false);
  });

  it('sin platos: no cierra', () => {
    expect(consumo([], [['a', 10000]])).toBe(false);
  });
});

describe('D240 punto 8 · seleccionCierraLaMesa («igual»: el borrador reemplaza lo guardado)', () => {
  const igual = (items: MesaItem[], guardadas: Array<[string, number]>, borrador: Array<[string, number]>) => {
    const g = new Map(guardadas);
    return seleccionCierraLaMesa({ items }, (i) => i.informative_remaining_bps, (i) => g.get(i.id) ?? 0, new Map(borrador));
  };

  // El restante del dueño ya descuenta lo mío guardado: lo que puedo declarar
  // es restante + lo mío, y el borrador lo reemplaza.
  it('lo propio guardado es ½ del plato a (la otra ½ es de otro); el borrador la conserva y toma el b entero: cierra', () => {
    expect(igual(
      [item({ id: 'a', informative_remaining_bps: 0 }), item({ id: 'b', informative_remaining_bps: 10000 })],
      [['a', 5000]],
      [['a', 5000], ['b', 10000]],
    )).toBe(true);
  });

  it('el borrador suelta lo mío guardado: ya no cierra', () => {
    expect(igual(
      [item({ id: 'a', informative_remaining_bps: 0 }), item({ id: 'b', informative_remaining_bps: 10000 })],
      [['a', 10000]],
      [['b', 10000]],
    )).toBe(false);
  });
});

describe('D240 punto 8 · lo que muestra la hoja', () => {
  const items = [
    item({ id: 't1', name: 'Tiramisú', price_cents: 7000, my_bps: 10000 }),
    item({ id: 't2', name: 'Tiramisú', price_cents: 7000, my_bps: 10000 }),
    item({ id: 'ag', name: 'Agua mineral', price_cents: 4000, my_bps: 5000 }),
    item({ id: 'pz', name: 'Pizza', price_cents: 18500, my_bps: 10000, status: 'paid' }),
    item({ id: 'vn', name: 'Vino', price_cents: 12000 }),
  ];

  it('lo registrado, con los iguales juntos y la porción: lo pagado no entra', () => {
    expect(lineasElegidas(elegidosRegistrados({ items }, true, new Map())).map((l) => l.texto))
      .toEqual(['2 × Tiramisú', 'Agua mineral · ½']);
  });

  it('al guardar en consumo: lo registrado más el borrador', () => {
    expect(lineasElegidas(elegidosAlGuardar({ items }, true, new Map([['vn', 10000]]))).map((l) => l.texto))
      .toEqual(['2 × Tiramisú', 'Agua mineral · ½', 'Vino']);
  });

  it('en «igual» lo registrado sale de lo guardado, y al guardar vale sólo el borrador', () => {
    const guardadas = new Map([['vn', 10000]]);
    expect(lineasElegidas(elegidosRegistrados({ items }, false, guardadas)).map((l) => l.texto)).toEqual(['Vino']);
    expect(lineasElegidas(elegidosAlGuardar({ items }, false, new Map([['ag', 10000]]))).map((l) => l.texto))
      .toEqual(['Agua mineral']);
  });
});
