import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateMesaRequest } from './types';
import { ocrResponse, ticketAdjustmentsOf } from './contractResponses';

/**
 * D218 · `ticket_adjustments` de App Backend 2.164.0, con las reglas del dueño
 * (`ajustesDelTicket`, `totalesConAjustes` y la invariante de `respuestaOcr` en
 * `contract-mirror/services/ocrResponseContract.js`). Lo que no cumple se
 * rechaza.
 */
const items = [{ name: 'Taco', category: 'mexican', price_cents: 84000, quantity: 1 }];
const v2 = { contract_version: 2, items, total_cents: 84000, warnings: ['total_mismatch'], mock: false };
const desc = (amount_cents: number) => ({ kind: 'discount', amount_cents });

describe('OCR · ticket_adjustments', () => {
  it('🔴 un descuento solo: ítems − descuento = impreso', () => {
    const leido = ocrResponse({ ...v2, total_detected_cents: 79000, ticket_adjustments: [desc(5000)] });
    expect(leido.ticket_adjustments).toEqual([{ kind: 'discount', amount_cents: 5000 }]);
  });

  it('🔴 con un subtotal sin IVA (sólo vale con el descuento)', () => {
    const leido = ocrResponse({
      ...v2, total_detected_cents: 79000, ticket_totals: { subtotal_cents: 84000 }, ticket_adjustments: [desc(5000)],
    });
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 84000 });
  });

  it('🔴 con IVA agregado: ítems − descuento + IVA = impreso', () => {
    const leido = ocrResponse({
      ...v2, total_detected_cents: 92440,
      ticket_totals: { subtotal_cents: 84000, tax_cents: 13440 }, ticket_adjustments: [desc(5000)],
    });
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 84000, tax_cents: 13440 });
    expect(leido.ticket_adjustments).toEqual([{ kind: 'discount', amount_cents: 5000 }]);
  });

  it('el subtotal ya descontado: S + IVA = impreso', () => {
    const leido = ocrResponse({
      ...v2, total_detected_cents: 79000, ticket_totals: { subtotal_cents: 79000 }, ticket_adjustments: [desc(5000)],
    });
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 79000 });
  });

  it.each([
    ['vacío', []],
    ['11 descuentos', Array.from({ length: 11 }, () => desc(100))],
    ['kind desconocido', [{ kind: 'surcharge', amount_cents: 5000 }]],
    ['importe cero', [desc(0)]],
    ['importe negativo', [desc(-5000)]],
    ['decimales', [desc(50.5)]],
    ['la etiqueta impresa', [{ ...desc(5000), label: 'DESCUENTO' }]],
    ['no es arreglo', desc(5000)],
  ])('🔴 rechaza `ticket_adjustments` %s', (_caso, ajustes) => {
    expect(() => ocrResponse({ ...v2, total_detected_cents: 79000, ticket_adjustments: ajustes }))
      .toThrow('contract_response_invalid');
  });

  it('🔴 rechaza la invariante que no cierra (un centavo)', () => {
    expect(() => ocrResponse({ ...v2, total_detected_cents: 79001, ticket_adjustments: [desc(5000)] }))
      .toThrow('contract_response_invalid');
  });

  it('🔴 rechaza un descuento sin total impreso', () => {
    expect(() => ocrResponse({ ...v2, ticket_adjustments: [desc(5000)] })).toThrow('contract_response_invalid');
  });

  it('🔴 rechaza un `ticket_totals` sin IVA si no hay descuentos', () => {
    expect(() => ocrResponse({ ...v2, total_detected_cents: 84000, ticket_totals: { subtotal_cents: 84000 } }))
      .toThrow('contract_response_invalid');
  });

  it('🔴 rechaza totales que no cierran ni con el descuento', () => {
    expect(() => ocrResponse({
      ...v2, total_detected_cents: 79000, ticket_totals: { subtotal_cents: 70000 }, ticket_adjustments: [desc(5000)],
    })).toThrow('contract_response_invalid');
  });

  it('en v1 no se negocia: la clave se descarta y no llega a la app', () => {
    const { contract_version: _v, ...v1 } = v2;
    const leido = ocrResponse({ ...v1, total_detected_cents: 79000, ticket_adjustments: [desc(5000)] });
    expect('ticket_adjustments' in leido).toBe(false);
  });

  it('ticketAdjustmentsOf distingue ausente (undefined) de inválido (null)', () => {
    expect(ticketAdjustmentsOf(undefined)).toBeUndefined();
    expect(ticketAdjustmentsOf([])).toBeNull();
    expect(ticketAdjustmentsOf([desc(5000)])).toEqual([{ kind: 'discount', amount_cents: 5000 }]);
  });
});

function setupStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
}

let n = 0;
function alta(restaurantId: string, platos: ReadonlyArray<{ name: string; price_cents: number; quantity: number }>, extra: Record<string, unknown>): CreateMesaRequest {
  n += 1;
  return {
    restaurant_id: restaurantId,
    total_cents: platos.reduce((s, i) => s + i.price_cents * i.quantity, 0),
    division_mode: 'igual',
    expected_participants: 2,
    guarantee_method: 'card',
    idempotency_key: `mock-descuento-${n}-${'0'.repeat(4)}`,
    items: platos.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
    ...extra,
  } as CreateMesaRequest;
}

const cuerpo = (recibo: string) => JSON.parse(Buffer.from(recibo.split('.')[1]!, 'base64url').toString('utf8'));

describe('mock · el descuento aparte (D218)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('por defecto no se emite', async () => {
    const mock = await import('./mock/mockApi');
    expect('ticket_adjustments' in ocrResponse(await mock.mockScanTicket())).toBe(false);
  });

  it('🔴 seam `descuento`: el decoder lo acepta y el recibo es v3 con d y t', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'descuento');
    const mock = await import('./mock/mockApi');
    const leido = ocrResponse(await mock.mockScanTicket());
    expect(leido.total_detected_cents).toBe(79000);
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 84000 });
    expect(leido.ticket_adjustments).toEqual([{ kind: 'discount', amount_cents: 5000 }]);
    expect(cuerpo(leido.receipt!)).toMatchObject({ v: 3, d: [5000], t: [84000, null] });
  });

  it('🔴 seam `descuento_iva`: IVA agregado y descuento, el impreso $924.40', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'descuento_iva');
    const mock = await import('./mock/mockApi');
    const leido = ocrResponse(await mock.mockScanTicket());
    expect(leido.total_detected_cents).toBe(92440);
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 84000, tax_cents: 13440 });
    expect(cuerpo(leido.receipt!)).toMatchObject({ v: 3, d: [5000], t: [84000, 13440] });
  });

  it('🔴 la mesa retomada: GET devuelve el descuento y no los totales', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'descuento_iva');
    const mock = await import('./mock/mockApi');
    const { MOCK_RESTAURANTS } = await import('./mock/seedData');
    const leido = ocrResponse(await mock.mockScanTicket());
    const { mesa } = await mock.mockCreateMesa(alta(MOCK_RESTAURANTS[0].id, leido.items, { ocr_receipt: leido.receipt }));
    const detalle = await mock.mockGetMesa(mesa.code, 'user');
    expect(detalle.mesa.total_cents).toBe(84000);
    expect(detalle.mesa.ticket_adjustments).toEqual([{ kind: 'discount', amount_cents: 5000 }]);
    expect('ticket_totals' in detalle.mesa).toBe(false);
  });

  it('🔴 una mesa editada no devuelve el descuento', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'descuento');
    const mock = await import('./mock/mockApi');
    const { MOCK_RESTAURANTS } = await import('./mock/seedData');
    const leido = ocrResponse(await mock.mockScanTicket());
    const editados = leido.items.slice(1);
    const { mesa } = await mock.mockCreateMesa(alta(MOCK_RESTAURANTS[0].id, editados, { ocr_receipt: leido.receipt }));
    expect('ticket_adjustments' in (await mock.mockGetMesa(mesa.code, 'user')).mesa).toBe(false);
  });
});
