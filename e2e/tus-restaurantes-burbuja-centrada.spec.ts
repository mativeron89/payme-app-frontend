import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-STATS-BURBUJA · Mati, en el iPhone: «la burbuja está descentrada». La
 * tarjeta blanca con lo propio tenía el texto corrido a la izquierda: al relleno
 * de 12 px se le sumaba la columna de la porción (14 px + 10 de hueco) aun
 * cuando ningún plato era una porción, y la tarjeta era 24 px más angosta que
 * el botón «Ver ticket completo».
 *
 * Se mide la geometría real, a 390 px: relleno simétrico, el texto a la misma
 * distancia de cada borde cuando no hay porciones, y la tarjeta del mismo ancho
 * que el botón.
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

/** Geometría de la tarjeta de lo propio y de su botón, en px CSS. */
async function medir(page: Page, restaurante: string) {
  const r = page.getByRole('region', { name: restaurante, exact: true });
  await r.getByRole('button', { name: new RegExp(`^${restaurante}`) }).click();
  const visita = r.locator('.rest-visita').first();
  await visita.locator('.rest-visita-fila').click();
  await expect(visita.locator('.rest-items')).toBeVisible();
  return visita.evaluate((v) => {
    const caja = (e: Element): Caja => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right }; };
    const tarjeta = v.querySelector('.rest-items')!;
    const cs = getComputedStyle(tarjeta);
    const borde = parseFloat(cs.borderLeftWidth);
    const t = caja(tarjeta);
    const filas = [...tarjeta.querySelectorAll('.rest-item')];
    return {
      paddingLeft: parseFloat(cs.paddingLeft),
      paddingRight: parseFloat(cs.paddingRight),
      tarjeta: t,
      boton: caja(v.querySelector('.rest-visita-ticket')!),
      // Del borde interior de la tarjeta al primer texto de cada fila, y del
      // último texto al borde interior derecho.
      izquierda: filas.map((f) => {
        const primero = [...f.children].find((c) => c.textContent !== '')!;
        return primero.getBoundingClientRect().left - (t.left + borde);
      }),
      derecha: filas.map((f) => (t.right - borde) - f.lastElementChild!.getBoundingClientRect().right),
    };
  });
}

test.describe('AF-STATS-BURBUJA · la tarjeta de lo propio, centrada', () => {
  test('sin porciones: el texto queda a la misma distancia de los dos bordes', async ({ page }) => {
    await preparar(page);
    const m = await medir(page, 'Hanzo Sushi');
    await capturar(page, 'burbuja-01-sin-porciones');
    expect(m.paddingLeft).toBe(m.paddingRight);
    for (let i = 0; i < m.izquierda.length; i += 1) {
      expect(Math.abs(m.izquierda[i]! - m.derecha[i]!), `fila ${i}: izq ${m.izquierda[i]} vs der ${m.derecha[i]}`).toBeLessThanOrEqual(1);
    }
  });

  test('la tarjeta tiene el mismo ancho útil que «Ver ticket completo»', async ({ page }) => {
    await preparar(page);
    const m = await medir(page, 'La Parolaccia');
    await capturar(page, 'burbuja-02-con-porcion');
    expect(m.paddingLeft).toBe(m.paddingRight);
    expect(Math.abs(m.tarjeta.left - m.boton.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.tarjeta.right - m.boton.right)).toBeLessThanOrEqual(1);
    // Con una porción en la visita, la columna del «½» sigue alineando los platos.
    const conPorcion = page.getByRole('region', { name: 'La Parolaccia', exact: true }).locator('.rest-item');
    await expect(conPorcion.nth(1)).toHaveText(/^½Tiramisú\$/);
    await expect(conPorcion.nth(1).locator('.rest-item-frac')).toBeVisible();
    const nombres = await conPorcion.locator('.rest-item-nombre').evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().left));
    expect(new Set(nombres.map((x) => Math.round(x))).size).toBe(1);
  });
});
