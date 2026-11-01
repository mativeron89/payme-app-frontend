import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D218 · D224 · L1 · `GET /api/mesas/:code` negocia el descuento y el cargo por
 * servicio aparte (`adjustments_version=2`, App Backend 2.168.0; antes `1`) y el subtotal e IVA con IVA
 * agregado (`totals_version=2`, 2.165.0). D344 · y «Mi parte» con la propina de
 * la mesa (`share_version=1`, 2.186.0). Strings exactos y una sola vez: si
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

describe('GET /api/mesas/:code · negociación del detalle (D218, L1, D344)', () => {
  it('🔴 con sesión: adjustments_version=2, totals_version=2, share_version=1 y members_version=1, exactos y una sola vez', async () => {
    const urls = capturarUrls();
    await api.getMesa('PA-1234').catch(() => undefined);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!, 'https://payme.test');
    expect(url.pathname).toMatch(/\/mesas\/PA-1234$/);
    expect(url.searchParams.getAll('adjustments_version')).toEqual(['2']);
    expect(url.searchParams.getAll('totals_version')).toEqual(['2']);
    expect(url.searchParams.getAll('share_version')).toEqual(['1']);
    // D622 · D628 · AF-4 · `members_version=1` (App Backend 2.210.0, `contract/mesa-miembros-v1.json`).
    expect(url.searchParams.getAll('members_version')).toEqual(['1']);
    expect([...url.searchParams.keys()].sort()).toEqual(['adjustments_version', 'members_version', 'share_version', 'totals_version']);
  });

  it('el camino de invitado (durmiente) negocia lo mismo', async () => {
    const urls = capturarUrls();
    await api.getMesa('PA-1234', 'token-invitado').catch(() => undefined);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]!, 'https://payme.test');
    expect(url.searchParams.getAll('adjustments_version')).toEqual(['2']);
    expect(url.searchParams.getAll('totals_version')).toEqual(['2']);
    expect(url.searchParams.getAll('share_version')).toEqual(['1']);
    // D622 · D628 · AF-4 · `members_version=1` (App Backend 2.210.0, `contract/mesa-miembros-v1.json`).
    expect(url.searchParams.getAll('members_version')).toEqual(['1']);
    expect([...url.searchParams.keys()].sort()).toEqual(['adjustments_version', 'members_version', 'share_version', 'totals_version']);
  });

  it('el código sigue escapado: la negociación no se mezcla con el path', async () => {
    const urls = capturarUrls();
    await api.getMesa('PA 1?x=1').catch(() => undefined);
    const url = new URL(urls[0]!, 'https://payme.test');
    expect(url.pathname).toMatch(/\/mesas\/PA%201%3Fx%3D1$/);
    expect(url.searchParams.has('x')).toBe(false);
  });
});

describe('PUT /api/mesas/:code/tip · la propina de la mesa (D344)', () => {
  function capturarPedidos(respuesta: unknown, status = 200): Array<{ url: string; method: string; body: unknown }> {
    const pedidos: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      pedidos.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return new Response(JSON.stringify(respuesta), { status, headers: { 'Content-Type': 'application/json' } });
    }));
    return pedidos;
  }

  it('🔴 un preset viaja como tip_bps, con el código escapado y el cuerpo exacto', async () => {
    const pedidos = capturarPedidos({ tip_setting: { tip_bps: 1000 } });
    await expect(api.fijarPropinaDeLaMesa('PA 1?x=1', { tip_bps: 1000 })).resolves.toEqual({ tip_bps: 1000 });
    expect(pedidos).toHaveLength(1);
    const url = new URL(pedidos[0]!.url, 'https://payme.test');
    expect(pedidos[0]!.method).toBe('PUT');
    expect(url.pathname).toMatch(/\/mesas\/PA%201%3Fx%3D1\/tip$/);
    expect([...url.searchParams.keys()]).toEqual([]);
    expect(pedidos[0]!.body).toEqual({ tip_setting: { tip_bps: 1000 } });
  });

  it('«Otro» viaja como tip_cents y «sin fijar» como null, nunca como 0 %', async () => {
    const otro = capturarPedidos({ tip_setting: { tip_cents: 15000 } });
    await expect(api.fijarPropinaDeLaMesa('PA-1234', { tip_cents: 15000 })).resolves.toEqual({ tip_cents: 15000 });
    expect(otro[0]!.body).toEqual({ tip_setting: { tip_cents: 15000 } });
    vi.unstubAllGlobals();
    const sinFijar = capturarPedidos({ tip_setting: null });
    await expect(api.fijarPropinaDeLaMesa('PA-1234', null)).resolves.toBeNull();
    expect(sinFijar[0]!.body).toEqual({ tip_setting: null });
  });

  it('una respuesta 200 que no es el contrato no se acepta', async () => {
    capturarPedidos({ tip_setting: { tip_bps: 1000, tip_cents: 1 } });
    await expect(api.fijarPropinaDeLaMesa('PA-1234', { tip_bps: 1000 })).rejects.toThrow();
  });

  it('un 409 llega como error HTTP con su código, para que lo clasifique quien reintenta', async () => {
    capturarPedidos({ error: 'mesa_not_active', mesa_status: 'expired', closure_reason: 'time' }, 409);
    await expect(api.fijarPropinaDeLaMesa('PA-1234', { tip_bps: 500 })).rejects.toMatchObject({ status: 409 });
  });
});
