import { describe, expect, it } from 'vitest';
import { cocinasDeLaEvolucion, decodeEvolucion } from './evolucion';

const mes = (m: number, cats: Array<[string, number, number]>) => ({
  month_start: new Date(Date.UTC(2026, m, 1, 6)).toISOString(),
  total_cents: cats.reduce((s, [, a]) => s + a, 0),
  visits: cats.reduce((s, [, , v]) => s + v, 0),
  categories: cats.map(([category, amount_cents, visits]) => ({ category, amount_cents, visits })),
});

const MESES = [
  mes(3, [['italian', 30000, 3]]),
  mes(4, []),
  mes(5, [['cafe', 10000, 2]]),
  mes(6, [['other', 20000, 1], ]),
  mes(7, [['italian', 5000, 1], ['japanese', 5000, 1]]),
  mes(8, [['japanese', 60000, 2], ['italian', 10000, 1]]),
];
const TOTAL = 30000 + 10000 + 20000 + 10000 + 70000;
const BUENO = { basis: 'consumption', months: MESES, total_cents: TOTAL, avg_per_month_cents: Math.floor(TOTAL / 6) };

describe('AF-31 · decodeEvolucion', () => {
  it('lee seis meses, con el vacío incluido', () => {
    const r = decodeEvolucion(BUENO);
    expect(r.months).toHaveLength(6);
    expect(r.months[1]).toMatchObject({ totalCents: 0, categories: [] });
    expect(r.avgPerMonthCents).toBe(23333);
  });

  it('🔴 el promedio es total ÷ 6 CON los meses vacíos (no ÷ los meses con datos)', () => {
    expect(() => decodeEvolucion({ ...BUENO, avg_per_month_cents: Math.floor(TOTAL / 5) }))
      .toThrow('stats_evolution_response_malformed');
  });

  it('las sumas del dueño se exigen: mes = sus cocinas, total = los meses', () => {
    const roto = JSON.parse(JSON.stringify(BUENO));
    roto.months[0].total_cents += 1;
    expect(() => decodeEvolucion(roto)).toThrow('stats_evolution_response_malformed');
    expect(() => decodeEvolucion({ ...BUENO, total_cents: TOTAL + 1 })).toThrow('stats_evolution_response_malformed');
  });

  it('seis meses exactos, en orden creciente, y claves exactas', () => {
    for (const malo of [
      // Cinco meses con su total y su promedio coherentes: así sólo lo caza la
      // exigencia de SEIS (mutante E3, que el caso sin ajustar dejaba vivo).
      (() => {
        const cinco = MESES.slice(1);
        const t = cinco.reduce((s, m) => s + m.total_cents, 0);
        return { ...BUENO, months: cinco, total_cents: t, avg_per_month_cents: Math.floor(t / 6) };
      })(),
      { ...BUENO, months: [...MESES].reverse() },
      { ...BUENO, extra: 1 },
      { ...BUENO, months: [{ ...MESES[0], who: 'Ana' }, ...MESES.slice(1)] },
      { ...BUENO, basis: 'spending' },
    ]) {
      expect(() => decodeEvolucion(malo)).toThrow('stats_evolution_response_malformed');
    }
  });

  it('el orden de cocinas de los seis meses: monto desc y «other» al final', () => {
    expect(cocinasDeLaEvolucion(decodeEvolucion(BUENO))).toEqual(['japanese', 'italian', 'cafe', 'other']);
  });
});
