import { beforeEach, describe, expect, it, vi } from 'vitest';

function storage() {
  const values = new Map<string, string>([['payme.app.mock.money_rail.v1', 'disabled']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
}

async function subject() {
  const mock = await import('./mockApi');
  const { state } = await import('./store');
  const mesa = state.mesas.find((candidate) => candidate.division_mode === 'igual' && candidate.items.length >= 2)!;
  mesa.status = 'open';
  mesa.guarantee_mode = false;
  mesa.guarantee_method = 'none';
  mesa.closure_reason = null;
  return { mock, state, mesa };
}

describe('mock selección informativa v2', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    storage();
  });

  it('reemplaza, persiste y GET devuelve los pares canónicos propios', async () => {
    const { mock, mesa } = await subject();
    const first = mesa.items[0]!;
    const saved = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 5000 }],
      confirm_closure: true,
    });
    expect(saved.selection.items).toEqual([{ item_id: first.id, declared_fraction_bps: 5000 }]);
    expect((await mock.mockGetInformativeSelection(mesa.code)).selection.items).toEqual(saved.selection.items);
  });

  it('vacío reemplaza vacío sin atajo local', async () => {
    const { mock, mesa } = await subject();
    await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: mesa.items[0]!.id, declared_fraction_bps: 10000 }],
      confirm_closure: true,
    });
    const emptied = await mock.mockReplaceInformativeSelection(mesa.code, { items: [], confirm_closure: true });
    expect(emptied.selection.items).toEqual([]);
    expect(emptied.selection.updated_at).toBeNull();
  });

  it('al cubrir todos cierra; después sólo admite replay exacto', async () => {
    const { mock, mesa } = await subject();
    const request = {
      items: mesa.items.map((item) => ({ item_id: item.id, declared_fraction_bps: 10000 as const })),
      confirm_closure: true as const,
    };
    const closed = await mock.mockReplaceInformativeSelection(mesa.code, request);
    expect(closed.mesa).toMatchObject({ status: 'expired', mutable: false, closure_reason: 'all_items_selected' });
    expect((await mock.mockReplaceInformativeSelection(mesa.code, request)).selection.items).toEqual(closed.selection.items);
    await expect(mock.mockReplaceInformativeSelection(mesa.code, { items: [], confirm_closure: true }))
      .rejects.toMatchObject({ status: 409, message: 'informative_selection_read_only' });
  });

  it('no habilita selección si pagos están activos', async () => {
    const { mock, mesa } = await subject();
    localStorage.setItem('payme.app.mock.money_rail.v1', 'sandbox');
    expect((await mock.mockGetInformativeSelection(mesa.code)).mesa.mutable).toBe(false);
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: mesa.items[0]!.id, declared_fraction_bps: 10000 }],
      confirm_closure: true,
    }))
      .rejects.toMatchObject({ status: 409, message: 'informative_selection_requires_payments_disabled' });
  });

  it('rechaza shapes abiertos y duplicados después de normalizar UUID', async () => {
    const { mock, mesa } = await subject();
    const id = mesa.items[0]!.id;
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [
        { item_id: id, declared_fraction_bps: 5000 },
        { item_id: id.toUpperCase(), declared_fraction_bps: 5000 },
      ],
      confirm_closure: true,
    })).rejects.toMatchObject({ status: 400, message: 'validation_error' });
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [], confirm_closure: true, extra: true,
    } as never)).rejects.toMatchObject({ status: 400, message: 'validation_error' });
  });

  it('cobertura es global por mesa, pero GET conserva sólo la selección propia', async () => {
    const { mock, state, mesa } = await subject();
    const firstUserId = state.user.id;
    const firstItems = mesa.items.slice(0, 1);
    const secondItems = mesa.items.slice(1);

    const first = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: firstItems.map((item) => ({ item_id: item.id, declared_fraction_bps: 5000 })),
      confirm_closure: true,
    });
    expect(first.coverage.all_items_selected).toBe(false);

    const secondUserId = 'e0000000-0000-4000-8000-000000000999';
    state.user = { ...state.user, id: secondUserId };
    const closed = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: secondItems.map((item) => ({ item_id: item.id, declared_fraction_bps: 10000 })),
      confirm_closure: true,
    });
    expect(closed.coverage.all_items_selected).toBe(true);
    expect(closed.mesa).toMatchObject({ status: 'expired', closure_reason: 'all_items_selected' });
    expect(closed.selection.items.map((item) => item.item_id)).toEqual(secondItems.map((item) => item.id).sort());

    state.user = { ...state.user, id: firstUserId };
    const ownFirst = await mock.mockGetInformativeSelection(mesa.code);
    expect(ownFirst.coverage.all_items_selected).toBe(true);
    expect(ownFirst.selection.items).toEqual(first.selection.items);
    expect(ownFirst.selection.items).not.toEqual(closed.selection.items);
  });
});
