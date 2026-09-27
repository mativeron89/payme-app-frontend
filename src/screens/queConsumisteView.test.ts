import { describe, expect, it } from 'vitest';
import { PORCIONES, etiquetaPorcion, porcionesDisponibles, textoPlatos } from './queConsumisteView';

/** AF-QUE-CONSUMISTE · decisión 90 y reglas 4 del diseño de Claude Design. */
const t = (s: string, ...a: unknown[]) => s.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)]));

describe('porcionesDisponibles · regla 4 del diseño y definición 2 de la decisión 90', () => {
  it('sólo Entero, ½, ⅓ y ¼: nada de ⅔, ¾ ni «Otro»', () => {
    expect(PORCIONES).toEqual([1, 2, 3, 4]);
    expect(porcionesDisponibles(8, 10000)).toEqual([1, 2, 3, 4]);
  });

  it('las limita la cantidad de personas: con 4, las cuatro; con 3, sin ¼; con 2, Entero y ½', () => {
    expect(porcionesDisponibles(4, 10000)).toEqual([1, 2, 3, 4]);
    expect(porcionesDisponibles(3, 10000)).toEqual([1, 2, 3]);
    expect(porcionesDisponibles(2, 10000)).toEqual([1, 2]);
    expect(porcionesDisponibles(1, 10000)).toEqual([1]);
  });

  it('las limita lo que queda del plato: en un «Queda ½» no aparece Entero', () => {
    expect(porcionesDisponibles(4, 5000)).toEqual([2, 3, 4]);
    expect(porcionesDisponibles(4, 3334)).toEqual([3, 4]);
    expect(porcionesDisponibles(4, 2500)).toEqual([4]);
    expect(porcionesDisponibles(4, 2000)).toEqual([]);
    expect(porcionesDisponibles(4, 0)).toEqual([]);
  });

  it('sin el dato de personas no limita por personas', () => {
    expect(porcionesDisponibles(null, 10000)).toEqual([1, 2, 3, 4]);
    expect(porcionesDisponibles(null, 5000)).toEqual([2, 3, 4]);
  });

  it('un restante que no es un entero de 0 a 10000 no ofrece nada', () => {
    for (const malo of [Number.NaN, -1, 10001, 5000.5]) {
      expect(porcionesDisponibles(4, malo), String(malo)).toEqual([]);
    }
  });
});

describe('etiquetaPorcion · la píldora', () => {
  it('Entero con palabra; el resto con su glifo', () => {
    expect(etiquetaPorcion(10000, t)).toBe('Entero');
    expect(etiquetaPorcion(5000, t)).toBe('½');
    expect(etiquetaPorcion(3333, t)).toBe('⅓');
    expect(etiquetaPorcion(2500, t)).toBe('¼');
  });

  it('una porción vieja ya guardada (⅔, ¾) se sigue mostrando bien', () => {
    expect(etiquetaPorcion(6667, t)).toBe('⅔');
    expect(etiquetaPorcion(7500, t)).toBe('¾');
  });
});

describe('textoPlatos · «Mi parte · N platos»', () => {
  it('singular y plural', () => {
    expect(textoPlatos(1, t)).toBe('1 plato');
    expect(textoPlatos(0, t)).toBe('0 platos');
    expect(textoPlatos(3, t)).toBe('3 platos');
  });
});
