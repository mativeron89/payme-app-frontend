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

  it('V07 · normaliza el nombre sólo en la mesa privada y lo incluye en la identidad', async () => {
    const { mock, store, storage } = await load();
    mock.setModoMonetarioMock('disabled');
    storage.saveSession(storage.createSession({
      access_token: 'a', refresh_token: 'r', user: store.state.user,
    }));
    const resolved = await mock.mockResolveRestaurant({
      fallback_key: '33333333-3333-4333-8333-333333333333',
    });
    expect(resolved.restaurant.name).toBe('Restaurante sin identificar');
    const request = {
      restaurant_id: resolved.restaurant.id,
      restaurant_label: '  Cafe\u0301   del Centro  ',
      total_cents: 1000,
      division_mode: 'consumo' as const,
      expected_participants: 7,
      guarantee_method: 'none' as const,
      idempotency_key: 'private-label-normalized',
      items: [{ name: 'Taco', price_cents: 1000, quantity: 1 }],
    };
    const first = await mock.mockCreateMesa(request);
    const retry = await mock.mockCreateMesa({ ...request, restaurant_label: 'Café del Centro' });
    expect(retry).toMatchObject({ idempotent: true, mesa: { id: first.mesa.id, original_participants: 7 } });

    const created = store.state.mesas.find((mesa) => mesa.id === first.mesa.id)!;
    expect(created.restaurant.name).toBe('Café del Centro');
    const privateRecord = Object.values(store.state.restaurantResolutions[store.state.user.id] ?? {})
      .find((restaurant) => restaurant.id === resolved.restaurant.id);
    expect(privateRecord?.name).toBe('Restaurante sin identificar');

    await expect(mock.mockCreateMesa({ ...request, restaurant_label: 'Otro nombre' }))
      .rejects.toMatchObject({ status: 409, message: 'idempotency_conflict' });

    const blank = await mock.mockCreateMesa({
      ...request,
      restaurant_label: '   ',
      idempotency_key: 'private-label-blank',
    });
    expect(store.state.mesas.find((mesa) => mesa.id === blank.mesa.id)?.restaurant.name)
      .toBe('Restaurante sin identificar');
  });

  it('V07 · un restaurante verificado no acepta etiqueta privada', async () => {
    const { mock, store, storage } = await load();
    storage.saveSession(storage.createSession({
      access_token: 'a', refresh_token: 'r', user: store.state.user,
    }));
    await expect(mock.mockCreateMesa({
      restaurant_id: store.state.mesas[0].restaurant.id,
      restaurant_label: 'No debe aplicar',
      total_cents: 1000,
      division_mode: 'igual',
      expected_participants: 2,
      guarantee_method: 'none',
      idempotency_key: 'verified-label-forbidden',
      items: [{ name: 'Taco', price_cents: 1000, quantity: 1 }],
    })).rejects.toMatchObject({ status: 409, message: 'restaurant_label_not_allowed' });
  });
});
