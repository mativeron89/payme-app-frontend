import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const store = await import('./store');
  const storage = await import('../storage');
  return { mock, store, storage };
}

describe('mock restaurants/resolve · ownership e idempotencia', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('misma sesión+identidad reusa registro; otra sesión no puede usarlo', async () => {
    const { mock, store, storage } = await load();
    const userA = { ...store.state.user, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    storage.saveSession(storage.createSession({
      access_token: 'a', refresh_token: 'r', user: userA,
    }));
    const request = {
      name: 'Tacos El Güero',
      rfc: 'TEG010101AB1',
      fallback_key: '11111111-1111-4111-8111-111111111111',
    };
    const first = await mock.mockResolveRestaurant(request);
    const retry = await mock.mockResolveRestaurant(request);
    expect(retry).toEqual(first);
    expect(first).toMatchObject({ record_only: true, restaurant: { address: null } });

    const userB = { ...store.state.user, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    storage.saveSession(storage.createSession({
      access_token: 'b', refresh_token: 's', user: userB,
    }));
    await expect(mock.mockCreateMesa({
      restaurant_id: first.restaurant.id,
      total_cents: 1000,
      division_mode: 'igual',
      expected_participants: 2,
      guarantee_method: 'none',
      idempotency_key: 'private-owner-isolation',
      items: [{ name: 'Taco', price_cents: 1000, quantity: 1 }],
    })).rejects.toMatchObject({ status: 404, message: 'restaurant_not_found' });

    const secondOwner = await mock.mockResolveRestaurant(request);
    expect(secondOwner.restaurant.id).not.toBe(first.restaurant.id);
  });

  it('un registro privado rechaza garantía aun en mock', async () => {
    const { mock, store, storage } = await load();
    storage.saveSession(storage.createSession({
      access_token: 'a', refresh_token: 'r', user: store.state.user,
    }));
    const resolved = await mock.mockResolveRestaurant({
      fallback_key: '22222222-2222-4222-8222-222222222222',
    });
    await expect(mock.mockCreateMesa({
      restaurant_id: resolved.restaurant.id,
      total_cents: 1000,
      division_mode: 'igual',
      expected_participants: 2,
      guarantee_method: 'card',
      stripe_payment_method_id: 'pm_private_forbidden',
      idempotency_key: 'private-record-only-card',
      items: [{ name: 'Taco', price_cents: 1000, quantity: 1 }],
    })).rejects.toMatchObject({ status: 409, message: 'restaurant_record_only' });
  });
});
