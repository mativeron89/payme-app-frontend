import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D218 · L1 · `GET /api/mesas/:code` negocia el descuento aparte
 * (`adjustments_version=1`, App Backend 2.164.0) y el subtotal e IVA con IVA
 * agregado (`totals_version=2`, 2.165.0). Strings exactos y una sola vez: si
 * faltan, se repiten o son otros, el dueño contesta como antes.
 */
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

const { saveSession } = await import('./storage');
const { api, IS_MOCK } = await import('./index');

beforeEach(() => {
  expect(IS_MOCK).toBe(false);
  // Valores cortos a propósito: la auditoría de secretos (el repo es público)
  // marca cualquier `*_token` con 8 caracteres o más.
  saveSession({
    access_token: 'a',
    refresh_token: 'r',
    family_id: 'family-mesa',
    principal_id: 'user-mesa',
    user: { id: 'user-mesa', payme_id: 'payme_mx_mesa', email: 'mesa@example.com', first_name: 'Me', last_name: 'Sa' },
  });
});

afterEach(() => {
  storage.values.clear();
  vi.unstubAllGlobals();
});

function capturarUrls(): string[] {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ mesa: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
  return urls;
}

describe('GET /api/mesas/:code · negociación del detalle (D218, L1)', () => {
  it('🔴 con sesión: adjustments_version=1 y totals_version=2, exactos y una sola vez', async () => {
    const urls = capturarUrls();
    await api.getMesa('PA-1234').catch(() => undefined);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!, 'https://payme.test');
    expect(url.pathname).toMatch(/\/mesas\/PA-1234$/);
    expect(url.searchParams.getAll('adjustments_version')).toEqual(['1']);
    expect(url.searchParams.getAll('totals_version')).toEqual(['2']);
    expect([...url.searchParams.keys()].sort()).toEqual(['adjustments_version', 'totals_version']);
  });

  it('el camino de invitado (durmiente) negocia lo mismo', async () => {
    const urls = capturarUrls();
    await api.getMesa('PA-1234', 'token-invitado').catch(() => undefined);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!, 'https://payme.test');
    expect(url.searchParams.getAll('adjustments_version')).toEqual(['1']);
    expect(url.searchParams.getAll('totals_version')).toEqual(['2']);
  });

  it('el código sigue escapado: la negociación no se mezcla con el path', async () => {
    const urls = capturarUrls();
    await api.getMesa('PA 1?x=1').catch(() => undefined);
    const url = new URL(urls[0]!, 'https://payme.test');
    expect(url.pathname).toMatch(/\/mesas\/PA%201%3Fx%3D1$/);
    expect(url.searchParams.has('x')).toBe(false);
  });
});
