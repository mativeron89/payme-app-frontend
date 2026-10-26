import { describe, expect, it } from 'vitest';
import {
  anioDeMexico,
  estadoDelPeriodo,
  mesConMayuscula,
  mesEnFrase,
  mesYAnio,
  rangoDeEvolucion,
  rotuloDeLaBase,
  ultimosTresMeses,
} from './textosDeEstadisticas';

const t = (s: string) => s;
// El 1 a las 00:00 de México es las 06:00Z: así manda el dueño `month_start`.
const AGOSTO = '2026-08-01T06:00:00.000Z';
const MAYO = '2026-05-01T06:00:00.000Z';
const OCTUBRE = '2026-10-01T06:00:00.000Z';

describe('D479/D482 · textos de meses y períodos', () => {
  it('T4 · «Agosto 2026»: mayúscula inicial sola, sin «de»', () => {
    expect(mesYAnio(AGOSTO, 'es')).toBe('Agosto 2026');
    expect(mesYAnio(AGOSTO, 'en')).toBe('August 2026');
  });

  it('el mes se lee en hora de México, no en UTC', () => {
    // 2026-09-01T03:00Z todavía es 31 de agosto en México.
    expect(mesYAnio('2026-09-01T03:00:00.000Z', 'es')).toBe('Agosto 2026');
  });

  it('dentro de una frase: minúscula en español, mayúscula en EN', () => {
    expect(mesEnFrase(AGOSTO, 'es')).toBe('agosto');
    expect(mesEnFrase(AGOSTO, 'en')).toBe('August');
    expect(mesConMayuscula(AGOSTO, 'es')).toBe('Agosto');
  });

  it('el rango de Evolución y el de los últimos 3 meses', () => {
    expect(rangoDeEvolucion(MAYO, OCTUBRE, 'es')).toBe('Mayo a octubre');
    expect(rangoDeEvolucion(MAYO, OCTUBRE, 'en')).toBe('May to October');
    expect(ultimosTresMeses(new Date('2026-10-21T18:00:00Z'), 'es')).toBe('Agosto a octubre');
    // Cruzando el año.
    expect(ultimosTresMeses(new Date('2027-01-15T18:00:00Z'), 'es')).toBe('Noviembre a enero');
    expect(anioDeMexico(new Date('2026-10-21T18:00:00Z'))).toBe('2026');
  });

  it('K1 · el estado del período: el mes pasado está completo; los demás, en curso', () => {
    expect(estadoDelPeriodo('last_month', t)).toBe('Mes completo');
    for (const p of ['this_month', 'last_3_months', 'this_year']) expect(estadoDelPeriodo(p, t)).toBe('En curso');
  });

  it('la fila de la base: «Consumo»/«Gasto», en EN «Orders»/«Spending»', () => {
    expect(rotuloDeLaBase('consumption', 'es')).toBe('Consumo');
    expect(rotuloDeLaBase('payments', 'es')).toBe('Gasto');
    expect(rotuloDeLaBase('consumption', 'en')).toBe('Orders');
    expect(rotuloDeLaBase('payments', 'en')).toBe('Spending');
  });
});
