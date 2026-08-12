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

const { modoMonetarioMock, setModoMonetarioMock, mockGetConfig } = await import('./mockApi');

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

  it('el default es `sandbox` · es lo que hay desplegado hoy', () => {
    // Un default distinto del real haría que la demo no muestre lo que la gente
    // se va a encontrar.
    expect(modoMonetarioMock()).toMatchObject({ mode: 'sandbox' });
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
