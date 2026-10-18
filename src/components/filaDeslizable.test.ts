import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANCHO_ELIMINAR,
  MINIMO_RAPIDO,
  PAUSA_MS,
  VELOCIDAD_RAPIDA,
  decidirAlSoltar,
  velocidadAlSoltar,
  velocidadDe,
} from './FilaDeslizable';

/**
 * D360-8 · qué hace la tarjeta al soltarla (o si el navegador cancela el
 * gesto). Los valores esperados van escritos a mano, con la cuenta al lado:
 * botón de 96 → la mitad es 48; un tercio, 32; rápido es 0.4 px/ms.
 */
describe('decidirAlSoltar', () => {
  it('las constantes son las que dice el comentario', () => {
    expect(ANCHO_ELIMINAR).toBe(96);
    expect(MINIMO_RAPIDO).toBe(32);
    expect(VELOCIDAD_RAPIDA).toBe(0.4);
  });

  it('despacio: pasada la mitad (−48) abre; en la mitad o antes, cierra (como antes de D360)', () => {
    expect(decidirAlSoltar(-49, 0)).toBe('abrir');
    expect(decidirAlSoltar(-96, 0)).toBe('abrir');
    expect(decidirAlSoltar(-48, 0)).toBe('cerrar');
    expect(decidirAlSoltar(-30, 0)).toBe('cerrar');
    expect(decidirAlSoltar(0, 0)).toBe('cerrar');
  });

  it('🔴 rápido a la izquierda abre aunque no llegue a la mitad, si se corrió al menos un tercio (−32)', () => {
    expect(decidirAlSoltar(-32, -0.4)).toBe('abrir');
    expect(decidirAlSoltar(-40, -2)).toBe('abrir');
    // Un roce rápido de menos de un tercio no abre.
    expect(decidirAlSoltar(-31, -2)).toBe('cerrar');
    // Apenas por debajo de rápido, manda la mitad.
    expect(decidirAlSoltar(-40, -0.39)).toBe('cerrar');
  });

  it('rápido a la derecha cierra, aunque esté pasada la mitad', () => {
    expect(decidirAlSoltar(-80, 0.4)).toBe('cerrar');
    expect(decidirAlSoltar(-96, 3)).toBe('cerrar');
    // Despacio a la derecha, pasada la mitad, sigue abierta.
    expect(decidirAlSoltar(-80, 0.1)).toBe('abrir');
  });
});

describe('velocidadDe', () => {
  it('es la distancia entre la primera y la última muestra sobre el tiempo entre ellas', () => {
    // 40 px a la izquierda en 20 ms = −2 px/ms.
    expect(velocidadDe([{ x: 200, t: 1000 }, { x: 190, t: 1010 }, { x: 160, t: 1020 }])).toBe(-2);
    // 30 px a la izquierda en 240 ms = −0.125 px/ms.
    expect(velocidadDe([{ x: 200, t: 0 }, { x: 170, t: 240 }])).toBe(-0.125);
  });

  it('con menos de dos muestras, o sin tiempo entre ellas, es 0', () => {
    expect(velocidadDe([])).toBe(0);
    expect(velocidadDe([{ x: 10, t: 5 }])).toBe(0);
    expect(velocidadDe([{ x: 10, t: 5 }, { x: 0, t: 5 }])).toBe(0);
  });
});

describe('velocidadAlSoltar', () => {
  it('la pausa es de 60 ms', () => {
    expect(PAUSA_MS).toBe(60);
  });

  it('🔴 un soltar un cuadro después del último movimiento no frena el gesto (medido en Chromium: 16,7 ms)', () => {
    // Dos tramos de 20 px: 40 px en 20 ms = −2 px/ms; el soltar 16,7 ms después no cuenta.
    const muestras = [{ x: 200, t: 1000 }, { x: 180, t: 1003.3 }, { x: 160, t: 1020 }];
    expect(velocidadAlSoltar(muestras, 1036.7)).toBe(-2);
  });

  it('si el dedo se quedó quieto más de 60 ms antes de soltar, la velocidad es 0', () => {
    const muestras = [{ x: 200, t: 1000 }, { x: 160, t: 1020 }];
    expect(velocidadAlSoltar(muestras, 1081)).toBe(0);
    expect(velocidadAlSoltar(muestras, 1080)).toBe(-2);
  });

  it('sin muestras, 0', () => {
    expect(velocidadAlSoltar([], 5)).toBe(0);
  });
});

describe('el ancho del botón rojo', () => {
  it('🔴 el CSS de .deslizable-eliminar mide lo mismo que ANCHO_ELIMINAR (una sola medida, D360-8)', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    const bloque = /\n\.deslizable-eliminar \{([^}]*)\}/.exec(css);
    expect(bloque, 'falta la regla .deslizable-eliminar').not.toBeNull();
    const anchos = [...bloque![1]!.matchAll(/(?:^|\n)\s*width:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(anchos).toEqual([`${ANCHO_ELIMINAR}px`]);
  });
});
