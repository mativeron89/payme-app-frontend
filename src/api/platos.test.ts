import { describe, expect, it } from 'vitest';
import { decodePlatos, rutaDePlatos } from './platos';
import { rutaDeIngredientes } from './ingredientes';

const PLATO = {
  name: 'Tiramisú',
  restaurant: { id: 'r-1', name: 'La Parolaccia', category: 'italian' },
  times: 3,
  amount_cents: 27000,
};
const BUENO = {
  basis: 'consumption',
  period: { key: 'this_month', start: '2026-09-01T06:00:00.000Z', end: null },
  distinct_dishes: 15,
  dishes: [PLATO],
};

describe('AF-31 · decodePlatos · claves exactas', () => {
  it('lee el ejemplo del handoff del dueño', () => {
    const r = decodePlatos(BUENO);
    expect(r.distinctDishes).toBe(15);
    expect(r.period?.key).toBe('this_month');
    expect(r.agrupados).toBe(false);
    // La forma de siempre se lee como un plato de un solo lugar.
    expect(r.dishes[0]).toEqual({
      name: 'Tiramisú', times: 3, amountCents: 27000,
      restaurants: [{ ...PLATO.restaurant, times: 3, amountCents: 27000 }],
    });
  });

  it('`period` es opcional; vacío es válido', () => {
    const { period: _p, ...sinPeriodo } = BUENO;
    expect(decodePlatos(sinPeriodo).period).toBeNull();
    expect(decodePlatos({ ...BUENO, distinct_dishes: 0, dishes: [] }).dishes).toEqual([]);
  });

  it('🔴 un campo de más se rechaza: en el plato, en su restaurante o arriba', () => {
    for (const malo of [
      { ...BUENO, extra: 1 },
      { ...BUENO, dishes: [{ ...PLATO, who: 'Ana' }] },
      { ...BUENO, dishes: [{ ...PLATO, restaurant: { ...PLATO.restaurant, address: 'Roma Norte' } }] },
    ]) {
      expect(() => decodePlatos(malo)).toThrow('stats_dishes_response_malformed');
    }
  });

  it('más de 5 platos, menos distintos que listados, veces en 0 o un período raro ⇒ error', () => {
    for (const malo of [
      { ...BUENO, distinct_dishes: 6, dishes: Array.from({ length: 6 }, (_, i) => ({ ...PLATO, name: `P${i}` })) },
      { ...BUENO, distinct_dishes: 0 },
      { ...BUENO, dishes: [{ ...PLATO, times: 0 }] },
      { ...BUENO, dishes: [{ ...PLATO, amount_cents: 1.5 }] },
      { ...BUENO, basis: 'spending' },
      { ...BUENO, period: { key: 'ayer', start: 'x', end: null } },
    ]) {
      expect(() => decodePlatos(malo), JSON.stringify(malo).slice(0, 80)).toThrow('stats_dishes_response_malformed');
    }
  });
});

describe('🔴 D479/D482 · AF-2 · `dishes_version=2`: platos agrupados entre restaurantes (App Backend 2.195.0)', () => {
  const AGRUPADO = {
    name: 'Vino tinto',
    times: 3,
    amount_cents: 67000,
    restaurants: [
      { id: 'r-1', name: 'La Parolaccia', category: 'italian', times: 2, amount_cents: 54000 },
      { id: 'r-2', name: 'Café Nube', category: 'cafe', times: 1, amount_cents: 13000 },
    ],
  };
  const V2 = { ...BUENO, distinct_dishes: 4, dishes: [AGRUPADO] };

  it('la app lo pide siempre, en platos y en ingredientes, con el período o sin él', () => {
    expect(rutaDePlatos()).toBe('/account/stats/dishes?dishes_version=2');
    expect(rutaDePlatos('last_month')).toBe('/account/stats/dishes?period=last_month&dishes_version=2');
    expect(rutaDeIngredientes()).toBe('/account/stats/ingredients?dishes_version=2');
    expect(rutaDeIngredientes('this_year')).toBe('/account/stats/ingredients?period=this_year&dishes_version=2');
  });

  it('negociada: lee el ejemplo del handoff, con dónde se pidió cada plato', () => {
    const r = decodePlatos(V2, { negociado: true });
    expect(r.agrupados).toBe(true);
    expect(r.dishes[0]).toEqual({
      name: 'Vino tinto', times: 3, amountCents: 67000,
      restaurants: [
        { id: 'r-1', name: 'La Parolaccia', category: 'italian', times: 2, amountCents: 54000 },
        { id: 'r-2', name: 'Café Nube', category: 'cafe', times: 1, amountCents: 13000 },
      ],
    });
  });

  it('un dueño anterior ignora el parámetro: negociada, la forma de siempre se sigue aceptando', () => {
    const r = decodePlatos(BUENO, { negociado: true });
    expect(r.agrupados).toBe(false);
    expect(r.dishes[0]!.restaurants).toHaveLength(1);
  });

  it('🔴 la forma de siempre se lee IGUAL con o sin negociar (también vacía y en base gasto)', () => {
    for (const vieja of [BUENO, { ...BUENO, distinct_dishes: 0, dishes: [] }, { ...BUENO, basis: 'payments' }]) {
      expect(decodePlatos(vieja, { negociado: true })).toEqual(decodePlatos(vieja));
    }
  });

  it('🔴 sin negociar, la forma agrupada se rechaza', () => {
    expect(() => decodePlatos(V2)).toThrow('stats_dishes_response_malformed');
  });

  it('🔴 negociada: mezcla de formas, sumas que no cierran o lugares raros se rechazan', () => {
    for (const malo of [
      { ...V2, dishes: [AGRUPADO, PLATO] },
      { ...V2, dishes: [PLATO, AGRUPADO] },
      { ...V2, dishes: [{ ...AGRUPADO, times: 4 }] },
      { ...V2, dishes: [{ ...AGRUPADO, amount_cents: 67001 }] },
      { ...V2, dishes: [{ ...AGRUPADO, restaurants: [] }] },
      { ...V2, dishes: [{ ...AGRUPADO, restaurants: [AGRUPADO.restaurants[0], { ...AGRUPADO.restaurants[1], id: 'r-1' }] }] },
      { ...V2, dishes: [{ ...AGRUPADO, restaurants: [{ ...AGRUPADO.restaurants[0], times: 0 }, AGRUPADO.restaurants[1]] }] },
      { ...V2, dishes: [{ ...AGRUPADO, restaurants: [{ ...AGRUPADO.restaurants[0], address: 'Roma Norte' }, AGRUPADO.restaurants[1]] }] },
      { ...V2, dishes: [{ ...AGRUPADO, restaurant: PLATO.restaurant }] },
    ]) {
      expect(() => decodePlatos(malo, { negociado: true }), JSON.stringify(malo).slice(0, 90)).toThrow('stats_dishes_response_malformed');
    }
  });
});
