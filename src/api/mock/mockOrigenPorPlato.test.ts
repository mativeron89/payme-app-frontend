import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateMesaRequest } from '../types';

/**
 * AF-ORIGEN-POR-PLATO · decisión 141 · el mock del recibo de lectura.
 *
 * El mock es donde Mati mira la app y donde corren los e2e: el recibo tiene que
 * tener la forma del dueño (`services/origenItems.js`@2.145.0) y firmar cada
 * ítem como él, `[huella del nombre, precio UNITARIO, cantidad]`. Se prueba
 * atravesando el decoder de verdad (`ocrResponse`).
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

const FORMA = /^or1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

/** La huella del dueño: NFC, espacios colapsados, minúsculas, sha256 base64url. */
function huellaDelDueño(nombre: string): string {
  return createHash('sha256')
    .update(nombre.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase(), 'utf8')
    .digest('base64url');
}

function cuerpo(recibo: string): { items: Array<[string, number, number]> } & Record<string, unknown> {
  return JSON.parse(Buffer.from(recibo.split('.')[1]!, 'base64url').toString('utf8'));
}

describe('mock del OCR · el recibo de lectura', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'no_merchant');
  });

  it('trae un `receipt` con la forma del dueño que el decoder acepta', async () => {
    const { mock, ocrResponse } = await load();
    const leido = ocrResponse(await mock.mockScanTicket());
    expect(leido.receipt).toMatch(FORMA);
  });

  it('firma cada ítem como el dueño: Tiramisú con precio UNITARIO 7000 y cantidad 2', async () => {
    const { mock, ocrResponse } = await load();
    const leido = ocrResponse(await mock.mockScanTicket());
    const { items, ...resto } = cuerpo(leido.receipt!);
    expect(items).toHaveLength(leido.items.length);
    expect(items).toContainEqual([huellaDelDueño('Tiramisú'), 7000, 2]);
    expect(items).toEqual(leido.items.map((i) => [huellaDelDueño(i.name), i.price_cents, i.quantity]));
    expect(resto).toMatchObject({ v: 1, mode: 'mock' });
    expect(resto.exp).toBe((resto.iat as number) + 7200);
  });

  it('cada lectura trae un recibo nuevo', async () => {
    const { mock } = await load();
    const primero = (await mock.mockScanTicket()).receipt;
    const segundo = (await mock.mockScanTicket()).receipt;
    expect(primero).toMatch(FORMA);
    expect(segundo).toMatch(FORMA);
    expect(segundo).not.toBe(primero);
  });

  it('sin ítems no hay recibo, como en el dueño', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'no_items');
    const { mock, ocrResponse } = await load();
    expect('receipt' in ocrResponse(await mock.mockScanTicket())).toBe(false);
  });
});

describe('mock de POST /mesas · `ocr_receipt` con la puerta del dueño', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  let n = 0;
  function pedido(restaurantId: string, extra: Record<string, unknown>): CreateMesaRequest {
    n += 1;
    return {
      restaurant_id: restaurantId,
      total_cents: 30000,
      division_mode: 'consumo',
      expected_participants: 3,
      guarantee_method: 'card',
      idempotency_key: `mock-origen-${n}-${'0'.repeat(4)}`,
      items: [{ name: 'Pizza', price_cents: 30000, quantity: 1 }],
      ...extra,
    } as CreateMesaRequest;
  }

  it.each([
    ['ausente', {}],
    ['un recibo', { ocr_receipt: 'or1.e30.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }],
    ['null', { ocr_receipt: null }],
    ['de 16384 caracteres', { ocr_receipt: 'x'.repeat(16384) }],
  ])('acepta `ocr_receipt` %s', async (_caso, extra) => {
    const { mock, MOCK_RESTAURANTS } = await load();
    await expect(mock.mockCreateMesa(pedido(MOCK_RESTAURANTS[0].id, extra))).resolves.toMatchObject({
      mesa: { total_cents: 30000 },
    });
  });

  it.each([
    ['de 16385 caracteres', { ocr_receipt: 'x'.repeat(16385) }],
    ['número', { ocr_receipt: 7 }],
    ['objeto', { ocr_receipt: {} }],
  ])('rechaza `ocr_receipt` %s con 400 validation_error', async (_caso, extra) => {
    const { mock, MOCK_RESTAURANTS } = await load();
    await expect(mock.mockCreateMesa(pedido(MOCK_RESTAURANTS[0].id, extra))).rejects.toMatchObject({
      status: 400,
      message: 'validation_error',
    });
  });
});
