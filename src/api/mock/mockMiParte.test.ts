import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MesaDetail } from '../types';
import type { MockClaim, MockMesa } from './store';

/**
 * D344 · «Mi parte» en el mock: la escritura (`mockFijarPropinaDeLaMesa`, espejo de `PUT /api/mesas/:code/tip`) y la
 * lectura (`toMesaDetail` y `mockGetMesa`, las tres claves `tip_setting`, `share_totals` y `my_share`), contra el
 * contrato del dueño `contract-mirror/contract/mesa-mi-parte-v1.json` y las simplificaciones que declara `store.ts`.
 *
 *   ① el PUT, en el orden del dueño: 404 → 403 → 400 → 409 no aplicable → 409 mesa no activa → 200;
 *   ② el detalle con garantía: las tres claves en null;
 *   ③ por consumo, con los números calculados A MANO (la cuenta va al lado de cada valor esperado);
 *   ④ los ajustes del ticket (`ajustesAplicablesMock`): descuento, servicio, IVA aparte, mesa corregida y neto ≤ 0;
 *   ⑤ en partes iguales;
 *   ⑥ el cálculo imposible (un «Otro» que desborda, una mesa sin platos);
 *   ⑦ lo que publica el mock lo acepta el decodificador estricto de la app (`leerParteDelDetalle`).
 *
 * Regla del contrato que se usa en las cuentas: N = P + S + V − D; B = máx(0, P − D); T = round_half_up(B × bps / 10000);
 * reparto por mayor resto con pesos = platos de cada persona y, al final, lo que nadie eligió; en empate de restos, el
 * centavo va al de menor índice (el organizador primero).
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

const MAX = Number.MAX_SAFE_INTEGER;

type Plato = MockMesa['items'][number];

const plato = (id: string, price_cents: number, quantity: number, claims: MockClaim[] = []): Plato => ({
  id, name: id, category: 'comida', price_cents, quantity, status: 'available', lockedBy: null, lock_expires_at: null, claims,
});

/** Un reclamo reservado (sin monto: vale su fracción nominal) o pagado (con el monto fijado). */
const reclamo = (who: MockClaim['who'], fraction_bps: number, amount_cents: number | null = null): MockClaim => ({
  who, fraction_bps, amount_cents, status: amount_cents === null ? 'locked' : 'paid',
});

const totales = (
  items: number, discounts: number, service: number, tax_added: number, adjustments: number,
  tip_basis: number, tip: number, total: number, omitted: boolean, reason: 'mesa_corregida' | 'neto_no_positivo' | null,
) => ({
  items_cents: items, discounts_cents: discounts, service_cents: service, tax_added_cents: tax_added,
  adjustments_cents: adjustments, tip_basis_cents: tip_basis, tip_cents: tip, total_cents: total,
  adjustments_omitted: omitted, adjustments_omitted_reason: reason,
});

const parte = (items: number, adjustments: number, tip: number, total: number) =>
  ({ items_cents: items, adjustments_cents: adjustments, tip_cents: tip, total_cents: total });

async function cargar() {
  const mock = await import('./mockApi');
  const store = await import('./store');
  const { leerParteDelDetalle } = await import('../miParte');
  mock.setModoMonetarioMock('disabled');
  /** Una mesa SIN garantía, abierta y del usuario, salvo lo que se pise. */
  const mesa = (code: string, extra: Partial<MockMesa> = {}): MockMesa => {
    const m: MockMesa = {
      id: `mesa-${code}`,
      code,
      restaurant: { id: 'r-mi-parte', name: 'Fonda de prueba', category: 'restaurant', address: null },
      total_cents: 10000,
      paid_amount_cents: 0,
      tip_amount_cents: 0,
      division_mode: 'consumo',
      expected_participants: 2,
      status: 'open',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      items: [plato('unico', 10000, 1)],
      slots: null,
      active_staff: [],
      openedByUser: true,
      captured_shortfall_cents: 0,
      guarantee_method: 'none',
      guarantee_mode: false,
      ...extra,
    };
    store.state.mesas.push(m);
    return m;
  };
  return { mock, store, leerParteDelDetalle, mesa };
}

async function rechazo(p: Promise<unknown>): Promise<{ status: number; error: string; extra: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    const err = e as { status: number; message: string; extra: Record<string, unknown> };
    return { status: err.status, error: err.message, extra: err.extra };
  }
  throw new Error('se esperaba un rechazo');
}

/** Las tres claves, como las publica el detalle. */
function claves(d: MesaDetail) {
  return { tip_setting: d.tip_setting, share_totals: d.share_totals, my_share: d.my_share };
}

// ─── ① El PUT ───────────────────────────────────────────────────────────────

describe('① el PUT de la propina de la mesa, en el orden del dueño', () => {
  it('código inexistente → 404 mesa_not_found', async () => {
    const { mock } = await cargar();
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-999', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 404, error: 'mesa_not_found', extra: {} });
  });

  it('🔴 ORDEN · código inexistente con identidad guest → 404, no 403', async () => {
    const { mock } = await cargar();
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-998', { tip_setting: null }, 'guest')))
      .toEqual({ status: 404, error: 'mesa_not_found', extra: {} });
  });

  it('🔴 mesa de otro organizador (openedByUser false) → 403 not_mesa_organizer, y no se guarda', async () => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-102', { openedByUser: false });
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-102', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 403, error: 'not_mesa_organizer', extra: {} });
    expect(m.tip_setting).toBeUndefined();
  });

  it('🔴 identidad guest en la mesa del organizador → 403 not_mesa_organizer', async () => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-103');
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-103', { tip_setting: { tip_bps: 1000 } }, 'guest')))
      .toEqual({ status: 403, error: 'not_mesa_organizer', extra: {} });
    expect(m.tip_setting).toBeUndefined();
  });

  it('🔴 ORDEN · quien no es organizador con cuerpo inválido recibe 403, no 400 (por openedByUser y por guest)', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-104', { openedByUser: false });
    mesa('MP-105');
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-104', {}, 'user'))).status).toBe(403);
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-105', { tip_setting: 5 }, 'guest'))).status).toBe(403);
  });

  const invalidos: ReadonlyArray<readonly [string, unknown]> = [
    ['objeto vacío', {}],
    ['tip_bps 10001', { tip_setting: { tip_bps: 10001 } }],
    ['tip_bps 1.5', { tip_setting: { tip_bps: 1.5 } }],
    ['tip_bps -1', { tip_setting: { tip_bps: -1 } }],
    ['tip_bps como texto', { tip_setting: { tip_bps: '500' } }],
    ['tip_bps y tip_cents juntos', { tip_setting: { tip_bps: 1, tip_cents: 1 } }],
    ['tip_setting vacío', { tip_setting: {} }],
    ['tip_setting número', { tip_setting: 5 }],
    ['tip_setting lista vacía', { tip_setting: [] }],
    ['tip_setting lista con la clave tip_bps', { tip_setting: Object.assign([], { tip_bps: 500 }) }],
    ['tip_setting con otra clave', { tip_setting: { otra: 500 } }],
    ['tip_cents -1', { tip_setting: { tip_cents: -1 } }],
    ['tip_cents 1.5', { tip_setting: { tip_cents: 1.5 } }],
    ['tip_cents que no es entero seguro', { tip_setting: { tip_cents: MAX + 1 } }],
    ['clave extra junto a tip_setting', { tip_setting: null, otra: 1 }],
    ['una sola clave que no es tip_setting', { otra: null }],
    ['cuerpo null', null],
    ['cuerpo undefined', undefined],
    ['cuerpo número', 5],
    ['cuerpo lista con la clave tip_setting', Object.assign([], { tip_setting: null })],
    // Un término por condición: una función también tiene claves propias.
    ['cuerpo función con la clave tip_setting', Object.assign(() => 0, { tip_setting: null })],
    ['tip_setting función con la clave tip_bps', { tip_setting: Object.assign(() => 0, { tip_bps: 500 }) }],
    ['clave tip_setting propia no enumerable', Object.defineProperty({ otra: 1 }, 'tip_setting', { value: null, enumerable: false })],
  ];

  it.each(invalidos)('🔴 cuerpo inválido (%s) → 400 validation_error, y no se guarda', async (_nombre, cuerpo) => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-106', { tip_setting: { tip_bps: 500 } });
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-106', cuerpo, 'user')))
      .toEqual({ status: 400, error: 'validation_error', extra: {} });
    expect(m.tip_setting).toEqual({ tip_bps: 500 });
  });

  it('🔴 ORDEN · organizador con cuerpo inválido en mesa con garantía, con dinero encendido o cerrada recibe 400, no 409', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-107', { guarantee_mode: true });
    mesa('MP-108', { status: 'expired', closure_reason: 'closed_by_organizer' });
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-107', { tip_setting: {} }, 'user'))).status).toBe(400);
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-108', { tip_setting: {} }, 'user'))).status).toBe(400);
    mock.setModoMonetarioMock('sandbox');
    mesa('MP-109');
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-109', { tip_setting: {} }, 'user'))).status).toBe(400);
  });

  it('🔴 mesa con garantía (guarantee_mode true o ausente) → 409 tip_setting_not_applicable, y no se guarda', async () => {
    const { mock, mesa } = await cargar();
    const conGarantia = mesa('MP-110', { guarantee_mode: true });
    const sinMarca = mesa('MP-111', { guarantee_mode: undefined });
    for (const code of ['MP-110', 'MP-111']) {
      expect(await rechazo(mock.mockFijarPropinaDeLaMesa(code, { tip_setting: { tip_bps: 1000 } }, 'user')))
        .toEqual({ status: 409, error: 'tip_setting_not_applicable', extra: {} });
    }
    expect(conGarantia.tip_setting).toBeUndefined();
    expect(sinMarca.tip_setting).toBeUndefined();
  });

  it.each(['sandbox', 'live'] as const)('🔴 mesa sin garantía con el dinero encendido (%s) → 409 tip_setting_not_applicable', async (modo) => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-112');
    mock.setModoMonetarioMock(modo);
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-112', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 409, error: 'tip_setting_not_applicable', extra: {} });
    expect(m.tip_setting).toBeUndefined();
  });

  it('sin la clave del modo monetario rige el default del mock (sandbox, dinero encendido) → 409', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-113');
    localStorage.removeItem('payme.app.mock.money_rail.v1');
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-113', { tip_setting: { tip_bps: 1000 } }, 'user'))).error)
      .toBe('tip_setting_not_applicable');
  });

  it('🔴 ORDEN · mesa sin garantía, cerrada y con el dinero encendido → tip_setting_not_applicable, no mesa_not_active', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-128', { status: 'expired', closure_reason: 'closed_by_organizer' });
    localStorage.removeItem('payme.app.mock.money_rail.v1');
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-128', { tip_setting: { tip_bps: 1000 } }, 'user'))).error)
      .toBe('tip_setting_not_applicable');
  });

  it('🔴 ORDEN · una mesa con garantía que además está cerrada da tip_setting_not_applicable, no mesa_not_active', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-114', { guarantee_mode: true, status: 'completed', closure_reason: null });
    expect((await rechazo(mock.mockFijarPropinaDeLaMesa('MP-114', { tip_setting: { tip_bps: 1000 } }, 'user'))).error)
      .toBe('tip_setting_not_applicable');
  });

  it('🔴 mesa no abierta → 409 mesa_not_active con mesa_status y closure_reason, y no se guarda', async () => {
    const { mock, mesa } = await cargar();
    const cerrada = mesa('MP-115', { status: 'expired', closure_reason: 'closed_by_organizer' });
    mesa('MP-116', { status: 'completed', closure_reason: 'all_items_selected' });
    // Sin closure_reason guardado, el 409 lo publica en null.
    mesa('MP-117', { status: 'partially_paid', closure_reason: undefined });
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-115', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 409, error: 'mesa_not_active', extra: { mesa_status: 'expired', closure_reason: 'closed_by_organizer' } });
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-116', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 409, error: 'mesa_not_active', extra: { mesa_status: 'completed', closure_reason: 'all_items_selected' } });
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-117', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 409, error: 'mesa_not_active', extra: { mesa_status: 'partially_paid', closure_reason: null } });
    expect(cerrada.tip_setting).toBeUndefined();
  });

  it('una mesa abierta cuyo plazo ya venció se cierra por tiempo antes de contestar: 409 mesa_not_active (completed, time)', async () => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-118', { expires_at: new Date(Date.now() - 60_000).toISOString() });
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-118', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 409, error: 'mesa_not_active', extra: { mesa_status: 'completed', closure_reason: 'time' } });
    expect(m.tip_setting).toBeUndefined();
  });

  const validos: ReadonlyArray<readonly [string, { tip_bps: number } | { tip_cents: number } | null]> = [
    ['10 %', { tip_bps: 1000 }],
    ['0 %', { tip_bps: 0 }],
    ['100 %', { tip_bps: 10000 }],
    ['«Otro» de $2.50', { tip_cents: 250 }],
    ['«Otro» de 0', { tip_cents: 0 }],
    ['«Otro» del máximo entero seguro', { tip_cents: MAX }],
    ['sin fijar', null],
  ];

  it.each(validos)('🔴 válido (%s) → 200 {tip_setting: X}, se guarda y el detalle lo refleja', async (_nombre, setting) => {
    const { mock, store, mesa } = await cargar();
    mesa('MP-119');
    const r = await mock.mockFijarPropinaDeLaMesa('MP-119', { tip_setting: setting }, 'user');
    expect(r).toStrictEqual({ tip_setting: setting });
    expect(store.findMesa('MP-119')!.tip_setting).toStrictEqual(setting);
    expect((await mock.mockGetMesa('MP-119', 'user')).mesa.tip_setting).toStrictEqual(setting);
  });

  it('🔴 un «Otro» se guarda como tip_cents, nunca como tip_bps (y viceversa)', async () => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-120');
    expect(await mock.mockFijarPropinaDeLaMesa('MP-120', { tip_setting: { tip_cents: 500 } }, 'user'))
      .toStrictEqual({ tip_setting: { tip_cents: 500 } });
    expect(m.tip_setting).toStrictEqual({ tip_cents: 500 });
    expect(await mock.mockFijarPropinaDeLaMesa('MP-120', { tip_setting: { tip_bps: 500 } }, 'user'))
      .toStrictEqual({ tip_setting: { tip_bps: 500 } });
    expect(m.tip_setting).toStrictEqual({ tip_bps: 500 });
  });

  it('🔴 repetir el mismo valor da lo mismo', async () => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-121');
    const primero = await mock.mockFijarPropinaDeLaMesa('MP-121', { tip_setting: { tip_bps: 1500 } }, 'user');
    const segundo = await mock.mockFijarPropinaDeLaMesa('MP-121', { tip_setting: { tip_bps: 1500 } }, 'user');
    expect(primero).toStrictEqual({ tip_setting: { tip_bps: 1500 } });
    expect(segundo).toStrictEqual(primero);
    expect(m.tip_setting).toStrictEqual({ tip_bps: 1500 });
  });

  it('🔴 null vuelve a «sin fijar»: el detalle publica tip_setting null y la propina de la mesa en 0', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-122');
    await mock.mockFijarPropinaDeLaMesa('MP-122', { tip_setting: { tip_bps: 1500 } }, 'user');
    // Con 15 %: T = round(10000 × 1500 / 10000) = 1500.
    expect((await mock.mockGetMesa('MP-122', 'user')).mesa.share_totals).toMatchObject({ tip_cents: 1500 });
    expect(await mock.mockFijarPropinaDeLaMesa('MP-122', { tip_setting: null }, 'user')).toStrictEqual({ tip_setting: null });
    const { mesa: d } = await mock.mockGetMesa('MP-122', 'user');
    expect(d.tip_setting).toBeNull();
    // Sin fijar: T = 0 y el total es N = 10000.
    expect(d.share_totals).toMatchObject({ tip_cents: 0, total_cents: 10000 });
  });

  it('lo guardado es una copia del cuerpo: cambiar el cuerpo después no toca la mesa', async () => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-123');
    const cuerpo = { tip_setting: { tip_bps: 1000 } };
    await mock.mockFijarPropinaDeLaMesa('MP-123', cuerpo, 'user');
    cuerpo.tip_setting.tip_bps = 9999;
    expect(m.tip_setting).toStrictEqual({ tip_bps: 1000 });
  });

  it('🔴 costura payme.app.mock.propina_mesa.v1 = error → 500 internal_error, y no se guarda', async () => {
    const { mock, mesa } = await cargar();
    const m = mesa('MP-124');
    localStorage.setItem('payme.app.mock.propina_mesa.v1', 'error');
    expect(await rechazo(mock.mockFijarPropinaDeLaMesa('MP-124', { tip_setting: { tip_bps: 1000 } }, 'user')))
      .toEqual({ status: 500, error: 'internal_error', extra: {} });
    expect(m.tip_setting).toBeUndefined();
  });

  it('la costura con otro valor no cambia nada: 200', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-125');
    localStorage.setItem('payme.app.mock.propina_mesa.v1', 'antiguo');
    expect(await mock.mockFijarPropinaDeLaMesa('MP-125', { tip_setting: { tip_bps: 1000 } }, 'user'))
      .toStrictEqual({ tip_setting: { tip_bps: 1000 } });
  });

  it('🔴 contarPedidosDePropina cuenta cada llamada, también las que fallan', async () => {
    const { mock, mesa } = await cargar();
    mesa('MP-126');
    mesa('MP-127', { guarantee_mode: true });
    const antes = mock.contarPedidosDePropina();
    await mock.mockFijarPropinaDeLaMesa('MP-126', { tip_setting: { tip_bps: 1000 } }, 'user'); // 200
    await rechazo(mock.mockFijarPropinaDeLaMesa('MP-999', { tip_setting: null }, 'user')); // 404
    await rechazo(mock.mockFijarPropinaDeLaMesa('MP-126', { tip_setting: null }, 'guest')); // 403
    await rechazo(mock.mockFijarPropinaDeLaMesa('MP-126', {}, 'user')); // 400
    await rechazo(mock.mockFijarPropinaDeLaMesa('MP-127', { tip_setting: null }, 'user')); // 409
    localStorage.setItem('payme.app.mock.propina_mesa.v1', 'error');
    await rechazo(mock.mockFijarPropinaDeLaMesa('MP-126', { tip_setting: null }, 'user')); // 500
    // Seis llamadas.
    expect(mock.contarPedidosDePropina() - antes).toBe(6);
  });
});

// ─── ② Con garantía ─────────────────────────────────────────────────────────

describe('② el detalle de una mesa con garantía', () => {
  it.each([
    ['guarantee_mode true', true],
    ['guarantee_mode ausente', undefined],
  ] as const)('🔴 %s: las tres claves salen en null, aunque la mesa tenga una propina guardada', async (_nombre, modo) => {
    const { store, mesa, leerParteDelDetalle } = await cargar();
    const m = mesa('MP-201', { guarantee_mode: modo, tip_setting: { tip_bps: 1000 } });
    const d = store.toMesaDetail(m, 'user');
    for (const k of ['tip_setting', 'share_totals', 'my_share']) {
      expect(Object.prototype.hasOwnProperty.call(d, k), k).toBe(true);
    }
    expect(claves(d)).toStrictEqual({ tip_setting: null, share_totals: null, my_share: null });
    expect(leerParteDelDetalle(d)).toStrictEqual({ tipSetting: null, shareTotals: null, myShare: null });
  });
});

// ─── ③ Por consumo ──────────────────────────────────────────────────────────

describe('③ por consumo, con los números calculados a mano', () => {
  it('🔴 sin ajustes, 10 %: platos de cada uno + lo que nadie eligió, todo exacto', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-301', {
      total_cents: 20000,
      items: [
        plato('a', 10000, 1, [reclamo('user', 10000)]), // nominal: 10000 × 10000 / 10000 = 10000
        plato('b', 6000, 1, [reclamo('other', 10000, 6000)]),
        plato('c', 4000, 1), // nadie lo eligió: U = 4000
      ],
      tip_setting: { tip_bps: 1000 },
    });
    // P = 20000, N = 20000, B = 20000, T = 20000 × 1000 / 10000 = 2000.
    // Pesos [10000, 6000, 4000], W = 20000: N → [10000, 6000, 4000]; T → [1000, 600, 400].
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(20000, 0, 0, 0, 0, 20000, 2000, 22000, false, null),
      my_share: parte(10000, 0, 1000, 11000),
    });
  });

  it('🔴 descuento v1 y 10 % con mitad exacta: la propina redondea hacia arriba y el centavo del empate va al organizador', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-302', {
      total_cents: 5000,
      items: [
        plato('a', 2500, 1, [reclamo('user', 10000)]), // nominal: (2500 × 10000 + 5000) / 10000 → 2500
        plato('b', 2500, 1, [reclamo('other', 10000, 2500)]),
      ],
      ticket_adjustments: { version: 1, discounts_cents: [995], items_total_cents: 5000 },
      tip_setting: { tip_bps: 1000 },
    });
    // P = 5000, D = 995 → N = 4005; B = máx(0, 5000 − 995) = 4005; T = round_half_up(400.5) = 401.
    // Pesos [2500, 2500, 0], W = 5000:
    //   N: 4005 × 2500 / 5000 = 2002 resto 2500 cada uno; falta 1 → al índice 0 (el organizador) → [2003, 2002, 0].
    //   T: 401 × 2500 / 5000 = 200 resto 2500 cada uno; falta 1 → al índice 0 → [201, 200, 0].
    // my_share: platos 2500, ajustes 2003 − 2500 = −497, propina 201, total 2003 + 201 = 2204.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(5000, 995, 0, 0, -995, 4005, 401, 4406, false, null),
      my_share: parte(2500, -497, 201, 2204),
    });
  });

  it('🔴 la misma mesa vista por quien no es el organizador: el organizador va primero y se lleva el centavo del empate', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-303', {
      openedByUser: false,
      total_cents: 5000,
      items: [
        plato('a', 2500, 1, [reclamo('user', 10000)]),
        plato('b', 2500, 1, [reclamo('other', 10000, 2500)]),
      ],
      ticket_adjustments: { version: 1, discounts_cents: [995], items_total_cents: 5000 },
      tip_setting: { tip_bps: 1000 },
    });
    // Orden [other, user]: el centavo de N y el de T van a other (índice 0); user queda con 2002 y 200.
    // my_share: platos 2500, ajustes 2002 − 2500 = −498, propina 200, total 2202.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(5000, 995, 0, 0, -995, 4005, 401, 4406, false, null),
      my_share: parte(2500, -498, 200, 2202),
    });
  });

  it('🔴 lo que nadie eligió es el último peso y puede llevarse el centavo de la propina («Otro» de $1)', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-304', {
      total_cents: 3001,
      items: [
        plato('a', 1000, 1, [reclamo('user', 10000)]),
        plato('b', 1000, 1, [reclamo('other', 10000, 1000)]),
        plato('c', 1001, 1), // U = 1001
      ],
      tip_setting: { tip_cents: 100 },
    });
    // P = 3001, N = 3001, B = 3001, T = 100 (monto fijo).
    // Pesos [1000, 1000, 1001], W = 3001: N exacto → [1000, 1000, 1001].
    // T: 100 × 1000 / 3001 = 33 resto 967 (dos veces); 100 × 1001 / 3001 = 33 resto 1067; falta 1 → a U → [33, 33, 34].
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_cents: 100 },
      share_totals: totales(3001, 0, 0, 0, 0, 3001, 100, 3101, false, null),
      my_share: parte(1000, 0, 33, 1033),
    });
  });

  it('🔴 fracciones: la reservada vale su nominal sobre la línea (precio × cantidad) y la pagada, su monto fijado', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-305', {
      total_cents: 4001,
      items: [
        // Línea 1500 × 2 = 3000: user 5000 bps → (3000 × 5000 + 5000) / 10000 → 1500; other 2500 bps → 750; U = 750.
        plato('d', 1500, 2, [reclamo('user', 5000), reclamo('other', 2500)]),
        // Línea 1001: pagados con la completadora (500 y 501), no con el nominal 501; U = 0.
        plato('e', 1001, 1, [reclamo('user', 5000, 500), reclamo('other', 5000, 501)]),
      ],
    });
    // Sin propina guardada: tip_setting null y T = 0. user = 1500 + 500 = 2000; other = 750 + 501 = 1251; U = 750.
    // Pesos [2000, 1251, 750], W = 4001 = N: reparto exacto.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: null,
      share_totals: totales(4001, 0, 0, 0, 0, 4001, 0, 4001, false, null),
      my_share: parte(2000, 0, 0, 2000),
    });
  });

  it('🔴 dos mitades de un plato impar suman más que la línea: lo que nadie eligió queda en 0, nunca negativo', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-306', {
      total_cents: 1001,
      // Cada mitad: (1001 × 5000 + 5000) / 10000 → 501; elegido 1002 > 1001 → U = máx(0, −1) = 0.
      items: [plato('f', 1001, 1, [reclamo('user', 5000), reclamo('other', 5000)])],
    });
    // Pesos [501, 501, 0], W = 1002: 1001 × 501 / 1002 = 500 resto 501 cada uno; falta 1 → al índice 0 → [501, 500, 0].
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: null,
      share_totals: totales(1001, 0, 0, 0, 0, 1001, 0, 1001, false, null),
      my_share: parte(501, 0, 0, 501),
    });
  });

  it('🔴 quien mira sin estar en la mesa (guest) recibe ceros, nunca la parte de lo que nadie eligió', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-307', {
      total_cents: 3001,
      items: [
        plato('a', 1000, 1, [reclamo('user', 10000)]),
        plato('b', 1000, 1, [reclamo('other', 10000, 1000)]),
        plato('c', 1001, 1),
      ],
      tip_setting: { tip_cents: 100 },
    });
    expect(claves(store.toMesaDetail(m, 'guest'))).toStrictEqual({
      tip_setting: { tip_cents: 100 },
      share_totals: totales(3001, 0, 0, 0, 0, 3001, 100, 3101, false, null),
      my_share: parte(0, 0, 0, 0),
    });
  });

  it('quien no eligió nada recibe ceros', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-308', {
      total_cents: 3000,
      items: [plato('a', 2000, 1, [reclamo('other', 10000, 2000)]), plato('b', 1000, 1)],
      tip_setting: { tip_bps: 1000 },
    });
    // N = 3000, T = 300; pesos [user 0, other 2000, U 1000]: user → 0 y 0.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(3000, 0, 0, 0, 0, 3000, 300, 3300, false, null),
      my_share: parte(0, 0, 0, 0),
    });
  });
});

// ─── ④ Los ajustes del ticket ───────────────────────────────────────────────

describe('④ los ajustes del ticket', () => {
  /** Platos de la mesa de 10000: user 6000 y other 4000, los dos completos. */
  const platos6040 = () => [
    plato('a', 6000, 1, [reclamo('user', 10000)]),
    plato('b', 4000, 1, [reclamo('other', 10000, 4000)]),
  ];

  it('🔴 mesa corregida (total ≠ platos del recibo) con descuento v1: sin ajustes, mesa_corregida y B = P', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-401', {
      total_cents: 10000,
      items: platos6040(),
      ticket_adjustments: { version: 1, discounts_cents: [1500], items_total_cents: 9000 },
      tip_setting: { tip_bps: 1000 },
    });
    // D = S = V = 0, N = 10000; B = P = 10000 (no 8500); T = 1000. N → [6000, 4000, 0]; T → [600, 400, 0].
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(10000, 0, 0, 0, 0, 10000, 1000, 11000, true, 'mesa_corregida'),
      my_share: parte(6000, 0, 600, 6600),
    });
  });

  it('🔴 descuento mayor que los platos: neto_no_positivo, B = máx(0, P − D) = 0 y la propina por % da 0', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-402', {
      total_cents: 5000,
      items: [plato('a', 3000, 1, [reclamo('user', 10000)]), plato('b', 2000, 1, [reclamo('other', 10000, 2000)])],
      ticket_adjustments: { version: 1, discounts_cents: [3000, 2500], items_total_cents: 5000 },
      tip_setting: { tip_bps: 1000 },
    });
    // D = 3000 + 2500 = 5500; N = 5000 − 5500 = −500 ≤ 0 → sin ajustes, N = 5000; B = máx(0, −500) = 0; T = 0.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(5000, 0, 0, 0, 0, 0, 0, 5000, true, 'neto_no_positivo'),
      my_share: parte(3000, 0, 0, 3000),
    });
  });

  it('🔴 con neto_no_positivo un «Otro» se mantiene y se reparte por platos', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-403', {
      total_cents: 5000,
      items: [plato('a', 3000, 1, [reclamo('user', 10000)]), plato('b', 2000, 1, [reclamo('other', 10000, 2000)])],
      ticket_adjustments: { version: 1, discounts_cents: [3000, 2500], items_total_cents: 5000 },
      tip_setting: { tip_cents: 700 },
    });
    // T = 700; pesos [3000, 2000, 0], W = 5000: 700 × 3000 / 5000 = 420; 280. Total 5000 + 700 = 5700.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_cents: 700 },
      share_totals: totales(5000, 0, 0, 0, 0, 0, 700, 5700, true, 'neto_no_positivo'),
      my_share: parte(3000, 0, 420, 3420),
    });
  });

  it('🔴 frontera: un descuento igual a los platos ya es neto_no_positivo; uno menos todavía se aplica', async () => {
    const { store, mesa } = await cargar();
    const items = () => [plato('a', 3000, 1, [reclamo('user', 10000)]), plato('b', 2000, 1, [reclamo('other', 10000, 2000)])];
    const igual = mesa('MP-404', {
      total_cents: 5000, items: items(), tip_setting: { tip_bps: 1000 },
      ticket_adjustments: { version: 1, discounts_cents: [5000], items_total_cents: 5000 },
    });
    // D = 5000 → N = 0 ≤ 0: sin ajustes; B = 0; T = 0.
    expect(store.toMesaDetail(igual, 'user').share_totals).toStrictEqual(totales(5000, 0, 0, 0, 0, 0, 0, 5000, true, 'neto_no_positivo'));
    const menos = mesa('MP-405', {
      total_cents: 5000, items: items(), tip_setting: { tip_bps: 1000 },
      ticket_adjustments: { version: 1, discounts_cents: [4999], items_total_cents: 5000 },
    });
    // D = 4999 → N = 1; B = 1; T = (1 × 1000 + 5000) / 10000 → 0.
    // N = 1 con pesos [3000, 2000, 0]: pisos 0 y 0, restos 3000 y 2000; falta 1 → user. my_share: 3000, 1 − 3000 = −2999, 0, 1.
    expect(claves(store.toMesaDetail(menos, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(5000, 4999, 0, 0, -4999, 1, 0, 1, false, null),
      my_share: parte(3000, -2999, 0, 1),
    });
  });

  it('🔴 v2 con descuento, servicio e IVA aparte (subtotal = platos): la base no incluye servicio ni IVA', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-406', {
      total_cents: 10000,
      items: platos6040(),
      ticket_adjustments: {
        version: 2, discounts_cents: [500], service_charges_cents: [800], subtotal_cents: 10000, tax_cents: 1600, items_total_cents: 10000,
      },
      tip_setting: { tip_bps: 1000 },
    });
    // D 500, S 800, V 1600 (subtotal = platos). N = 10000 + 800 + 1600 − 500 = 11900; ajustes 1900.
    // B = 10000 − 500 = 9500; T = 950. N → [7140, 4760, 0]; T → [570, 380, 0]. my_share: 6000, 1140, 570, 7710.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(10000, 500, 800, 1600, 1900, 9500, 950, 12850, false, null),
      my_share: parte(6000, 1140, 570, 7710),
    });
  });

  it('🔴 v2 con subtotal = platos − descuento y descuento ≠ IVA: el IVA es aparte', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-407', {
      total_cents: 10000,
      items: platos6040(),
      ticket_adjustments: {
        version: 2, discounts_cents: [500], service_charges_cents: [], subtotal_cents: 9500, tax_cents: 1520, items_total_cents: 10000,
      },
      tip_setting: { tip_bps: 1000 },
    });
    // V = 1520. N = 10000 + 1520 − 500 = 11020; ajustes 1020. B = 9500; T = 950.
    // N → [6612, 4408, 0]; T → [570, 380, 0]. my_share: 6000, 612, 570, 7182.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(10000, 500, 0, 1520, 1020, 9500, 950, 11970, false, null),
      my_share: parte(6000, 612, 570, 7182),
    });
  });

  it('🔴 v2 ambiguo (subtotal = platos − descuento y descuento = IVA): el IVA no se suma', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-408', {
      total_cents: 10000,
      items: platos6040(),
      ticket_adjustments: {
        version: 2, discounts_cents: [1600], service_charges_cents: [], subtotal_cents: 8400, tax_cents: 1600, items_total_cents: 10000,
      },
    });
    // V = 0. N = 10000 − 1600 = 8400; B = 8400; sin fijar, T = 0. N → [5040, 3360, 0]. my_share: 6000, −960, 0, 5040.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: null,
      share_totals: totales(10000, 1600, 0, 0, -1600, 8400, 0, 8400, false, null),
      my_share: parte(6000, -960, 0, 5040),
    });
  });

  it('🔴 v2 con IVA incluido (subtotal + IVA = platos, sin descuento): el IVA no se suma', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-409', {
      total_cents: 10000,
      items: platos6040(),
      ticket_adjustments: {
        version: 2, discounts_cents: [], service_charges_cents: [], subtotal_cents: 8621, tax_cents: 1379, items_total_cents: 10000,
      },
      tip_setting: { tip_bps: 500 },
    });
    // V = 0, N = 10000, B = 10000, T = 500. T → [300, 200, 0].
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 500 },
      share_totals: totales(10000, 0, 0, 0, 0, 10000, 500, 10500, false, null),
      my_share: parte(6000, 0, 300, 6300),
    });
  });

  it('🔴 sólo ticket_totals v2, publicable y con IVA agregado (total = subtotal): el IVA es aparte', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-410', {
      total_cents: 10000,
      items: platos6040(),
      ticket_totals: { version: 2, subtotal_cents: 10000, tax_cents: 1600, total_cents: 11600, items_total_cents: 10000 },
      tip_setting: { tip_bps: 1000 },
    });
    // V = 1600, N = 11600, B = 10000, T = 1000. N → [6960, 4640, 0]; T → [600, 400, 0]. my_share: 6000, 960, 600, 7560.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(10000, 0, 0, 1600, 1600, 10000, 1000, 12600, false, null),
      my_share: parte(6000, 960, 600, 7560),
    });
  });

  it('🔴 sólo ticket_totals v2, publicable con IVA incluido (total = subtotal + IVA): nada que sumar', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-411', {
      total_cents: 10000,
      items: platos6040(),
      ticket_totals: { version: 2, subtotal_cents: 8621, tax_cents: 1379, total_cents: 10000, items_total_cents: 10000 },
    });
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: null,
      share_totals: totales(10000, 0, 0, 0, 0, 10000, 0, 10000, false, null),
      my_share: parte(6000, 0, 0, 6000),
    });
  });

  /** Mesa editada de 11000: user 6000, other 4000 y un plato agregado de 1000 que nadie eligió. */
  const editada = () => [...platos6040(), plato('agregado', 1000, 1)];
  // Con 10 %: N = 11000, B = 11000, T = 1100. Pesos [6000, 4000, 1000] (W = 11000): N exacto; T → [600, 400, 100].

  it('🔴 sólo ticket_totals v2 con IVA aparte y la mesa editada: mesa_corregida', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-412', {
      total_cents: 11000,
      items: editada(),
      ticket_totals: { version: 2, subtotal_cents: 10000, tax_cents: 1600, total_cents: 11600, items_total_cents: 10000 },
      tip_setting: { tip_bps: 1000 },
    });
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(11000, 0, 0, 0, 0, 11000, 1100, 12100, true, 'mesa_corregida'),
      my_share: parte(6000, 0, 600, 6600),
    });
  });

  it.each([
    ['v2 sin IVA', { version: 2 as const, subtotal_cents: 10000, tax_cents: 0, total_cents: 10000, items_total_cents: 10000 }],
    ['v2 con IVA incluido', { version: 2 as const, subtotal_cents: 8621, tax_cents: 1379, total_cents: 10000, items_total_cents: 10000 }],
    ['v1 aunque traiga la suma de los platos', { version: 1 as const, subtotal_cents: 10000, tax_cents: 1600, total_cents: 11600, items_total_cents: 10000 }],
  ])('🔴 sólo ticket_totals (%s) y la mesa editada: no había nada que omitir, sin la marca', async (_nombre, tt) => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-413', { total_cents: 11000, items: editada(), ticket_totals: tt, tip_setting: { tip_bps: 1000 } });
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 },
      share_totals: totales(11000, 0, 0, 0, 0, 11000, 1100, 12100, false, null),
      my_share: parte(6000, 0, 600, 6600),
    });
  });
});

// ─── ⑤ En partes iguales ────────────────────────────────────────────────────

describe('⑤ en partes iguales', () => {
  const igual = (extra: Partial<MockMesa>): Partial<MockMesa> => ({
    division_mode: 'igual',
    expected_participants: 3,
    total_cents: 10000,
    items: [plato('unico', 10000, 1)],
    ticket_adjustments: { version: 1, discounts_cents: [1000], items_total_cents: 10000 },
    tip_setting: { tip_bps: 1000 },
    ...extra,
  });
  // P = 10000, D = 1000 → N = 9000; B = 9000; T = 900.
  // splitEqual(10000, 3) = [3334, 3333, 3333]; splitEqual(9000, 3) = [3000, 3000, 3000]; splitEqual(900, 3) = [300, 300, 300].
  const totalesIgual = totales(10000, 1000, 0, 0, -1000, 9000, 900, 9900, false, null);

  it('🔴 el organizador es la parte 0: platos 3334, ajustes 3000 − 3334 = −334, propina 300, total 3300', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-501', igual({}));
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 }, share_totals: totalesIgual, my_share: parte(3334, -334, 300, 3300),
    });
  });

  it('🔴 quien no es el organizador es la parte 1: platos 3333, ajustes −333, propina 300, total 3300', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-502', igual({ openedByUser: false }));
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 }, share_totals: totalesIgual, my_share: parte(3333, -333, 300, 3300),
    });
  });

  it('🔴 guest no tiene parte: my_share null, los totales igual', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-503', igual({}));
    expect(claves(store.toMesaDetail(m, 'guest'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 }, share_totals: totalesIgual, my_share: null,
    });
  });

  it('🔴 con una sola parte declarada, quien no es el organizador no tiene parte: my_share null', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-504', igual({ openedByUser: false, expected_participants: 1 }));
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_bps: 1000 }, share_totals: totalesIgual, my_share: null,
    });
  });

  it('🔴 sin partes declaradas (0) cuenta como una: el organizador se lleva todo', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-505', igual({ expected_participants: 0, ticket_adjustments: undefined, tip_setting: { tip_cents: 333 } }));
    // n = 1: P, N y T enteros. N = 10000, T = 333, total 10333.
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({
      tip_setting: { tip_cents: 333 },
      share_totals: totales(10000, 0, 0, 0, 0, 10000, 333, 10333, false, null),
      my_share: parte(10000, 0, 333, 10333),
    });
  });
});

// ─── ⑥ El cálculo imposible ─────────────────────────────────────────────────

describe('⑥ cuando el cálculo no se puede hacer', () => {
  it.each(['consumo', 'igual'] as const)('🔴 un «Otro» que desborda (%s): tip_setting igual, share_totals y my_share en null', async (modo) => {
    const { mock, mesa, leerParteDelDetalle } = await cargar();
    mesa('MP-601', { division_mode: modo, items: [plato('a', 10000, 1, [reclamo('user', 10000)])] });
    await mock.mockFijarPropinaDeLaMesa('MP-601', { tip_setting: { tip_cents: MAX } }, 'user');
    const { mesa: d } = await mock.mockGetMesa('MP-601', 'user');
    // N + T = 10000 + MAX no es un entero seguro.
    expect(claves(d)).toStrictEqual({ tip_setting: { tip_cents: MAX }, share_totals: null, my_share: null });
    expect(leerParteDelDetalle(d)).toStrictEqual({ tipSetting: { tip_cents: MAX }, shareTotals: null, myShare: null });
  });

  it('una mesa sin platos (total 0): tip_setting igual, share_totals y my_share en null', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-602', { total_cents: 0, items: [], tip_setting: { tip_bps: 1000 } });
    expect(claves(store.toMesaDetail(m, 'user'))).toStrictEqual({ tip_setting: { tip_bps: 1000 }, share_totals: null, my_share: null });
  });

  it('el resto del detalle sale igual aunque el cálculo falle', async () => {
    const { store, mesa } = await cargar();
    const m = mesa('MP-603', { total_cents: 0, items: [], tip_setting: { tip_cents: 5 } });
    const d = store.toMesaDetail(m, 'user');
    expect(d.code).toBe('MP-603');
    expect(d.total_cents).toBe(0);
    expect(d.guarantee_mode).toBe(false);
  });
});

// ─── ⑦ El decodificador de la app ──────────────────────────────────────────

describe('⑦ lo que publica el mock lo acepta el decodificador estricto (leerParteDelDetalle)', () => {
  /** Cada mesa del archivo que tiene «Mi parte», por cada identidad: las tres claves leídas son las publicadas. */
  const casos: ReadonlyArray<readonly [string, Partial<MockMesa>]> = [
    ['por consumo con descuento y empate', {
      total_cents: 5000,
      items: [plato('a', 2500, 1, [reclamo('user', 10000)]), plato('b', 2500, 1, [reclamo('other', 10000, 2500)])],
      ticket_adjustments: { version: 1, discounts_cents: [995], items_total_cents: 5000 },
      tip_setting: { tip_bps: 1000 },
    }],
    ['por consumo, lo que nadie eligió se lleva el centavo', {
      total_cents: 3001,
      items: [plato('a', 1000, 1, [reclamo('user', 10000)]), plato('b', 1000, 1, [reclamo('other', 10000, 1000)]), plato('c', 1001, 1)],
      tip_setting: { tip_cents: 100 },
    }],
    ['mesa corregida', {
      total_cents: 10000,
      items: [plato('a', 6000, 1, [reclamo('user', 10000)]), plato('b', 4000, 1, [reclamo('other', 10000, 4000)])],
      ticket_adjustments: { version: 1, discounts_cents: [1500], items_total_cents: 9000 },
      tip_setting: { tip_bps: 1000 },
    }],
    ['neto no positivo con «Otro»', {
      total_cents: 5000,
      items: [plato('a', 3000, 1, [reclamo('user', 10000)]), plato('b', 2000, 1, [reclamo('other', 10000, 2000)])],
      ticket_adjustments: { version: 1, discounts_cents: [3000, 2500], items_total_cents: 5000 },
      tip_setting: { tip_cents: 700 },
    }],
    ['neto no positivo con %', {
      total_cents: 5000,
      items: [plato('a', 3000, 1, [reclamo('user', 10000)]), plato('b', 2000, 1, [reclamo('other', 10000, 2000)])],
      ticket_adjustments: { version: 1, discounts_cents: [5000], items_total_cents: 5000 },
      tip_setting: { tip_bps: 2000 },
    }],
    ['v2 con descuento, servicio e IVA aparte', {
      total_cents: 10000,
      items: [plato('a', 6000, 1, [reclamo('user', 10000)]), plato('b', 4000, 1, [reclamo('other', 10000, 4000)])],
      ticket_adjustments: {
        version: 2, discounts_cents: [500], service_charges_cents: [800], subtotal_cents: 10000, tax_cents: 1600, items_total_cents: 10000,
      },
      tip_setting: { tip_bps: 1500 },
    }],
    ['partes iguales con descuento', {
      division_mode: 'igual', expected_participants: 3, total_cents: 10000, items: [plato('unico', 10000, 1)],
      ticket_adjustments: { version: 1, discounts_cents: [1000], items_total_cents: 10000 },
      tip_setting: { tip_bps: 1000 },
    }],
    ['sin propina fijada', { total_cents: 10000, items: [plato('a', 10000, 1, [reclamo('user', 5000)])] }],
  ];

  it.each(casos)('🔴 %s: ninguna de las tres claves queda undefined y se leen iguales a lo publicado', async (_nombre, extra) => {
    const { store, mesa, leerParteDelDetalle } = await cargar();
    for (const [i, openedByUser] of [true, false].entries()) {
      const m = mesa(`MP-70${i}`, { ...extra, openedByUser });
      for (const identidad of ['user', 'guest'] as const) {
        const d = store.toMesaDetail(m, identidad);
        expect(d.share_totals, `${identidad} · openedByUser ${openedByUser}`).not.toBeNull();
        const leido = leerParteDelDetalle(d);
        expect(leido.tipSetting, 'tipSetting').not.toBeUndefined();
        expect(leido.shareTotals, 'shareTotals').not.toBeUndefined();
        expect(leido.myShare, 'myShare').not.toBeUndefined();
        expect(leido).toStrictEqual({ tipSetting: d.tip_setting, shareTotals: d.share_totals, myShare: d.my_share });
      }
    }
  });
});
