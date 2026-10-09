import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-NOMBRES-CORREGIDOS · D240 punto 15 · el mock del escaneo con
 * `names_version=1`, como el del dueño (`routes/ocr.js`, 2.170.0): no corrige,
 * el original es el mismo nombre. El seam `payme.app.mock.ocr.nombres.v1 =
 * corregidos` es la fixture con originales distintos. Pasa por el decoder.
 */
function storage(extra: Record<string, string> = {}) {
  const values = new Map<string, string>(Object.entries(extra));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
}

describe('mock · nombres corregidos', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('negociado y sin corrección: el original es el mismo nombre, en todos los platos', async () => {
    storage();
    const { mockScanTicket } = await import('./mockApi');
    const { ocrResponse } = await import('../contractResponses');
    const r = ocrResponse(await mockScanTicket({ nombres: true }), { nombres: true });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((i) => i.original_name === i.name)).toBe(true);
  });

  it('con el seam, «el ticket decía» otra cosa y `name` es el corregido', async () => {
    storage({ 'payme.app.mock.ocr.nombres.v1': 'corregidos' });
    const { mockScanTicket } = await import('./mockApi');
    const { ocrResponse } = await import('../contractResponses');
    const r = ocrResponse(await mockScanTicket({ nombres: true }), { nombres: true });
    const por = new Map(r.items.map((i) => [i.name, i.original_name]));
    expect(por.get('Agua mineral')).toBe('Agua minral');
    expect(por.get('Tiramisú')).toBe('TIRAMISU');
    expect(por.get('Vino tinto (copa)')).toBe('Vino tinto (copa)');
  });

  it('sin la negociación, ningún plato trae `original_name`', async () => {
    storage({ 'payme.app.mock.ocr.nombres.v1': 'corregidos' });
    const { mockScanTicket } = await import('./mockApi');
    const r = await mockScanTicket();
    expect(r.items.some((i) => 'original_name' in i)).toBe(false);
  });
});
