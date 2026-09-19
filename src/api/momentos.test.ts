import { describe, expect, it } from 'vitest';
import { decodeMomentos } from './momentos';

const BUENO = {
  basis: 'consumption',
  period: { key: 'this_month', start: '2026-09-01T06:00:00.000Z', end: null },
  dayparts: [
    { key: 'breakfast', visits: 2, amount_cents: 18000 },
    { key: 'lunch', visits: 3, amount_cents: 24500 },
    { key: 'afternoon', visits: 1, amount_cents: 6500 },
    { key: 'dinner', visits: 4, amount_cents: 32200 },
  ],
  total_cents: 81200,
  visits: 10,
};

describe('AF-32 · decodeMomentos (2e)', () => {
  it('lee el ejemplo del handoff del dueño', () => {
    const r = decodeMomentos(BUENO);
    expect(r.dayparts.map((d) => d.key)).toEqual(['breakfast', 'lunch', 'afternoon', 'dinner']);
    expect(r.visits).toBe(10);
    expect(r.period?.key).toBe('this_month');
  });

  it('los cuatro en cero es un período vacío válido; `period` es opcional', () => {
    const { period: _p, ...sin } = BUENO;
    const vacio = { ...sin, total_cents: 0, visits: 0, dayparts: BUENO.dayparts.map((d) => ({ ...d, visits: 0, amount_cents: 0 })) };
    expect(decodeMomentos(vacio).visits).toBe(0);
  });

  it('🔴 tres momentos con sus totales coherentes también se rechazan: son siempre cuatro', () => {
    // Así sólo lo caza la exigencia de CUATRO (mutante G3, que el caso de abajo
    // dejaba vivo porque además rompía las sumas).
    const tres = BUENO.dayparts.slice(0, 3);
    expect(() => decodeMomentos({
      ...BUENO,
      dayparts: tres,
      visits: tres.reduce((a, d) => a + d.visits, 0),
      total_cents: tres.reduce((a, d) => a + d.amount_cents, 0),
    })).toThrow('stats_dayparts_response_malformed');
  });

  it('🔴 siempre los cuatro, en ese orden', () => {
    for (const dayparts of [
      BUENO.dayparts.slice(0, 3),
      [...BUENO.dayparts].reverse(),
      [...BUENO.dayparts.slice(0, 3), { key: 'midnight', visits: 4, amount_cents: 32200 }],
    ]) {
      expect(() => decodeMomentos({ ...BUENO, dayparts })).toThrow('stats_dayparts_response_malformed');
    }
  });

  it('🔴 las sumas se exigen: visitas y montos de los cuatro = los totales', () => {
    expect(() => decodeMomentos({ ...BUENO, visits: 11 })).toThrow('stats_dayparts_response_malformed');
    expect(() => decodeMomentos({ ...BUENO, total_cents: 81201 })).toThrow('stats_dayparts_response_malformed');
  });

  it('claves exactas en todos los niveles', () => {
    for (const malo of [
      { ...BUENO, extra: 1 },
      { ...BUENO, dayparts: [{ ...BUENO.dayparts[0], hour: 9 }, ...BUENO.dayparts.slice(1)] },
      { ...BUENO, basis: 'spending' },
    ]) {
      expect(() => decodeMomentos(malo)).toThrow('stats_dayparts_response_malformed');
    }
  });
});
