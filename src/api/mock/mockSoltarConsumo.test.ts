import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-25 · n80 · `mockReleaseItems` sigue al dueño (`contract-mirror/routes/mesas.js:1603-1666`):
 * sólo lo `locked` propio se suelta, lo pagado y lo ajeno NO (y eso no es error), modo
 * «igual» es 409 `release_not_applicable`, mesa inactiva 409 `mesa_not_active`.
 */

let values: Map<string, string>;

function installStorage() {
  values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_MOCK', '1');
  installStorage();
  vi.stubGlobal('setTimeout', ((callback: () => void) => { queueMicrotask(callback); return 0; }) as unknown as typeof setTimeout);
});

async function cargar() {
  const mock = await import('./mockApi');
  const store = await import('./store');
  mock.setModoMonetarioMock('disabled');
  const mesa = store.state.mesas.find((m) => m.code === 'PA-2847')!;
  const libre = mesa.items.find((i) => i.claims.length === 0)!;
  return { mock, store, mesa, libre };
}

async function error(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { status: number; message: string };
    return { status: err.status, message: err.message };
  }
  throw new Error('se esperaba un rechazo');
}

describe('n80 · soltar en el mock', () => {
  it('suelta lo mío reservado y el ítem vuelve a quedar libre', async () => {
    const { mock, store, mesa, libre } = await cargar();
    await mock.mockLockItems('PA-2847', [{ item_id: libre.id, fraction_bps: 10000 }], 'user');
    expect(store.myBps(mesa.items.find((i) => i.id === libre.id)!, 'user')).toBe(10000);

    const r = await mock.mockReleaseItems('PA-2847', [libre.id], 'user');
    expect(r.released).toEqual([{ item_id: libre.id, fraction_bps: 10000 }]);
    expect(store.takenBps(mesa.items.find((i) => i.id === libre.id)!)).toBe(0);
  });

  it('idempotente: soltar lo ya suelto devuelve released vacío, no un error', async () => {
    const { mock, libre } = await cargar();
    const r = await mock.mockReleaseItems('PA-2847', [libre.id], 'user');
    expect(r.released).toEqual([]);
  });

  it('🔴 nunca lo pagado ni lo de otro: quedan intactos y no aparecen en released', async () => {
    const { mock, store, mesa, libre } = await cargar();
    const item = mesa.items.find((i) => i.id === libre.id)!;
    item.claims.push({ who: 'user', fraction_bps: 5000, amount_cents: 1000, status: 'paid' });
    item.claims.push({ who: 'guest', fraction_bps: 2500, amount_cents: null, status: 'locked' });
    const r = await mock.mockReleaseItems('PA-2847', [libre.id], 'user');
    expect(r.released).toEqual([]);
    expect(store.takenBps(item)).toBe(7500);
  });

  it('modo «igual» → 409 release_not_applicable', async () => {
    const { mock } = await cargar();
    expect(await error(mock.mockReleaseItems('PA-4520', ['x'], 'user')))
      .toEqual({ status: 409, message: 'release_not_applicable' });
  });

  it('mesa que ya no está activa → 409 mesa_not_active', async () => {
    const { mock, mesa, libre } = await cargar();
    mesa.status = 'fully_paid';
    expect(await error(mock.mockReleaseItems('PA-2847', [libre.id], 'user')))
      .toEqual({ status: 409, message: 'mesa_not_active' });
  });

  it('un ítem de otra mesa → 404 item_not_found, sin soltar nada', async () => {
    const { mock } = await cargar();
    expect(await error(mock.mockReleaseItems('PA-2847', ['no-existe'], 'user')))
      .toEqual({ status: 404, message: 'item_not_found' });
  });
});
