import { beforeEach, describe, expect, it, vi } from 'vitest';
import { payMesaResponse } from './moneyGuards';
import type { PayMesaRequest } from './types';

/**
 * OLA 5C · (a) · MARCAR ANTES DE BORRAR.
 *
 * Hay código que dice `topup`, `transfer` y `wallet` pero que **sostiene el
 * riel TARJETA**. Un apagado del riel saldo guiado por `grep` lo borraría por
 * nombre y rompería la seguridad monetaria de card-only, que es superficie
 * ratificada que se conserva.
 *
 * Es el gemelo exacto de los siete `INSERT INTO wallets` del backend: allá el
 * riesgo era apagar uno y creer que se apagaron todos; acá es borrar por
 * nombre y llevarse puesta una protección que no es de wallet.
 *
 * Un comentario no alcanza —ya se vio en este ciclo que el comentario correcto
 * no evitó la reincidencia—, así que la marca es ESTRUCTURAL: si alguien
 * elimina estas ramas, estos tests fallan y dicen por qué.
 *
 * ⚠️ Si estás leyendo esto porque un test de acá se puso rojo mientras
 * apagabas el wallet: no es un test desactualizado. Es la marca funcionando.
 */

const SESSION_KEY = 'payme_app_session';

function setup() {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const mk = (m: Map<string, string>) => ({
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear(),
  });
  local.set(SESSION_KEY, JSON.stringify({
    access_token: 'a', refresh_token: 'r', family_id: 'fam-1', principal_id: 'p1',
  }));
  vi.stubGlobal('localStorage', mk(local));
  vi.stubGlobal('sessionStorage', mk(session));
  let n = 0;
  vi.stubGlobal('crypto', {
    randomUUID: () => `key-${++n}-aaaa-bbbb-cccc-dddddddddddd`,
    subtle: {
      digest: async (_a: string, data: Uint8Array) => {
        let h = 2166136261;
        for (const b of data) h = Math.imul(h ^ b, 16777619) >>> 0;
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) out[i] = (h >>> ((i % 4) * 8)) & 0xff;
        return out.buffer;
      },
    },
  });
  vi.stubGlobal('navigator', {
    locks: { request: async (_n: string, _o: unknown, fn: () => Promise<unknown>) => fn() },
  });
  return { session };
}

describe('OLA 5C · vocabulario wallet que sostiene el riel TARJETA', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  /**
   * `legacyOperation` (idempotency.ts) mapea residuo de versiones anteriores a
   * su área. Sus cuatro ramas incluyen `pay:` y `mesa:`, que son CARD-ONLY.
   *
   * Las ramas `topup:` y `transfer:` tampoco son "superficie wallet": son la
   * PRECISIÓN del barrido. Sin ellas, un residuo de topup deja de reconocerse y
   * cae en la rama "prefijo desconocido", que congela CUALQUIER área que el
   * usuario intente abrir — incluidas las de tarjeta.
   */
  describe('legacyOperation · sus ramas dan precisión al barrido de card-only', () => {
    it('un residuo de TOPUP no congela abrir mesa (card-only)', async () => {
      const { session } = setup();
      session.set('payme_idem_topup:card:5000', 'residuo');
      const { acquireMonetaryIntent } = await import('./idempotency');

      // Si alguien borra la rama `topup:` de legacyOperation, este residuo pasa
      // a ser "desconocido" y ESTA llamada empieza a fallar: el organizador
      // queda sin poder abrir mesa por un residuo de saldo.
      const handle = await acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa');
      expect(handle.key).toBeTruthy();
    });

    it('un residuo de TRANSFER no congela pagar una mesa (card-only)', async () => {
      const { session } = setup();
      session.set('payme_idem_transfer:payme_mx_juan:1000:', 'residuo');
      const { acquireMonetaryIntent } = await import('./idempotency');

      const handle = await acquireMonetaryIntent('auth:p1::pay:PA-1', 'mesa_pay:PA-1');
      expect(handle.key).toBeTruthy();
    });

    it('pero un residuo de la MISMA área card-only sí congela', async () => {
      const { session } = setup();
      session.set('payme_idem_mesa:rest-1', 'residuo');
      const { acquireMonetaryIntent, MonetarySafetyError } = await import('./idempotency');

      await expect(
        acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa'),
      ).rejects.toBeInstanceOf(MonetarySafetyError);
    });

    it('y un prefijo DESCONOCIDO congela todo: es el fallback conservador', async () => {
      const { session } = setup();
      session.set('payme_idem_formato-que-nadie-conoce', 'residuo');
      const { acquireMonetaryIntent, MonetarySafetyError } = await import('./idempotency');

      await expect(
        acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa'),
      ).rejects.toBeInstanceOf(MonetarySafetyError);
    });
  });

  /**
   * CORRECCIÓN de mi propio hallazgo H-1, hecha con mutation testing.
   *
   * Yo había reportado que las comparaciones con `'wallet'` de
   * `moneyGuards.payMesaResponse` sostenían el riel tarjeta. **Es falso**, y lo
   * probé borrándolas: el test seguía verde. Quien rechaza un 2xx con forma de
   * wallet sobre un pago con tarjeta es la comparación GENÉRICA
   * `paymentType !== expected.payment_type`, que no lleva vocabulario wallet y
   * por lo tanto ningún `grep wallet` la tocaría.
   *
   * Las comparaciones con `'wallet'` que sí existen ahí hacen lo contrario de
   * lo que dije: EXIMEN al riel saldo de traer `client_secret`/`stripe_status`.
   * Borrarlas rompería el camino wallet, no el de tarjeta.
   *
   * Se conserva este bloque porque la protección real merece quedar fijada —
   * verificada por mutación, no por lectura.
   */
  describe('moneyGuards · qué protege de verdad al riel TARJETA', () => {
    const UUID_A = '11111111-1111-4111-8111-111111111111';
    const UUID_B = '22222222-2222-4222-8222-222222222222';
    const request: PayMesaRequest = {
      payment_type: 'card',
      items: [{ item_id: UUID_A, fraction_bps: 3333 }],
      tip_cents: 300,
      idempotency_key: 'k-1234567890',
    } as PayMesaRequest;
    const binding = { divisionMode: 'consumo' as const, tipCents: 300 };
    const fresh = {
      attempt: {
        id: UUID_B,
        gross_amount_cents: '1300',
        tip_cents: '300',
        items: [{ item_id: UUID_A, fraction_bps: 3333, amount_cents: '1000' }],
        client_secret: 'pi_secret',
        status: 'requires_action',
        stripe_status: 'requires_action',
        requires_action: true,
      },
    };

    it('el camino honesto de tarjeta pasa', () => {
      expect(payMesaResponse(fresh, request, binding)).toMatchObject({
        attempt: { gross_amount_cents: 1300, client_secret: 'pi_secret' },
      });
    });

    it('una respuesta con forma de WALLET sobre un pago con TARJETA se rechaza', () => {
      // Mutación verificada: borrar `paymentType !== expected.payment_type`
      // pone ESTE test en rojo. Borrar las comparaciones con 'wallet' NO lo
      // pone en rojo — de ahí la corrección del docblock de arriba.
      expect(() =>
        payMesaResponse(
          { attempt: { ...fresh.attempt, payment_type: 'wallet' } },
          request,
          binding,
        ),
      ).toThrow('money_response_malformed');
    });

    it('un pago con tarjeta SIN el secreto contractual se rechaza', () => {
      const { client_secret: _omitido, ...sinSecreto } = fresh.attempt;
      expect(() => payMesaResponse({ attempt: sinSecreto }, request, binding)).toThrow(
        'money_response_malformed',
      );
    });
  });
});
