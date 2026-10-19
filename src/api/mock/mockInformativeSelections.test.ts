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
    // Decisión 81: con la otra mitad del primer plato sin declarar, NO cierra.
    const sinCompletar = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: secondItems.map((item) => ({ item_id: item.id, declared_fraction_bps: 10000 })),
      confirm_closure: true,
    });
    expect(sinCompletar.coverage.all_items_selected).toBe(false);
    expect(sinCompletar.mesa.status).toBe('open');
    const closed = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [
        ...firstItems.map((item) => ({ item_id: item.id, declared_fraction_bps: 5000 as const })),
        ...secondItems.map((item) => ({ item_id: item.id, declared_fraction_bps: 10000 as const })),
      ],
      confirm_closure: true,
    });
    expect(closed.coverage.all_items_selected).toBe(true);
    expect(closed.mesa).toMatchObject({ status: 'expired', closure_reason: 'all_items_selected' });
    expect(closed.selection.items.map((item) => item.item_id)).toEqual(mesa.items.map((item) => item.id).sort());

    state.user = { ...state.user, id: firstUserId };
    const ownFirst = await mock.mockGetInformativeSelection(mesa.code);
    expect(ownFirst.coverage.all_items_selected).toBe(true);
    expect(ownFirst.selection.items).toEqual(first.selection.items);
    expect(ownFirst.selection.items).not.toEqual(closed.selection.items);
  });

  /**
   * Decisión 81 · réplica de `assertWithinWhole` del dueño v2.134.0 (wire §2):
   * subir por encima del entero da 409 con el plato y lo que queda SIN contar lo
   * propio; bajar, soltar o reenviar lo mismo nunca se rechaza; no escribe nada.
   */
  it('409 informative_fraction_exceeds_item al pasar del entero; bajar nunca se rechaza', async () => {
    const { mock, state, mesa } = await subject();
    const plato = mesa.items[0]!;
    const primero = state.user.id;
    await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: plato.id, declared_fraction_bps: 5000 }], confirm_closure: true,
    });
    state.user = { ...state.user, id: 'e0000000-0000-4000-8000-000000000998' };
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: plato.id, declared_fraction_bps: 10000 }], confirm_closure: true,
    })).rejects.toMatchObject({
      status: 409,
      message: 'informative_fraction_exceeds_item',
      extra: { item_id: plato.id, remaining_bps: 5000 },
    });
    // No escribió nada: esta cuenta sigue sin selección.
    expect((await mock.mockGetInformativeSelection(mesa.code)).selection.items).toEqual([]);
    // Lo que queda sí entra.
    await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: plato.id, declared_fraction_bps: 5000 }], confirm_closure: true,
    });
    // El primero ya no puede subir: lo que queda SIN contar lo suyo es la
    // mitad que declaró el otro (wire §2). Sí puede bajar o reenviar.
    state.user = { ...state.user, id: primero };
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: plato.id, declared_fraction_bps: 10000 }], confirm_closure: true,
    })).rejects.toMatchObject({ status: 409, extra: { remaining_bps: 5000 } });
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: plato.id, declared_fraction_bps: 5000 }], confirm_closure: true,
    })).resolves.toBeTruthy();
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: plato.id, declared_fraction_bps: 2500 }], confirm_closure: true,
    })).resolves.toBeTruthy();
  });

  it('decisión 79 · el detalle publica lo que queda por plato, sumando a todos y sin nombres', async () => {
    const { mock, state, mesa } = await subject();
    const plato = mesa.items[0]!;
    state.informativeSelections[`${mesa.id}:e0000000-0000-4000-8000-000000000997`] = {
      items: [{ item_id: plato.id, declared_fraction_bps: 5000 }], updated_at: new Date().toISOString(),
    };
    const detalle = (await mock.mockGetMesa(mesa.code, 'user')).mesa;
    const item = detalle.items.find((candidate) => candidate.id === plato.id)!;
    expect(item.informative_remaining_bps).toBe(5000);
    expect(detalle.items.filter((candidate) => candidate.id !== plato.id)
      .every((candidate) => candidate.informative_remaining_bps === 10000)).toBe(true);
    // 3 × 3333 = 9999 cuenta como completo (tope de 100 bps).
    state.informativeSelections[`${mesa.id}:e0000000-0000-4000-8000-000000000997`] = {
      items: [{ item_id: plato.id, declared_fraction_bps: 3333 }], updated_at: new Date().toISOString(),
    };
    for (const otra of ['e0000000-0000-4000-8000-000000000996', 'e0000000-0000-4000-8000-000000000995']) {
      state.informativeSelections[`${mesa.id}:${otra}`] = {
        items: [{ item_id: plato.id, declared_fraction_bps: 3333 }], updated_at: new Date().toISOString(),
      };
    }
    const casi = (await mock.mockGetMesa(mesa.code, 'user')).mesa.items.find((candidate) => candidate.id === plato.id)!;
    expect(casi.informative_remaining_bps).toBe(0);
    expect(JSON.stringify(casi)).not.toMatch(/e0000000|user_id|declared_by/);
  });

  it('decisión 76 · /mesas/open publica lo ELEGIDO en «igual» con la misma cuenta que adentro', async () => {
    const { mock, state, mesa } = await subject();
    mesa.openedByUser = true;
    const plato = mesa.items[0]!;
    state.informativeSelections[`${mesa.id}:e0000000-0000-4000-8000-000000000997`] = {
      items: [{ item_id: plato.id, declared_fraction_bps: 5000 }], updated_at: new Date().toISOString(),
    };
    const abierta = (await mock.mockOpenMesas()).mesas.find((m) => m.code === mesa.code)!;
    const linea = plato.price_cents * plato.quantity;
    expect(abierta).toMatchObject({
      division_mode: 'igual',
      assigned_cents: Math.floor(linea / 2),
      assignment_complete: false,
    });
  });

  /**
   * v2.124.0 (AB-FRACCIONES-IGUAL, Decisión de Mati e9aa0450…): paridad con
   * `validateInformativeFractions` del dueño. Con N conocido sólo 1/k con k ≤ N
   * (400); sin N sólo las seis legacy (409); lo ya guardado se reenvía igual.
   */
  it('con N conocido acepta 1/k hasta N y rechaza el resto con 400 visible', async () => {
    const { mock, mesa } = await subject();
    mesa.original_participants = 3;
    const first = mesa.items[0]!;
    const saved = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 3333 }], confirm_closure: true,
    });
    expect(saved.selection.items).toEqual([{ item_id: first.id, declared_fraction_bps: 3333 }]);
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 1666 }], confirm_closure: true,
    })).rejects.toMatchObject({ status: 400, message: 'fraction_not_allowed_for_original_participants' });
    // Estrechamiento declarado: 2/3 ya no entra como selección NUEVA con N.
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 6667 }], confirm_closure: true,
    })).rejects.toMatchObject({ status: 400, message: 'fraction_not_allowed_for_original_participants' });
    // Nada de eso tocó lo guardado.
    expect((await mock.mockGetInformativeSelection(mesa.code)).selection.items)
      .toEqual([{ item_id: first.id, declared_fraction_bps: 3333 }]);
  });

  it('🔴 D375 · con N = 50 (sube el tope de personas) la porción sigue en 1/20: nada lanza, 1/21 no existe', async () => {
    // API-9: sin min(N, 20), el Set de 1..50 llegaba a 21 y `denominatorBps` lanzaba un Error que no es de la API.
    const { mock, mesa } = await subject();
    mesa.original_participants = 50;
    const first = mesa.items[0]!;
    const saved = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 500 }], confirm_closure: true,
    });
    expect(saved.selection.items).toEqual([{ item_id: first.id, declared_fraction_bps: 500 }]);
    // 476 (1/21) no está en el dominio del dueño: 400 de forma, nunca un 1/21.
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 476 as never }], confirm_closure: true,
    })).rejects.toMatchObject({ status: 400, message: 'validation_error' });
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 6667 }], confirm_closure: true,
    })).rejects.toMatchObject({ status: 400, message: 'fraction_not_allowed_for_original_participants' });
  });

  it('sin N sólo admite las seis legacy y contesta 409 sin inventar N', async () => {
    const { mock, mesa } = await subject();
    delete mesa.original_participants;
    const first = mesa.items[0]!;
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 1428 }], confirm_closure: true,
    })).rejects.toMatchObject({ status: 409, message: 'original_participants_unknown' });
    const saved = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 7500 }], confirm_closure: true,
    });
    expect(saved.selection.items).toEqual([{ item_id: first.id, declared_fraction_bps: 7500 }]);
  });

  it('una fracción legacy ya guardada se reenvía igual aunque N la excluya', async () => {
    const { mock, mesa } = await subject();
    delete mesa.original_participants;
    const [first, second] = [mesa.items[0]!, mesa.items[1]!];
    await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 7500 }], confirm_closure: true,
    });
    mesa.original_participants = 4;
    const items = [
      { item_id: first.id, declared_fraction_bps: 7500 as const },
      { item_id: second.id, declared_fraction_bps: 2500 as const },
    ].sort((a, b) => a.item_id.localeCompare(b.item_id));
    const saved = await mock.mockReplaceInformativeSelection(mesa.code, { items, confirm_closure: true });
    expect(saved.selection.items).toEqual(items);
    // Fuera de los 22 sigue siendo validation_error, antes que cualquier regla por N.
    await expect(mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: first.id, declared_fraction_bps: 2001 as unknown as 2500 }], confirm_closure: true,
    })).rejects.toMatchObject({ status: 400, message: 'validation_error' });
  });
});

/**
 * D389 · réplica del dueño 2.188.0: en una mesa SIN garantía, un plato de $0 cuenta como cubierto aunque nadie lo
 * elija, en los tres lugares: el cierre por selección (`items/lock`), la cobertura informativa y `assignment_complete`
 * de `/mesas/open`. Cada caso con su control: con garantía, o con algo con precio sin elegir, no alcanza.
 */
describe('D389 · un plato de $0 cuenta como cubierto en la mesa sin garantía (mock)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    storage();
  });

  /** Una mesa con dos platos: uno de $0 y uno de $120 (total $120). */
  async function conCero(division: 'consumo' | 'igual', garantia: boolean) {
    const mock = await import('./mockApi');
    const { state } = await import('./store');
    const mesa = state.mesas.find((m) => m.division_mode === division && m.items.length >= 1)!;
    const base = mesa.items[0]!;
    mesa.status = 'open';
    mesa.guarantee_mode = garantia;
    mesa.guarantee_method = garantia ? 'card' : 'none';
    mesa.closure_reason = null;
    mesa.original_participants = undefined;
    mesa.items = [
      { ...base, id: 'd3890000-0000-4000-8000-000000000001', name: 'Agua de la casa', price_cents: 0, quantity: 1, claims: [], status: 'available', lockedBy: null, lock_expires_at: null },
      { ...base, id: 'd3890000-0000-4000-8000-000000000002', name: 'Pescado', price_cents: 12000, quantity: 1, claims: [], status: 'available', lockedBy: null, lock_expires_at: null },
    ];
    mesa.total_cents = 12000;
    const [cero, pescado] = mesa.items as [typeof base, typeof base];
    return { mock, state, mesa, cero, pescado };
  }

  it('🔴 consumo: elegir sólo el plato con precio cierra la mesa (all_items_selected)', async () => {
    const { mock, mesa, pescado } = await conCero('consumo', false);
    const r = await mock.mockLockItems(mesa.code, [{ item_id: pescado.id, fraction_bps: 10000 }], 'user');
    expect(r).toMatchObject({ mesa_status: 'expired', closure_reason: 'all_items_selected' });
    expect(mesa).toMatchObject({ status: 'expired', closure_reason: 'all_items_selected' });
  });

  it('control: elegir sólo el $0 no cierra (falta lo que tiene precio); y con garantía, el mismo pedido tampoco', async () => {
    const sinGarantia = await conCero('consumo', false);
    const soloCero = await sinGarantia.mock.mockLockItems(sinGarantia.mesa.code, [{ item_id: sinGarantia.cero.id, fraction_bps: 10000 }], 'user');
    expect(soloCero).not.toHaveProperty('closure_reason');
    expect(sinGarantia.mesa.status).toBe('open');

    vi.resetModules();
    storage();
    const conGarantia = await conCero('consumo', true);
    const r = await conGarantia.mock.mockLockItems(conGarantia.mesa.code, [{ item_id: conGarantia.pescado.id, fraction_bps: 10000 }], 'user');
    expect(r).not.toHaveProperty('closure_reason');
    expect(conGarantia.mesa.status).toBe('open');
  });

  it('🔴 igual informativo: declarar sólo el plato con precio da la cobertura completa y cierra', async () => {
    const { mock, mesa, pescado } = await conCero('igual', false);
    const r = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: pescado.id, declared_fraction_bps: 10000 }],
      confirm_closure: true,
    });
    expect(r.coverage.all_items_selected).toBe(true);
    expect(r.mesa).toMatchObject({ status: 'expired', closure_reason: 'all_items_selected' });
  });

  it('control: en igual informativo, declarar sólo el $0 no cubre la mesa', async () => {
    const { mock, mesa, cero } = await conCero('igual', false);
    const r = await mock.mockReplaceInformativeSelection(mesa.code, {
      items: [{ item_id: cero.id, declared_fraction_bps: 10000 }],
      confirm_closure: true,
    });
    expect(r.coverage.all_items_selected).toBe(false);
    expect(r.mesa.status).toBe('open');
  });

  /**
   * Como el dueño (`con_importe > 0`): una mesa sin ningún plato con importe no se da por cubierta, ni en el cierre por
   * selección ni en la cobertura informativa. Sin esa regla, la mesa toda en $0 se cerraba con cualquier pedido.
   */
  it('consumo: una mesa toda en $0 no se cierra por selección, aunque se elija todo', async () => {
    const consumo = await conCero('consumo', false);
    consumo.pescado.price_cents = 0;
    consumo.mesa.total_cents = 0;
    const r = await consumo.mock.mockLockItems(consumo.mesa.code, [
      { item_id: consumo.cero.id, fraction_bps: 10000 },
      { item_id: consumo.pescado.id, fraction_bps: 10000 },
    ], 'user');
    expect(r).not.toHaveProperty('closure_reason');
    expect(consumo.mesa.status).toBe('open');
  });

  it('igual informativo: una mesa toda en $0 no queda cubierta, aunque se declare todo', async () => {
    const igual = await conCero('igual', false);
    igual.pescado.price_cents = 0;
    igual.mesa.total_cents = 0;
    const cobertura = await igual.mock.mockReplaceInformativeSelection(igual.mesa.code, {
      items: [{ item_id: igual.cero.id, declared_fraction_bps: 10000 }, { item_id: igual.pescado.id, declared_fraction_bps: 10000 }],
      confirm_closure: true,
    });
    expect(cobertura.coverage.all_items_selected).toBe(false);
    expect(cobertura.mesa.status).toBe('open');
  });

  /**
   * F1 · el mock absorbe como el dueño (`effectiveBps` con `COMPLETING_TOLERANCE_BPS`): el ⅓ que deja menos de 100
   * bps se guarda con todo lo que queda y la mesa se cierra; con un faltante de 100, se guarda lo pedido. Es lo que
   * la hoja «antes de cerrar» predice con `restanteAlGuardar`.
   */
  async function tercio(otros: [number, number]) {
    const r = await conCero('consumo', false);
    r.mesa.items = [r.pescado];
    r.pescado.claims = otros.map((fraction_bps) => ({ who: 'other' as const, fraction_bps, amount_cents: null, status: 'locked' as const }));
    return r;
  }

  it('🔴 F1 · consumo: el tercer ⅓ sobre los 3334 que quedan se guarda como 3334 y cierra la mesa', async () => {
    const { mock, mesa, pescado } = await tercio([3333, 3333]);
    const r = await mock.mockLockItems(mesa.code, [{ item_id: pescado.id, fraction_bps: 3333 }], 'user');
    expect(pescado.claims.filter((c) => c.who === 'user').map((c) => c.fraction_bps)).toEqual([3334]);
    expect(r).toMatchObject({ mesa_status: 'expired', closure_reason: 'all_items_selected' });
  });

  it('F1 · el borde: con un faltante de 100 se guarda lo pedido y la mesa sigue abierta', async () => {
    const { mock, mesa, pescado } = await tercio([3333, 3234]);
    const r = await mock.mockLockItems(mesa.code, [{ item_id: pescado.id, fraction_bps: 3333 }], 'user');
    expect(pescado.claims.filter((c) => c.who === 'user').map((c) => c.fraction_bps)).toEqual([3333]);
    expect(r).not.toHaveProperty('closure_reason');
    expect(mesa.status).toBe('open');
  });

  it('🔴 /mesas/open: con el plato con precio elegido, assignment_complete es true; con garantía, false', async () => {
    for (const garantia of [false, true]) {
      vi.resetModules();
      storage();
      const { mock, mesa, pescado } = await conCero('consumo', garantia);
      mesa.openedByUser = true;
      pescado.claims = [{ who: 'other', fraction_bps: 10000, amount_cents: null, status: 'locked' }];
      const abierta = (await mock.mockOpenMesas()).mesas.find((m) => m.code === mesa.code)!;
      expect(abierta, `garantía ${garantia}`).toMatchObject({ assigned_cents: 12000, assignment_complete: !garantia });
    }
  });
});
