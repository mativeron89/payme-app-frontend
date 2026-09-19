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
  const g = (key: string, times: number, amountCents: number) => ({ key, times, amountCents });

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
      { key: 'meat', amountCents: 30000, times: 2 },
      { key: 'other', amountCents: 1700, times: null },
    ]);
  });

  it('una clave desconocida sola conserva sus visitas, como «Otros»', () => {
    expect(agruparIngredientes([g('meat', 1, 100), g('grains', 3, 700)])).toEqual([
      { key: 'meat', amountCents: 100, times: 1 },
      { key: 'other', amountCents: 700, times: 3 },
    ]);
  });

  it('el alcohol es un grupo propio (decisión de Mati)', () => {
    expect(agruparIngredientes([g('alcohol', 1, 4000)]).map((x) => x.key)).toEqual(['alcohol']);
  });
});
