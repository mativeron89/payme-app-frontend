import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-20 · n89 · `withSessionLock` y la costura C-02: «no hay Web Locks» es un
 * centinela propio, así que una acción que resuelve `null` corre UNA vez.
 */

const { SIN_WEB_LOCKS, withSessionLock } = await import('./http');

function conLocks(): { pedidos: () => number } {
  let pedidos = 0;
  const locks = {
    async request<T>(_name: string, _opts: unknown, action: () => Promise<T> | T): Promise<T> {
      pedidos += 1;
      return action();
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
  return { pedidos: () => pedidos };
}

function sinLocks(): void {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('withSessionLock · centinela en vez de null', () => {
  it('🔴 una acción que resuelve null corre EXACTAMENTE una vez y devuelve null', async () => {
    const lock = conLocks();
    const accion = vi.fn(async () => null);
    const r = await withSessionLock(accion);
    expect(accion).toHaveBeenCalledTimes(1);
    expect(lock.pedidos()).toBe(1);
    expect(r).toBeNull();
    // El llamador lo distingue de «no hay Web Locks»: no es el centinela.
    expect(r).not.toBe(SIN_WEB_LOCKS);
  });

  it('🔴 sin Web Locks devuelve el centinela, no null, y no corre la acción', async () => {
    sinLocks();
    const accion = vi.fn(async () => 'x');
    const r = await withSessionLock(accion);
    expect(r).toBe(SIN_WEB_LOCKS);
    expect(r).not.toBeNull();
    expect(accion).not.toHaveBeenCalled();
  });

  it('🔴 el patrón de los llamadores: con una acción null, el fallback NO se ejecuta', async () => {
    // Reproduce la forma exacta de `invalidateSessionSerialized` y
    // `persistNewSession`: correr bajo el lock y, sólo si no hubo lock,
    // correr afuera. Con `null` como señal, esto corría la acción dos veces.
    conLocks();
    const accion = vi.fn(async () => null);
    const r = await withSessionLock(accion);
    if (r === SIN_WEB_LOCKS) await accion();
    expect(accion).toHaveBeenCalledTimes(1);
  });

  it('control positivo: sin Web Locks, el fallback corre la acción una vez', async () => {
    sinLocks();
    const accion = vi.fn(async () => null);
    const r = await withSessionLock(accion);
    if (r === SIN_WEB_LOCKS) await accion();
    expect(accion).toHaveBeenCalledTimes(1);
  });
});

describe('las tres puertas de sesión comparan contra el centinela, no contra null', () => {
  const fuente = readFileSync(new URL('./http.ts', import.meta.url), 'utf8');

  it('invalidateSessionSerialized, tryRefresh y persistNewSession usan SIN_WEB_LOCKS', () => {
    expect(fuente).toContain('return locked === SIN_WEB_LOCKS ? invalidateSession(session) : locked;');
    expect(fuente).toContain('return refrescada === SIN_WEB_LOCKS ? null : refrescada;');
    expect(fuente).toContain('if (saved === SIN_WEB_LOCKS) {');
    // Y ninguna vuelve a leer `null`/`??` sobre el resultado del lock.
    expect(fuente).not.toMatch(/locked \?\?/);
    expect(fuente).not.toMatch(/saved === null/);
    expect(fuente.match(/await withSessionLock\(/g)).toHaveLength(3);
  });
});
