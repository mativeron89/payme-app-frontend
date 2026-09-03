import { beforeEach, describe, expect, it } from 'vitest';

/**
 * `localStorage` no existe en el entorno de los tests de `src/api/`. Se usa el
 * mismo `MemoryStorage` que `cardSetupAttempt.test.ts`, y se instala ANTES de
 * importar el módulo: el mock lo lee al llamarlo, pero el import ya evalúa el
 * archivo entero.
 */
class MemoryStorage {
  values = new Map<string, string>();
  failGet = false;
  getItem(key: string) {
    if (this.failGet) throw new Error('modo privado');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const local = new MemoryStorage();
Object.assign(globalThis, { localStorage: local, sessionStorage: new MemoryStorage() });

const { modoMonetarioMock, modoMonetarioMockPorDefecto, setModoMonetarioMock, mockGetConfig, mockCreateMesa } = await import('./mockApi');

/**
 * LOS TRES MODOS MONETARIOS DEL MOCK · `D-FF-2-BIS`.
 *
 * ⚠️ **FORMA LEÍDA DE LA FUENTE, NO ESPEJADA.** Estos tres campos salen de
 * `../payme-app-backend/services/moneyRail.js:138`, leído directo. **El
 * contrato es lo que declara el inventario del dueño, y hoy su inventario está
 * en `df32a6b` (2026-08-07), tres días antes de que `money_rail` naciera.**
 * Republicado pedido. **Si el espejo llega con otra forma, estos tests caen y
 * hay que corregirlos — no borrarlos.**
 *
 * ── Por qué existe este archivo ──
 *
 * El cartel de «tarjeta de prueba» tiene que aparecer con `real_money: false`
 * **y NO aparecer con `real_money: true`**. Sin los dos estados alcanzables se
 * puede probar que aparece; **no que desaparece** — y ésa es la mitad que
 * importa, porque mostrarlo de más le dice a alguien con dinero real que use
 * una tarjeta falsa.
 *
 * 🔴 **AF-02 ya consume `money_rail` en producto.** El lector fail-closed
 * cierra los inicios nuevos cuando la capability no los habilita y conserva
 * las continuidades acreditadas (replay, 3DS y reconciliación).
 */

describe('los tres modos del mock · `payments_enabled` y `real_money` son INDEPENDIENTES', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    ['disabled', { mode: 'disabled', payments_enabled: false, real_money: false }],
    ['sandbox', { mode: 'sandbox', payments_enabled: true, real_money: false }],
    ['live', { mode: 'live', payments_enabled: true, real_money: true }],
  ] as const)('%s produce la forma de la fuente', (modo, esperado) => {
    setModoMonetarioMock(modo);
    expect(modoMonetarioMock()).toEqual(esperado);
  });

  /**
   * 🔴 LA PROPIEDAD QUE JUSTIFICA QUE SEAN DOS CAMPOS Y NO UNO.
   *
   * Con `disabled` las dos respuestas eran `false` y nadie notaba que eran dos
   * preguntas distintas. **Bajo `sandbox` se separan por primera vez**: el flujo
   * de pago está habilitado Y no se mueve dinero real. Un front que dedujera
   * `real_money` de una lista de modos hardcodeada miente el día que aparezca
   * un modo nuevo — por eso el emisor lo publica explícito y por eso se LEE.
   */
  it('🔴 sandbox es el único donde difieren · si coincidieran, un campo sobraría', () => {
    setModoMonetarioMock('sandbox');
    const s = modoMonetarioMock() as { payments_enabled: boolean; real_money: boolean };
    expect(s.payments_enabled).toBe(true);
    expect(s.real_money).toBe(false);
    expect(s.payments_enabled).not.toBe(s.real_money);
  });

  /**
   * 🔴 **F2 · el default se queda en `sandbox`, y lo decidió una medición.**
   *
   * Ponerlo en `disabled` parecía más honesto —es lo desplegado durante el
   * corte— pero ese valor **decide qué flujo ejercita la suite de navegador
   * entera**: sin pagos el organizador nunca pasa por la garantía, y 18
   * recorridos en 12 specs murieron. El default describe el flujo completo que
   * la app sabe hacer; **el corte se declara donde se prueba**.
   */
  it('el default es `sandbox` · el mock describe el flujo completo, no el corte', () => {
    expect(modoMonetarioMock()).toMatchObject({ mode: 'sandbox', payments_enabled: true, real_money: false });
  });

  /**
   * 🔴 Los otros dos modos existen y son alcanzables **sólo por el seam
   * explícito**. Es lo que permite que cada recorrido del corte declare su modo
   * sin que el default afirme algo que sólo vale mientras dure el corte.
   */
  it('`disabled` y `live` son alcanzables sólo por la clave explícita', () => {
    setModoMonetarioMock('disabled');
    expect(modoMonetarioMock()).toMatchObject({ mode: 'disabled', payments_enabled: false, real_money: false });
    setModoMonetarioMock('live');
    expect(modoMonetarioMock()).toMatchObject({ mode: 'live', payments_enabled: true, real_money: true });
  });

  /**
   * La fuente que leen los recorridos desde Node, donde no hay `localStorage`.
   * Tiene que coincidir con el default de arriba: si divergen, un spec dormiría
   * (o despertaría) por un motivo distinto del que ve la app en el navegador.
   */
  it('🔴 la fuente sin storage devuelve EXACTAMENTE el mismo default', () => {
    expect(modoMonetarioMockPorDefecto()).toEqual(modoMonetarioMock());
  });

  it('🔴 un valor basura cae al default y NO rompe · nadie tipea a mano sin equivocarse', () => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'lo-que-sea');
    expect(modoMonetarioMock()).toMatchObject({ mode: 'sandbox' });
  });

  it('🔴 la clave está NAMESPACEADA · mock y build real compartieron origen una vez', () => {
    setModoMonetarioMock('live');
    // `storage.ts:10-13` documenta que una sesión mock se habría filtrado al
    // backend real por vivir en el mismo origen. Esta clave nace namespaceada.
    expect(localStorage.getItem('payme.app.mock.money_rail.v1')).toBe('live');
  });

  it('🔴 si `localStorage` TIRA, cae al default y no rompe · modo privado del navegador', () => {
    local.failGet = true;
    try {
      expect(() => modoMonetarioMock()).not.toThrow();
      expect(modoMonetarioMock()).toMatchObject({ mode: 'sandbox' });
    } finally { local.failGet = false; }
    // CONTROL: con el storage sano vuelve a leer de verdad. Sin esto, un
    // `return MODOS.sandbox` al tope pasaría el caso de arriba.
    setModoMonetarioMock('live');
    expect(modoMonetarioMock()).toMatchObject({ mode: 'live' });
  });

  it('🔴 y llega a `GET /api/config` · sin esto el modo no sale del mock', async () => {
    setModoMonetarioMock('live');
    const cfg = await mockGetConfig();
    expect(cfg.features.money_rail).toEqual({
      mode: 'live', payments_enabled: true, real_money: true,
    });
    // CONTROL: cambiar el modo CAMBIA la respuesta. Sin esto, un valor fijo
    // pegado en `mockGetConfig` pasaría todo lo de arriba.
    setModoMonetarioMock('disabled');
    expect((await mockGetConfig()).features.money_rail).toMatchObject({ mode: 'disabled' });
  });
});

/**
 * 🔴 **La puerta del dueño para la mesa sin garantía, con su rojo.**
 *
 * `guarantee_method:'none'` **sólo existe con el dinero apagado**: con el riel
 * vivo el dueño responde `409 guarantee_required`, porque «la garantía es lo que
 * hace que el restaurante cobre» sigue ratificado para el riel monetario.
 *
 * ⚠️ **Este bloque existe porque un mutante sobrevivió**: quitar esa puerta del
 * mock no ponía nada en rojo — el recorrido de la mesa sin garantía fija
 * `disabled`, así que nunca ejercitaba el caso prohibido.
 */
describe('C3 · la mesa sin garantía sólo existe con el dinero apagado', () => {
  const pedido = {
    restaurant_id: 'b0000000-0000-4000-8000-000000000001',
    total_cents: 1000,
    division_mode: 'igual' as const,
    expected_participants: 2,
    guarantee_method: 'none' as const,
    idempotency_key: 'mesa-idem-c3-none',
    items: [{ name: 'Sopa', price_cents: 1000, quantity: 1 }],
  };

  it('con el riel VIVO, pedir `none` se rechaza con 409 guarantee_required', async () => {
    setModoMonetarioMock('sandbox');
    await expect(mockCreateMesa(pedido as never)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('con el dinero APAGADO, la misma mesa nace `open` y sin garantía', async () => {
    setModoMonetarioMock('disabled');
    const r = await mockCreateMesa({ ...pedido, idempotency_key: 'mesa-idem-c3-none-ok' } as never);
    expect(r.mesa.status).toBe('open');
    expect(r.guarantee).toEqual({ method: 'none', status: 'none' });
  });
});
