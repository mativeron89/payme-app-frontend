import { afterEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  values = new Map<string, string>();
  failSet = false;
  corruptRead = false;
  getItem(key: string) { return this.corruptRead ? null : this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('blocked');
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
let lockCalls = 0;
let activeLocks = 0;
let maxActiveLocks = 0;
let lockTail: Promise<void> = Promise.resolve();
const locks = {
  async request<T>(_name: string, _options: LockOptions, callback: () => Promise<T>): Promise<T> {
    lockCalls += 1;
    const previous = lockTail;
    let release: (() => void) | undefined;
    lockTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    activeLocks += 1;
    maxActiveLocks = Math.max(maxActiveLocks, activeLocks);
    try {
      return await callback();
    } finally {
      activeLocks -= 1;
      release?.();
    }
  },
};

Object.assign(globalThis, { localStorage: local, sessionStorage: session });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });

const storage = await import('./storage');
const money = await import('./idempotency');

function signIn(id: string, family = `${id}-family`) {
  storage.saveSession({
    access_token: `${id}-access`,
    refresh_token: `${id}-refresh`,
    user: { id, payme_id: id, email: `${id}@x`, first_name: id, last_name: id },
    principal_id: id,
    family_id: family,
  });
}

async function preparedAuth(id: string, operation = 'mesa_pay:mesa-1') {
  signIn(id);
  const actor = await money.resolveMoneyActor();
  const scope = money.scopeForActor(actor, 'pay:mesa-1|card');
  const key = await money.idempotencyKeyFor(scope, operation);
  const payload = { idempotency_key: key, payment_method_id: 'pm_saved', item_ids: ['item-1'] };
  await money.rememberPaymentMethod(scope, 'pm_saved');
  await money.prepareMonetaryRequest(scope, operation, payload);
  return { scope, key, payload };
}

afterEach(() => {
  local.values.clear();
  session.values.clear();
  local.failSet = false;
  local.corruptRead = false;
  session.failSet = false;
  session.corruptRead = false;
  lockCalls = 0;
  activeLocks = 0;
  maxActiveLocks = 0;
  lockTail = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  vi.unstubAllGlobals();
});

describe('B-06: actor namespace y journal durable', () => {
  it('A→B no reutiliza key, pm ni payload de A y no llama API como B', async () => {
    const a = await preparedAuth('a');
    expect(money.recallPaymentMethod(a.scope)).toBe('pm_saved');
    signIn('b');
    const send = vi.fn(async () => ({ ok: true }));

    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, a.payload, undefined, send)).rejects.toThrow('monetary_request_unprepared');
    expect(send).not.toHaveBeenCalled();
    const b = await preparedAuth('b');
    expect(b.key).not.toBe(a.key);
    expect(money.recallPaymentMethod(b.scope)).toBe('pm_saved');
  });

  it('mismo principal con familia nueva conserva actor estable pero no firma un intento en vuelo', async () => {
    const a = await preparedAuth('a');
    const stale = (await money.resolveMoneyActor()).session;
    signIn('a', 'family-new');
    expect(storage.isCurrentSession(stale!)).toBe(false);
    expect((await money.resolveMoneyActor()).id).toBe('auth:a');
    const send = vi.fn(async (captured: Awaited<ReturnType<typeof money.resolveMoneyActor>>['session']) => captured);
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, a.payload, undefined, send)).rejects.toThrow('monetary_request_unprepared');
    expect(send).not.toHaveBeenCalled();
  });

  it('auth↔guest y guest A→B no comparten artefactos ni guarda token crudo', async () => {
    signIn('a');
    const auth = await money.resolveMoneyActor();
    const guestA = await money.resolveMoneyActor('guest-token-A');
    const guestB = await money.resolveMoneyActor('guest-token-B');
    expect(guestA.id).not.toBe(guestB.id);
    expect(guestA.id).not.toContain('guest-token-A');
    const authScope = money.scopeForActor(auth, 'pay:mesa');
    const guestScope = money.scopeForActor(guestA, 'pay:mesa');
    const guestBScope = money.scopeForActor(guestB, 'pay:mesa');
    await money.idempotencyKeyFor(authScope, 'mesa_pay:mesa');
    await money.idempotencyKeyFor(guestScope, 'mesa_pay:mesa');
    expect(money.recallPaymentMethod(guestBScope)).toBeUndefined();
    expect([...session.values.values()].join('')).not.toContain('guest-token-A');
  });

  it('storage throw, round-trip corrupto, WebCrypto o lock ausentes detienen antes de API', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'transfer:b:100');
    const send = vi.fn(async () => ({ ok: true }));
    local.failSet = true;
    await expect(money.idempotencyKeyFor(scope, 'transfer')).rejects.toThrow('money_storage_unavailable');
    expect(send).not.toHaveBeenCalled();
    local.failSet = false;
    local.corruptRead = true;
    await expect(money.idempotencyKeyFor(scope, 'transfer')).rejects.toThrow('money_actor_unavailable');
    local.corruptRead = false;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await expect(money.idempotencyKeyFor(scope, 'transfer')).rejects.toThrow('money_lock_unavailable');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { randomUUID: originalCrypto.randomUUID.bind(originalCrypto) });
    await expect(money.resolveMoneyActor('guest-token-A')).rejects.toThrow('money_crypto_unavailable');
  });

  it('journal corrupto o legacy sin actor no se reenvía', async () => {
    const a = await preparedAuth('a');
    const journalKey = [...local.values.keys()].find((key) => key.startsWith('payme_money_journal_v3_'))!;
    local.values.set(journalKey, '{corrupto');
    const send = vi.fn(async () => ({ ok: true }));
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, a.payload, undefined, send)).rejects.toThrow('monetary_journal_ambiguous');
    expect(send).not.toHaveBeenCalled();

    local.values.clear();
    local.values.set('payme_money_journal_v3_legacy', JSON.stringify({ key: 'legacy' }));
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'pay:mesa-1|card');
    await expect(money.idempotencyKeyFor(scope, 'mesa_pay:mesa-1')).resolves.toMatch(/.+/);
  });

  it('dos pestañas del mismo actor se serializan bajo lock y payload distinto queda bloqueado', async () => {
    const a = await preparedAuth('a');
    const send = vi.fn(async () => ({ ok: true }));
    const results = await Promise.allSettled([
      money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, a.payload, undefined, send),
      money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, a.payload, undefined, send),
    ]);
    expect(maxActiveLocks).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(money.prepareMonetaryRequest(a.scope, 'mesa_pay:mesa-1', { ...a.payload, item_ids: ['other'] })).rejects.toThrow('monetary_area_frozen');
    expect(lockCalls).toBeGreaterThan(1);
  });

  it('timeout reintenta solo la misma key y fingerprint; otro payload nunca llega a red', async () => {
    const a = await preparedAuth('a');
    const backend = vi.fn(async () => {
      if (backend.mock.calls.length === 1) throw new Error('timeout');
      return { idempotent: true };
    });
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, a.payload, undefined, backend)).rejects.toThrow('timeout');
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, a.payload, undefined, backend)).resolves.toEqual({ idempotent: true });
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.key, { ...a.payload, item_ids: ['other'] }, undefined, backend)).rejects.toThrow('monetary_request_unprepared');
    expect(backend).toHaveBeenCalledTimes(2);
  });
});
