import { describe, expect, it } from 'vitest';
import { GRUPOS_CONOCIDOS } from '../api/ingredientes';
import { MOMENTOS } from '../api/momentos';
import {
  COLORES_DE_COCINA,
  COLORES_DE_GRUPO,
  COLORES_DE_MOMENTO,
  colorDeCocina,
  colorDeGrupo,
  colorDeMomento,
} from './coloresDeEstadisticas';

/** LEEME §5 del paquete de Claude Design 0.261 (D479/D482), tal cual. */
describe('D479/D482 · colores FIJOS por clave en Estadísticas', () => {
  it('cocinas: los cinco del paquete, más las seis de D496 (App Backend 2.198.0)', () => {
    expect(COLORES_DE_COCINA).toEqual({
      italian: '#12A5B4', japanese: '#101E3B', mexican: '#0A7B80', cafe: '#475569',
      spanish: '#B4462F', argentinian: '#0A6C85', peruvian: '#C2410C', chinese: '#92620A', american: '#047857', seafood: '#5B4B8A',
      other: '#7D8CA1',
    });
  });

  it('una cocina desconocida, vacía o ausente toma el color de Otros', () => {
    for (const c of ['thai', '', null, undefined, 'toString', '__proto__']) {
      expect(colorDeCocina(c as string | null | undefined), String(c)).toBe('#7D8CA1');
    }
  });

  it('la misma cocina da el mismo color sin importar el orden ni la pantalla', () => {
    expect(['cafe', 'italian', 'japanese'].map(colorDeCocina)).toEqual(['#475569', '#12A5B4', '#101E3B']);
    expect(['japanese', 'italian', 'cafe'].map(colorDeCocina)).toEqual(['#101E3B', '#12A5B4', '#475569']);
  });

  it('ingredientes: un color por cada grupo conocido, los del paquete; uno desconocido, el de Otros', () => {
    expect(Object.keys(COLORES_DE_GRUPO).sort()).toEqual([...GRUPOS_CONOCIDOS].sort());
    expect(COLORES_DE_GRUPO).toEqual({
      meat: '#B4462F', seafood: '#12A5B4', pasta: '#92620A', veggie: '#047857',
      dessert: '#0A6C85', drinks: '#0A7B80', alcohol: '#101E3B', other: '#7D8CA1',
    });
    expect(colorDeGrupo('vegan')).toBe('#7D8CA1');
  });

  it('momentos: los cuatro del paquete', () => {
    expect(Object.keys(COLORES_DE_MOMENTO)).toEqual([...MOMENTOS]);
    expect(MOMENTOS.map(colorDeMomento)).toEqual(['#92620A', '#12A5B4', '#C2410C', '#101E3B']);
  });
});
