import { describe, expect, it, vi } from 'vitest';
import { persist, state } from './store';
import { mockCreateTransfer, mockPayMesa, mockTopupCard, mockTopupOxxo } from './mockApi';

interface RawTopup {
  idempotent?: boolean;
  topup: {
    id: string;
    method?: string;
    amount_cents: number;
    voucher_reference?: string;
  };
}

describe('mock: replay monetario de topups', () => {
  it('replaya la misma referencia OXXO y detecta conflicto de payload', async () => {
    const key = 'mock-topup-oxxo-idem-1';
    const first = await mockTopupOxxo(5000, key) as RawTopup;
    const replay = await mockTopupOxxo(5000, key) as RawTopup;

    expect(replay).toMatchObject({
      idempotent: true,
      topup: {
        id: first.topup.id,
        method: 'oxxo',
        voucher_reference: first.topup.voucher_reference,
      },
    });
    await expect(mockTopupOxxo(6000, key)).rejects.toMatchObject({
      status: 409,
      message: 'idempotency_conflict',
    });
  });

  it('replaya tarjeta sin acreditar saldo dos veces', async () => {
    const key = 'mock-topup-card-idem-1';
    const paymentMethodId = state.paymentMethods[0].id;
    const before = state.balance_cents;
    const first = await mockTopupCard(5000, paymentMethodId, key) as RawTopup;
    const afterFirst = state.balance_cents;
    const replay = await mockTopupCard(5000, paymentMethodId, key) as RawTopup;

    expect(afterFirst - before).toBe(5000);
    expect(state.balance_cents).toBe(afterFirst);
    expect(replay).toMatchObject({
      idempotent: true,
      topup: { id: first.topup.id, method: 'card', amount_cents: 5000 },
    });
  });

  it('comparte la key entre OXXO y tarjeta y no acredita al cambiar de riel', async () => {
    const key = 'mock-topup-cross-rail-idem-1';
    const paymentMethodId = state.paymentMethods[0].id;
    await mockTopupOxxo(5000, key);
    const beforeCard = state.balance_cents;

    await expect(mockTopupCard(5000, paymentMethodId, key)).rejects.toMatchObject({
      status: 409,
      message: 'idempotency_conflict',
    });
    expect(state.balance_cents).toBe(beforeCard);
  });

  it('restaura el ledger junto con el saldo al simular un reload', async () => {
    const key = 'mock-topup-card-reload-idem-1';
    const paymentMethodId = state.paymentMethods[0].id;
    const persisted = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (storageKey: string) => persisted.get(storageKey) ?? null,
      setItem: (storageKey: string, value: string) => persisted.set(storageKey, value),
      removeItem: (storageKey: string) => persisted.delete(storageKey),
    });

    try {
      const first = await mockTopupCard(5000, paymentMethodId, key) as RawTopup;

      // `delay` ya dejó correr el microtask de persistencia. Resetear módulos
      // reproduce la inicialización de store/mockApi que hace un reload real.
      vi.resetModules();
      const [{ mockTopupCard: reloadedTopup }, { state: reloadedState }] = await Promise.all([
        import('./mockApi'),
        import('./store'),
      ]);
      const balanceAfterReload = reloadedState.balance_cents;
      const walletTxAfterReload = reloadedState.walletTx.length;
      const replay = await reloadedTopup(5000, paymentMethodId, key) as RawTopup;

      expect(replay).toMatchObject({
        idempotent: true,
        topup: { id: first.topup.id, method: 'card', amount_cents: 5000 },
      });
      expect(reloadedState.balance_cents).toBe(balanceAfterReload);
      expect(reloadedState.walletTx).toHaveLength(walletTxAfterReload);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('mock: paridad idempotente de pago de mesa', () => {
  it('canonicaliza items como backend, ignora la fuente y detecta fracciones distintas', async () => {
    const template = state.mesas.find((mesa) => mesa.division_mode === 'consumo');
    expect(template).toBeDefined();
    const mesa = structuredClone(template!);
    const code = 'TEST-CANONICAL-1';
    const key = 'mock-mesa-canonical-idem-1';
    mesa.id = 'mock-mesa-canonical-id';
    mesa.code = code;
    mesa.status = 'open';
    mesa.paid_amount_cents = 0;
    mesa.tip_amount_cents = 0;
    mesa.expires_at = new Date(Date.now() + 60_000).toISOString();
    mesa.items = mesa.items.slice(0, 2).map((item) => ({
      ...item,
      status: 'available',
      lockedBy: null,
      lock_expires_at: null,
      claims: [],
    }));
    state.mesas.push(mesa);
    const historyBefore = [...state.history];

    try {
      const [firstItem, secondItem] = mesa.items;
      const first = await mockPayMesa(code, {
        idempotency_key: key,
        payment_type: 'card',
        stripe_payment_method_id: 'pm_first_source',
        items: [
          { item_id: firstItem.id, fraction_bps: 5000 },
          { item_id: secondItem.id, fraction_bps: 2500 },
        ],
        tip_cents: 0,
      }, 'user');

      const replay = await mockPayMesa(code, {
        tip_cents: 0,
        items: [
          { fraction_bps: 2500, item_id: secondItem.id },
          { fraction_bps: 5000, item_id: firstItem.id },
        ],
        stripe_payment_method_id: 'pm_retry_materialized_anew',
        payment_type: 'card',
        idempotency_key: key,
      }, 'user');

      expect(replay).toMatchObject({ idempotent: true, attempt: { id: first.attempt.id } });
      await expect(mockPayMesa(code, {
        idempotency_key: key,
        payment_type: 'card',
        items: [
          { item_id: firstItem.id, fraction_bps: 3333 },
          { item_id: secondItem.id, fraction_bps: 2500 },
        ],
        tip_cents: 0,
      }, 'user')).rejects.toMatchObject({ status: 409, message: 'idempotency_conflict' });
    } finally {
      state.mesas.splice(state.mesas.indexOf(mesa), 1);
      state.history.splice(0, state.history.length, ...historyBefore);
      delete state.idempotency[`pay:${code}:${key}`];
      persist();
      await Promise.resolve();
    }
  });

  it('saldo insuficiente en el segundo slot no revierte el pago anterior ni marca el nuevo', async () => {
    const template = state.mesas.find((mesa) => mesa.division_mode === 'igual');
    expect(template).toBeDefined();
    const mesa = structuredClone(template!);
    const code = 'TEST-EQUAL-ROLLBACK-1';
    const firstKey = 'mock-equal-first-idem-1';
    const secondKey = 'mock-equal-second-idem-1';
    mesa.id = 'mock-mesa-equal-rollback-id';
    mesa.code = code;
    mesa.total_cents = 2000;
    mesa.paid_amount_cents = 0;
    mesa.tip_amount_cents = 0;
    mesa.expected_participants = 2;
    mesa.status = 'open';
    mesa.expires_at = new Date(Date.now() + 60_000).toISOString();
    mesa.items = [];
    mesa.slots = [0, 1].map((slot_index) => ({
      slot_index,
      amount_cents: 1000,
      status: 'available' as const,
      claimedBy: null,
    }));

    const balanceBefore = state.balance_cents;
    const heldBefore = state.held_balance_cents;
    const historyBefore = [...state.history];
    const walletTxBefore = [...state.walletTx];
    state.mesas.push(mesa);
    state.balance_cents = 3000;
    state.held_balance_cents = 0;

    try {
      const firstRequest = {
        idempotency_key: firstKey,
        payment_type: 'wallet' as const,
        item_ids: [],
        tip_cents: 0,
      };
      await mockPayMesa(code, firstRequest, 'user');
      expect(mesa.slots?.[0]).toMatchObject({ status: 'paid', claimedBy: 'user' });
      expect(mesa.slots?.[1]).toMatchObject({ status: 'available', claimedBy: null });

      const balanceAfterFirst = state.balance_cents;
      const paidAfterFirst = mesa.paid_amount_cents;
      const replay = await mockPayMesa(code, firstRequest, 'user');
      expect(replay).toMatchObject({ idempotent: true });
      expect(state.balance_cents).toBe(balanceAfterFirst);
      expect(mesa.paid_amount_cents).toBe(paidAfterFirst);
      expect(mesa.slots?.[1]).toMatchObject({ status: 'available', claimedBy: null });

      state.balance_cents = 500;
      const paidBeforeSecond = mesa.paid_amount_cents;
      const historyAfterFirst = state.history.length;
      const walletTxAfterFirst = state.walletTx.length;
      await expect(mockPayMesa(code, {
        idempotency_key: secondKey,
        payment_type: 'wallet',
        item_ids: [],
        tip_cents: 0,
      }, 'user')).rejects.toMatchObject({ status: 402, message: 'insufficient_funds' });

      expect(state.balance_cents).toBe(500);
      expect(mesa.paid_amount_cents).toBe(paidBeforeSecond);
      expect(mesa.slots?.[0]).toMatchObject({ status: 'paid', claimedBy: 'user' });
      expect(mesa.slots?.[1]).toMatchObject({ status: 'available', claimedBy: null });
      expect(state.history).toHaveLength(historyAfterFirst);
      expect(state.walletTx).toHaveLength(walletTxAfterFirst);
      expect(state.idempotency[`pay:${code}:${secondKey}`]).toBeUndefined();
    } finally {
      state.mesas.splice(state.mesas.indexOf(mesa), 1);
      state.balance_cents = balanceBefore;
      state.held_balance_cents = heldBefore;
      state.history.splice(0, state.history.length, ...historyBefore);
      state.walletTx.splice(0, state.walletTx.length, ...walletTxBefore);
      delete state.idempotency[`pay:${code}:${firstKey}`];
      delete state.idempotency[`pay:${code}:${secondKey}`];
      persist();
      await Promise.resolve();
    }
  });

  it('rechaza centavos fraccionales o inseguros antes de mutar mock', async () => {
    const balanceBefore = state.balance_cents;
    const transfersBefore = state.transfers.length;
    const friend = state.friends[0];

    await expect(mockTopupCard(5000.5, state.paymentMethods[0].id, 'mock-invalid-cents-topup')).rejects.toMatchObject({
      status: 400,
      message: 'validation_error',
    });
    await expect(mockCreateTransfer({
      amount_cents: Number.MAX_SAFE_INTEGER + 1,
      to_payme_id: friend.payme_id,
      idempotency_key: 'mock-invalid-cents-transfer',
    })).rejects.toMatchObject({ status: 400, message: 'validation_error' });

    expect(state.balance_cents).toBe(balanceBefore);
    expect(state.transfers).toHaveLength(transfersBefore);
  });
});
