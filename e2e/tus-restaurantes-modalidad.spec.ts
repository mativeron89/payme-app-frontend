import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-STATS-MODALIDAD · decisión 86 de Mati («Modalidad y porción»): cada visita
 * de «Tus restaurantes» dice si fue «Partes iguales» o «Por consumo», con el
 * `visits[].division_mode` que el dueño ya publica. La porción por plato queda
 * como estaba.
 *
 * El mock de estadísticas emite todas las visitas en consumo. Para tener una
 * «igual» sin tocar el mock, se envuelve `api.getStatsRestaurants`: llama al
 * mock real, pasa la primera visita de Hanzo Sushi a `igual` (sin platos
 * propios, como la publica el dueño) y la hace pasar por el decodificador
 * REAL, que sigue siendo estricto.
 */
async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await page.goto('/#/estadisticas');
  await page.evaluate(async () => {
    const apiRoute = '/src/api/index.ts';
    const mockRoute = '/src/api/mock/mockApi.ts';
    const decoderRoute = '/src/api/tusRestaurantes.ts';
    const { api } = await import(/* @vite-ignore */ apiRoute) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const mock = await import(/* @vite-ignore */ mockRoute) as { mockStatsRestaurants: (p?: string) => Promise<unknown> };
    const { decodeTusRestaurantes } = await import(/* @vite-ignore */ decoderRoute) as { decodeTusRestaurantes: (raw: unknown) => unknown };
    api.getStatsRestaurants = async (period?: unknown) => {
      const raw = structuredClone(await mock.mockStatsRestaurants(period as string | undefined)) as {
        restaurants: Array<{ name: string; visits: Array<{ division_mode: string; items: unknown[] }> }>;
      };
      const hanzo = raw.restaurants.find((r) => r.name === 'Hanzo Sushi');
      if (!hanzo?.visits[0]) throw new Error('fixture sin Hanzo Sushi');
      hanzo.visits[0].division_mode = 'igual';
      hanzo.visits[0].items = [];
      return decodeTusRestaurantes(raw);
    };
  });
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png`, fullPage: true });
}

const tarjeta = (page: Page, nombre: string) => page.getByRole('region', { name: nombre, exact: true });

test.describe('decisión 86 · la modalidad de cada visita en Tus restaurantes', () => {
  test('una visita «igual» dice «Partes iguales» y una de consumo dice «Por consumo»', async ({ page }) => {
    await preparar(page);
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page).toHaveURL(/:\d+\/restaurantes$/);

    const hanzo = tarjeta(page, 'Hanzo Sushi');
    await hanzo.getByRole('button', { name: /^Hanzo Sushi/ }).click();
    const visitasHanzo = hanzo.locator('.rest-visita');
    await expect(visitasHanzo).toHaveCount(2);
    await expect(visitasHanzo.nth(0).locator('.rest-visita-modo')).toHaveText('Partes iguales');
    await expect(visitasHanzo.nth(1).locator('.rest-visita-modo')).toHaveText('Por consumo');
    await capturar(page, 'modalidad-01-hanzo');

    // La porción por plato sigue como estaba: «½» junto al plato, nada si es entero.
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    for (const modo of await parolaccia.locator('.rest-visita-modo').allTextContents()) {
      expect(modo).toBe('Por consumo');
    }
  });
});
