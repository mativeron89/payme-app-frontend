import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateMesaRequest } from '../types';

/**
 * D209 · el mock de `ticket_totals`, con las reglas del dueño
 * (`contract-mirror/contract/ocr-merchant-v2.json`):
 * - por defecto NO se emite (el `mode: 'mock'` del dueño nunca lo emite);
 * - los seams `iva_incluido` e `iva_agregado` lo emiten, con recibo v2 y `t`;
 * - el alta lo guarda SÓLO desde el recibo (`stored`), nunca del cuerpo;
 * - GET mesa lo devuelve sólo si el total de la mesa es el impreso
 *   (`mesa_detail`).
 */
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

async function load() {
  const mock = await import('./mockApi');
  const { ocrResponse } = await import('../contractResponses');
  const { MOCK_RESTAURANTS } = await import('./seedData');
  return { mock, ocrResponse, MOCK_RESTAURANTS };
}

function cuerpo(recibo: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(recibo.split('.')[1]!, 'base64url').toString('utf8'));
}

let n = 0;
function alta(
  restaurantId: string,
  items: ReadonlyArray<{ name: string; price_cents: number; quantity: number }>,
  extra: Record<string, unknown>,
): CreateMesaRequest {
  n += 1;
  return {
    restaurant_id: restaurantId,
    total_cents: items.reduce((s, i) => s + i.price_cents * i.quantity, 0),
    division_mode: 'igual',
    expected_participants: 2,
    guarantee_method: 'card',
    idempotency_key: `mock-totales-${n}-${'0'.repeat(4)}`,
    items: items.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
    ...extra,
  } as CreateMesaRequest;
}

describe('mock · ticket_totals (D209)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('por defecto no se emite, y el recibo sigue siendo v1', async () => {
    const { mock, ocrResponse } = await load();
    const leido = ocrResponse(await mock.mockScanTicket());
    expect('ticket_totals' in leido).toBe(false);
    expect(cuerpo(leido.receipt!).v).toBe(1);
  });

  it('🔴 IVA incluido: el decoder lo acepta, el recibo es v2 con t y GET mesa lo devuelve', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'iva_incluido');
    const { mock, ocrResponse, MOCK_RESTAURANTS } = await load();
    const leido = ocrResponse(await mock.mockScanTicket());
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 72414, tax_cents: 11586 });
    expect(leido.total_detected_cents).toBe(84000);
    expect(cuerpo(leido.receipt!)).toMatchObject({ v: 2, t: [72414, 11586] });
    const { mesa } = await mock.mockCreateMesa(alta(MOCK_RESTAURANTS[0].id, leido.items, { ocr_receipt: leido.receipt }));
    const detalle = await mock.mockGetMesa(mesa.code, 'user');
    expect(detalle.mesa.total_cents).toBe(84000);
    expect(detalle.mesa.ticket_totals).toEqual({ subtotal_cents: 72414, tax_cents: 11586 });
  });

  it('🔴 L1 · IVA agregado: ítems = subtotal; con `totals_version=2` la mesa retomada SÍ lo devuelve', async () => {
    // Antes de la adenda 1 (regla de 2.156.0) no salía: el total de la mesa no
    // es el impreso. Con `totals_version=2` (2.165.0) sale si la mesa vale S.
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'iva_agregado');
    const { mock, ocrResponse, MOCK_RESTAURANTS } = await load();
    const leido = ocrResponse(await mock.mockScanTicket());
    expect(leido.total_cents).toBe(84000);
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 84000, tax_cents: 13440 });
    expect(leido.total_detected_cents).toBe(97440);
    expect(leido.warnings).toEqual(['total_mismatch']);
    const { mesa } = await mock.mockCreateMesa(alta(MOCK_RESTAURANTS[0].id, leido.items, { ocr_receipt: leido.receipt }));
    const detalle = await mock.mockGetMesa(mesa.code, 'user');
    expect(detalle.mesa.total_cents).toBe(84000);
    expect(detalle.mesa.ticket_totals).toEqual({ subtotal_cents: 84000, tax_cents: 13440 });
  });

  it('🔴 L1 · una mesa editada (otro total que el de los platos del recibo) no lo devuelve', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'iva_incluido');
    const { mock, ocrResponse, MOCK_RESTAURANTS } = await load();
    const leido = ocrResponse(await mock.mockScanTicket());
    const editados = [...leido.items, { name: 'Café', category: 'cafe' as const, price_cents: 3000, quantity: 1 }];
    const { mesa } = await mock.mockCreateMesa(alta(MOCK_RESTAURANTS[0].id, editados, { ocr_receipt: leido.receipt }));
    const detalle = await mock.mockGetMesa(mesa.code, 'user');
    expect(detalle.mesa.total_cents).toBe(87000);
    expect('ticket_totals' in detalle.mesa).toBe(false);
  });

  it('🔴 nunca desde el cuerpo del pedido: sin recibo, GET no los devuelve aunque el pedido los traiga', async () => {
    const { mock, MOCK_RESTAURANTS } = await load();
    const items = [{ name: 'Pizza', price_cents: 30000, quantity: 1 }];
    const { mesa } = await mock.mockCreateMesa(alta(MOCK_RESTAURANTS[0].id, items, {
      ticket_totals: { subtotal_cents: 25862, tax_cents: 4138 },
    }));
    expect('ticket_totals' in (await mock.mockGetMesa(mesa.code, 'user')).mesa).toBe(false);
  });
});
