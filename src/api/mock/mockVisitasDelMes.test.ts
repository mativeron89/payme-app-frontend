import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Las visitas del mes en curso del mock (`visitasDelModelo`), a cualquier hora del mes.
 *
 * El defecto (medido el 2026-11-01 a las 00:07 de México): las visitas del mes iban «una hora atrás por cada una desde
 * ahora, sin salir del mes». En las primeras horas del día 1 las que no entraban se pegaban al inicio del mes con un
 * minuto de diferencia, en el orden contrario, así que la más nueva dejaba de ser la primera. Se rompían
 * `tus-restaurantes`, `tus-restaurantes-lo-propio` y `tus-restaurantes-burbuja-centrada` durante las primeras horas de
 * cada mes, en local y en CI. Ahora el paso entre visitas se achica para entrar en lo que va del mes: el orden es el
 * mismo a cualquier hora, y desde que pasaron las horas que hacen falta, las fechas son las de siempre.
 */
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
});
vi.stubGlobal('window', { location: { origin: 'https://payme.test', pathname: '/' } });
storage.set('payme.app.mock.latencia.v1', '0');

const { mockStatsRestaurants } = await import('./mockApi');

interface Visita { created_at: string; items: Array<{ name: string; fraction_bps: number }> }
interface Restaurante { name: string; visits: Visita[] }

afterEach(() => { vi.useRealTimers(); });

async function restaurantesA(iso: string): Promise<{ inicio: number; ahora: number; restaurantes: Restaurante[] }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  const r = await mockStatsRestaurants() as { month_start: string; restaurants: Restaurante[] };
  return { inicio: Date.parse(r.month_start), ahora: Date.parse(iso), restaurantes: r.restaurants };
}

// Medianoche del día 1 en México = 06:00Z. Momentos del día 1, del primer minuto a la hora 12, y uno de mitad de mes.
const MOMENTOS = [
  '2026-11-01T06:00:30Z', '2026-11-01T06:07:00Z', '2026-11-01T06:30:00Z', '2026-11-01T07:30:00Z',
  '2026-11-01T09:00:00Z', '2026-11-01T12:00:00Z', '2026-11-01T18:00:00Z', '2026-11-15T18:00:00Z',
];

describe('las visitas del mes en curso del mock', () => {
  it.each(MOMENTOS)('🔴 %s · en cada restaurante, la más nueva es la primera (la del plato a medias), todas dentro del mes y distintas', async (iso) => {
    const { inicio, ahora, restaurantes } = await restaurantesA(iso);
    const parolaccia = restaurantes.find((r) => r.name === 'La Parolaccia');
    expect(parolaccia, 'La Parolaccia está en el mes').toBeDefined();
    expect(parolaccia!.visits[0]!.items.map((i) => i.fraction_bps)).toContain(5000);
    for (const r of restaurantes) {
      const fechas = r.visits.map((v) => Date.parse(v.created_at));
      for (const f of fechas) {
        expect(f, `${r.name}: dentro del mes`).toBeGreaterThanOrEqual(inicio);
        expect(f, `${r.name}: no en el futuro`).toBeLessThanOrEqual(ahora);
      }
      expect(new Set(fechas).size, `${r.name}: fechas distintas`).toBe(fechas.length);
      // La primera visita (v = 0) es la del plato a medias, y es la más nueva.
      if (r.visits.length > 1) expect(r.visits[0]!.items.some((i) => i.fraction_bps === 5000), r.name).toBe(true);
    }
  });

  it('pasadas las horas que hacen falta, las fechas son las de siempre: una hora atrás por visita', async () => {
    const { ahora, restaurantes } = await restaurantesA('2026-11-15T18:00:00Z');
    const todas = restaurantes.flatMap((r) => r.visits.map((v) => Date.parse(v.created_at))).sort((a, b) => b - a);
    expect(todas.map((f) => (ahora - f) / 3_600_000)).toEqual(todas.map((_, i) => i + 1));
  });
});
