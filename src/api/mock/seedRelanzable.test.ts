import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G-36 (ORDEN 2-A.4) · EL SEED QUE ENVEJECE SE RE-SIEMBRA SOLO — CON RELOJ
 * CONTROLADO, como exige la orden: crear estado → adelantar el tiempo más
 * allá de TODAS las expiraciones → recargar desde persistencia → la demo
 * sigue coherente sin reset manual.
 *
 * Y las dos direcciones que hacen honesto el relanzamiento:
 * - lo NUNCA tocado vuelve (la demo no se pudre sola entre sesiones);
 * - lo TOCADO por el usuario y lo que no lleva la marca NO se reescriben
 *   jamás — relanzarle una mesa pagada a alguien sería el mock inventándole
 *   pasado, y PA-1099 tiene que seguir contando la historia A-2.
 */

function setupStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear(),
  });
}

/** Persiste el estado vigente y devuelve una recarga fresca del módulo. */
async function persistirYRehidratar() {
  const { persist } = await import('./store');
  persist();
  // persist() agrupa en un microtask: hay que drenarlo antes de re-importar.
  await Promise.resolve();
  vi.resetModules();
  return import('./store');
}

describe('G-36 · relanzamiento del seed vencido, con reloj controlado', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T20:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dos horas después, la demo vuelve coherente: las tres vivas del seed, con reloj adelante', async () => {
    const { state } = await import('./store');
    const codigos = ['PA-2847', 'PA-3121', 'PA-4520'];
    for (const c of codigos) {
      expect(state.mesas.find((m) => m.code === c)?.seedRelanzable).toBeTruthy();
    }

    // Adelantar el tiempo MÁS ALLÁ de todas las expiraciones (la más larga es
    // 29 min) y recargar desde persistencia.
    vi.setSystemTime(new Date('2026-08-06T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();

    for (const c of codigos) {
      const mesa = renacido.mesas.find((m) => m.code === c)!;
      const original = c === 'PA-4520' ? 'open' : 'partially_paid';
      expect(mesa.status).toBe(original);
      expect(new Date(mesa.expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(mesa.captured_shortfall_cents).toBe(0);
    }
    // La invitación de Sofía sigue atada al reloj de SU mesa: canjeable.
    const inv = renacido.pendingInvitations.find((i) => i.mesa_code === 'PA-4520')!;
    expect(inv.expires_at).toBe(renacido.mesas.find((m) => m.code === 'PA-4520')!.expires_at);
  });

  it('PA-1099 NO se relanza: su historia ES estar cerrada (A-2)', async () => {
    await import('./store');
    vi.setSystemTime(new Date('2026-08-06T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();
    expect(renacido.mesas.find((m) => m.code === 'PA-1099')!.status).toBe('completed');
  });

  it('la mesa TOCADA por el usuario no se reescribe: su pago es historia, no seed', async () => {
    const { state } = await import('./store');
    // El usuario pagó su parte en PA-3121 antes de irse a dormir.
    state.history.push({
      id: 'pago-del-usuario',
      amount_cents: 15500,
      date: new Date().toISOString(),
      mesa_code: 'PA-3121',
      mesa_status: 'partially_paid',
      restaurant: 'Hanzo Sushi',
      category: 'japanese',
    });

    vi.setSystemTime(new Date('2026-08-06T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();

    // PA-3121 quedó donde el reloj la dejó (vencida, NO relanzada)…
    const tocada = renacido.mesas.find((m) => m.code === 'PA-3121')!;
    expect(new Date(tocada.expires_at).getTime()).toBeLessThan(Date.now());
    expect(tocada.status).toBe('partially_paid'); // settleIfExpired corre al LEER, no acá
    // …y las no tocadas volvieron igual: el relanzamiento es POR MESA.
    expect(new Date(renacido.mesas.find((m) => m.code === 'PA-2847')!.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('la mesa creada por el usuario no lleva la marca y no se relanza', async () => {
    const { state } = await import('./store');
    state.mesas.unshift({
      ...state.mesas.find((m) => m.code === 'PA-4520')!,
      id: 'mesa-del-usuario',
      code: 'PA-9001',
      openedByUser: true,
      seedRelanzable: undefined,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });

    vi.setSystemTime(new Date('2026-08-06T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();
    const propia = renacido.mesas.find((m) => m.code === 'PA-9001')!;
    expect(new Date(propia.expires_at).getTime()).toBeLessThan(Date.now());
  });
});

/**
 * G-36 · LEGACY (ORDEN 1-C·B) · EL ESTADO QUE YA ESTÁ ROTO EN LOS TELÉFONOS.
 *
 * Un `localStorage` anterior a `67fc0de` no tiene la marca `seedRelanzable`,
 * así que el relanzamiento no lo alcanzaba: quedaba podrido para siempre. La
 * migración le pone la marca a lo que es INEQUÍVOCAMENTE del seed y nadie
 * tocó — y estos tests recorren, uno por uno, los daños que una migración
 * ingenua causaría (cada `it` es un riesgo medido en la auditoría del
 * 2026-08-06, no una hipótesis).
 */

/** Un estado como el que hay HOY en un teléfono viejo: sin marca y vencido. */
function estadoLegacy(mesas: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    user: { id: 'u1', payme_id: 'payme_mx_mati', first_name: 'Mati', last_name: 'V', email: 'm@x.mx' },
    balance_cents: 125000,
    held_balance_cents: 0,
    clabe: null,
    paymentMethods: [],
    friends: [],
    directory: [],
    friendRequests: [],
    blockedUserIds: [],
    groups: [],
    mesas,
    history: [],
    walletTx: [],
    transfers: [],
    notifications: [],
    pendingInvitations: [],
    linkTokens: {},
    joinedMesaCodes: [],
    idempotency: {},
    ...extra,
  });
}

/** PA-2847 tal como quedó en un teléfono viejo: vencida y ya liquidada. */
function pa2847Legacy(over: Record<string, unknown> = {}) {
  return {
    id: 'c-legacy-1',
    code: 'PA-2847',
    restaurant: { id: 'r1', name: 'La Parolaccia', category: 'italian', address: null },
    total_cents: 84000,
    paid_amount_cents: 32500,
    tip_amount_cents: 0,
    division_mode: 'consumo',
    expected_participants: 4,
    status: 'completed',
    expires_at: new Date('2026-08-05T10:00:00Z').toISOString(),
    items: [],
    slots: null,
    active_staff: [],
    openedByUser: true,
    captured_shortfall_cents: 51500,
    guarantee_method: 'card',
    ...over,
  };
}

describe('G-36 legacy · el estado pre-67fc0de se rescata sólo si se acredita', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T20:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('🔴 el caso de la orden: sin marca, vencida e intacta → migrada Y relanzada', async () => {
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([pa2847Legacy()]));
    const { state } = await import('./store');
    const mesa = state.mesas.find((m) => m.code === 'PA-2847')!;
    expect(mesa.seedRelanzable).toEqual({ status: 'partially_paid', expiraEnMs: 29 * 60_000 });
    expect(mesa.status).toBe('partially_paid');
    expect(new Date(mesa.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(mesa.captured_shortfall_cents).toBe(0);
  });

  it('la plantilla sale de la TABLA, no del estado sucio (status completed / reloj pasado)', async () => {
    // Derivarla del persistido grabaría `{status:'completed'}` con reloj
    // futuro —imposible— y la marca se PERSISTE: el teléfono quedaría podrido
    // Y marcado, peor que antes.
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([pa2847Legacy()]));
    const { state } = await import('./store');
    expect(state.mesas.find((m) => m.code === 'PA-2847')!.seedRelanzable!.status).not.toBe('completed');
  });

  it('🔴 PA-1099 NO se migra aunque nadie la haya tocado: su historia ES estar cerrada', async () => {
    const pa1099 = {
      ...pa2847Legacy(),
      id: 'c-legacy-9',
      code: 'PA-1099',
      total_cents: 84000,
      paid_amount_cents: 63000,
      status: 'settled',
      captured_shortfall_cents: 21000,
    };
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([pa1099]));
    const { state } = await import('./store');
    const mesa = state.mesas.find((m) => m.code === 'PA-1099')!;
    expect(mesa.seedRelanzable).toBeUndefined();
    expect(mesa.status).toBe('settled');
  });

  it('🔴 código DUPLICADO → no se migra ninguna: no se puede acreditar cuál es cuál', async () => {
    // Los códigos nuevos salen de PA-1000..9999 sin chequeo de unicidad: una
    // mesa propia puede nacer "PA-2847".
    const propia = { ...pa2847Legacy(), id: 'c-del-usuario' };
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([propia, pa2847Legacy()]));
    const { state } = await import('./store');
    for (const m of state.mesas.filter((x) => x.code === 'PA-2847')) {
      expect(m.seedRelanzable).toBeUndefined();
    }
  });

  it('🔴 guarantee_method wallet (legacy de PA-3121) NO se migra: relanzarla debitaría saldo cada sesión', async () => {
    const pa3121 = {
      ...pa2847Legacy(),
      id: 'c-legacy-3',
      code: 'PA-3121',
      restaurant: { id: 'r2', name: 'Hanzo Sushi', category: 'japanese', address: null },
      total_cents: 62000,
      paid_amount_cents: 31000,
      division_mode: 'igual',
      guarantee_method: 'wallet',
    };
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([pa3121]));
    const { state } = await import('./store');
    expect(state.mesas.find((m) => m.code === 'PA-3121')!.seedRelanzable).toBeUndefined();
    // Y el saldo no se movió: la mesa quedó conservada, no revivida.
    expect(state.balance_cents).toBe(125000);
  });

  it('🔴 un pago del usuario como GUEST cuenta como tocada (misma persona, mismo teléfono)', async () => {
    const conPagoGuest = pa2847Legacy({
      items: [
        {
          id: 'i1', name: 'Pizza', category: 'other', price_cents: 18500, quantity: 1,
          status: 'paid', lockedBy: 'guest', lock_expires_at: null,
          claims: [{ who: 'guest', fraction_bps: 10000, amount_cents: 18500, status: 'paid' }],
        },
      ],
    });
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([conPagoGuest]));
    const { state } = await import('./store');
    expect(state.mesas.find((m) => m.code === 'PA-2847')!.seedRelanzable).toBeUndefined();
  });

  it('paid_amount_cents distinto del seed → alguien pagó: no se migra', async () => {
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([pa2847Legacy({ paid_amount_cents: 53500 })]));
    const { state } = await import('./store');
    expect(state.mesas.find((m) => m.code === 'PA-2847')!.seedRelanzable).toBeUndefined();
  });

  it('una mesa materializada con la firma de PA-2847 pero otro código NO se toca', async () => {
    // `materializeDemoMesa` clona esa firma para CUALQUIER código: si la
    // migración fuera por firma en vez de por código, reescribiría mesas ajenas.
    const materializada = { ...pa2847Legacy(), id: 'c-mat', code: 'PA-7777', openedByUser: false };
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([materializada]));
    const { state } = await import('./store');
    expect(state.mesas.find((m) => m.code === 'PA-7777')!.seedRelanzable).toBeUndefined();
  });

  it('PA-4520 sin su invitación sembrada → el usuario ya la aceptó: no se migra', async () => {
    const pa4520 = {
      ...pa2847Legacy(),
      id: 'c-legacy-4',
      code: 'PA-4520',
      restaurant: { id: 'r2', name: 'Hanzo Sushi', category: 'japanese', address: null },
      total_cents: 96000,
      paid_amount_cents: 0,
      division_mode: 'igual',
      expected_participants: 3,
      openedByUser: false,
    };
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([pa4520]));
    const { state } = await import('./store');
    expect(state.mesas.find((m) => m.code === 'PA-4520')!.seedRelanzable).toBeUndefined();
  });

  it('la mesa igual migrada recupera sus ítems: no revive con el ticket vacío de H-14', async () => {
    const pa3121 = {
      ...pa2847Legacy(),
      id: 'c-legacy-3b',
      code: 'PA-3121',
      restaurant: { id: 'r2', name: 'Hanzo Sushi', category: 'japanese', address: null },
      total_cents: 62000,
      paid_amount_cents: 31000,
      division_mode: 'igual',
      guarantee_method: 'card',
      items: [],
    };
    localStorage.setItem('payme_mock_state_v1', estadoLegacy([pa3121]));
    const { state } = await import('./store');
    const mesa = state.mesas.find((m) => m.code === 'PA-3121')!;
    expect(mesa.seedRelanzable).toBeTruthy();
    expect(mesa.items.length).toBe(4);
    expect(mesa.items.reduce((s, i) => s + i.price_cents * i.quantity, 0)).toBe(62000);
  });

  it('🔴 una mesa podrida NO puede tirar el estado entero (el catch de afuera lo descartaría)', async () => {
    const rota = { code: 'PA-2847', items: null, slots: 'no soy array', restaurant: null };
    localStorage.setItem(
      'payme_mock_state_v1',
      estadoLegacy([rota as unknown as Record<string, unknown>, pa2847Legacy({ id: 'otra', code: 'PA-5555' })]),
    );
    const { state } = await import('./store');
    // El estado sobrevivió: las tarjetas, amigos e historial del usuario no se
    // perdieron por una fila mala.
    expect(state.mesas.length).toBe(2);
    expect(state.user.payme_id).toBe('payme_mx_mati');
  });
});

describe('la tabla legacy no puede desincronizarse del seed', () => {
  // Aislamiento propio: sin esto el bloque hereda el localStorage del describe
  // anterior —incluida la mesa podrida— y mide contra un estado que no es el
  // seed. Un test que comparte estado con el de al lado no mide lo que dice.
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('cada código de la tabla existe en el seed con la MISMA firma inmutable', async () => {
    // La tabla es explícita a propósito (el seed cambió entre versiones), pero
    // si el seed de HOY se mueve, la tabla tiene que moverse con él o dejar de
    // reconocer lo que dice reconocer.
    const { state, plantillaLegacy, SEED_LEGACY_CODES } = await import('./store');
    for (const code of SEED_LEGACY_CODES) {
      const mesa = state.mesas.find((m) => m.code === code)!;
      const p = plantillaLegacy(code)!;
      expect(mesa, `${code} debe existir en el seed`).toBeTruthy();
      expect({
        total: mesa.total_cents,
        modo: mesa.division_mode,
        n: mesa.expected_participants,
        rest: mesa.restaurant.name,
        abierta: mesa.openedByUser,
        garantia: mesa.guarantee_method,
        pagado: mesa.paid_amount_cents,
        status: mesa.seedRelanzable?.status,
        ms: mesa.seedRelanzable?.expiraEnMs,
      }).toEqual({
        total: p.total_cents,
        modo: p.division_mode,
        n: p.expected_participants,
        rest: p.restaurante,
        abierta: p.openedByUser,
        garantia: p.guarantee_method,
        pagado: p.paid_amount_cents,
        status: p.status,
        ms: p.expiraEnMs,
      });
    }
  });

  it('PA-1099 NO está en la tabla, y eso es la protección de A-2', async () => {
    const { SEED_LEGACY_CODES } = await import('./store');
    expect(SEED_LEGACY_CODES).not.toContain('PA-1099');
  });
});
