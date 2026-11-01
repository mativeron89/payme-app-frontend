import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockClaim, MockMesa } from './store';

/**
 * D622 · D628 · AF-4 · el mock publica «los de la mesa» con la forma de
 * `contract/mesa-miembros-v1.json` (la app siempre negocia `members_version=1`),
 * y el decodificador del front la lee. El mock tiene a quien mira ('user'), a
 * «los demás» juntos ('other', iniciales inventadas fijas) y al invitado viejo
 * sin cuenta ('guest', «?»).
 */

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.stubEnv('VITE_MOCK', '1');
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
});

type Plato = MockMesa['items'][number];
const plato = (id: string, claims: MockClaim[] = []): Plato => ({
  id, name: id, category: 'comida', price_cents: 10000, quantity: 1, status: 'available', lockedBy: null, lock_expires_at: null, claims,
});
const reclamo = (who: MockClaim['who'], fraction_bps: number): MockClaim => ({ who, fraction_bps, amount_cents: null, status: 'locked' });

async function cargar() {
  const store = await import('./store');
  const { leerMiembros, leerEligieron } = await import('../miembros');
  store.state.user = { ...store.state.user, first_name: 'Matías', last_name: 'Verón' };
  const mesa = (extra: Partial<MockMesa> = {}): MockMesa => ({
    id: 'mesa-MB-1', code: 'MB-1',
    restaurant: { id: 'r', name: 'Fonda', category: 'restaurant', address: null },
    total_cents: 30000, paid_amount_cents: 0, tip_amount_cents: 0, division_mode: 'consumo', expected_participants: 4,
    original_participants: 4, status: 'open', expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    items: [plato('a', [reclamo('other', 10000)]), plato('b', [reclamo('other', 5000), reclamo('user', 5000)]), plato('c')],
    slots: null, active_staff: [], openedByUser: true, captured_shortfall_cents: 0, guarantee_method: 'none', guarantee_mode: false,
    ...extra,
  });
  return { store, leerMiembros, leerEligieron, mesa };
}

describe('mock · members_version=1', () => {
  it('🔴 quien mira (organizador) es el 0 con sus iniciales y «mine»; los demás, el 1', async () => {
    const { store, leerMiembros, mesa } = await cargar();
    expect(leerMiembros(store.toMesaDetail(mesa(), 'user'))).toEqual({
      joinedCount: 2, expectedCount: 4,
      fichas: [{ ordinal: 0, initials: 'MV', mine: true }, { ordinal: 1, initials: 'AM', mine: false }],
      mas: 0,
    });
  });

  it('🔴 por plato, quienes tienen una parte, en orden de llegada; un plato libre, []', async () => {
    const { store, leerEligieron, mesa } = await cargar();
    const d = store.toMesaDetail(mesa(), 'user');
    expect(d.items.map((i) => leerEligieron(i))).toEqual([
      { fichas: [{ ordinal: 1, initials: 'AM', mine: false }], mas: 0 },
      { fichas: [{ ordinal: 0, initials: 'MV', mine: true }, { ordinal: 1, initials: 'AM', mine: false }], mas: 0 },
      { fichas: [], mas: 0 },
    ]);
  });

  it('si la mesa la abrió otro, ése es el 0', async () => {
    const { store, leerMiembros, mesa } = await cargar();
    expect(leerMiembros(store.toMesaDetail(mesa({ openedByUser: false }), 'user'))?.fichas).toEqual([
      { ordinal: 0, initials: 'AM', mine: false }, { ordinal: 1, initials: 'MV', mine: true },
    ]);
  });

  it('sin nadie más con partes en una mesa propia: sólo quien mira; mesa vieja: expected_count en null', async () => {
    const { store, leerMiembros, mesa } = await cargar();
    expect(leerMiembros(store.toMesaDetail(mesa({ items: [plato('c')], original_participants: undefined }), 'user'))).toEqual({
      joinedCount: 1, expectedCount: null, fichas: [{ ordinal: 0, initials: 'MV', mine: true }], mas: 0,
    });
  });

  it('el invitado viejo sin cuenta (durmiente): members y picked_by en null, como una invitación sin aceptar', async () => {
    const { store, leerMiembros, leerEligieron, mesa } = await cargar();
    const d = store.toMesaDetail(mesa(), 'guest');
    expect(leerMiembros(d)).toBeNull();
    expect(d.items.map((i) => leerEligieron(i))).toEqual([null, null, null]);
  });

  it('🔴 nada de nombres en lo que publica: sólo ordinal, initials y mine', async () => {
    const { store, mesa } = await cargar();
    const json = JSON.stringify(store.toMesaDetail(mesa(), 'user'));
    expect(json).not.toContain('Matías');
    expect(json).not.toContain('Verón');
  });
});

describe('mock · la costura del dueño anterior a 2.210.0', () => {
  it('🔴 `payme.app.mock.miembros.v1 = antiguo`: sin members ni picked_by (las claves no vienen)', async () => {
    const { store, leerMiembros, leerEligieron, mesa } = await cargar();
    localStorage.setItem('payme.app.mock.miembros.v1', 'antiguo');
    const d = store.toMesaDetail(mesa(), 'user');
    expect(Object.prototype.hasOwnProperty.call(d, 'members')).toBe(false);
    expect(d.items.some((i) => 'picked_by' in i || 'picked_by_more' in i)).toBe(false);
    expect(leerMiembros(d)).toBeUndefined();
    expect(d.items.map((i) => leerEligieron(i))).toEqual([undefined, undefined, undefined]);
  });
});
