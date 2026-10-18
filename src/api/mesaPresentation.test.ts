import { describe, expect, it } from 'vitest';
import {
  availableDefaultDenominators,
  canLabelPrivateUnknownRestaurant,
  denominatorBps,
  denominatorFromBps,
  initialDenominator,
  MAX_PERSONAS,
  originalParticipants,
  TOPE_PORCION,
  topePorcion,
  validateRestaurantLabel,
} from './mesaPresentation';

describe('mesa-presentation-v1 · N original', () => {
  it('🔴 D375 · acepta sólo enteros 1..50 (antes 1..20) y nunca rellena históricos', () => {
    // Valores escritos a mano: el contrato espejado dice «Integer1..50 (1..20 until v2.187.0, D375) or null».
    expect(MAX_PERSONAS).toBe(50);
    expect([1, 2, 20, 21, 49, 50].map(originalParticipants)).toEqual([1, 2, 20, 21, 49, 50]);
    for (const value of [null, undefined, 0, 51, 2.5, '4', -1]) expect(originalParticipants(value)).toBeNull();
  });

  it('🔴 D375 · la porción sigue en 20: con N = 50, un plato se parte en a lo sumo 20 y nada lanza', () => {
    expect(TOPE_PORCION).toBe(20);
    expect([1, 4, 20, 21, 50].map(topePorcion)).toEqual([1, 4, 20, 20, 20]);
    expect(denominatorBps(20)).toBe(500);
    expect(() => denominatorBps(21)).toThrow('fraction_denominator_invalid');
    // Sin el tope, el recorrido de 1..50 llegaba a 21 y `denominatorBps` lanzaba.
    expect(initialDenominator(50, 10000)).toBe(1);
    expect(initialDenominator(50, 500)).toBe(20);
    expect(initialDenominator(50, 499)).toBeNull();
    expect(initialDenominator(50, 0)).toBeNull();
    expect(denominatorFromBps(500, 50)).toBe(20);
    expect(denominatorFromBps(3333, 50)).toBe(3);
    for (const bps of [476, 6667, 7500, 0]) expect(denominatorFromBps(bps, 50), String(bps)).toBeNull();
    expect(availableDefaultDenominators(50, 10000)).toEqual([1, 2, 3, 4]);
  });

  it('filtra defaults por N y por disponibilidad', () => {
    expect(availableDefaultDenominators(2, 10000)).toEqual([1, 2]);
    expect(availableDefaultDenominators(4, 5000)).toEqual([2, 3, 4]);
    expect(initialDenominator(7, 1428)).toBe(7);
    expect(initialDenominator(6, 1400)).toBeNull();
    expect(denominatorBps(7)).toBe(1428);
  });
});

describe('mesa-presentation-v1 · etiqueta privada', () => {
  it('sólo habilita fallback privado sin QR, nombre OCR ni RFC', () => {
    const base = {
      hasRestaurantFromQr: false,
      restaurantName: 'Restaurante sin identificar',
      ocrName: undefined,
      ocrRfc: undefined,
    };
    expect(canLabelPrivateUnknownRestaurant(base)).toBe(true);
    expect(canLabelPrivateUnknownRestaurant({ ...base, hasRestaurantFromQr: true })).toBe(false);
    expect(canLabelPrivateUnknownRestaurant({ ...base, restaurantName: 'Restaurante verificado' })).toBe(false);
    expect(canLabelPrivateUnknownRestaurant({ ...base, ocrName: 'Café' })).toBe(false);
    expect(canLabelPrivateUnknownRestaurant({ ...base, ocrRfc: 'TEG010101AB1' })).toBe(false);
  });

  it('normaliza NFC/espacios y conserva vacío como omitido', () => {
    expect(validateRestaurantLabel('  Cafe\u0301   del   Centro  ')).toEqual({
      ok: true,
      normalized: 'Café del Centro',
    });
    expect(validateRestaurantLabel('   ')).toEqual({ ok: true, normalized: null });
  });

  it('rechaza controles y los dos techos contractuales', () => {
    expect(validateRestaurantLabel('Café\nCentro')).toEqual({ ok: false, reason: 'control_character' });
    expect(validateRestaurantLabel('a'.repeat(401))).toEqual({ ok: false, reason: 'raw_too_long' });
    expect(validateRestaurantLabel(` ${'a'.repeat(201)} `)).toEqual({ ok: false, reason: 'normalized_too_long' });
  });
});
