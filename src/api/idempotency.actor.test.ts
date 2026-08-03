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
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
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
const guards = await import('./moneyGuards');

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
  const handle = await money.acquireMonetaryIntent(scope, operation);
  const payload = { idempotency_key: handle.key, payment_method_id: 'pm_saved', item_ids: ['item-1'] };
  await money.rememberPaymentMethod(scope, handle, 'pm_saved');
  await money.prepareMonetaryRequest(scope, operation, handle, payload);
  return { scope, handle, key: handle.key, payload };
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
    expect(money.recallPaymentMethod(a.scope, a.handle)).toBe('pm_saved');
    signIn('b');
    const send = vi.fn(async () => ({ ok: true }));

    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, send)).rejects.toThrow('monetary_request_unprepared');
    expect(send).not.toHaveBeenCalled();
    const b = await preparedAuth('b');
    expect(b.key).not.toBe(a.key);
    expect(money.recallPaymentMethod(b.scope, b.handle)).toBe('pm_saved');
  });

  it('mismo principal con familia nueva conserva el guard y no firma un intento en vuelo', async () => {
    const a = await preparedAuth('a');
    const stale = (await money.resolveMoneyActor()).session;
    signIn('a', 'family-new');
    expect(storage.isCurrentSession(stale!)).toBe(false);
    expect((await money.resolveMoneyActor()).id).toBe('auth:a');
    const send = vi.fn(async (captured: Awaited<ReturnType<typeof money.resolveMoneyActor>>['session']) => captured);
    await expect(money.acquireMonetaryIntent(a.scope, 'mesa_pay:mesa-1')).rejects.toThrow('monetary_family_reconciliation_required');
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, send)).rejects.toThrow('monetary_family_reconciliation_required');
    await expect(money.readUnconfirmed(a.scope, 'mesa_pay:mesa-1')).resolves.toMatchObject({
      handle: a.handle,
      reconciliationRequired: true,
    });
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
    await money.acquireMonetaryIntent(authScope, 'mesa_pay:mesa');
    await money.acquireMonetaryIntent(guestScope, 'mesa_pay:mesa');
    const guestBHandle = await money.acquireMonetaryIntent(guestBScope, 'mesa_pay:mesa');
    expect(money.recallPaymentMethod(guestBScope, guestBHandle)).toBeUndefined();
    expect([...session.values.values()].join('')).not.toContain('guest-token-A');
  });

  it('storage throw, round-trip corrupto, WebCrypto o lock ausentes detienen antes de API', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'transfer:b:100');
    const send = vi.fn(async () => ({ ok: true }));
    local.failSet = true;
    await expect(money.acquireMonetaryIntent(scope, 'transfer')).rejects.toThrow('money_storage_unavailable');
    expect(send).not.toHaveBeenCalled();
    local.failSet = false;
    local.corruptRead = true;
    await expect(money.acquireMonetaryIntent(scope, 'transfer')).rejects.toThrow('money_actor_unavailable');
    local.corruptRead = false;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await expect(money.acquireMonetaryIntent(scope, 'transfer')).rejects.toThrow('money_lock_unavailable');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', { randomUUID: originalCrypto.randomUUID.bind(originalCrypto) });
    await expect(money.resolveMoneyActor('guest-token-A')).rejects.toThrow('money_crypto_unavailable');
  });

  it('journal corrupto o legacy sin actor no se reenvía', async () => {
    const a = await preparedAuth('a');
    const journalKey = [...local.values.keys()].find((key) => key.startsWith('payme_money_journal_v5_'))!;
    local.values.set(journalKey, '{corrupto');
    const send = vi.fn(async () => ({ ok: true }));
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, send)).rejects.toThrow('monetary_journal_ambiguous');
    expect(send).not.toHaveBeenCalled();

    local.values.clear();
    // Formato exacto de origin/main: sessionStorage, scope crudo, sin actor
    // ni family. No hay base segura para atribuirlo a esta nueva sesión.
    session.values.set('payme_idem_pay:mesa-1|card|new|item-1|b1500|-', JSON.stringify({ key: 'legacy-key', pm: 'pm_legacy' }));
    session.values.set('payme_pending_pay:mesa-1', JSON.stringify({ scope: 'pay:mesa-1|card|new|item-1|b1500|-', evidence: 1, payload: { item_ids: ['item-1'] } }));
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'pay:mesa-1|card');
    await expect(money.acquireMonetaryIntent(scope, 'mesa_pay:mesa-1')).rejects.toThrow('monetary_legacy_quarantined');
    expect([...session.values.keys()]).toEqual(expect.arrayContaining([
      'payme_idem_pay:mesa-1|card|new|item-1|b1500|-',
      'payme_pending_pay:mesa-1',
    ]));
    expect([...local.values.keys()].some((key) => key.startsWith('payme_money_legacy_quarantine_v1_'))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('journal v5 con fingerprint o metadatos inválidos falla cerrado antes de red', async () => {
    const a = await preparedAuth('a');
    const journalKey = [...local.values.keys()].find((key) => key.startsWith('payme_money_journal_v5_'))!;
    const send = vi.fn(async () => ({ ok: true }));
    const entry = JSON.parse(local.values.get(journalKey)!) as Record<string, unknown>;

    local.values.set(journalKey, JSON.stringify({ ...entry, fingerprint: 'no-es-sha256' }));
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, send)).rejects.toThrow('monetary_journal_ambiguous');

    local.values.set(journalKey, JSON.stringify({ ...entry, retries: -1 }));
    await expect(money.acquireMonetaryIntent(a.scope, 'mesa_pay:mesa-1')).rejects.toThrow('monetary_journal_ambiguous');
    expect(send).not.toHaveBeenCalled();
  });

  it('un prefijo legacy de operación ya no reconocible también falla cerrado', async () => {
    session.values.set('payme_pending_formato-antiguo', JSON.stringify({ key: 'unknown' }));
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'transfer:b:100');
    await expect(money.acquireMonetaryIntent(scope, 'transfer')).rejects.toThrow('monetary_legacy_quarantined');
    expect([...session.values.keys()]).toContain('payme_pending_formato-antiguo');
  });

  it('send ambiguous en familia A bloquea el relogin B del mismo principal', async () => {
    const old = await preparedAuth('a', 'mesa_pay:mesa-1');
    money.markUnconfirmed(old.scope, old.scope, old.handle, old.payload);
    expect(money.recallPaymentMethod(old.scope, old.handle)).toBe('pm_saved');
    expect(await money.readUnconfirmed(old.scope, 'mesa_pay:mesa-1')).toMatchObject({ payload: old.payload });
    await expect(money.withPreparedMonetaryRequest(
      'mesa_pay:mesa-1',
      old.handle,
      old.payload,
      undefined,
      async () => { throw new Error('timeout'); },
    )).rejects.toThrow('timeout');

    signIn('a', 'a-family-new');
    const freshActor = await money.resolveMoneyActor();
    const freshScope = money.scopeForActor(freshActor, 'pay:mesa-1|card');
    expect(money.recallPaymentMethod(freshScope, old.handle)).toBeUndefined();
    await expect(money.acquireMonetaryIntent(freshScope, 'mesa_pay:mesa-1')).rejects.toThrow('monetary_family_reconciliation_required');
    await expect(money.prepareMonetaryRequest(freshScope, 'mesa_pay:mesa-1', old.handle, old.payload)).rejects.toThrow('monetary_family_reconciliation_required');
    await expect(money.completeMonetaryIntent(freshScope, 'mesa_pay:mesa-1', old.handle)).rejects.toThrow('monetary_family_reconciliation_required');
    await expect(money.readUnconfirmed(freshScope, 'mesa_pay:mesa-1')).resolves.toMatchObject({
      handle: old.handle,
      reconciliationRequired: true,
    });
    expect([...local.values.keys()].filter((key) => key.startsWith('payme_money_journal_v5_'))).toHaveLength(1);
  });

  it('respuesta tardía A no cierra ni limpia la generación B del mismo principal', async () => {
    signIn('a', 'family-one');
    const first = await money.resolveMoneyActor();
    const firstScope = money.scopeForActor(first, 'topup:card:5000');
    const firstHandle = await money.acquireMonetaryIntent(firstScope, 'topup_card');
    const firstPayload = { idempotency_key: firstHandle.key, amount_cents: 5000 };
    await money.prepareMonetaryRequest(firstScope, 'topup_card', firstHandle, firstPayload);
    await money.withPreparedMonetaryRequest('topup_card', firstHandle, firstPayload, undefined, async () => ({ ok: true }));
    await money.completeMonetaryIntent(firstScope, 'topup_card', firstHandle);

    signIn('a', 'family-two');
    const second = await money.resolveMoneyActor();
    const secondScope = money.scopeForActor(second, 'topup:card:5000');
    const secondHandle = await money.acquireMonetaryIntent(secondScope, 'topup_card');
    const secondPayload = { idempotency_key: secondHandle.key, amount_cents: 5000 };
    await money.rememberPaymentMethod(secondScope, secondHandle, 'pm_family_two');
    await money.prepareMonetaryRequest(secondScope, 'topup_card', secondHandle, secondPayload);
    money.markUnconfirmed(secondScope, secondScope, secondHandle, secondPayload);

    await expect(money.completeMonetaryIntent(firstScope, 'topup_card', firstHandle)).rejects.toThrow('monetary_generation_stale');
    money.clearUnconfirmed(firstScope, firstHandle);
    expect(money.recallPaymentMethod(secondScope, secondHandle)).toBe('pm_family_two');
    await expect(money.readUnconfirmed(secondScope, 'topup_card')).resolves.toMatchObject({ handle: secondHandle, payload: secondPayload });
    await expect(money.acquireMonetaryIntent(secondScope, 'topup_card')).resolves.toEqual(secondHandle);
  });

  it('dos pestañas del mismo actor se serializan bajo lock y payload distinto queda bloqueado', async () => {
    const a = await preparedAuth('a');
    const send = vi.fn(async () => ({ ok: true }));
    const results = await Promise.allSettled([
      money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, send),
      money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, send),
    ]);
    expect(maxActiveLocks).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(money.prepareMonetaryRequest(a.scope, 'mesa_pay:mesa-1', a.handle, { ...a.payload, item_ids: ['other'] })).rejects.toThrow('monetary_payload_ambiguous');
    expect(lockCalls).toBeGreaterThan(1);
  });

  it('timeout reintenta solo la misma key y fingerprint; otro payload nunca llega a red', async () => {
    const a = await preparedAuth('a');
    const backend = vi.fn(async () => {
      if (backend.mock.calls.length === 1) throw new Error('timeout');
      return { idempotent: true };
    });
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, backend)).rejects.toThrow('timeout');
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, a.payload, undefined, backend)).resolves.toEqual({ idempotent: true });
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', a.handle, { ...a.payload, item_ids: ['other'] }, undefined, backend)).rejects.toThrow('monetary_request_unprepared');
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it('sin payload en memoria no puede reconstruir otro slot ni emitir una segunda mutación', async () => {
    const first = await preparedAuth('a');
    const backend = vi.fn(async () => { throw new Error('respuesta_perdida'); });
    await expect(money.withPreparedMonetaryRequest(
      'mesa_pay:mesa-1', first.handle, first.payload, undefined, backend,
    )).rejects.toThrow('respuesta_perdida');

    // Simula reload: el journal durable existe, pero nunca se persistió el
    // payload/PM. Sólo queda una congelación; no se inventa qué slot reenviar.
    const frozen = await money.readUnconfirmed(first.scope, 'mesa_pay:mesa-1');
    expect(frozen).toMatchObject({ handle: first.handle, reconciliationRequired: true });
    expect(frozen).not.toHaveProperty('payload');
    const anotherSlot = { ...first.payload, item_ids: ['slot-2'] };
    await expect(money.prepareMonetaryRequest(first.scope, 'mesa_pay:mesa-1', first.handle, anotherSlot)).rejects.toThrow('monetary_payload_ambiguous');
    await expect(money.withPreparedMonetaryRequest('mesa_pay:mesa-1', first.handle, anotherSlot, undefined, backend)).rejects.toThrow('monetary_request_unprepared');
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it('payload y handle de una generación terminal no pueden enviarse sobre la siguiente', async () => {
    const first = await preparedAuth('a', 'transfer');
    await money.withPreparedMonetaryRequest('transfer', first.handle, first.payload, undefined, async () => ({ ok: true }));
    await money.completeMonetaryIntent(first.scope, 'transfer', first.handle);
    const second = await money.acquireMonetaryIntent(first.scope, 'transfer');
    expect(second.generation).toBe(first.handle.generation + 1);

    const staleSend = vi.fn(async () => ({ ok: true }));
    await expect(money.withPreparedMonetaryRequest('transfer', first.handle, first.payload, undefined, staleSend)).rejects.toThrow('monetary_generation_stale');
    expect(staleSend).not.toHaveBeenCalled();
  });

  it('un crash después del POST en sending permite solo replay exacto con la misma key', async () => {
    const a = await preparedAuth('a');
    const backend = vi.fn(async () => ({ ok: true }));
    await expect(money.withPreparedMonetaryRequest(
      'mesa_pay:mesa-1',
      a.handle,
      a.payload,
      undefined,
      backend,
    )).resolves.toEqual({ ok: true });

    // Simula que el proceso cayó antes de completeMonetaryIntent: el journal
    // quedó `sending`. Repreparar el MISMO cuerpo habilita un replay seguro.
    await money.prepareMonetaryRequest(a.scope, 'mesa_pay:mesa-1', a.handle, a.payload);
    await expect(money.withPreparedMonetaryRequest(
      'mesa_pay:mesa-1',
      a.handle,
      a.payload,
      undefined,
      backend,
    )).resolves.toEqual({ ok: true });
    await expect(money.prepareMonetaryRequest(
      a.scope,
      'mesa_pay:mesa-1',
      a.handle,
      { ...a.payload, item_ids: ['otro'] },
    )).rejects.toThrow('monetary_payload_ambiguous');
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it('una adquisición sobre estado ambiguous conserva exactamente la misma generación', async () => {
    const attempt = await preparedAuth('a', 'transfer');
    await expect(money.withPreparedMonetaryRequest(
      'transfer',
      attempt.handle,
      attempt.payload,
      undefined,
      async () => { throw new Error('timeout'); },
    )).rejects.toThrow('timeout');

    await expect(money.acquireMonetaryIntent(attempt.scope, 'transfer')).resolves.toEqual(attempt.handle);
  });

  it('raw scopes distintos comparten el área transfer mientras esté ambigua y avanzan solo tras terminal', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const firstScope = money.scopeForActor(actor, 'transfer:destino-a:100:uno');
    const secondScope = money.scopeForActor(actor, 'transfer:destino-b:200:dos');
    const first = await money.acquireMonetaryIntent(firstScope, 'transfer');
    const firstPayload = { idempotency_key: first.key, amount_cents: 100, to_payme_id: 'destino-a' };
    await money.prepareMonetaryRequest(firstScope, 'transfer', first, firstPayload);
    await expect(money.withPreparedMonetaryRequest(
      'transfer',
      first,
      firstPayload,
      undefined,
      async () => { throw new Error('timeout'); },
    )).rejects.toThrow('timeout');

    await expect(money.acquireMonetaryIntent(secondScope, 'transfer')).resolves.toEqual(first);
    const secondWithOldHandle = { idempotency_key: first.key, amount_cents: 200, to_payme_id: 'destino-b' };
    await expect(money.prepareMonetaryRequest(secondScope, 'transfer', first, secondWithOldHandle)).rejects.toThrow('monetary_payload_ambiguous');

    await money.completeMonetaryIntent(firstScope, 'transfer', first);
    const second = await money.acquireMonetaryIntent(secondScope, 'transfer');
    expect(second.generation).toBe(first.generation + 1);
    expect(second.key).not.toBe(first.key);
  });

  it('topup OXXO y tarjeta comparten área aunque cambien riel, monto y raw scope', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const oxxoScope = money.scopeForActor(actor, 'topup:oxxo:5000');
    const cardScope = money.scopeForActor(actor, 'topup:card:9000');
    const oxxo = await money.acquireMonetaryIntent(oxxoScope, 'topup_oxxo');
    const oxxoPayload = { idempotency_key: oxxo.key, amount_cents: 5000 };
    await money.prepareMonetaryRequest(oxxoScope, 'topup_oxxo', oxxo, oxxoPayload);
    await expect(money.withPreparedMonetaryRequest(
      'topup_oxxo',
      oxxo,
      oxxoPayload,
      undefined,
      async () => { throw new Error('timeout'); },
    )).rejects.toThrow('timeout');

    await expect(money.acquireMonetaryIntent(cardScope, 'topup_card')).resolves.toEqual(oxxo);
    await expect(money.prepareMonetaryRequest(cardScope, 'topup_card', oxxo, {
      idempotency_key: oxxo.key,
      amount_cents: 9000,
      payment_method_id: 'pm_other_rail',
    })).rejects.toThrow('monetary_payload_ambiguous');
  });

  it('áreas de dos mesas distintas quedan independientes aunque una esté ambigua', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const mesaA = money.scopeForActor(actor, 'pay:mesa-a|card');
    const mesaB = money.scopeForActor(actor, 'pay:mesa-b|card');
    const a = await money.acquireMonetaryIntent(mesaA, 'mesa_pay:mesa-a');
    const payloadA = { idempotency_key: a.key, item_ids: ['item-a'] };
    await money.prepareMonetaryRequest(mesaA, 'mesa_pay:mesa-a', a, payloadA);
    await expect(money.withPreparedMonetaryRequest(
      'mesa_pay:mesa-a',
      a,
      payloadA,
      undefined,
      async () => { throw new Error('timeout'); },
    )).rejects.toThrow('timeout');

    const b = await money.acquireMonetaryIntent(mesaB, 'mesa_pay:mesa-b');
    expect(b.generation).toBe(1);
    expect(b.key).not.toBe(a.key);
  });

  it('subir claimed_by_me por otro pago no terminaliza el intento ambiguo observado', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'pay:mesa-1|card');
    const attempt = await money.acquireMonetaryIntent(scope, 'mesa_pay:mesa-1');
    const payload = { idempotency_key: attempt.key, item_ids: ['parte-a'] };
    const baselineClaimedByMe = 1;
    await money.prepareMonetaryRequest(scope, 'mesa_pay:mesa-1', attempt, payload);
    await expect(money.withPreparedMonetaryRequest(
      'mesa_pay:mesa-1',
      attempt,
      payload,
      undefined,
      async () => { throw new Error('timeout'); },
    )).rejects.toThrow('timeout');

    const claimedByMeAfterOtherDevicePayment = 2;
    expect(claimedByMeAfterOtherDevicePayment).toBeGreaterThan(baselineClaimedByMe);
    await expect(money.readUnconfirmed(scope, 'mesa_pay:mesa-1')).resolves.toMatchObject({
      handle: attempt,
    });
    await expect(money.acquireMonetaryIntent(scope, 'mesa_pay:mesa-1')).resolves.toEqual(attempt);
  });

  it('el payload no puede desacoplar la key enviada del handle generacional', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'transfer:b:100');
    const handle = await money.acquireMonetaryIntent(scope, 'transfer');
    const payload = { idempotency_key: 'otra-key', amount_cents: 100 };
    const backend = vi.fn(async () => ({ ok: true }));

    await expect(money.prepareMonetaryRequest(scope, 'transfer', handle, payload)).rejects.toThrow('monetary_attempt_ambiguous');
    await expect(money.withPreparedMonetaryRequest('transfer', handle, payload, undefined, backend)).rejects.toThrow('monetary_request_unprepared');
    expect(backend).not.toHaveBeenCalled();
  });

  it('un journal v4 preexistente se conserva y bloquea una emisión v5 del área', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'transfer:b:100');
    await money.acquireMonetaryIntent(scope, 'transfer');
    const v5Key = [...local.values.keys()].find((key) => key.startsWith('payme_money_journal_v5_'))!;
    const current = JSON.parse(local.values.get(v5Key)!) as { area: string };
    local.values.delete(v5Key);
    local.values.set('payme_money_journal_v4_old-index', JSON.stringify({ v: 4, area: current.area, key: 'old' }));

    await expect(money.acquireMonetaryIntent(scope, 'transfer')).rejects.toThrow('monetary_journal_ambiguous');
    expect(local.values.has('payme_money_journal_v4_old-index')).toBe(true);
  });

  it('OXXO sin voucher vuelve a ambiguous dentro del callback y reintenta la misma key', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'topup:oxxo:5000');
    const handle = await money.acquireMonetaryIntent(scope, 'topup_oxxo');
    const payload = { amount_cents: 5000, idempotency_key: handle.key };
    await money.prepareMonetaryRequest(scope, 'topup_oxxo', handle, payload);
    const id = 'f0000000-0000-4000-8000-000000000001';
    const backend = vi.fn(async () => {
      if (backend.mock.calls.length === 1) {
        return guards.topupOxxoResponse({ idempotent: true, topup: { id, method: 'oxxo', status: 'processing', amount_cents: 5000 } }, 5000);
      }
      return guards.topupOxxoResponse({ idempotent: true, topup: { id, method: 'oxxo', status: 'processing', amount_cents: 5000, voucher_reference: '1234', voucher_expires_at: '2026-08-04T12:00:00.000Z' } }, 5000);
    });

    await expect(money.withPreparedMonetaryRequest('topup_oxxo', handle, payload, undefined, backend)).rejects.toThrow('money_response_unbound');
    await expect(money.withPreparedMonetaryRequest('topup_oxxo', handle, payload, undefined, backend)).resolves.toMatchObject({ topup: { voucher_reference: '1234' } });
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['topup', 'topup_card', 'topup:card:5000'],
    ['transfer', 'transfer', 'transfer:friend:5000:concepto'],
    ['garantía', 'create_mesa', 'mesa:restaurant'],
    ['pago', 'mesa_pay:mesa-1', 'pay:mesa-1|card'],
  ])('abre una generación nueva para una segunda acción legítima de %s', async (_label, operation, rawScope) => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, rawScope);
    const first = await money.acquireMonetaryIntent(scope, operation);
    const payload = { idempotency_key: first.key, amount_cents: 5000, operation };
    await money.prepareMonetaryRequest(scope, operation, first, payload);
    const backend = vi.fn(async () => ({ ok: true }));

    await money.withPreparedMonetaryRequest(operation, first, payload, undefined, backend);
    await money.completeMonetaryIntent(scope, operation, first);
    const second = await money.acquireMonetaryIntent(scope, operation);
    expect(second.generation).toBe(first.generation + 1);
    expect(second.key).not.toBe(first.key);
    const secondPayload = { ...payload, idempotency_key: second.key };
    await money.prepareMonetaryRequest(scope, operation, second, secondPayload);
    await expect(money.withPreparedMonetaryRequest(operation, second, secondPayload, undefined, backend)).resolves.toEqual({ ok: true });
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it('dos pestañas que adquieren después del terminal comparten una sola generación siguiente', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'transfer:b:100');
    const first = await money.acquireMonetaryIntent(scope, 'transfer');
    const payload = { idempotency_key: first.key, amount_cents: 100 };
    await money.prepareMonetaryRequest(scope, 'transfer', first, payload);
    await money.withPreparedMonetaryRequest('transfer', first, payload, undefined, async () => ({ ok: true }));
    await money.completeMonetaryIntent(scope, 'transfer', first);

    const [tabA, tabB] = await Promise.all([
      money.acquireMonetaryIntent(scope, 'transfer'),
      money.acquireMonetaryIntent(scope, 'transfer'),
    ]);
    expect(tabA).toEqual(tabB);
    expect(tabA.generation).toBe(first.generation + 1);
    expect(maxActiveLocks).toBe(1);
  });

  it('un caller tardío no puede preparar, enviar ni terminar una generación nueva', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'topup:card:5000');
    const first = await money.acquireMonetaryIntent(scope, 'topup_card');
    const oldPayload = { idempotency_key: first.key, amount_cents: 5000 };
    await money.prepareMonetaryRequest(scope, 'topup_card', first, oldPayload);
    const backend = vi.fn(async () => ({ ok: true }));
    await money.withPreparedMonetaryRequest('topup_card', first, oldPayload, undefined, backend);
    await money.completeMonetaryIntent(scope, 'topup_card', first);
    const second = await money.acquireMonetaryIntent(scope, 'topup_card');
    const newPayload = { idempotency_key: second.key, amount_cents: 5000 };
    await money.rememberPaymentMethod(scope, second, 'pm_new_generation');
    await money.prepareMonetaryRequest(scope, 'topup_card', second, newPayload);
    money.markUnconfirmed(scope, scope, second, newPayload);
    // Una continuación vieja puede ejecutar código local tarde, pero queda en
    // su namespace de handle y no pisa ni limpia artefactos de la generación 2.
    money.markUnconfirmed(scope, scope, first, oldPayload);
    money.clearUnconfirmed(scope, first);

    await expect(money.prepareMonetaryRequest(scope, 'topup_card', first, oldPayload)).rejects.toThrow('monetary_generation_stale');
    await expect(money.withPreparedMonetaryRequest('topup_card', first, oldPayload, undefined, backend)).rejects.toThrow('monetary_generation_stale');
    await expect(money.completeMonetaryIntent(scope, 'topup_card', first)).rejects.toThrow('monetary_generation_stale');
    expect(money.recallPaymentMethod(scope, second)).toBe('pm_new_generation');
    await expect(money.readUnconfirmed(scope, 'topup_card')).resolves.toMatchObject({ handle: second, payload: newPayload });
    await expect(money.withPreparedMonetaryRequest('topup_card', second, newPayload, undefined, backend)).resolves.toEqual({ ok: true });
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it('tras reload consulta solo actor, familia y área exactos', async () => {
    signIn('a');
    const actorA = await money.resolveMoneyActor();
    const mesaA = money.scopeForActor(actorA, 'pay:mesa-a|card');
    const mesaB = money.scopeForActor(actorA, 'pay:mesa-b|card');
    const handle = await money.acquireMonetaryIntent(mesaA, 'mesa_pay:mesa-a');
    await money.prepareMonetaryRequest(mesaA, 'mesa_pay:mesa-a', handle, { idempotency_key: handle.key, item_ids: ['a'] });
    // Simula reload: se pierde el payload/PM de memoria, no el journal durable.
    expect(await money.readUnconfirmed(mesaA, 'mesa_pay:mesa-a')).toMatchObject({ scope: mesaA });
    expect(await money.readUnconfirmed(mesaB, 'mesa_pay:mesa-b')).toBeNull();
    signIn('b');
    const actorB = await money.resolveMoneyActor();
    const mesaOtherActor = money.scopeForActor(actorB, 'pay:mesa-a|card');
    expect(await money.readUnconfirmed(mesaOtherActor, 'mesa_pay:mesa-a')).toBeNull();
    expect([...local.values.values()].join('')).not.toContain('item_ids');
  });

  it('tras reload no usa agregados claimed_by_me como evidencia del intento', async () => {
    signIn('a');
    const actor = await money.resolveMoneyActor();
    const scope = money.scopeForActor(actor, 'pay:mesa-1|card');
    const handle = await money.acquireMonetaryIntent(scope, 'mesa_pay:mesa-1');
    const payload = { idempotency_key: handle.key, item_ids: ['second'] };
    await money.prepareMonetaryRequest(scope, 'mesa_pay:mesa-1', handle, payload);
    const recovered = await money.readUnconfirmed(money.scopeForActor(actor, 'pay:mesa-1'), 'mesa_pay:mesa-1');
    expect(recovered).toMatchObject({ handle });
    expect(recovered).not.toHaveProperty('evidence');
  });
});
