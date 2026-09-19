import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-31 · n166 · «Qué comes» por platos (2c), `GET /api/account/stats/dishes`.
 *
 * El mock saca los platos del mismo modelo de visitas que 2a y 2b. Este mes:
 * La Parolaccia ×3 (tres platos por visita), Hanzo ×2 (dos) y Café Nube ×1 (dos)
 * ⇒ 7 platos distintos; los cinco primeros son los tres de La Parolaccia
 * (3 veces) y los dos de Hanzo (2 veces).
 */

async function preparar(
  page: Page,
  o: { stats?: string; platos?: string; momentos?: string; conDinero?: boolean } = {},
): Promise<void> {
  await page.addInitScript((op) => {
    if (!op.conDinero) localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (op.stats) localStorage.setItem('payme.app.mock.stats.v1', op.stats);
    if (op.platos) localStorage.setItem('payme.app.mock.platos.v1', op.platos);
    if (op.momentos) localStorage.setItem('payme.app.mock.momentos.v1', op.momentos);
  }, o);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const acceso = (page: Page) => page.getByRole('button', { name: /^Qué comes/ });
const tarjeta = (page: Page) => page.getByRole('region', { name: /^Tus (cinco )?platos$/ });

test.describe('AF-31 · Qué comes (2c)', () => {
  test('se abre desde 2a: cinco platos con restaurante, veces y monto, y vuelve', async ({ page }) => {
    await preparar(page);
    await expect(acceso(page)).toContainText('3 veces · y 6 platos más');
    await acceso(page).click();
    await expect(page).toHaveURL(/#\/platos$/);
    await expect(tarjeta(page)).toBeVisible();
    await expect(page.locator('.stat-burbuja')).toContainText('7 platos distintos');
    const filas = tarjeta(page).getByRole('listitem');
    await expect(filas).toHaveCount(5);
    await expect(filas.first()).toContainText('La Parolaccia');
    await expect(filas.first()).toContainText('3 veces');
    await expect(filas.last()).toContainText('Hanzo Sushi');
    await expect(filas.last()).toContainText('2 veces');
    await expect(tarjeta(page).locator('circle')).toHaveCount(5);
    await expect(tarjeta(page).getByRole('img', { name: /^Platos más pedidos: / })).toBeVisible();
    // En base consumo no hay propina que aclarar.
    await expect(page.getByText('Lo cobrado por cada plato, sin la propina.')).toHaveCount(0);
    // Sin las pestañas que no existen todavía.
    await expect(page.getByText('Ingrediente', { exact: true })).toHaveCount(0);
    // AF-32: «Momento» ya existe (2e, v2.109.0) y es pestaña; «Ingrediente» (2d) no.
    await expect(page.getByRole('tab', { name: 'Momento' })).toBeVisible();
    await capturar(page, 'platos-01-2c');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/#\/estadisticas$/);
  });

  test('con pagos, dice que el monto de cada plato no lleva propina', async ({ page }) => {
    await preparar(page, { conDinero: true });
    await acceso(page).click();
    await expect(page.getByText('Lo cobrado por cada plato, sin la propina.')).toBeVisible();
  });

  test('el período elegido en 2a rige en 2c', async ({ page }) => {
    await preparar(page);
    await page.getByRole('button', { name: /^Período: / }).click();
    await page.getByRole('radio', { name: 'Mes pasado', exact: true }).click();
    await expect(page.locator('.stat-burbuja')).toContainText('$1,320.00');
    await acceso(page).click();
    await expect(tarjeta(page)).toBeVisible();
    await expect(page.locator('.stat-burbuja')).toContainText('Mes pasado');
    await expect(page.locator('.stat-burbuja')).toContainText('7 platos distintos');
    await expect(tarjeta(page)).toContainText('el mes pasado');
  });

  test('mes sin platos: el vacío', async ({ page }) => {
    await preparar(page, { stats: 'vacio' });
    await acceso(page).click();
    await expect(page.getByText('Todavía no registramos platos este mes.')).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
    await capturar(page, 'platos-02-2c-vacia');
  });

  test('backend anterior (404): el acceso NO se dibuja', async ({ page }) => {
    await preparar(page, { platos: 'antiguo' });
    await expect(page.getByRole('button', { name: /^Tus restaurantes/ })).toBeVisible();
    await expect(acceso(page)).toHaveCount(0);
  });

  for (const costura of ['error', 'grande'] as const) {
    test(`${costura === 'error' ? 'error del servidor' : '413 stats_range_too_large'}: error con «Reintentar»`, async ({ page }) => {
      await preparar(page, { platos: costura });
      await acceso(page).click();
      await expect(page.getByText('No pudimos cargar tus platos')).toBeVisible();
      await page.evaluate(() => localStorage.removeItem('payme.app.mock.platos.v1'));
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(tarjeta(page).getByRole('listitem')).toHaveCount(5);
    });
  }

  test.describe('AF-32 · por momento del día (2e)', () => {
    const momentos = (page: Page) => page.getByRole('region', { name: 'Por momento del día' });

    test('la pestaña «Momento»: cuatro momentos con horario, visitas y monto; mismo total que 2a', async ({ page }) => {
      await preparar(page);
      await acceso(page).click();
      const pestanas = page.getByRole('tablist', { name: 'Qué comes' });
      await expect(pestanas.getByRole('tab')).toHaveText(['Platos', 'Momento']);
      await expect(page.getByText('Ingrediente', { exact: true })).toHaveCount(0);
      await pestanas.getByRole('tab', { name: 'Momento' }).click();
      await expect(momentos(page)).toBeVisible();
      const filas = momentos(page).getByRole('listitem');
      await expect(filas).toHaveCount(4);
      await expect(filas.nth(0)).toContainText('Desayuno');
      await expect(filas.nth(0)).toContainText('hasta las 12');
      await expect(filas.nth(3)).toContainText('Cena');
      await expect(filas.nth(3)).toContainText('desde las 19');
      // Las 6 visitas del mes, como 2a (el mismo modelo del mock).
      await expect(page.locator('.stat-burbuja')).toContainText('6 visitas');
      await expect(momentos(page)).toContainText('De 6 visitas este mes');
      await expect(momentos(page).getByRole('img', { name: /^Visitas por momento del día: Desayuno \d+%, Comida/ })).toBeVisible();
      await expect(page.getByText('Cada visita incluye la propina.')).toHaveCount(0);
      await capturar(page, 'momentos-01-2e');
    });

    test('mes sin visitas: el vacío de momentos', async ({ page }) => {
      await preparar(page, { stats: 'vacio' });
      await acceso(page).click();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(page.getByText('Todavía no registramos visitas este mes.')).toBeVisible();
      await expect(momentos(page)).toHaveCount(0);
      await capturar(page, 'momentos-02-2e-vacia');
    });

    test('el período elegido rige también en los momentos', async ({ page }) => {
      await preparar(page);
      await page.getByRole('button', { name: /^Período: / }).click();
      await page.getByRole('radio', { name: 'Mes pasado', exact: true }).click();
      await expect(page.locator('.stat-burbuja')).toContainText('$1,320.00');
      await acceso(page).click();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(momentos(page)).toContainText('De 5 visitas el mes pasado');
    });

    test('con pagos, dice que cada visita incluye la propina', async ({ page }) => {
      await preparar(page, { conDinero: true });
      await acceso(page).click();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(page.getByText('Cada visita incluye la propina.')).toBeVisible();
    });

    test('backend anterior (404): no hay pestañas y 2c queda como estaba', async ({ page }) => {
      await preparar(page, { momentos: 'antiguo' });
      await acceso(page).click();
      await expect(tarjeta(page)).toBeVisible();
      await expect(page.getByRole('tablist')).toHaveCount(0);
    });

    test('error de momentos: su cartel con «Reintentar», y los platos siguen', async ({ page }) => {
      await preparar(page, { momentos: 'error' });
      await acceso(page).click();
      await expect(tarjeta(page)).toBeVisible();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(page.getByText('No pudimos cargar tus momentos')).toBeVisible();
      await page.evaluate(() => localStorage.removeItem('payme.app.mock.momentos.v1'));
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(momentos(page).getByRole('listitem')).toHaveCount(4);
    });
  });
});
