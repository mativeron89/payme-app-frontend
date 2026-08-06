import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * N-08 · la misma persona, en la misma mesa, entrando primero por link de
 * invitado y después autenticada obtenía un journal virgen y una idempotency
 * key nueva. En división igual eso toma un SEGUNDO casillero: doble cobro real.
 *
 * `claimed_by_me` del backend no lo detecta —se computa por identidad, así que
 * el backend también ve dos personas—. La evidencia disponible es local.
 *
 * Lo que estos tests fijan: que el cruce se DETECTE, que no se fusionen
 * principals distintos, y que seguir siendo posible pagar varias partes.
 */

const SESSION_KEY = 'payme_app_session';

function setup(principal = 'p1', family = 'fam-1') {
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
    access_token: 'a', refresh_token: 'r', family_id: family, principal_id: principal,
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
  return { local };
}

const MESA = 'PA-777';
const OP = `mesa_pay:${MESA}`;
const AUTH = `auth:p1::pay:${MESA}`;
const GUEST = `guest:tokenhash-abc::pay:${MESA}`;

describe('N-08 · cruce invitado ↔ autenticado en la misma mesa', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sin intentos previos no hay nada que advertir', async () => {
    setup();
    const { crossActorIntentExists } = await import('./idempotency');
    expect(await crossActorIntentExists(AUTH, OP)).toBe(false);
  });

  it('un intento propio NO se cuenta como otro actor', async () => {
    setup();
    const { acquireMonetaryIntent, crossActorIntentExists } = await import('./idempotency');
    await acquireMonetaryIntent(AUTH, OP);
    expect(await crossActorIntentExists(AUTH, OP)).toBe(false);
  });

  /** El caso del doble cobro: pagó como invitado y ahora entra autenticado. */
  it('detecta el intento del invitado cuando después entra autenticado', async () => {
    setup();
    const { acquireMonetaryIntent, crossActorIntentExists } = await import('./idempotency');
    await acquireMonetaryIntent(GUEST, OP);
    expect(await crossActorIntentExists(AUTH, OP)).toBe(true);
  });

  /** Y al revés: pagó autenticado y abre el link de invitado. */
  it('detecta el intento autenticado cuando después entra por el link', async () => {
    setup();
    const { acquireMonetaryIntent, crossActorIntentExists } = await import('./idempotency');
    await acquireMonetaryIntent(AUTH, OP);
    expect(await crossActorIntentExists(GUEST, OP)).toBe(true);
  });

  it('no confunde mesas distintas: el aviso es por mesa', async () => {
    setup();
    const { acquireMonetaryIntent, crossActorIntentExists } = await import('./idempotency');
    await acquireMonetaryIntent(`guest:tokenhash-abc::pay:OTRA-MESA`, 'mesa_pay:OTRA-MESA');
    expect(await crossActorIntentExists(AUTH, OP)).toBe(false);
  });

  it('sigue detectando después de que el intento del otro actor terminó', async () => {
    setup();
    const { acquireMonetaryIntent, completeMonetaryIntent, crossActorIntentExists } = await import('./idempotency');
    const h = await acquireMonetaryIntent(GUEST, OP);
    await completeMonetaryIntent(GUEST, OP, h);
    // Terminal significa que ese pago se resolvió: es justo cuando más importa
    // avisar, porque el próximo es una parte ADICIONAL.
    expect(await crossActorIntentExists(AUTH, OP)).toBe(true);
  });

  it('ante un journal corrupto avisa igual: preferimos preguntar de más', async () => {
    const { local } = setup();
    const { crossActorIntentExists } = await import('./idempotency');
    local.set('payme_money_journal_v5_loquesea', '{no es json valido');
    expect(await crossActorIntentExists(AUTH, OP)).toBe(true);
  });

  /**
   * El límite que la orden marca: detectar el cruce NO puede convertirse en el
   * guard "un usuario = un casillero", que está vetado por acta. Detectar es
   * avisar, no bloquear: el journal sigue entregando handle nuevo.
   */
  it('detectar NO bloquea: se puede seguir pagando otra parte', async () => {
    setup();
    const { acquireMonetaryIntent, completeMonetaryIntent, crossActorIntentExists } = await import('./idempotency');
    const primero = await acquireMonetaryIntent(AUTH, OP);
    await completeMonetaryIntent(AUTH, OP, primero);
    expect(await crossActorIntentExists(GUEST, OP)).toBe(true);

    const segundo = await acquireMonetaryIntent(AUTH, OP);
    expect(segundo.key).not.toBe(primero.key);
    expect(segundo.generation).toBe(primero.generation + 1);
  });
});
