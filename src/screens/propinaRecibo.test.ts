import { describe, expect, it } from 'vitest';
import { rotuloPropina } from './propinaRecibo';

describe('rótulo de propina del comprobante · lo que no se sabe no se nombra', () => {
  it('con las dos cosas, trae porcentaje y nombre', () => {
    expect(rotuloPropina({ pct: 10, nombre: 'Ana' })).toEqual({
      clave: 'Propina ({0}% · para {1})',
      args: [10, 'Ana'],
    });
  });

  it('🔴 monto libre: NO se inventa un porcentaje', () => {
    expect(rotuloPropina({ pct: null, nombre: 'Ana' })).toEqual({
      clave: 'Propina (para {0})',
      args: ['Ana'],
    });
  });

  it('🔴 sin destinatario elegido: NO se inventa un nombre', () => {
    expect(rotuloPropina({ pct: 15, nombre: null })).toEqual({
      clave: 'Propina ({0}%)',
      args: [15],
    });
  });

  it('sin ninguno de los dos, queda el rótulo pelado — nunca «para —» ni «0%»', () => {
    expect(rotuloPropina({ pct: null, nombre: null })).toEqual({ clave: 'Propina', args: [] });
  });

  it('🔴 el 0% es un porcentaje ELEGIDO y se dice, no se confunde con «no eligió»', () => {
    // La fila entera se oculta con tipCents === 0, así que este caso sólo
    // llega si alguien deja 0% con un monto custom encima. Igual: 0 no es null.
    expect(rotuloPropina({ pct: 0, nombre: 'Ana' }).args).toEqual([0, 'Ana']);
  });
});
