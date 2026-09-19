import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-31 · n167 · «Evolución» (2f), `GET /api/account/stats/evolution`.
 *
 * Mock (el mismo modelo que 2a, 2b y 2c), seis meses del más viejo al actual:
 * $300, $450, $0 (vacío), $680, $1,320 y $2,165 ⇒ $4,915.00, con un promedio de
 * $819.16 por mes: ÷ 6, con el vacío adentro, como el dueño. El último es el
 * total de 2a.
 */

async function preparar(page: Page, o: { stats?: string; evolucion?: string; conDinero?: boolean } = {}): Promise<void> {
  await page.addInitScript((op) => {
    if (!op.conDinero) localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (op.stats) localStorage.setItem('payme.app.mock.stats.v1', op.stats);
    if (op.evolucion) localStorage.setItem('payme.app.mock.evolucion.v1', op.evolucion);
  }, o);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const acceso = (page: Page) => page.getByRole('button', { name: /^Evolución/ });

test.describe('AF-31 · Evolución (2f)', () => {
  test('se abre desde 2a: seis barras, total y promedio con el mes vacío adentro', async ({ page }) => {
    await preparar(page);
    await expect(acceso(page)).toContainText('$819.16 promedio en los últimos 6 meses');
    await acceso(page).click();
    await expect(page).toHaveURL(/#\/evolucion$/);
    const burbuja = page.locator('.stat-burbuja');
    await expect(burbuja).toContainText('6 meses');
    await expect(burbuja).toContainText('$4,915.00');
    await expect(burbuja).toContainText('$819.16 promedio por mes');
    // Sin selector de período en esta pantalla.
    await expect(page.getByRole('button', { name: /^Período: / })).toHaveCount(0);

    const barras = page.locator('.evo-barra');
    await expect(barras).toHaveCount(6);
    await expect(barras.locator('.evo-barra-monto')).toHaveText(['$300', '$450', '$0', '$680', '$1,320', '$2,165']);
    // El actual, marcado; el vacío, sin alto.
    await expect(barras.last()).toHaveClass(/actual/);
    await expect(barras.nth(2).locator('.evo-barra-cuerpo')).toHaveCSS('height', '0px');
    await expect(page.getByText(/ está \$845\.00 arriba de /)).toBeVisible();

    // Columnas al 100 %: el vacío dice que no hubo consumos; nunca el color solo.
    const columnas = page.locator('.evo-columna-cuerpo');
    await expect(columnas).toHaveCount(6);
    await expect(columnas.nth(2)).toHaveAttribute('aria-label', /: sin consumos$/);
    await expect(columnas.last()).toHaveAttribute('aria-label', /Italiana 54%, Japonesa 39%, Café 7%/);
    await expect(page.getByRole('listitem').filter({ hasText: 'Italiana' }).last()).toContainText('hoy 54%');
    await capturar(page, 'evolucion-01-2f');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/#\/estadisticas$/);
  });

  test('con el mes actual vacío: su barra en cero y el resto igual', async ({ page }) => {
    await preparar(page, { stats: 'vacio' });
    await acceso(page).click();
    await expect(page.locator('.evo-barra-monto')).toHaveText(['$300', '$450', '$0', '$680', '$1,320', '$0']);
    await expect(page.locator('.evo-columna-cuerpo.vacia')).toHaveCount(2);
    await expect(page.getByText(/ está \$1,320\.00 abajo de /)).toBeVisible();
    await capturar(page, 'evolucion-02-2f-meses-vacios');
  });

  test('con pagos, dice «gasto»', async ({ page }) => {
    await preparar(page, { conDinero: true });
    await acceso(page).click();
    await expect(page.getByRole('heading', { name: 'Cuánto gastaste por mes' })).toBeVisible();
    await expect(page.getByText('Lo que pagaste, descontando reembolsos.', { exact: true })).toBeVisible();
  });

  test('backend anterior (404): el acceso NO se dibuja', async ({ page }) => {
    await preparar(page, { evolucion: 'antiguo' });
    await expect(page.getByRole('button', { name: /^Tus restaurantes/ })).toBeVisible();
    await expect(acceso(page)).toHaveCount(0);
  });

  for (const costura of ['error', 'grande'] as const) {
    test(`${costura === 'error' ? 'error del servidor' : '413 stats_range_too_large'}: error con «Reintentar»`, async ({ page }) => {
      await preparar(page, { evolucion: costura });
      await acceso(page).click();
      await expect(page.getByText('No pudimos cargar tu evolución')).toBeVisible();
      await page.evaluate(() => localStorage.removeItem('payme.app.mock.evolucion.v1'));
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(page.locator('.evo-barra')).toHaveCount(6);
    });
  }
});
