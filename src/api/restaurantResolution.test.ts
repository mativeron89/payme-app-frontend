import { describe, expect, it } from 'vitest';
import { decodeRestaurantResolution, resolutionRequest } from './restaurantResolution';

const UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('restaurants/resolve · contrato privado', () => {
  it('manda identidad del proveedor y siempre un fallback UUID estable', () => {
    const first = resolutionRequest({ name: 'Tacos El Güero', rfc: 'TEG010101AB1' }, UUID);
    const retry = resolutionRequest({ name: 'Tacos El Güero', rfc: 'TEG010101AB1' }, UUID);
    expect(first).toEqual(retry);
    expect(first).toEqual({
      name: 'Tacos El Güero',
      rfc: 'TEG010101AB1',
      fallback_key: UUID,
    });
  });

  it('sin merchant usa fallback real y nunca acepta vacío o pseudo UUID', () => {
    expect(resolutionRequest(undefined, UUID)).toEqual({ fallback_key: UUID });
    for (const invalid of ['', 'ticket-1', '00000000-0000-0000-0000-000000000000']) {
      expect(() => resolutionRequest(undefined, invalid)).toThrow('restaurant_resolution_fallback_invalid');
    }
  });

  it('decodifica sólo la proyección pública y record_only booleano', () => {
    const valid = {
      restaurant: { id: UUID, name: 'Tacos El Güero', category: 'other', address: null },
      record_only: true,
    };
    expect(decodeRestaurantResolution(valid)).toEqual(valid);
    for (const malformed of [
      { ...valid, record_only: 'true' },
      { ...valid, restaurant: { ...valid.restaurant, rfc: 'TEG010101AB1' } },
      { ...valid, owner_id: UUID },
      { ...valid, restaurant: { ...valid.restaurant, id: '' } },
    ]) {
      expect(() => decodeRestaurantResolution(malformed)).toThrow('contract_response_invalid:restaurants/resolve');
    }
  });
});
