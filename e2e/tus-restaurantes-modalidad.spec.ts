import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-STATS-MODALIDAD · decisión 86 de Mati («Modalidad y porción»): cada visita
 * de «Tus restaurantes» decía si fue «Partes iguales» o «Por consumo».
 *
 * D482 (K3) · Mati eligió sacar la modalidad de la lista de visitas (Claude
 * Design 0.261). Dentro de una visita en partes iguales queda «Tu parte, en
 * partes iguales»; dentro de una por consumo, los platos propios.
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
    // D260 · como la fachada: con `stats_version=2` (la visita trae `viaje_id`, que el decodificador exige).
    const mock = await import(/* @vite-ignore */ mockRoute) as {
      mockStatsRestaurants: (p?: string, o?: { statsVersion?: 1 | 2 }) => Promise<unknown>;
    };
    const { decodeTusRestaurantes } = await import(/* @vite-ignore */ decoderRoute) as { decodeTusRestaurantes: (raw: unknown) => unknown };
    api.getStatsRestaurants = async (period?: unknown) => {
      const raw = structuredClone(await mock.mockStatsRestaurants(period as string | undefined, { statsVersion: 2 })) as {
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

test.describe('D482 · K3 · la modalidad sale de la lista y queda dentro de la visita en partes iguales', () => {
  test('la lista no dice la modalidad; la visita «igual» dice «Tu parte, en partes iguales»', async ({ page }) => {
    await preparar(page);
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page).toHaveURL(/:\d+\/restaurantes$/);

    const hanzo = tarjeta(page, 'Hanzo Sushi');
    await hanzo.getByRole('button', { name: /^Hanzo Sushi/ }).click();
    const visitasHanzo = hanzo.locator('.rest-visita');
    await expect(visitasHanzo).toHaveCount(2);
    for (const texto of await visitasHanzo.allTextContents()) {
      expect(texto).not.toMatch(/Partes iguales|Por consumo/);
    }
    await visitasHanzo.nth(0).locator('.rest-visita-fila').click();
    await expect(visitasHanzo.nth(0).locator('.est-consumo.mio')).toHaveText(['Tu parte, en partes iguales']);
    await capturar(page, 'modalidad-01-hanzo');

    // La de consumo, con sus platos propios.
    await visitasHanzo.nth(1).locator('.rest-visita-fila').click();
    await expect(visitasHanzo.nth(1).locator('.est-consumo.mio').first()).toBeVisible();
    await expect(visitasHanzo.nth(1)).not.toContainText('Tu parte, en partes iguales');
  });
});
