import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * N-09 · la cuarentena legacy tenía entrada pero no salida: `guardLegacy`
 * relanzaba para siempre y ningún camino de código levantaba la marca. Un
 * usuario con residuo de una versión anterior quedaba sin poder operar.
 *
 * Estos tests fijan las dos mitades del arreglo: que se pueda salir por una
 * reconciliación EXPLÍCITA, y que salir NO borre la evidencia monetaria.
 */

const AREA_KEY = 'payme_money_legacy_quarantine_v1_';

const SESSION_KEY = 'payme_app_session';
const SESION = {
  access_token: 'a-token',
  refresh_token: 'r-token',
  family_id: 'fam-1',
  principal_id: 'p1',
};

function setupStorage() {
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
  // El journal necesita una sesión real: `currentFamily` deriva de ella el
  // lease, y sin eso todo scope `auth:` falla con money_actor_unavailable.
  local.set(SESSION_KEY, JSON.stringify(SESION));
  vi.stubGlobal('localStorage', mk(local));
  vi.stubGlobal('sessionStorage', mk(session));
  return { local, session };
}

function setupCryptoAndLocks() {
  vi.stubGlobal('crypto', {
    randomUUID: () => '11111111-2222-4333-8444-555555555555',
    subtle: {
      digest: async (_alg: string, data: Uint8Array) => {
        // Digest determinista y suficiente para el test: no se audita crypto acá.
        let h = 0;
        for (const b of data) h = (h * 31 + b) >>> 0;
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) out[i] = (h >>> (i % 4 * 8)) & 0xff;
        return out.buffer;
      },
    },
  });
  vi.stubGlobal('navigator', {
    locks: { request: async (_n: string, _o: unknown, fn: () => Promise<unknown>) => fn() },
  });
}

describe('N-09 · salida controlada de la cuarentena legacy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('con residuo legacy, la operación queda congelada', async () => {
    const { session } = setupStorage();
    setupCryptoAndLocks();
    session.set('payme_idem_mesa:rest-1', 'lo-que-sea');
    const { acquireMonetaryIntent, MonetarySafetyError } = await import('./idempotency');
    await expect(acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa')).rejects.toBeInstanceOf(
      MonetarySafetyError,
    );
  });

  it('readLegacyQuarantine informa el bloqueo sin lanzar, y lista el residuo', async () => {
    const { session } = setupStorage();
    setupCryptoAndLocks();
    session.set('payme_idem_mesa:rest-1', 'lo-que-sea');
    const { acquireMonetaryIntent, readLegacyQuarantine } = await import('./idempotency');
    await acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa').catch(() => undefined);

    const state = await readLegacyQuarantine('auth:p1::mesa:rest-1', 'create_mesa');
    expect(state).not.toBeNull();
    expect(state!.reconciled).toBe(false);
    expect(state!.residue).toContain('payme_idem_mesa:rest-1');
  });

  it('tras la reconciliación explícita la operación vuelve a abrirse', async () => {
    const { session } = setupStorage();
    setupCryptoAndLocks();
    session.set('payme_idem_mesa:rest-1', 'lo-que-sea');
    const { acquireMonetaryIntent, releaseLegacyQuarantine, readLegacyQuarantine } = await import(
      './idempotency'
    );
    await acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa').catch(() => undefined);

    await releaseLegacyQuarantine('auth:p1::mesa:rest-1', 'create_mesa');

    const state = await readLegacyQuarantine('auth:p1::mesa:rest-1', 'create_mesa');
    expect(state!.reconciled).toBe(true);
    const handle = await acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa');
    expect(handle.key).toBeTruthy();
    expect(handle.generation).toBeGreaterThan(0);
  });

  it('liberar NO borra la evidencia monetaria: el residuo queda intacto', async () => {
    const { session } = setupStorage();
    setupCryptoAndLocks();
    session.set('payme_idem_mesa:rest-1', 'evidencia-que-no-se-toca');
    session.set('payme_pending_pay:PA-1', 'otra-evidencia');
    const { acquireMonetaryIntent, releaseLegacyQuarantine } = await import('./idempotency');
    await acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa').catch(() => undefined);

    await releaseLegacyQuarantine('auth:p1::mesa:rest-1', 'create_mesa');

    expect(session.get('payme_idem_mesa:rest-1')).toBe('evidencia-que-no-se-toca');
    expect(session.get('payme_pending_pay:PA-1')).toBe('otra-evidencia');
  });

  it('la reconciliación es por área: no destraba otra operación', async () => {
    const { session, local } = setupStorage();
    setupCryptoAndLocks();
    // Prefijo histórico DESCONOCIDO: no se puede atribuir a un área, así que
    // congela cualquiera que el usuario intente abrir. Es el peor caso y el que
    // deja ver que la reconciliación no se contagia entre áreas.
    session.set('payme_idem_formato-viejo-desconocido', 'residuo');
    const { acquireMonetaryIntent, releaseLegacyQuarantine, MonetarySafetyError } = await import(
      './idempotency'
    );
    await expect(
      acquireMonetaryIntent('auth:p1::transfer:x:1', 'transfer'),
    ).rejects.toBeInstanceOf(MonetarySafetyError);
    await expect(
      acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa'),
    ).rejects.toBeInstanceOf(MonetarySafetyError);

    await releaseLegacyQuarantine('auth:p1::transfer:x:1', 'transfer');

    // La transferencia se abre; abrir mesa sigue congelada por su propia área.
    const handle = await acquireMonetaryIntent('auth:p1::transfer:x:1', 'transfer');
    expect(handle.key).toBeTruthy();
    await expect(
      acquireMonetaryIntent('auth:p1::mesa:rest-1', 'create_mesa'),
    ).rejects.toBeInstanceOf(MonetarySafetyError);
    expect([...local.keys()].filter((k) => k.startsWith(AREA_KEY)).length).toBeGreaterThan(1);
  });
});
