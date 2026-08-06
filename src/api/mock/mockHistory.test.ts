import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `mesa_status` DEL HISTORIAL ES VIVO, NO FOTO.
 *
 * El emisor lo proyecta con `JOIN mesas` al momento de la consulta
 * (`contract-mirror/routes/account.js`); el mock guardaba el estado del
 * momento del pago. La divergencia aparece en el caso más corriente de §1.10:
 * pagás tu parte (la entrada nace `partially_paid`), la mesa termina después
 * — y con la foto, Historial excluiría esa mesa PARA SIEMPRE como "todavía
 * abierta". Un mock que miente hacia el lado permisivo o el restrictivo
 * convierte mirar la pantalla en teatro; mismo defecto de clase que el filtro
 * `openedByUser` de G-28.
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

describe('mockHistory · mesa_status se proyecta vivo, como el JOIN del emisor', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('una entrada con foto vieja sirve el estado ACTUAL de la mesa', async () => {
    const { mock, state } = await cargar();
    const mesa = state.mesas[0]!;
    mesa.status = 'completed';
    state.history.push({
      id: 'h-foto-vieja',
      amount_cents: 5000,
      date: new Date().toISOString(),
      mesa_code: mesa.code,
      // La foto del momento del pago: la mesa seguía viva.
      mesa_status: 'partially_paid',
      restaurant: mesa.restaurant.name,
      category: mesa.restaurant.category,
    });

    const r = await mock.mockHistory();
    const entrada = r.history.find((h) => h.id === 'h-foto-vieja');
    expect(entrada?.mesa_status).toBe('completed');
  });

  it('una entrada del seed sin mesa viva conserva su estado guardado', async () => {
    const { mock, state } = await cargar();
    // Las mesas del seed histórico (PA-8712, etc.) no existen en state.mesas:
    // no hay de dónde re-leer, y el estado guardado es lo único que hay.
    const codigosVivos = new Set(state.mesas.map((m) => m.code));
    const r = await mock.mockHistory();
    const delSeed = r.history.filter((h) => !codigosVivos.has(h.mesa_code));
    expect(delSeed.length).toBeGreaterThan(0);
    for (const h of delSeed) expect(h.mesa_status).toBe('completed');
  });
});
