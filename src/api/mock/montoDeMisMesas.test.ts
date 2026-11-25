import { expect, it, vi } from 'vitest';

it.each([
  { precio: 3500, esperados: [1167, 1167, 1166] },
  { precio: 10001, esperados: [3333, 3333, 3335] },
])('Tus mesas conserva cada centavo al completar un plato de $precio centavos', async ({ precio, esperados }) => {
  vi.resetModules();
  const { state } = await import('./store');
  const { mockMisMesas } = await import('./mockApi');
  const mesa = state.mesas.find(m => m.openedByUser && m.division_mode === 'consumo' && m.items.length)!;
  mesa.items = [{ ...mesa.items[0]!, quantity: 1, price_cents: precio, claims: [] }];
  const plato = mesa.items[0]!;
  for (const [i, esperado] of esperados.entries()) {
    plato.claims = [3333, 3333, 3334].map((fraction_bps, k) => ({
      who: k === i ? 'user' : 'other', fraction_bps, amount_cents: null, status: 'locked',
    }));
    const respuesta = await mockMisMesas({ detail: 'items' }) as {
      mesas: { code: string; mine: { amount_cents: number; items: { amount_cents: number }[] } }[];
    };
    const mia = respuesta.mesas.find(m => m.code === mesa.code)!.mine;
    expect(mia.amount_cents).toBe(esperado);
    expect(mia.items.map(p => p.amount_cents)).toEqual([esperado]);
  }
});
