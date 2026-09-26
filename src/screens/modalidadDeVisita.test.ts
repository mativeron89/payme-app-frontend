import { describe, expect, it } from 'vitest';
import { modalidadDeVisita } from './TusRestaurantesScreen';

const t = (s: string) => s;

/**
 * Decisión 86 · el rótulo de la modalidad de una visita. Hoy el decodificador
 * de «Tus restaurantes» es estricto (decisión del Bibliotecario): sólo deja
 * pasar 'consumo' e 'igual'. La pantalla, además, nunca adivina un rótulo.
 */
describe('decisión 86 · modalidadDeVisita', () => {
  it('«igual» → «Partes iguales»; «consumo» → «Por consumo»', () => {
    expect(modalidadDeVisita('igual', t)).toBe('Partes iguales');
    expect(modalidadDeVisita('consumo', t)).toBe('Por consumo');
  });
  it('cualquier otro valor no se nombra', () => {
    for (const raro of [undefined, null, '', 'Igual', 'partes_iguales', 1]) {
      expect(modalidadDeVisita(raro, t), String(raro)).toBeNull();
    }
  });
});
