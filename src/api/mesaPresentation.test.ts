import { describe, expect, it } from 'vitest';
import {
  availableDefaultDenominators,
  canLabelPrivateUnknownRestaurant,
  denominatorBps,
  initialDenominator,
  originalParticipants,
  validateRestaurantLabel,
} from './mesaPresentation';

describe('mesa-presentation-v1 · N original', () => {
  it('acepta sólo enteros 1..20 y nunca rellena históricos', () => {
    expect([1, 2, 20].map(originalParticipants)).toEqual([1, 2, 20]);
    for (const value of [null, undefined, 0, 21, 2.5, '4']) expect(originalParticipants(value)).toBeNull();
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
