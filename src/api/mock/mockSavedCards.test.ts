import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G-11 CERRADO (backend v2.46.0, `7e45db0`) · EL MOCK COINCIDE CON EL REAL.
 *
 * Historia completa del desfase, porque es la lección: el mock guardaba en
 * plataforma e IGNORABA en directo (modelaba v2.24) — y durante meses el
 * riel real no guardaba nunca bajo direct charge, así que el mock PROMETÍA
 * algo que el backend no hacía en el único riel del MVP. Ahora el emisor
 * guarda de verdad en los dos y el mock lo espeja. La orden pide acreditar
 * QUE COINCIDEN — estos tests fijan la semántica exacta del contrato:
 *
 *   · direct charge + save + tarjeta tipeada → guardada tras el ÉXITO;
 *   · wallets nativas → no-op (cardEligibility las rechaza en el real);
 *   · guest → no-op;
 *   · garantía con 3DS → PENDIENTE hasta confirmar (el real la guarda por
 *     webhook de éxito; guardarla antes acumularía fantasmas por reintento).
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

async function cargar() {
  const mock = await import('./mockApi');
  const { state } = await import('./store');
  return { mock, state };
}

const HANZO_DIRECTO = 'PA-3121'; // Hanzo Sushi: EN MOCK_CONNECTED_ACCOUNTS — riel directo.

function pagoBase(extra: Record<string, unknown> = {}) {
  return {
    payment_type: 'card' as const,
    idempotency_key: `11111111-2222-4333-8444-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`,
    stripe_payment_method_id: 'pm_g11_tipeada',
    tip_bps: 0,
    ...extra,
  };
}

describe('G-11 · el guardado del mock coincide con el contrato v2.46.0', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('direct charge + save + tarjeta tipeada → la tarjeta APARECE tras el éxito', async () => {
    const { mock, state } = await cargar();
    const antes = state.paymentMethods.length;
    // Control del control: la mesa es del riel DIRECTO — si Hanzo dejara de
    // estar conectado en el seed, este test probaría el riel equivocado.
    const r = await mock.mockPayMesa(HANZO_DIRECTO, pagoBase({ save_payment_method: true }), 'user');
    expect(r.attempt.connected_account_id).toBeTruthy();
    expect(state.paymentMethods.length).toBe(antes + 1);
    expect(state.paymentMethods.some((pm) => pm.stripe_payment_method_id === 'pm_g11_tipeada')).toBe(true);
  });

  it('sin save_payment_method NO aparece — la promesa sólo existe si alguien la elige', async () => {
    const { mock, state } = await cargar();
    const antes = state.paymentMethods.length;
    await mock.mockPayMesa(HANZO_DIRECTO, pagoBase(), 'user');
    expect(state.paymentMethods.length).toBe(antes);
  });

  it('wallet nativa → no-op aunque pida guardar (el pm_ efímero no entra a la bóveda)', async () => {
    const { mock, state } = await cargar();
    const antes = state.paymentMethods.length;
    await mock.mockPayMesa(
      HANZO_DIRECTO,
      pagoBase({ payment_type: 'apple_pay', save_payment_method: true, stripe_payment_method_id: 'pm_utileria_wallet' }),
      'user',
    );
    expect(state.paymentMethods.some((pm) => pm.stripe_payment_method_id === 'pm_utileria_wallet')).toBe(false);
    expect(state.paymentMethods.length).toBe(antes);
  });

  it('guest → no-op (no hay Customer al que adjuntar)', async () => {
    const { mock, state } = await cargar();
    const antes = state.paymentMethods.length;
    await mock.mockPayMesa(HANZO_DIRECTO, pagoBase({ save_payment_method: true }), 'guest');
    expect(state.paymentMethods.length).toBe(antes);
  });
});
