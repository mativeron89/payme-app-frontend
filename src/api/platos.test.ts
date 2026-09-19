import { describe, expect, it } from 'vitest';
import { decodePlatos } from './platos';

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
    expect(r.dishes[0]).toEqual({ name: 'Tiramisú', restaurant: PLATO.restaurant, times: 3, amountCents: 27000 });
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
