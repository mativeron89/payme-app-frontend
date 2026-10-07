import { describe, expect, it } from 'vitest';
import { ocrResponse, ticketTotalsOf } from './contractResponses';

/**
 * D209 · `ticket_totals` de App Backend 2.156.0
 * (`contract-mirror/contract/ocr-merchant-v2.json`): subtotal e IVA impresos,
 * sólo la pareja que cierra EXACTO con el total impreso. El cliente replica el
 * control del dueño (`invariant`): si no cuadra, la respuesta se rechaza.
 */
const base = {
  contract_version: 2,
  items: [{ name: 'Taco', category: 'mexican', price_cents: 116000, quantity: 1 }],
  total_cents: 116000,
  total_detected_cents: 116000,
  warnings: [],
  mock: false,
};

describe('OCR v2 · ticket_totals', () => {
  it('🔴 acepta la pareja que cierra exacto: subtotal + IVA = total impreso', () => {
    const leido = ocrResponse({ ...base, ticket_totals: { subtotal_cents: 100000, tax_cents: 16000 } });
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 100000, tax_cents: 16000 });
  });

  it('IVA cero es válido; subtotal cero no', () => {
    expect(ocrResponse({ ...base, ticket_totals: { subtotal_cents: 116000, tax_cents: 0 } }).ticket_totals)
      .toEqual({ subtotal_cents: 116000, tax_cents: 0 });
    expect(() => ocrResponse({ ...base, total_detected_cents: 0, ticket_totals: { subtotal_cents: 0, tax_cents: 0 } }))
      .toThrow('contract_response_invalid');
  });

  it('sin la clave, la respuesta queda como antes', () => {
    expect('ticket_totals' in ocrResponse(base)).toBe(false);
  });

  it.each([
    ['no cuadra por un centavo', { ticket_totals: { subtotal_cents: 100000, tax_cents: 15999 } }],
    ['sin total impreso', { total_detected_cents: undefined, ticket_totals: { subtotal_cents: 100000, tax_cents: 16000 } }],
    ['una clave de más', { ticket_totals: { subtotal_cents: 100000, tax_cents: 16000, total_cents: 116000 } }],
    ['una clave de menos', { ticket_totals: { subtotal_cents: 116000 } }],
    ['decimales', { ticket_totals: { subtotal_cents: 100000.5, tax_cents: 15999.5 } }],
    ['IVA negativo', { total_detected_cents: 100000, ticket_totals: { subtotal_cents: 110000, tax_cents: -10000 } }],
    ['texto', { ticket_totals: { subtotal_cents: '100000', tax_cents: 16000 } }],
    ['no es objeto', { ticket_totals: [100000, 16000] }],
    ['null', { ticket_totals: null }],
  ])('🔴 rechaza la respuesta si `ticket_totals` %s', (_caso, extra) => {
    const body: Record<string, unknown> = { ...base, ...extra };
    if (body.total_detected_cents === undefined) delete body.total_detected_cents;
    expect(() => ocrResponse(body)).toThrow('contract_response_invalid');
  });

  it('🔴 en v1 no se negocia: la clave se descarta y no llega a la app', () => {
    // El decoder v1 tolera claves desconocidas desde siempre (compatibilidad):
    // no se vuelve más estricto acá, pero tampoco expone lo que no negoció.
    const { contract_version: _v, ...v1 } = base;
    const leido = ocrResponse({ ...v1, ticket_totals: { subtotal_cents: 100000, tax_cents: 16000 } });
    expect('ticket_totals' in leido).toBe(false);
  });

  it('ticketTotalsOf distingue ausente (undefined) de inválido (null)', () => {
    expect(ticketTotalsOf(undefined, 116000)).toBeUndefined();
    expect(ticketTotalsOf({ subtotal_cents: 100000, tax_cents: 16000 }, 116001)).toBeNull();
    expect(ticketTotalsOf({ subtotal_cents: 100000, tax_cents: 16000 }, 116000))
      .toEqual({ subtotal_cents: 100000, tax_cents: 16000 });
  });
});
