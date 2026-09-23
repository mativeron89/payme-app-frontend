import { describe, expect, it } from 'vitest';
import { agruparIngredientes, decodeIngredientes } from './ingredientes';

const BUENO = {
  basis: 'consumption',
  period: { key: 'this_month', start: '2026-09-01T06:00:00.000Z', end: null },
  classifier_version: '1',
  estimated: true,
  groups: [
    { key: 'meat', times: 2, amount_cents: 30000 },
    { key: 'alcohol', times: 1, amount_cents: 4000 },
    { key: 'drinks', times: 1, amount_cents: 3000 },
    { key: 'other', times: 1, amount_cents: 30000 },
  ],
  total_cents: 67000,
};

describe('AF-38 · decodeIngredientes · claves exactas', () => {
  it('lee el ejemplo del handoff del dueño', () => {
    const r = decodeIngredientes(BUENO);
    expect(r.period?.key).toBe('this_month');
    expect(r.estimated).toBe(true);
    expect(r.classifierVersion).toBe('1');
    expect(r.groups.map((g) => g.key)).toEqual(['meat', 'alcohol', 'drinks', 'other']);
    expect(r.totalCents).toBe(67000);
  });

  it('sin platos en el período es válido; `period` es opcional', () => {
    const { period: _p, ...sin } = BUENO;
    expect(decodeIngredientes({ ...sin, groups: [], total_cents: 0 }).groups).toEqual([]);
  });

  it('🔴 `total_cents` tiene que ser la suma de los grupos', () => {
    expect(() => decodeIngredientes({ ...BUENO, total_cents: 67001 })).toThrow('stats_ingredients_response_malformed');
  });

  it('un campo de más, uno de menos o un tipo raro se rechazan', () => {
    for (const malo of [
      null, [], { ...BUENO, extra: 1 }, { ...BUENO, estimated: 'sí' }, { ...BUENO, classifier_version: '' },
      { ...BUENO, basis: 'otra' }, { ...BUENO, period: { key: 'this_month' } },
      { ...BUENO, groups: [{ key: 'meat', times: 1, amount_cents: 67000, name: 'Arrachera' }], total_cents: 67000 },
      { ...BUENO, groups: [{ key: 'meat', times: 0, amount_cents: 67000 }], total_cents: 67000 },
      { ...BUENO, groups: [{ key: 'meat', times: 1, amount_cents: 0 }], total_cents: 0 },
      { ...BUENO, groups: [{ key: '', times: 1, amount_cents: 100 }], total_cents: 100 },
      { ...BUENO, groups: [{ key: 'meat', times: 1, amount_cents: 100 }, { key: 'meat', times: 1, amount_cents: 100 }], total_cents: 200 },
    ]) {
      expect(() => decodeIngredientes(malo), JSON.stringify(malo)).toThrow('stats_ingredients_response_malformed');
    }
  });

  it('🔴 una clave que el front no conoce NO rompe el decodificador', () => {
    const r = decodeIngredientes({
      ...BUENO,
      groups: [{ key: 'grains', times: 1, amount_cents: 500 }],
      total_cents: 500,
    });
    expect(r.groups[0].key).toBe('grains');
  });
});

describe('AF-38 · agruparIngredientes · cómo se muestran', () => {
  const g = (key: string, times: number, amountCents: number, dishCount: number | null = null) => (
    { key, times, amountCents, dishCount }
  );

  it('🔴 «Otros» va siempre al final, aunque sea el mayor', () => {
    const r = agruparIngredientes([g('other', 5, 90000), g('meat', 2, 30000), g('drinks', 1, 3000)]);
    expect(r.map((x) => x.key)).toEqual(['meat', 'drinks', 'other']);
  });

  it('el resto va por monto de mayor a menor, empate por clave', () => {
    const r = agruparIngredientes([g('pasta', 1, 1000), g('dessert', 1, 1000), g('meat', 1, 5000)]);
    expect(r.map((x) => x.key)).toEqual(['meat', 'dessert', 'pasta']);
  });

  it('🔴 una clave desconocida se SUMA a «Otros»; con dos sumadas, las visitas no se inventan', () => {
    const r = agruparIngredientes([g('meat', 2, 30000), g('grains', 1, 700), g('other', 2, 1000)]);
    expect(r).toEqual([
      { key: 'meat', amountCents: 30000, times: 2, dishCount: null },
      { key: 'other', amountCents: 1700, times: null, dishCount: null },
    ]);
  });

  it('una clave desconocida sola conserva sus visitas, como «Otros»', () => {
    expect(agruparIngredientes([g('meat', 1, 100), g('grains', 3, 700)])).toEqual([
      { key: 'meat', amountCents: 100, times: 1, dishCount: null },
      { key: 'other', amountCents: 700, times: 3, dishCount: null },
    ]);
  });

  it('el alcohol es un grupo propio (decisión de Mati)', () => {
    expect(agruparIngredientes([g('alcohol', 1, 4000)]).map((x) => x.key)).toEqual(['alcohol']);
  });
});

/**
 * n178 · `dish_count` por grupo (dueño v2.125.0, `docs/HANDOFF_POR_INGREDIENTE_V2.115.0.md`
 * § v2.125.0). Aditivo: la forma vieja sigue valiendo.
 */
describe('n178 · dish_count por grupo', () => {
  const CON_PLATOS = {
    ...BUENO,
    groups: [
      { key: 'meat', times: 2, amount_cents: 30000, dish_count: 2 },
      { key: 'alcohol', times: 1, amount_cents: 4000, dish_count: 1 },
      { key: 'drinks', times: 1, amount_cents: 3000, dish_count: 1 },
      { key: 'other', times: 1, amount_cents: 30000, dish_count: 3 },
    ],
  };

  it('🔴 lee el `dish_count` del dueño (antes esta forma se rechazaba entera)', () => {
    const r = decodeIngredientes(CON_PLATOS);
    expect(r.groups.map((x) => x.dishCount)).toEqual([2, 1, 1, 3]);
  });

  it('sin `dish_count` (dueño anterior) sigue valiendo, con `dishCount` en null', () => {
    expect(decodeIngredientes(BUENO).groups.map((x) => x.dishCount)).toEqual([null, null, null, null]);
  });

  it('🔴 mezclado, en cero, negativo o no entero se rechaza', () => {
    const [primero, ...resto] = CON_PLATOS.groups;
    const sinElSegundo = { ...CON_PLATOS, groups: [primero, { key: 'alcohol', times: 1, amount_cents: 4000 }, ...resto.slice(1)] };
    const sinElPrimero = { ...CON_PLATOS, groups: [{ key: 'meat', times: 2, amount_cents: 30000 }, ...resto] };
    for (const malo of [
      sinElSegundo,
      sinElPrimero,
      { ...CON_PLATOS, groups: [{ ...primero, dish_count: 0 }, ...resto] },
      { ...CON_PLATOS, groups: [{ ...primero, dish_count: -1 }, ...resto] },
      { ...CON_PLATOS, groups: [{ ...primero, dish_count: 1.5 }, ...resto] },
      { ...CON_PLATOS, groups: [{ ...primero, dish_count: '2' }, ...resto] },
    ]) {
      expect(() => decodeIngredientes(malo), JSON.stringify(malo.groups)).toThrow('stats_ingredients_response_malformed');
    }
  });

  it('🔴 al juntar claves en «Otros» los platos SÍ se suman (cada plato cae en un solo grupo); las visitas no', () => {
    const g = (key: string, times: number, amountCents: number, dishCount: number | null) => (
      { key, times, amountCents, dishCount }
    );
    expect(agruparIngredientes([g('meat', 2, 30000, 2), g('grains', 1, 700, 1), g('other', 2, 1000, 3)])).toEqual([
      { key: 'meat', amountCents: 30000, times: 2, dishCount: 2 },
      { key: 'other', amountCents: 1700, times: null, dishCount: 4 },
    ]);
  });
});
