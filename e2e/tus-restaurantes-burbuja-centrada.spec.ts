import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-STATS-BURBUJA · Mati, en el iPhone: «la burbuja está descentrada». La
 * tarjeta blanca con lo propio tenía el texto corrido a la izquierda y era más
 * angosta que el botón del ticket completo.
 *
 * D479/D482 · con Claude Design 0.261 cada plato propio es su propia fila (el
 * formato de ¿Qué consumiste?) y la porción va pegada al nombre («½ Tiramisú»):
 * la columna aparte de la porción ya no existe. Se mide la geometría real, a
 * 390 px: relleno simétrico en cada fila, y las filas del mismo ancho que el
 * botón «Ver todo el ticket».
 *
 * El mock emite La Parolaccia con una visita con «½». Para tener una visita sin
 * porciones sin tocar el mock, se envuelve `api.getStatsRestaurants`: pasa los
 * platos de la primera visita de Hanzo Sushi a enteros y los hace pasar por el
 * decodificador REAL.
 */
async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await page.goto('/estadisticas');
  await page.evaluate(async () => {
    const apiRoute = '/src/api/index.ts';
    const mockRoute = '/src/api/mock/mockApi.ts';
    const decoderRoute = '/src/api/tusRestaurantes.ts';
    const { api } = await import(/* @vite-ignore */ apiRoute) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    // D260 · como la fachada: con `stats_version=2` (la visita trae `viaje_id`, que el decodificador exige).
    const mock = await import(/* @vite-ignore */ mockRoute) as {
      mockStatsRestaurants: (p?: string, o?: { statsVersion?: 1 | 2 }) => Promise<unknown>;
    };
    const { decodeTusRestaurantes } = await import(/* @vite-ignore */ decoderRoute) as { decodeTusRestaurantes: (raw: unknown) => unknown };
    api.getStatsRestaurants = async (period?: unknown) => {
      const raw = structuredClone(await mock.mockStatsRestaurants(period as string | undefined, { statsVersion: 2 })) as {
        restaurants: Array<{ name: string; visits: Array<{ items: Array<{ fraction_bps: number }> }> }>;
      };
      const hanzo = raw.restaurants.find((r) => r.name === 'Hanzo Sushi');
      if (!hanzo?.visits[0]?.items.length) throw new Error('fixture sin platos en Hanzo Sushi');
      for (const it of hanzo.visits[0].items) it.fraction_bps = 10000;
      return decodeTusRestaurantes(raw);
    };
  });
  await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
  await expect(page).toHaveURL(/:\d+\/restaurantes$/);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

type Caja = { left: number; right: number };

/** Geometría de las filas de lo propio y del botón del ticket, en px CSS. */
async function medir(page: Page, restaurante: string) {
  const r = page.getByRole('region', { name: restaurante, exact: true });
  await r.getByRole('button', { name: new RegExp(`^${restaurante}`) }).click();
  const visita = r.locator('.rest-visita').first();
  await visita.locator('.rest-visita-fila').click();
  await expect(visita.locator('.est-consumo.mio').first()).toBeVisible();
  return visita.evaluate((v) => {
    const caja = (e: Element): Caja => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right }; };
    const filas = [...v.querySelectorAll('.est-consumo.mio')];
    return {
      filas: filas.map((f) => ({ ...caja(f), izq: parseFloat(getComputedStyle(f).paddingLeft), der: parseFloat(getComputedStyle(f).paddingRight) })),
      boton: caja(v.querySelector('.est-ticket-boton')!),
    };
  });
}

test.describe('AF-STATS-BURBUJA · la tarjeta de lo propio, centrada', () => {
  test('sin porciones: cada fila con el mismo relleno a los dos lados', async ({ page }) => {
    await preparar(page);
    const m = await medir(page, 'Hanzo Sushi');
    await capturar(page, 'burbuja-01-sin-porciones');
    expect(m.filas.length).toBeGreaterThan(0);
    for (const f of m.filas) expect(f.izq).toBe(f.der);
  });

  test('las filas de lo propio tienen el mismo ancho que «Ver todo el ticket»', async ({ page }) => {
    await preparar(page);
    const m = await medir(page, 'La Parolaccia');
    await capturar(page, 'burbuja-02-con-porcion');
    for (const f of m.filas) {
      expect(Math.abs(f.left - m.boton.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(f.right - m.boton.right)).toBeLessThanOrEqual(1);
    }
    // Con una porción, va delante del nombre en la misma fila.
    const propio = page.getByRole('region', { name: 'La Parolaccia', exact: true }).locator('.est-consumo.mio');
    await expect(propio.nth(1)).toHaveText(/^½Tiramisú\$/);
    await expect(propio.nth(1).locator('.est-consumo-prefijo')).toHaveText('½');
  });
});
