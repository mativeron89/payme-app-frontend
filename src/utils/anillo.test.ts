import { describe, expect, it } from 'vitest';
import { porcentajesEnteros } from './anillo';

const suma = (xs: readonly number[]) => xs.reduce((a, x) => a + x, 0);

describe('AF-26 · porcentajes enteros por resto mayor', () => {
  it('siempre suman 100 cuando hay total', () => {
    for (const montos of [
      [31000, 24550, 12800, 8650],
      [1, 1, 1],
      [10000, 1, 1, 1, 1, 1, 1],
      [33333, 33333, 33334],
      [7, 13, 29, 51],
    ]) {
      expect(suma(porcentajesEnteros(montos)), JSON.stringify(montos)).toBe(100);
    }
  });

  it('un solo rubro es 100', () => {
    expect(porcentajesEnteros([118000])).toEqual([100]);
  });

  it('empate de restos: gana el que viene antes (el dueño ya ordena por monto)', () => {
    // 1/3 cada uno: 33 + 33 + 33 = 99, falta 1 y va al primero.
    expect(porcentajesEnteros([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it('el punto que falta va al resto MAYOR, no al monto mayor', () => {
    // 64,9 / 17,55 / 17,55 → 64 + 17 + 17 = 98; los dos restos mayores son los 0,9 y un 0,55.
    expect(porcentajesEnteros([6490, 1755, 1755])).toEqual([65, 18, 17]);
  });

  it('el ejemplo del diseño da 40 / 32 / 17 / 11', () => {
    expect(porcentajesEnteros([31000, 24550, 12800, 8650])).toEqual([40, 32, 17, 11]);
  });

  it('con total 0 no inventa porcentajes', () => {
    expect(porcentajesEnteros([])).toEqual([]);
    expect(porcentajesEnteros([0, 0])).toEqual([0, 0]);
  });
});
