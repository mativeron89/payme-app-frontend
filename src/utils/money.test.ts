import { describe, expect, it } from 'vitest';
import {
  calculateFee,
  centsToString,
  fractionAmount,
  prorateCents,
  splitEqual,
  stringToCents,
  sumCents,
  tipFromBps,
} from './money';

describe('tipFromBps: paridad entera con App Backend', () => {
  it.each([
    [84_000, 4, 1_500, 3_150],
    [30, 4, 2_000, 2],
    [84_101, 4, 1_500, 3_154],
    [101, 2, 1_000, 5],
    [1_001, 3, 1_000, 33],
    [1, 20, 10_000, 0],
  ])('redondea %i/%i a %i bps en un solo paso', (total, participants, bps, expected) => {
    expect(tipFromBps(total, participants, bps)).toBe(expected);
  });

  it('no pierde el medio centavo al multiplicar cerca de MAX_SAFE_INTEGER', () => {
    // La fórmula previa con Number devolvía 4503599627370495 por precisión.
    expect(tipFromBps(Number.MAX_SAFE_INTEGER, 1, 5_000)).toBe(4_503_599_627_370_496);
  });

  it('mantiene fractionAmount sobre la misma aritmética exacta', () => {
    expect(fractionAmount(Number.MAX_SAFE_INTEGER, 5_000)).toBe(4_503_599_627_370_496);
  });

  it.each([
    [Number.MAX_SAFE_INTEGER + 1, 1, 1_000],
    [10_000, Number.MAX_SAFE_INTEGER + 1, 1_000],
    [10_000, 1, Number.MAX_SAFE_INTEGER + 1],
    [10_000.5, 1, 1_000],
  ])('rechaza entradas fuera del dominio seguro (%s, %s, %s)', (total, participants, bps) => {
    expect(() => tipFromBps(total, participants, bps)).toThrow();
  });
});

describe('helpers monetarios: dominio entero seguro', () => {
  it('parsea importes canónicos sin limpiar basura ni pasar por floats', () => {
    expect(stringToCents('$210.45')).toBe(21_045);
    expect(stringToCents(-10.25)).toBe(-1_025);
    expect(() => stringToCents('$1,000')).toThrow();
    expect(() => stringToCents('1e3')).toThrow();
    expect(() => stringToCents(0.1 + 0.2)).toThrow();
  });

  it('formatea y suma sólo centavos enteros seguros', () => {
    expect(centsToString(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
    expect(sumCents(Number.MAX_SAFE_INTEGER - 1, 1)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => centsToString(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    expect(() => centsToString(10.5)).toThrow();
    expect(() => sumCents(Number.MAX_SAFE_INTEGER, 1)).toThrow();
    expect(() => sumCents('1.5')).toThrow();
  });

  it('calcula fee y prorrateo con BigInt en límites seguros', () => {
    expect(calculateFee(Number.MAX_SAFE_INTEGER, 0.5)).toBe(4_503_599_627_370_496);
    expect(prorateCents(Number.MAX_SAFE_INTEGER, 1, 2)).toBe(4_503_599_627_370_496);
    expect(() => calculateFee(10_000, 0.00015)).toThrow();
    expect(() => prorateCents(100, 101, 100)).toThrow();
  });

  it('splitEqual conserva el total exacto y rechaza enteros inseguros', () => {
    const parts = splitEqual(Number.MAX_SAFE_INTEGER, 20);
    expect(sumCents(...parts)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => splitEqual(Number.MAX_SAFE_INTEGER + 1, 20)).toThrow();
    expect(() => splitEqual(100, Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});
