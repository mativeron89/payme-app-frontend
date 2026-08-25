import { describe, expect, it } from 'vitest';
import { decodeMovementDetailResponse } from './movementDetail';
import { mockMovement } from './mock/mockApi';

const valid = () => ({
  id: '11111111-1111-4111-8111-111111111111',
  restaurant: { name: 'La Parolaccia', category: 'italian' },
  mesa: { code: 'PA-8712' },
  date: '2026-08-25T05:00:00.000Z',
  payment_type: 'card',
  method: { brand: 'visa', bank: 'Santander', last_four: '4532' },
  items: [{
    name: 'Tagliatelle', price_cents: 19500, quantity: 1, category: 'plato',
    amount_cents: 9750, fraction_bps: 5000, declared_fraction_bps: null as number | null,
  }],
  items_amount_cents: 9750,
  tip_amount_cents: 975,
  gross_amount_cents: 10725,
  fee_amount_cents: 100,
  status: 'succeeded',
});

describe('decodeMovementDetailResponse', () => {
  it('acepta centavos enteros y el par importe/fracción confirmado', () => {
    expect(decodeMovementDetailResponse(valid()).items[0]).toMatchObject({
      amount_cents: 9750, fraction_bps: 5000,
    });
  });

  it.each([
    ['centavos negativos', { items_amount_cents: -1 }],
    ['centavos fraccionarios', { tip_amount_cents: 1.5 }],
    ['gross no reconciliado', { gross_amount_cents: 9999 }],
    ['campo desconocido', { surprise: true }],
  ])('rechaza %s', (_name, patch) => {
    expect(() => decodeMovementDetailResponse({ ...valid(), ...patch })).toThrow('movement_detail_response_malformed');
  });

  it.each([2500, 3333, 5000, 6667, 7500, 10000] as const)(
    'acepta la fracción declarada contractual %s sin convertirla en dinero',
    (declaredFractionBps) => {
      const input = valid();
      input.items[0] = {
        ...input.items[0], amount_cents: null as never, fraction_bps: null as never,
        declared_fraction_bps: declaredFractionBps,
      };
      expect(decodeMovementDetailResponse(input).items[0]).toMatchObject({
        amount_cents: null, fraction_bps: null, declared_fraction_bps: declaredFractionBps,
      });
    },
  );

  it('acepta históricos de igualdad sin declaración y no inventa una', () => {
    const input = valid();
    input.items[0] = {
      ...input.items[0], amount_cents: null as never, fraction_bps: null as never,
      declared_fraction_bps: null,
    };
    expect(decodeMovementDetailResponse(input).items[0]?.declared_fraction_bps).toBeNull();
  });

  it('rechaza importe sin fracción o fracción sin importe', () => {
    const input = valid();
    input.items[0] = { ...input.items[0], fraction_bps: null as never };
    expect(() => decodeMovementDetailResponse(input)).toThrow('movement_detail_response_malformed');
  });

  it.each([0, 3334, 6666, 7501, 10001])('rechaza declared_fraction_bps no contractual: %s', (value) => {
    const input = valid();
    input.items[0] = {
      ...input.items[0], amount_cents: null as never, fraction_bps: null as never,
      declared_fraction_bps: value,
    };
    expect(() => decodeMovementDetailResponse(input)).toThrow('movement_detail_response_malformed');
  });

  it('rechaza mezclar una fracción cobrada con otra declarada', () => {
    const input = valid();
    input.items[0] = { ...input.items[0], declared_fraction_bps: 5000 };
    expect(() => decodeMovementDetailResponse(input)).toThrow('movement_detail_response_malformed');
  });

  it('el mock falla igual para un id ajeno o inexistente: nunca filtra otro detalle', async () => {
    await expect(mockMovement('99999999-9999-4999-8999-999999999999'))
      .rejects.toMatchObject({ status: 404, message: 'movement_not_found' });
  });
});
