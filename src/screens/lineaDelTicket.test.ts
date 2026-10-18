import { describe, expect, it } from 'vitest';
import { precioDeLinea, totalDeLinea } from './lineaDelTicket';

/** D360 · P04 · D371 · vacío no es $0; «0» es un plato de $0. Valores escritos a mano. */
describe('precioDeLinea', () => {
  it('🔴 vacío (o sólo espacios) es una línea incompleta, no $0', () => {
    expect(precioDeLinea('')).toBeNull();
    expect(precioDeLinea('   ')).toBeNull();
  });

  it('🔴 «0» es un plato válido de $0 (D371)', () => {
    expect(precioDeLinea('0')).toBe(0);
    expect(precioDeLinea('0.00')).toBe(0);
    expect(precioDeLinea('0.0')).toBe(0);
  });

  it('un precio con o sin centavos', () => {
    expect(precioDeLinea('195')).toBe(19500);
    expect(precioDeLinea('97.5')).toBe(9750);
    expect(precioDeLinea('97.50')).toBe(9750);
  });

  it('ilegible es incompleto, nunca $0', () => {
    expect(precioDeLinea('.')).toBeNull();
    expect(precioDeLinea('5.')).toBeNull();
    expect(precioDeLinea('1.234')).toBeNull();
    expect(precioDeLinea('1.2.3')).toBeNull();
  });
});

describe('totalDeLinea', () => {
  it('precio × cantidad; con $0, $0', () => {
    expect(totalDeLinea('70', 2)).toBe(14000);
    expect(totalDeLinea('0', 3)).toBe(0);
  });

  it('incompleta si el precio falta o la cantidad no es un entero ≥ 1', () => {
    expect(totalDeLinea('', 1)).toBeNull();
    expect(totalDeLinea('70', 0)).toBeNull();
    expect(totalDeLinea('70', 1.5)).toBeNull();
  });

  it('sin desbordar: más allá del entero seguro es incompleta', () => {
    // 90071992547409.91 × 2 pasa de Number.MAX_SAFE_INTEGER (9007199254740991).
    expect(totalDeLinea('90071992547409.91', 2)).toBeNull();
  });
});
