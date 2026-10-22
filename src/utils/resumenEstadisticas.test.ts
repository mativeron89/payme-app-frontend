import { describe, expect, it } from 'vitest';
import type { ConsumoDelMes } from '../api/consumoDelMes';
import type { Evolucion } from '../api/evolucion';
import { compararMesesCompletos, promedioDelResumen, promedioPorVisita } from './resumenEstadisticas';

const AHORA = new Date('2026-10-21T18:00:00Z');
function serie(actual = 9, year = 2026): Evolucion {
  const months = Array.from({ length: 6 }, (_, i) => {
    const totalCents = [0, 101, 0, 10001, 15005, 999999][i];
    return {
      monthStart: new Date(Date.UTC(year, actual - 5 + i, 1, 6)).toISOString(),
      totalCents, visits: [0, 1, 0, 3, 4, 99][i],
      categories: totalCents ? [{ category: 'italian', amountCents: totalCents, visits: 1 }] : [],
    };
  });
  const totalCents = months.reduce((n, m) => n + m.totalCents, 0);
  return { basis: 'consumption', months, totalCents, avgPerMonthCents: Math.floor(totalCents / 6) };
}
function cambiarMes(e: Evolucion, indice: number, cambio: Partial<Evolucion['months'][number]>): Evolucion {
  return { ...e, months: e.months.map((m, i) => i === indice ? { ...m, ...cambio } : m) };
}

describe('D444/D449 · promedios acreditados', () => {
  it('conserva el truncado de centavos del dueño, no redondea', () => {
    const consumo: ConsumoDelMes = { basis: 'consumption', totalCents: 10001, visits: 3, avgPerVisitCents: 3333, categories: [] };
    expect(promedioDelResumen(consumo)).toBe(3333);
    expect(promedioDelResumen({ ...consumo, avgPerVisitCents: 3334 })).toBeNull();
    expect(promedioDelResumen({ ...consumo, visits: 0, avgPerVisitCents: 0 })).toBeNull();
  });
  it('cero real con visitas acredita promedio cero; sin visitas o entero seguro no', () => {
    expect(promedioPorVisita(0, 2)).toBe(0);
    expect(promedioPorVisita(0, 0)).toBeNull();
    for (const n of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(promedioPorVisita(n, 1)).toBeNull();
      expect(promedioPorVisita(1, n)).toBeNull();
    }
    expect(promedioPorVisita(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('D444/D449 · dos meses completos de México', () => {
  it('excluye el mes actual y explicita valores, centavos y diferencias', () => {
    const c = compararMesesCompletos(serie(), 'consumption', AHORA)!;
    expect(c.anterior.monthStart).toBe('2026-08-01T06:00:00.000Z');
    expect(c.reciente.monthStart).toBe('2026-09-01T06:00:00.000Z');
    expect([c.anterior.totalCents, c.reciente.totalCents]).toEqual([10001, 15005]);
    expect([c.promedioAnterior, c.promedioReciente, c.diferenciaPromedioCents]).toEqual([3333, 3751, 418]);
    expect([c.diferenciaCents, c.diferenciaVisitas, c.porcentaje]).toEqual([5004, 1, 50]);
  });
  it('corte mexicano: a las 05:59Z sigue septiembre; a las 06Z ya octubre', () => {
    expect(compararMesesCompletos(serie(8), 'consumption', new Date('2026-10-01T05:59:59Z'))?.reciente.monthStart).toBe('2026-08-01T06:00:00.000Z');
    expect(compararMesesCompletos(serie(8), 'consumption', new Date('2026-10-01T06:00:00Z'))).toBeNull();
    expect(compararMesesCompletos(serie(), 'consumption', new Date('2026-10-01T06:00:00Z'))?.reciente.monthStart).toBe('2026-09-01T06:00:00.000Z');
  });
  it('enero conserva diciembre y noviembre del año anterior', () => {
    const c = compararMesesCompletos(serie(0, 2027), 'consumption', new Date('2027-01-15T12:00:00Z'))!;
    expect([c.anterior.monthStart, c.reciente.monthStart]).toEqual(['2026-11-01T06:00:00.000Z', '2026-12-01T06:00:00.000Z']);
  });
  it('base cero conserva la diferencia sin porcentaje ni promedio inventado', () => {
    const c = compararMesesCompletos(cambiarMes(serie(), 3, { totalCents: 0, visits: 0 }), 'consumption', AHORA)!;
    expect([c.diferenciaCents, c.diferenciaVisitas, c.porcentaje, c.promedioAnterior, c.diferenciaPromedioCents]).toEqual([15005, 4, null, null, null]);
    const ambos = cambiarMes(cambiarMes(serie(), 3, { totalCents: 0, visits: 0 }), 4, { totalCents: 0, visits: 0 });
    expect(compararMesesCompletos(ambos, 'consumption', AHORA)?.diferenciaCents).toBe(0);
    expect(compararMesesCompletos(ambos, 'consumption', AHORA)?.porcentaje).toBeNull();
  });
  it('baja e igualdad acreditadas, y porcentajes con centavos grandes', () => {
    expect(compararMesesCompletos(cambiarMes(serie(), 4, { totalCents: 0 }), 'consumption', AHORA)?.porcentaje).toBe(-100);
    expect(compararMesesCompletos(cambiarMes(serie(), 4, { totalCents: 10001 }), 'consumption', AHORA)?.porcentaje).toBe(0);
    const grande = cambiarMes(cambiarMes(serie(), 3, { totalCents: 3000000000000000 }), 4, { totalCents: 4500000000000000 });
    expect(compararMesesCompletos(grande, 'consumption', AHORA)?.porcentaje).toBe(50);
  });
  it('ausencia, base distinta y fechas sin vigencia no acreditan comparación', () => {
    expect(compararMesesCompletos(null, 'consumption', AHORA)).toBeNull();
    expect(compararMesesCompletos(serie(), 'payments', AHORA)).toBeNull();
    expect(compararMesesCompletos({ ...serie(), basis: 'payments' }, 'payments', AHORA)).not.toBeNull();
    expect(compararMesesCompletos(serie(), 'consumption', new Date('inválida'))).toBeNull();
    expect(compararMesesCompletos(serie(8), 'consumption', AHORA)).toBeNull();
    // Date.parse normaliza febrero 29 a marzo 1 en 2026; no debe acreditarlo.
    expect(compararMesesCompletos(cambiarMes(serie(3), 4, { monthStart: '2026-02-29T06:00:00Z' }), 'consumption', new Date('2026-04-21T18:00:00Z'))).toBeNull();
    expect(compararMesesCompletos({ ...serie(), months: serie().months.slice(1) }, 'consumption', AHORA)).toBeNull();
    for (const monthStart of ['inválida', '2026-08-02T06:00:00Z', '2026-08-01T00:00:00Z', '2026-08-01T06:00:00.001Z', '2026-07-01T06:00:00Z']) {
      expect(compararMesesCompletos(cambiarMes(serie(), 3, { monthStart }), 'consumption', AHORA)).toBeNull();
    }
    for (const n of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(compararMesesCompletos(cambiarMes(serie(), 3, { totalCents: n }), 'consumption', AHORA)).toBeNull();
    }
  });
});
