import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const detail = () => ({
  id: '11111111-1111-4111-8111-111111111111',
  restaurant: { name: 'La Parolaccia', category: 'italian' },
  mesa: { code: 'PA-8712' },
  date: '2026-08-25T05:00:00.000Z',
  payment_type: 'card',
  method: { brand: 'visa', bank: 'Santander', last_four: '4532' },
  items: [{
    name: 'Tagliatelle', price_cents: 19500, quantity: 1, category: 'plato',
    amount_cents: 9750, fraction_bps: 5000, declared_fraction_bps: null,
  }],
  items_amount_cents: 9750,
  tip_amount_cents: 975,
  gross_amount_cents: 10725,
  fee_amount_cents: 100,
  status: 'succeeded',
});

beforeEach(() => {
  expect(IS_MOCK).toBe(false);
  saveSession({
    access_token: 'access-private-movement',
    refresh_token: 'refresh-private-movement',
    family_id: 'family-private-movement',
    principal_id: 'user-private-movement',
  });
});

afterEach(() => {
  storage.values.clear();
  vi.unstubAllGlobals();
});

describe('fachada real: detalle owner-only no cacheable', () => {
  it('envía no-store y exige los dos tokens privados antes de decodificar', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization)
        .toBe('Bearer access-private-movement');
      expect((init?.headers as Record<string, string>).Accept).toBe('application/json');
      expect(init?.cache).toBe('no-store');
      return new Response(JSON.stringify(detail()), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.getMovement(detail().id)).resolves.toMatchObject({ id: detail().id });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rechaza un 2xx privado sin no-store aunque el JSON sea contablemente válido', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detail()), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private' },
    })));

    await expect(api.getMovement(detail().id)).rejects
      .toThrow('private_json_cache_policy_invalid');
  });

  it('conserva el 404 ciego del owner sin intentar interpretar un detalle', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'movement_not_found',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    })));

    await expect(api.getMovement('99999999-9999-4999-8999-999999999999'))
      .rejects.toMatchObject({ status: 404, message: 'movement_not_found' });
  });
});
