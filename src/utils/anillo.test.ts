import { describe, expect, it } from 'vitest';
import {
  CIRCUNFERENCIA,
  COLORES_ANILLO,
  CORTE_ANILLO,
  colorDeFila,
  porcentajesEnteros,
  porcionesDelAnillo,
} from './anillo';

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

describe('AF-26 · porciones del anillo', () => {
  it('una categoría: anillo entero, sin corte', () => {
    const p = porcionesDelAnillo([118000]);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ color: COLORES_ANILLO[0], trazo: CIRCUNFERENCIA, hueco: 0, desde: 0 });
  });

  it('cinco categorías: cinco porciones con los cinco colores, cada una con su corte', () => {
    const montos = [5, 4, 3, 2, 1];
    const p = porcionesDelAnillo(montos);
    expect(p.map((x) => x.color)).toEqual([...COLORES_ANILLO]);
    // Cada porción: su parte de la circunferencia menos el corte; el hueco completa.
    p.forEach((x, i) => {
      const parte = (montos[i] / 15) * CIRCUNFERENCIA;
      expect(x.trazo).toBeCloseTo(parte - CORTE_ANILLO, 6);
      expect(x.trazo + x.hueco).toBeCloseTo(CIRCUNFERENCIA, 6);
    });
    // Arrancan donde terminó la anterior.
    expect(p[1].desde).toBeCloseTo(-(5 / 15) * CIRCUNFERENCIA, 6);
    expect(p[4].desde).toBeCloseTo(-(14 / 15) * CIRCUNFERENCIA, 6);
  });

  it('siete categorías: la quinta porción junta de la quinta en adelante, con el quinto color', () => {
    const montos = [31000, 24550, 12800, 8650, 6200, 4400, 2100];
    const p = porcionesDelAnillo(montos);
    expect(p).toHaveLength(5);
    expect(p[4].color).toBe(COLORES_ANILLO[4]);
    const total = suma(montos);
    expect(p[4].trazo).toBeCloseTo(((6200 + 4400 + 2100) / total) * CIRCUNFERENCIA - CORTE_ANILLO, 6);
    // …y la lista sigue pintando cada fila: de la quinta en adelante, el quinto color.
    expect([4, 5, 6].map(colorDeFila)).toEqual([COLORES_ANILLO[4], COLORES_ANILLO[4], COLORES_ANILLO[4]]);
    expect(colorDeFila(0)).toBe(COLORES_ANILLO[0]);
  });

  it('el ejemplo del diseño: 133,6 de trazo y la segunda arranca en −136,6', () => {
    const p = porcionesDelAnillo([31000, 24550, 12800, 8650]);
    expect(Number(p[0].trazo.toFixed(1))).toBe(133.6);
    expect(Number(p[1].desde.toFixed(1))).toBe(-136.6);
  });

  it('sin monto no hay anillo', () => {
    expect(porcionesDelAnillo([])).toEqual([]);
    expect(porcionesDelAnillo([0])).toEqual([]);
  });
});
