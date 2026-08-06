import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * UNA CUENTA NUEVA NACE COMO EN EL BACKEND REAL: SIN TARJETAS Y CON SU PAYME_ID.
 *
 * Auditoría 2026-08-06: `mockRegister` hacía `{...MOCK_USER, ...data}` y la
 * cuenta recién creada heredaba las dos tarjetas del seed y el payme_id de la
 * persona de ejemplo. Con eso, EL CAMINO DEL PAGADOR PRIMERIZO —el primero que
 * recorre un usuario real, porque la garantía exige tarjeta guardada y
 * Apple/Google están apagados— era INEJERCITABLE en la demo: nunca existía el
 * estado cero-tarjetas.
 *
 * Las dos direcciones se afirman a propósito, porque cada una es la recaída de
 * la otra: si alguien "simplifica" el registro volviendo a heredar, cae el
 * primer test; si alguien sobre-corrige y le borra las tarjetas también al
 * LOGIN, cae el segundo — y con él la fluidez de la demo que Mati muestra.
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

describe('mockRegister · la cuenta nueva no hereda el seed', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('nace con CERO métodos de pago', async () => {
    const { mock, state } = await cargar();
    expect(state.paymentMethods.length).toBeGreaterThan(0); // control positivo: el seed las tiene
    await mock.mockRegister({ email: 'nueva@demo.mx', first_name: 'Sofía', last_name: 'Nueva' });
    const r = await mock.mockPaymentMethods();
    expect(r.payment_methods).toEqual([]);
  });

  it('nace con payme_id PROPIO, derivado de su nombre y sin acentos', async () => {
    const { mock, state } = await cargar();
    await mock.mockRegister({ email: 'nueva@demo.mx', first_name: 'Sofía', last_name: 'Nueva' });
    expect(state.user.payme_id).toBe('payme_mx_sofia');
    expect(state.user.payme_id).not.toBe('payme_mx_mati');
  });

  it('el login del usuario del SEED conserva sus dos tarjetas y su payme_id', async () => {
    const { mock, state } = await cargar();
    const sembradas = state.paymentMethods.length;
    await mock.mockLogin('mati@demo.mx', 'lo-que-sea');
    const r = await mock.mockPaymentMethods();
    expect(r.payment_methods.length).toBe(sembradas);
    expect(state.user.payme_id).toBe('payme_mx_mati');
  });
});
