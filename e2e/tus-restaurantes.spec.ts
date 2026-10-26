import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-29 · n165 · «Tus restaurantes» (2b), `GET /api/account/stats/restaurants`.
 *
 * Costuras del mock: `payme.app.mock.restaurantes.v1` (`antiguo` = 404,
 * `error` = 500, `grande` = 413) y `payme.app.mock.stats.v1` (`vacio`, …), que
 * rige 2a y 2b con las mismas cocinas: los totales coinciden.
 */

async function preparar(page: Page, o: { restaurantes?: string; stats?: string; sinDinero?: boolean } = {}): Promise<void> {
  await page.addInitScript((op) => {
    if (op.restaurantes) localStorage.setItem('payme.app.mock.restaurantes.v1', op.restaurantes);
    if (op.stats) localStorage.setItem('payme.app.mock.stats.v1', op.stats);
    if (op.sinDinero) localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  }, o);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const acceso = (page: Page) => page.getByRole('button', { name: /^Tus restaurantes/ });
const tarjeta = (page: Page, nombre: string) => page.getByRole('region', { name: nombre, exact: true });

test.describe('AF-29 · Tus restaurantes (2b)', () => {
  test('se abre desde Mis estadísticas, con el mismo total que 2a, y vuelve', async ({ page }) => {
    await preparar(page, { sinDinero: true });
    await expect(page.locator('.est-total')).toHaveText('$2,165');
    // D479/D482 · el subtítulo de Claude Design 0.261: lugares y visitas.
    await expect(acceso(page)).toContainText('3 lugares · 6 visitas');
    // Con el acceso nuevo, la sección vieja de barras no está.
    await expect(page.locator('.stat-rest')).toHaveCount(0);
    await acceso(page).click();
    await expect(page).toHaveURL(/:\d+\/restaurantes$/);
    // D479/D482 · la cabecera ya no lleva el total; «3 lugares · 6 visitas» va sobre la lista.
    await expect(page.getByRole('heading', { level: 1, name: 'Tus restaurantes' })).toBeVisible();
    await expect(page.locator('.est-contexto')).toHaveText('3 lugares · 6 visitas');
    await expect(page.locator('.rest-card')).toHaveCount(3);
    await expect(page.getByText('Lo que elegiste en tus mesas.', { exact: true })).toHaveCount(0);
    await capturar(page, 'restaurantes-01-cerrada');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/:\d+\/estadisticas$/);
  });

  test('tres niveles que se abren de a uno: restaurante → visita → lo consumido', async ({ page }) => {
    await preparar(page, { sinDinero: true });
    await acceso(page).click();
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visitas = parolaccia.locator('.rest-visita');
    await expect(visitas).toHaveCount(3);
    // D479/D482 · «dd/mm · hh:mm» y el importe: sin día de la semana ni modalidad (K3).
    await expect(visitas.first()).toHaveText(/^\d{2}\/\d{2} · \d{2}:\d{2}\$/);
    await capturar(page, 'restaurantes-02-restaurante-abierto');

    // La primera visita que arma el mock es la más NUEVA (va arriba) y trae el
    // plato a medias. El toque despliega lo propio; el ticket completo tiene su
    // botón y se despliega en la tarjeta (D479/D482), sin modal.
    await visitas.first().locator('.rest-visita-fila').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const consumido = parolaccia.locator('.est-consumo.mio');
    await expect(consumido).toHaveCount(3);
    await expect(consumido.nth(1)).toHaveText(/^½Tiramisú\$/);
    await expect(consumido.first()).toHaveText(/^Tagliatelle Bolognese\$/);
    await capturar(page, 'restaurantes-03-visita-abierta');

    // Abrir otro restaurante cierra el primero.
    await tarjeta(page, 'Hanzo Sushi').getByRole('button', { name: /^Hanzo Sushi/ }).click();
    await expect(parolaccia.locator('.rest-visita')).toHaveCount(0);
    await expect(tarjeta(page, 'Hanzo Sushi').locator('.rest-visita')).toHaveCount(2);
    // Volver al primero lo abre desde cero: la visita que estaba abierta, cerrada.
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    await expect(parolaccia.locator('.rest-visita')).toHaveCount(3);
    await expect(parolaccia.locator('.est-consumo')).toHaveCount(0);
  });

  test('entrando directo por la ruta, «Volver» lleva a Mis estadísticas (no a Inicio)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/restaurantes');
    await expect(page.locator('.rest-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/:\d+\/estadisticas$/);
  });

  test('con pagos, el pie dice que la visita incluye la propina y los platos no', async ({ page }) => {
    await preparar(page, {});
    await acceso(page).click();
    await expect(page.getByText('Lo que pagaste, descontando reembolsos. Cada visita incluye la propina; los platos, no.')).toBeVisible();
    await expect(page.getByText('Lo que elegiste en tus mesas.', { exact: true })).toHaveCount(0);
  });

  test('mes vacío: el vacío de siempre', async ({ page }) => {
    await preparar(page, { stats: 'vacio', sinDinero: true });
    await acceso(page).click();
    await expect(page.getByText('Todavía no registramos consumos este mes.')).toBeVisible();
    await expect(page.locator('.rest-card')).toHaveCount(0);
    await capturar(page, 'restaurantes-04-vacia');
  });

  test('backend anterior (404): el acceso NO se dibuja y queda la sección vieja', async ({ page }) => {
    await preparar(page, { restaurantes: 'antiguo', sinDinero: true });
    // Testigo positivo: la sección vieja de barras.
    await expect(page.locator('.stat-rest').first()).toBeVisible();
    await expect(acceso(page)).toHaveCount(0);
    // E173-4 · son barras de este mes: con otro período no van.
    await page.getByRole('button', { name: /^Período: / }).click();
    await page.getByRole('radio', { name: /^Mes pasado/ }).click();
    await expect(page.locator('.est-total')).toHaveText('$1,320');
    await expect(page.locator('.stat-rest')).toHaveCount(0);
  });

  for (const [costura, nombre] of [['error', 'error del servidor'], ['grande', '413 stats_month_too_large']] as const) {
    test(`${nombre}: error con «Reintentar», que vuelve a pedir`, async ({ page }) => {
      await preparar(page, { restaurantes: costura, sinDinero: true });
      await acceso(page).click();
      await expect(page.getByText('No pudimos cargar tus restaurantes')).toBeVisible();
      await page.evaluate(() => localStorage.removeItem('payme.app.mock.restaurantes.v1'));
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(page.locator('.rest-card')).toHaveCount(3);
    });
  }
});
