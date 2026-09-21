import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-21 · n90 · `mockLockItems` sigue al dueño (`contract-mirror/routes/mesas.js:1414-1421`):
 * la selección NO vence (`lock_expires_at: null`) en una mesa sin garantía ni con el
 * dinero apagado, y vence a los 10 minutos en el resto. Antes vencía SIEMPRE y el mock
 * se contradecía con su propio `/api/config` (`item_lock_seconds: null` sin dinero).
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

async function cargar(modo: 'disabled' | 'sandbox') {
  const mock = await import('./mockApi');
  const store = await import('./store');
  mock.setModoMonetarioMock(modo);
  const mesa = store.state.mesas.find((m) => m.code === 'PA-2847')!;
  const libre = mesa.items.find((i) => i.claims.length === 0)!;
  return { mock, mesa, libre };
}

describe('n90 · vencimiento de la selección en el mock', () => {
  it('control positivo: con dinero y mesa CON garantía, vence a los ~10 minutos', async () => {
    const { mock, mesa, libre } = await cargar('sandbox');
    expect(mesa.guarantee_mode).not.toBe(false);
    const antes = Date.now();
    const r = await mock.mockLockItems('PA-2847', [{ item_id: libre.id, fraction_bps: 10000 }], 'user');
    expect(typeof r.lock_expires_at).toBe('string');
    const vence = Date.parse(r.lock_expires_at!);
    expect(vence - antes).toBeGreaterThanOrEqual(9 * 60_000);
    expect(vence - antes).toBeLessThanOrEqual(11 * 60_000);
  });

  it('🔴 con el dinero apagado NO vence: lock_expires_at null, en la respuesta y en el ítem', async () => {
    const { mock, mesa, libre } = await cargar('disabled');
    const r = await mock.mockLockItems('PA-2847', [{ item_id: libre.id, fraction_bps: 10000 }], 'user');
    expect(r.lock_expires_at).toBeNull();
    expect(mesa.items.find((i) => i.id === libre.id)!.lock_expires_at).toBeNull();
  });

  it('🔴 una mesa SIN garantía no vence aunque el dinero esté vivo', async () => {
    const { mock, mesa, libre } = await cargar('sandbox');
    mesa.guarantee_mode = false;
    const r = await mock.mockLockItems('PA-2847', [{ item_id: libre.id, fraction_bps: 10000 }], 'user');
    expect(r.lock_expires_at).toBeNull();
  });

  it('el mock no se contradice: sin dinero, config publica item_lock_seconds null y el lock no vence', async () => {
    const { mock, libre } = await cargar('disabled');
    const config = await mock.mockGetConfig();
    expect(config.item_lock_seconds).toBeNull();
    const r = await mock.mockLockItems('PA-2847', [{ item_id: libre.id, fraction_bps: 10000 }], 'user');
    expect(r.lock_expires_at).toBeNull();
  });
});

describe('V04 · fracciones naturales en el mock contractual', () => {
  it('N=7 reserva 1/7 como 1428 bps y conserva reemplazo propio', async () => {
    const { mock, mesa, libre } = await cargar('disabled');
    mesa.original_participants = 7;
    const first = await mock.mockLockItems(
      mesa.code,
      [{ item_id: libre.id, fraction_denominator: 7 }],
      'user',
    );
    expect(first.claims).toEqual([{ item_id: libre.id, fraction_bps: 1428 }]);
    const retry = await mock.mockLockItems(
      mesa.code,
      [{ item_id: libre.id, fraction_denominator: 7 }],
      'user',
    );
    expect(retry.claims).toEqual([{ item_id: libre.id, fraction_bps: 1428 }]);
    expect(libre.claims.filter((claim) => claim.who === 'user')).toHaveLength(1);
  });

  it('N conocido cierra denominadores mayores y el bypass legacy', async () => {
    const { mock, mesa, libre } = await cargar('disabled');
    mesa.original_participants = 2;
    await expect(mock.mockLockItems(
      mesa.code,
      [{ item_id: libre.id, fraction_denominator: 3 }],
      'user',
    )).rejects.toMatchObject({ status: 400, message: 'fraction_denominator_exceeds_original' });
    await expect(mock.mockLockItems(
      mesa.code,
      [{ item_id: libre.id, fraction_bps: 2500 }],
      'user',
    )).rejects.toMatchObject({ status: 400, message: 'fraction_not_allowed_for_original_participants' });
  });

  it('histórica sin N rechaza denominador y mantiene fracciones legacy', async () => {
    const { mock, mesa, libre } = await cargar('disabled');
    delete mesa.original_participants;
    await expect(mock.mockLockItems(
      mesa.code,
      [{ item_id: libre.id, fraction_denominator: 2 }],
      'user',
    )).rejects.toMatchObject({ status: 409, message: 'original_participants_unknown' });
    const legacy = await mock.mockLockItems(
      mesa.code,
      [{ item_id: libre.id, fraction_bps: 2500 }],
      'user',
    );
    expect(legacy.claims).toEqual([{ item_id: libre.id, fraction_bps: 2500 }]);
  });
});
