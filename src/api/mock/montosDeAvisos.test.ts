import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMXN } from '../../utils/format';

/**
 * D202 · los avisos que siembra el mock escriben los montos como el dueño. Desde
 * App Backend v2.152.0 (`montoEnTexto`, la parte del dueño de D181) los textos de
 * las notificaciones van sin «.00» cuando el monto es entero; el mock seguía
 * sembrando «$210.00», «$500.00» y «$80.00».
 *
 * La migración de estados ya persistidos (`loadPersisted`) sigue reconociendo el
 * texto viejo a propósito: eso lo cubre `walletNotifications.test.ts`.
 */

function storageVacio() {
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

describe('D202 · los avisos sembrados del mock, con los montos del dueño', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sin «.00» en los montos enteros, con el formateador de la app', async () => {
    storageVacio();
    const { state, seedWalletNotifications } = await import('./store');
    const cuerpos = [...state.notifications, ...seedWalletNotifications()].map((n) => n.body ?? '');
    const montos = cuerpos.flatMap((b) => b.match(/\$[\d,]+(?:\.\d+)?/g) ?? []);
    // Control: hay montos que mirar (el faltante y los dos del riel durmiente).
    expect(montos.length).toBeGreaterThanOrEqual(3);
    for (const monto of montos) expect(monto).not.toMatch(/\.00$/);
    expect(cuerpos).toContain(`Se cobró el faltante de la mesa (${formatMXN(21000)}) a tu garantía.`);
    expect(cuerpos).toContain(`Se acreditaron ${formatMXN(50000)} a tu saldo PayMe`);
    expect(cuerpos).toContain(`Juan López te envió ${formatMXN(8000)}`);
  });
});
