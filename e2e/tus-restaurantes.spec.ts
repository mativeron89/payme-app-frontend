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
    await expect(page.locator('.stat-burbuja')).toContainText('$2,165.00');
    await expect(acceso(page)).toContainText('3 lugares · 6 visitas este mes');
    // Con el acceso nuevo, la sección vieja de barras no está.
    await expect(page.locator('.stat-rest')).toHaveCount(0);
    await acceso(page).click();
    await expect(page).toHaveURL(/#\/restaurantes$/);
    await expect(page.locator('.stat-burbuja')).toContainText('$2,165.00');
    await expect(page.locator('.stat-burbuja')).toContainText('3 lugares · 6 visitas');
    await expect(page.locator('.rest-card')).toHaveCount(3);
    await expect(page.getByText('Lo que elegiste en tus mesas.', { exact: true })).toHaveCount(0);
    await capturar(page, 'restaurantes-01-cerrada');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/#\/estadisticas$/);
  });

  test('tres niveles que se abren de a uno: restaurante → visita → lo consumido', async ({ page }) => {
    await preparar(page, { sinDinero: true });
    await acceso(page).click();
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visitas = parolaccia.locator('.rest-visita');
    await expect(visitas).toHaveCount(3);
    // Fecha «Xxx dd/mm» y hora «hh:mm».
    await expect(visitas.first()).toHaveText(/^(Dom|Lun|Mar|Mié|Jue|Vie|Sáb) \d{2}\/\d{2}\d{2}:\d{2}\$/);
    await capturar(page, 'restaurantes-02-restaurante-abierto');

    // La primera visita que arma el mock es la más NUEVA (va arriba) y trae el
    // plato a medias.
    await visitas.first().getByRole('button').click();
    const dialog = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('No es una foto, factura ni comprobante de pago.');
    await expect(dialog).toContainText('Total del ticket');
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    const consumido = parolaccia.locator('.rest-items');
    await expect(consumido).toBeVisible();
    await expect(consumido.locator('.rest-item')).toHaveCount(3);
    await expect(consumido.locator('.rest-item').nth(1)).toHaveText(/^½Tiramisú\$/);
    await expect(consumido.locator('.rest-item').first()).toHaveText(/^Tagliatelle Bolognese\$/);
    await capturar(page, 'restaurantes-03-visita-abierta');

    // Abrir otro restaurante cierra el primero.
    await tarjeta(page, 'Hanzo Sushi').getByRole('button', { name: /^Hanzo Sushi/ }).click();
    await expect(parolaccia.locator('.rest-visita')).toHaveCount(0);
    await expect(tarjeta(page, 'Hanzo Sushi').locator('.rest-visita')).toHaveCount(2);
    // Volver al primero lo abre desde cero: la visita que estaba abierta, cerrada.
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    await expect(parolaccia.locator('.rest-visita')).toHaveCount(3);
    await expect(parolaccia.locator('.rest-items')).toHaveCount(0);
  });

  test('entrando directo por la ruta, «Volver» lleva a Mis estadísticas (no a Inicio)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/restaurantes');
    await expect(page.locator('.rest-card').first()).toBeVisible();
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/#\/estadisticas$/);
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
