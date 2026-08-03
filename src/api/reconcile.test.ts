import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * N-07 · el journal v5 congelaba sin salida. Sin payload en memoria —tras un
 * reload, el back del navegador o un remount— el área quedaba bloqueada para
 * siempre, y en `create_mesa` el área es global por principal: el organizador
 * no podía abrir NINGUNA mesa nunca más en ese navegador.
 *
 * Estos tests fijan la salida: reconciliación explícita, nunca TTL, y sin
 * romper el aislamiento cross-principal.
 */

const SESSION_KEY = 'payme_app_session';

function sesion(principal: string, family: string) {
  return { access_token: 'a', refresh_token: 'r', family_id: family, principal_id: principal };
}

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
  local.set(SESSION_KEY, JSON.stringify(sesion(principal, family)));
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
  return { local, session, relogin: (fam: string) => local.set(SESSION_KEY, JSON.stringify(sesion(principal, fam))) };
}

const SCOPE = 'auth:p1::mesa:rest-1';
const OP = 'create_mesa';

describe('N-07 · salida del intento congelado', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sin reconciliar, un intento ambiguo sigue devolviendo el MISMO handle (no abre otro cobro)', async () => {
    setup();
    const { acquireMonetaryIntent, prepareMonetaryRequest, withPreparedMonetaryRequest } = await import('./idempotency');
    const h = await acquireMonetaryIntent(SCOPE, OP);
    await prepareMonetaryRequest(SCOPE, OP, h, { idempotency_key: h.key, total: 1 });
    await withPreparedMonetaryRequest(OP, h, { idempotency_key: h.key, total: 1 }, undefined, () => {
      throw new Error('red caída');
    }).catch(() => undefined);

    // Segundo intento del usuario: el journal le devuelve la MISMA generación.
    const again = await acquireMonetaryIntent(SCOPE, OP);
    expect(again.key).toBe(h.key);
    expect(again.generation).toBe(h.generation);
  });

  it('tras reconciliar, la operación siguiente abre una generación NUEVA', async () => {
    setup();
    const { acquireMonetaryIntent, prepareMonetaryRequest, withPreparedMonetaryRequest, reconcileMonetaryIntent } = await import('./idempotency');
    const h = await acquireMonetaryIntent(SCOPE, OP);
    await prepareMonetaryRequest(SCOPE, OP, h, { idempotency_key: h.key, total: 1 });
    await withPreparedMonetaryRequest(OP, h, { idempotency_key: h.key, total: 1 }, undefined, () => {
      throw new Error('red caída');
    }).catch(() => undefined);

    await reconcileMonetaryIntent(SCOPE, OP, h);

    const fresh = await acquireMonetaryIntent(SCOPE, OP);
    expect(fresh.key).not.toBe(h.key);
    expect(fresh.generation).toBe(h.generation + 1);
  });

  /**
   * El caso que dejaba al organizador sin poder abrir NINGUNA mesa: relogin
   * (familia nueva) sobre un intento ambiguo. `completeMonetaryIntent` exige
   * familia y por eso no servía; la reconciliación exige actor y generación.
   */
  it('destraba también después de un relogin del mismo principal', async () => {
    const s = setup('p1', 'fam-1');
    const mod = await import('./idempotency');
    const h = await mod.acquireMonetaryIntent(SCOPE, OP);
    await mod.prepareMonetaryRequest(SCOPE, OP, h, { idempotency_key: h.key, total: 1 });
    await mod.withPreparedMonetaryRequest(OP, h, { idempotency_key: h.key, total: 1 }, undefined, () => {
      throw new Error('red caída');
    }).catch(() => undefined);

    s.relogin('fam-2');

    // Antes de reconciliar, la familia nueva no puede mutar: sigue bloqueada.
    await expect(mod.acquireMonetaryIntent(SCOPE, OP)).rejects.toThrow('monetary_family_reconciliation_required');
    // Y `completeMonetaryIntent` tampoco la libera: exige familia.
    await expect(mod.completeMonetaryIntent(SCOPE, OP, h)).rejects.toThrow('monetary_family_reconciliation_required');

    await mod.reconcileMonetaryIntent(SCOPE, OP, h);

    const fresh = await mod.acquireMonetaryIntent(SCOPE, OP);
    expect(fresh.generation).toBe(h.generation + 1);
  });

  it('no reconcilia una generación distinta de la capturada', async () => {
    setup();
    const { acquireMonetaryIntent, reconcileMonetaryIntent } = await import('./idempotency');
    const h = await acquireMonetaryIntent(SCOPE, OP);
    await expect(
      reconcileMonetaryIntent(SCOPE, OP, { ...h, generation: h.generation + 5 }),
    ).rejects.toThrow('monetary_generation_stale');
    await expect(
      reconcileMonetaryIntent(SCOPE, OP, { ...h, key: 'otra-key-cualquiera' }),
    ).rejects.toThrow('monetary_generation_stale');
  });

  it('NO rompe el aislamiento cross-principal: otro principal no toca ese intento', async () => {
    const s = setup('p1', 'fam-1');
    const mod = await import('./idempotency');
    const h = await mod.acquireMonetaryIntent(SCOPE, OP);
    await mod.prepareMonetaryRequest(SCOPE, OP, h, { idempotency_key: h.key, total: 1 });

    // Otro principal en el mismo navegador intenta reconciliar con ese handle.
    s.local.set(SESSION_KEY, JSON.stringify(sesion('p2', 'fam-9')));
    await mod.reconcileMonetaryIntent('auth:p2::mesa:rest-1', OP, h).catch(() => undefined);

    // El intento de p1 sigue vivo: p2 no puede terminalizarlo desde su índice.
    s.local.set(SESSION_KEY, JSON.stringify(sesion('p1', 'fam-1')));
    const again = await mod.acquireMonetaryIntent(SCOPE, OP);
    expect(again.key).toBe(h.key);
    expect(again.generation).toBe(h.generation);
  });

  it('reconciliar es idempotente y no revive un intento ya terminal', async () => {
    setup();
    const { acquireMonetaryIntent, reconcileMonetaryIntent } = await import('./idempotency');
    const h = await acquireMonetaryIntent(SCOPE, OP);
    await reconcileMonetaryIntent(SCOPE, OP, h);
    await expect(reconcileMonetaryIntent(SCOPE, OP, h)).resolves.toBeUndefined();
    const fresh = await acquireMonetaryIntent(SCOPE, OP);
    expect(fresh.generation).toBe(h.generation + 1);
  });
});
