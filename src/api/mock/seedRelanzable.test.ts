import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G-36 (ORDEN 2-A.4) · EL SEED QUE ENVEJECE SE RE-SIEMBRA SOLO — CON RELOJ
 * CONTROLADO, como exige la orden: crear estado → adelantar el tiempo más
 * allá de TODAS las expiraciones → recargar desde persistencia → la demo
 * sigue coherente sin reset manual.
 *
 * Y las dos direcciones que hacen honesto el relanzamiento:
 * - lo NUNCA tocado vuelve (la demo no se pudre sola entre sesiones);
 * - lo TOCADO por el usuario y lo que no lleva la marca NO se reescriben
 *   jamás — relanzarle una mesa pagada a alguien sería el mock inventándole
 *   pasado, y PA-1099 tiene que seguir contando la historia A-2.
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

/** Persiste el estado vigente y devuelve una recarga fresca del módulo. */
async function persistirYRehidratar() {
  const { persist } = await import('./store');
  persist();
  // persist() agrupa en un microtask: hay que drenarlo antes de re-importar.
  await Promise.resolve();
  vi.resetModules();
  return import('./store');
}

describe('G-36 · relanzamiento del seed vencido, con reloj controlado', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T20:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('dos horas después, la demo vuelve coherente: las tres vivas del seed, con reloj adelante', async () => {
    const { state } = await import('./store');
    const codigos = ['PA-2847', 'PA-3121', 'PA-4520'];
    for (const c of codigos) {
      expect(state.mesas.find((m) => m.code === c)?.seedRelanzable).toBeTruthy();
    }

    // Adelantar el tiempo MÁS ALLÁ de todas las expiraciones (la más larga es
    // 29 min) y recargar desde persistencia.
    vi.setSystemTime(new Date('2026-08-07T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();

    for (const c of codigos) {
      const mesa = renacido.mesas.find((m) => m.code === c)!;
      const original = c === 'PA-4520' ? 'open' : 'partially_paid';
      expect(mesa.status).toBe(original);
      expect(new Date(mesa.expires_at).getTime()).toBeGreaterThan(Date.now());
      expect(mesa.captured_shortfall_cents).toBe(0);
    }
    // La invitación de Sofía sigue atada al reloj de SU mesa: canjeable.
    const inv = renacido.pendingInvitations.find((i) => i.mesa_code === 'PA-4520')!;
    expect(inv.expires_at).toBe(renacido.mesas.find((m) => m.code === 'PA-4520')!.expires_at);
  });

  it('PA-1099 NO se relanza: su historia ES estar cerrada (A-2)', async () => {
    await import('./store');
    vi.setSystemTime(new Date('2026-08-07T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();
    expect(renacido.mesas.find((m) => m.code === 'PA-1099')!.status).toBe('completed');
  });

  it('la mesa TOCADA por el usuario no se reescribe: su pago es historia, no seed', async () => {
    const { state } = await import('./store');
    // El usuario pagó su parte en PA-3121 antes de irse a dormir.
    state.history.push({
      id: 'pago-del-usuario',
      amount_cents: 15500,
      date: new Date().toISOString(),
      mesa_code: 'PA-3121',
      mesa_status: 'partially_paid',
      restaurant: 'Hanzo Sushi',
      category: 'japanese',
    });

    vi.setSystemTime(new Date('2026-08-07T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();

    // PA-3121 quedó donde el reloj la dejó (vencida, NO relanzada)…
    const tocada = renacido.mesas.find((m) => m.code === 'PA-3121')!;
    expect(new Date(tocada.expires_at).getTime()).toBeLessThan(Date.now());
    expect(tocada.status).toBe('partially_paid'); // settleIfExpired corre al LEER, no acá
    // …y las no tocadas volvieron igual: el relanzamiento es POR MESA.
    expect(new Date(renacido.mesas.find((m) => m.code === 'PA-2847')!.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('la mesa creada por el usuario no lleva la marca y no se relanza', async () => {
    const { state } = await import('./store');
    state.mesas.unshift({
      ...state.mesas.find((m) => m.code === 'PA-4520')!,
      id: 'mesa-del-usuario',
      code: 'PA-9001',
      openedByUser: true,
      seedRelanzable: undefined,
      expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    });

    vi.setSystemTime(new Date('2026-08-07T22:00:00Z'));
    const { state: renacido } = await persistirYRehidratar();
    const propia = renacido.mesas.find((m) => m.code === 'PA-9001')!;
    expect(new Date(propia.expires_at).getTime()).toBeLessThan(Date.now());
  });
});
