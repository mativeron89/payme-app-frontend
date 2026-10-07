import { describe, expect, it } from 'vitest';
import {
  BORDES,
  ESQUINAS,
  MARCO_ENTERO,
  MINIMO_PX,
  PASO_TECLADO,
  minimoProporcional,
  moverAsa,
  moverConTecla,
  recortePixeles,
  type Marco,
} from './marcoDelRecorte';

/** El mínimo de una foto que se ve de 300×400 en pantalla. */
const MIN_X = MINIMO_PX / 300;
const MIN_Y = MINIMO_PX / 400;

const cerca = (m: Marco, esperado: Marco) => {
  for (const k of ['x0', 'y0', 'x1', 'y1'] as const) expect(m[k], k).toBeCloseTo(esperado[k], 10);
};

describe('D222 · el marco arranca en la foto entera', () => {
  it('MARCO_ENTERO son los bordes de la foto', () => {
    expect(MARCO_ENTERO).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it('🔴 sin tocar, es la foto entera: `null`, y se manda lo de siempre', () => {
    expect(recortePixeles(MARCO_ENTERO, 3024, 4032)).toBeNull();
  });

  it('las ocho zonas: cuatro esquinas y cuatro bordes', () => {
    expect(ESQUINAS).toHaveLength(4);
    expect(BORDES).toHaveLength(4);
    expect(new Set([...ESQUINAS, ...BORDES]).size).toBe(8);
  });
});

describe('D222 · moverAsa: la esquina mueve dos lados; el borde, uno', () => {
  it('cada esquina mueve los dos lados que toca', () => {
    cerca(moverAsa(MARCO_ENTERO, 'arriba-izquierda', 0.1, 0.2, MIN_X, MIN_Y), { x0: 0.1, y0: 0.2, x1: 1, y1: 1 });
    cerca(moverAsa(MARCO_ENTERO, 'arriba-derecha', -0.1, 0.2, MIN_X, MIN_Y), { x0: 0, y0: 0.2, x1: 0.9, y1: 1 });
    cerca(moverAsa(MARCO_ENTERO, 'abajo-izquierda', 0.1, -0.2, MIN_X, MIN_Y), { x0: 0.1, y0: 0, x1: 1, y1: 0.8 });
    cerca(moverAsa(MARCO_ENTERO, 'abajo-derecha', -0.1, -0.2, MIN_X, MIN_Y), { x0: 0, y0: 0, x1: 0.9, y1: 0.8 });
  });

  it('cada borde mueve sólo su lado, aunque el dedo vaya en diagonal', () => {
    cerca(moverAsa(MARCO_ENTERO, 'arriba', 0.3, 0.2, MIN_X, MIN_Y), { x0: 0, y0: 0.2, x1: 1, y1: 1 });
    cerca(moverAsa(MARCO_ENTERO, 'abajo', 0.3, -0.2, MIN_X, MIN_Y), { x0: 0, y0: 0, x1: 1, y1: 0.8 });
    cerca(moverAsa(MARCO_ENTERO, 'izquierda', 0.3, 0.2, MIN_X, MIN_Y), { x0: 0.3, y0: 0, x1: 1, y1: 1 });
    cerca(moverAsa(MARCO_ENTERO, 'derecha', -0.3, 0.2, MIN_X, MIN_Y), { x0: 0, y0: 0, x1: 0.7, y1: 1 });
  });

  it('🔴 el marco nunca sale de la foto', () => {
    expect(moverAsa(MARCO_ENTERO, 'arriba-izquierda', -0.5, -0.5, MIN_X, MIN_Y)).toEqual(MARCO_ENTERO);
    expect(moverAsa(MARCO_ENTERO, 'abajo-derecha', 0.5, 0.5, MIN_X, MIN_Y)).toEqual(MARCO_ENTERO);
    const corrido = { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 };
    expect(moverAsa(corrido, 'izquierda', -9, 0, MIN_X, MIN_Y).x0).toBe(0);
    expect(moverAsa(corrido, 'derecha', 9, 0, MIN_X, MIN_Y).x1).toBe(1);
    expect(moverAsa(corrido, 'arriba', 0, -9, MIN_X, MIN_Y).y0).toBe(0);
    expect(moverAsa(corrido, 'abajo', 0, 9, MIN_X, MIN_Y).y1).toBe(1);
  });

  it('🔴 el mínimo: el lado que se mueve se frena contra el opuesto, que no se mueve', () => {
    const m = moverAsa(MARCO_ENTERO, 'arriba-izquierda', 5, 5, MIN_X, MIN_Y);
    expect(m.x1).toBe(1);
    expect(m.y1).toBe(1);
    expect(m.x1 - m.x0).toBeCloseTo(MIN_X, 10);
    expect(m.y1 - m.y0).toBeCloseTo(MIN_Y, 10);
    const b = moverAsa(MARCO_ENTERO, 'derecha', -5, 0, MIN_X, MIN_Y);
    expect(b.x0).toBe(0);
    expect(b.x1).toBeCloseTo(MIN_X, 10);
  });

  it('🔴 desde el marco del comienzo: ir y volver con el dedo lo deja donde estaba', () => {
    const inicio = { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 };
    // Pasado del mínimo y de vuelta: el corrimiento total es cero.
    expect(moverAsa(inicio, 'abajo-derecha', 0, 0, MIN_X, MIN_Y)).toEqual(inicio);
    const ida = moverAsa(inicio, 'abajo-derecha', -2, -2, MIN_X, MIN_Y);
    expect(ida.x1 - ida.x0).toBeCloseTo(MIN_X, 10);
  });

  it('un corrimiento que no es un número no mueve nada', () => {
    expect(moverAsa(MARCO_ENTERO, 'arriba-izquierda', Number.NaN, Number.POSITIVE_INFINITY, MIN_X, MIN_Y)).toEqual(MARCO_ENTERO);
  });
});

describe('D222 · minimoProporcional: 64 px de pantalla en proporciones', () => {
  it('64 px de una foto que se ve de 320 px son 0,2', () => {
    expect(minimoProporcional(320)).toBeCloseTo(0.2, 10);
    expect(MINIMO_PX).toBe(64);
  });

  it('si la foto se ve más chica que el mínimo, el mínimo es la foto entera', () => {
    expect(minimoProporcional(40)).toBe(1);
    expect(minimoProporcional(0)).toBe(1);
    expect(minimoProporcional(Number.NaN)).toBe(1);
  });

  it('con el mínimo en la foto entera, ninguna esquina se mueve hacia adentro', () => {
    expect(moverAsa(MARCO_ENTERO, 'arriba-izquierda', 0.3, 0.3, 1, 1)).toEqual(MARCO_ENTERO);
    expect(moverAsa(MARCO_ENTERO, 'abajo-derecha', -0.3, -0.3, 1, 1)).toEqual(MARCO_ENTERO);
  });
});

describe('D222 · moverConTecla: las flechas mueven el asa con foco un 2%', () => {
  it('cada flecha en su dirección', () => {
    expect(PASO_TECLADO).toBe(0.02);
    cerca(moverConTecla(MARCO_ENTERO, 'arriba-izquierda', 'ArrowRight', MIN_X, MIN_Y)!, { x0: 0.02, y0: 0, x1: 1, y1: 1 });
    cerca(moverConTecla(MARCO_ENTERO, 'arriba-izquierda', 'ArrowDown', MIN_X, MIN_Y)!, { x0: 0, y0: 0.02, x1: 1, y1: 1 });
    cerca(moverConTecla(MARCO_ENTERO, 'abajo-derecha', 'ArrowLeft', MIN_X, MIN_Y)!, { x0: 0, y0: 0, x1: 0.98, y1: 1 });
    cerca(moverConTecla(MARCO_ENTERO, 'abajo-derecha', 'ArrowUp', MIN_X, MIN_Y)!, { x0: 0, y0: 0, x1: 1, y1: 0.98 });
  });

  it('una flecha que no mueve ese asa, u otra tecla, no hace nada (`null`)', () => {
    expect(moverConTecla(MARCO_ENTERO, 'arriba', 'ArrowLeft', MIN_X, MIN_Y)).toBeNull();
    expect(moverConTecla(MARCO_ENTERO, 'izquierda', 'ArrowDown', MIN_X, MIN_Y)).toBeNull();
    expect(moverConTecla(MARCO_ENTERO, 'arriba-izquierda', 'Enter', MIN_X, MIN_Y)).toBeNull();
    expect(moverConTecla(MARCO_ENTERO, 'arriba-izquierda', 'Tab', MIN_X, MIN_Y)).toBeNull();
  });

  it('contra el borde de la foto, la flecha no lo saca', () => {
    expect(moverConTecla(MARCO_ENTERO, 'arriba-izquierda', 'ArrowLeft', MIN_X, MIN_Y)).toEqual(MARCO_ENTERO);
  });
});

describe('D222 · recortePixeles: el marco en píxeles de la foto ya orientada', () => {
  it('🔴 un ticket angosto en el medio de una foto vertical de 12 MP', () => {
    const marco = { x0: 0.35, y0: 0.125, x1: 0.65, y1: 0.875 };
    expect(recortePixeles(marco, 3024, 4032)).toEqual({ x: 1058, y: 504, ancho: 908, alto: 3024 });
  });

  it('🔴 vuelto a los bordes (por redondeo) es la foto entera otra vez: `null`', () => {
    expect(recortePixeles({ x0: 0.0001, y0: 0, x1: 0.9999, y1: 1 }, 3024, 4032)).toBeNull();
  });

  it('un lado contra el borde: el rectángulo llega justo al borde, sin pasarse', () => {
    const r = recortePixeles({ x0: 0.5, y0: 0, x1: 1, y1: 1 }, 3024, 4032)!;
    expect(r).toEqual({ x: 1512, y: 0, ancho: 1512, alto: 4032 });
    expect(r.x + r.ancho).toBe(3024);
  });

  it('siempre dentro de la foto y de al menos 1 px, aunque el marco llegue raro', () => {
    for (const marco of [
      { x0: 1, y0: 1, x1: 1, y1: 1 },
      { x0: 0.9, y0: 0.9, x1: 0.1, y1: 0.1 },
      { x0: -1, y0: -1, x1: 2, y1: 0.5 },
      { x0: Number.NaN, y0: 0, x1: 0.5, y1: 0.5 },
    ]) {
      const r = recortePixeles(marco, 400, 300);
      if (!r) continue;
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.ancho).toBeGreaterThanOrEqual(1);
      expect(r.alto).toBeGreaterThanOrEqual(1);
      expect(r.x + r.ancho).toBeLessThanOrEqual(400);
      expect(r.y + r.alto).toBeLessThanOrEqual(300);
      for (const v of [r.x, r.y, r.ancho, r.alto]) expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('medidas inválidas: `null`', () => {
    expect(recortePixeles({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 }, 0, 100)).toBeNull();
  });
});
