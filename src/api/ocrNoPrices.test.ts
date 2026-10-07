import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ocrResponse } from './contractResponses';

/**
 * AF-NOCHE-COMANDA · `no_prices_found` de App Backend 2.161.0 (`warnings_v2`
 * de `contract-mirror/contract/ocr-merchant-v2.json`): una comanda de cocina,
 * con renglones y sin ningún precio. Sólo en v2 negociado, siempre junto a
 * `no_items_found` y con cero ítems. El cliente replica esa regla.
 */
const v2 = {
  contract_version: 2,
  items: [],
  total_cents: 0,
  warnings: ['no_items_found', 'no_prices_found'],
  mock: false,
};

describe('OCR · no_prices_found', () => {
  it('🔴 en v2, junto a no_items_found y con cero ítems: se acepta', () => {
    expect(ocrResponse(v2).warnings).toEqual(['no_items_found', 'no_prices_found']);
  });

  it('🔴 con ítems: se rechaza', () => {
    expect(() => ocrResponse({
      ...v2,
      items: [{ name: 'Taco', category: 'mexican', price_cents: 1000, quantity: 1 }],
      total_cents: 1000,
    })).toThrow('contract_response_invalid');
  });

  it('🔴 sin no_items_found: se rechaza', () => {
    expect(() => ocrResponse({ ...v2, warnings: ['no_prices_found'] })).toThrow('contract_response_invalid');
  });

  it('🔴 en v1 no existe: se rechaza como cualquier warning desconocido', () => {
    const { contract_version: _v, ...v1 } = v2;
    expect(() => ocrResponse(v1)).toThrow('contract_response_invalid');
  });

  it('control · los warnings de siempre siguen valiendo en v1 y en v2', () => {
    const { contract_version: _v, ...v1 } = v2;
    expect(ocrResponse({ ...v1, warnings: ['no_items_found'] }).warnings).toEqual(['no_items_found']);
    expect(ocrResponse({ ...v2, warnings: ['no_items_found'] }).warnings).toEqual(['no_items_found']);
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

describe('mock · no_prices_found', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('por defecto no se emite, como en el mock del dueño', async () => {
    const mock = await import('./mock/mockApi');
    expect(ocrResponse(await mock.mockScanTicket()).warnings).not.toContain('no_prices_found');
  });

  it('el seam `no_prices` emite la forma de 2.161.0 y el decoder la acepta', async () => {
    localStorage.setItem('payme.app.mock.n179.ocr.v1', 'no_prices');
    const mock = await import('./mock/mockApi');
    const leido = ocrResponse(await mock.mockScanTicket());
    expect(leido.items).toEqual([]);
    expect(leido.warnings).toEqual(['no_items_found', 'no_prices_found']);
  });
});
