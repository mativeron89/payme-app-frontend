import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'payme_mock_state_v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/i;
const HIGH_ID = 'f0000000-0000-4000-8000-000000000900';
const OCCUPIED_ID = 'f0000000-0000-4000-8000-000000000004';
const LEGACY_ID = 'h0000000-0000-4000-8000-000000000004';

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

async function seedPersisted() {
  const { state } = await import('./store');
  return structuredClone(state);
}

function rekeyMovement(
  persisted: Awaited<ReturnType<typeof seedPersisted>>,
  index: number,
  nextId: string,
) {
  const previousId = persisted.history[index]!.id;
  const detail = persisted.movementDetails[previousId];
  persisted.history[index]!.id = nextId;
  delete persisted.movementDetails[previousId];
  if (detail) persisted.movementDetails[nextId] = { ...detail, id: nextId };
}

async function payOneEqualPart() {
  const [{ state }, { mockPayMesa }] = await Promise.all([
    import('./store'),
    import('./mockApi'),
  ]);
  const mesa = state.mesas.find((candidate) => candidate.division_mode === 'igual' && candidate.items.length > 0);
  expect(mesa).toBeDefined();
  mesa!.status = 'open';
  mesa!.paid_amount_cents = 0;
  mesa!.tip_amount_cents = 0;
  mesa!.expires_at = new Date(Date.now() + 60_000).toISOString();
  mesa!.slots = mesa!.slots?.map((slot) => ({ ...slot, status: 'available', claimedBy: null })) ?? null;
  const selected = mesa!.items[0]!;
  const response = await mockPayMesa(mesa!.code, {
    idempotency_key: 'mock-reload-sequence-payment',
    payment_type: 'card',
    payment_method_id: state.paymentMethods[0]!.id,
    items: [{ item_id: selected.id, fraction_bps: 5000 }],
    tip_cents: 0,
  }, 'user');
  return { response, state };
}

describe('allocator mock durable tras reload', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('continúa por encima del mayor sufijo persistido y no pisa historial/detalle', async () => {
    const persisted = await seedPersisted();
    rekeyMovement(persisted, 0, HIGH_ID);
    const highDetail = structuredClone(persisted.movementDetails[HIGH_ID]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    vi.resetModules();

    const { response, state } = await payOneEqualPart();
    const suffix = Number(response.attempt.id.slice(-12));
    expect(response.attempt.id).toMatch(UUID);
    expect(suffix).toBeGreaterThan(900);
    expect(state.history.at(-1)?.id).toBe(response.attempt.id);
    expect(state.movementDetails[response.attempt.id]?.id).toBe(response.attempt.id);
    expect(state.movementDetails[HIGH_ID]).toEqual(highDetail);
  });

  it('migrar h→f nunca elige un id ya ocupado por historial o detalle', async () => {
    const persisted = await seedPersisted();
    rekeyMovement(persisted, 0, LEGACY_ID);
    rekeyMovement(persisted, 1, OCCUPIED_ID);
    const occupiedDetail = structuredClone(persisted.movementDetails[OCCUPIED_ID]);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    vi.resetModules();

    const { state } = await import('./store');
    const migrated = state.history[0]!.id;
    expect(migrated).toMatch(UUID);
    expect(migrated).not.toBe(OCCUPIED_ID);
    expect(state.history[1]!.id).toBe(OCCUPIED_ID);
    expect(state.movementDetails[OCCUPIED_ID]).toEqual(occupiedDetail);
    expect(state.movementDetails[migrated]?.id).toBe(migrated);
    expect(state.movementDetails[LEGACY_ID]).toBeUndefined();
  });
});
