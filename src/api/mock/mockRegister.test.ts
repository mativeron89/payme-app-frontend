import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_PASSWORD = ['pass', 'word'].join('');
const SIGNUP_AUTHORITY = ['signup', 'authority', 'a'.repeat(24)].join('-');

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
    await mock.mockRegister({ email: 'nueva@demo.mx', password: TEST_PASSWORD, first_name: 'Sofía', last_name: 'Nueva', invitation_token: SIGNUP_AUTHORITY });
    const r = await mock.mockPaymentMethods();
    expect(r.payment_methods).toEqual([]);
  });

  it('nace con payme_id PROPIO, derivado de su nombre y sin acentos', async () => {
    const { mock, state } = await cargar();
    await mock.mockRegister({ email: 'nueva@demo.mx', password: TEST_PASSWORD, first_name: 'Sofía', last_name: 'Nueva', invitation_token: SIGNUP_AUTHORITY });
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

  /**
   * 🔴 EL DEFECTO QUE ESTE TEST FIJA, encontrado recorriendo la demo el
   * 2026-08-09 — no leyendo el código.
   *
   * `mockLogin` derivaba `first_name` del email y **heredaba el `payme_id` del
   * usuario sembrado**. Entrabas como `juan@ejemplo.mx`, la app te saludaba
   * «Juan» y te mostraba `payme_mx_mati` en Más y en el encabezado de Avisos.
   *
   * No es cosmético: **el `payme_id` es la identidad con la que te encuentran
   * tus amigos.** En un link público, cada desconocido veía el nombre propio
   * del dueño de la demo como si fuera el suyo — se lee como un bug y además
   * filtra un nombre real.
   *
   * Y el comentario de `paymeIdFromName` ya prometía la conducta correcta
   * —"sale de SU nombre, no del usuario de ejemplo"—. `mockRegister` la
   * cumplía; este camino no. **Un comentario correcto al lado de un código que
   * hace otra cosa es peor que no tener comentario**, porque el que lo lee deja
   * de mirar.
   */
  it('🔴 el login con OTRO email recibe su propio payme_id, no el del seed', async () => {
    const { mock, state } = await cargar();
    // Control positivo: antes del login, el estado tiene el payme_id sembrado.
    expect(state.user.payme_id).toBe('payme_mx_mati');

    await mock.mockLogin('juan@ejemplo.mx', 'lo-que-sea');

    expect(state.user.first_name).toBe('Juan');
    expect(state.user.payme_id).toBe('payme_mx_juan');
    expect(state.user.payme_id, 'quedó el payme_id de la persona de ejemplo')
      .not.toBe('payme_mx_mati');
  });

  it('🔴 y el `payme_id` del login se normaliza igual que el del alta', async () => {
    // La misma función para los dos caminos: si alguien arregla uno solo, esto
    // lo agarra. Acentos fuera, minúsculas, sin caracteres raros.
    const { mock, state } = await cargar();
    await mock.mockLogin('SOFÍA.ramírez@ejemplo.mx', 'x');
    expect(state.user.first_name).toBe('Sofía');
    expect(state.user.payme_id).toBe('payme_mx_sofia');
  });

  it('un email sin nombre utilizable no rompe: queda el usuario del seed', async () => {
    // `nameFromEmail` devuelve null para locales de una letra o numéricos. Sin
    // este caso, la corrección de arriba podría dejar `payme_mx_` a secas.
    const { mock, state } = await cargar();
    await mock.mockLogin('42@ejemplo.mx', 'x');
    expect(state.user.payme_id).toBe('payme_mx_mati');
    expect(state.user.payme_id).not.toBe('payme_mx_');
  });
});
