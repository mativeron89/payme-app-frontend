import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-31 · el selector de período de «Mis estadísticas» (dueño v2.106.0).
 *
 * Mock: «Mes pasado» suma $1,320.00 en 5 visitas; este mes, $2,165.00 en 6. Son
 * distintos a propósito: si el período no cambiara de verdad, el test no pasa.
 */

async function preparar(page: Page, o: { stats?: string; periodo?: string } = {}): Promise<void> {
  await page.addInitScript((op) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (op.stats) localStorage.setItem('payme.app.mock.stats.v1', op.stats);
    if (op.periodo) localStorage.setItem('payme.app.mock.periodo.v1', op.periodo);
  }, o);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const selector = (page: Page) => page.getByRole('button', { name: /^Período: / });

async function elegir(page: Page, periodo: string): Promise<void> {
  await selector(page).click();
  await page.getByRole('radio', { name: periodo, exact: true }).click();
}

test.describe('AF-31 · período de Mis estadísticas', () => {
  test('«Mes pasado» cambia el consumo, oculta lo que no se mueve y se conserva en 2b', async ({ page }) => {
    await preparar(page);
    const burbuja = page.locator('.stat-burbuja');
    await expect(burbuja).toContainText('$2,165.00');
    await expect(page.getByRole('heading', { name: 'Plato más pedido' })).toBeVisible();

    await selector(page).click();
    const hoja = page.getByRole('dialog', { name: 'Elige el período' });
    await expect(hoja.getByRole('radio')).toHaveCount(4);
    await expect(hoja.getByRole('radio', { name: 'Este mes' })).toHaveAttribute('aria-checked', 'true');
    await capturar(page, 'periodo-01-selector-abierto');
    await hoja.getByRole('radio', { name: 'Mes pasado', exact: true }).click();

    await expect(burbuja).toContainText('Mes pasado');
    await expect(burbuja).toContainText('$1,320.00');
    await expect(burbuja).toContainText('5 visitas');
    await expect(page.getByRole('heading', { name: 'Tu consumo en el período', exact: true })).toBeVisible();
    // Lo que sale de pagos sin filtro de fecha NO se mezcla con otro período.
    await expect(page.getByRole('heading', { name: 'Plato más pedido' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Tus restaurantes/ })).toContainText('3 lugares · 5 visitas el mes pasado');
    await capturar(page, 'periodo-02-2a-mes-pasado');

    // 2b con el mismo período y el mismo total. Se espera a la pantalla 2b ANTES
    // de mirar la burbuja: si no, la de 2a —que ya dice «Mes pasado»— satisface la
    // aserción mientras 2b todavía no pintó (mutante P4, que así sobrevivía).
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page).toHaveURL(/#\/restaurantes$/);
    await expect(page.locator('.rest-card').first()).toBeVisible();
    await expect(page.locator('.rest-card')).toHaveCount(3);
    await expect(page.locator('.stat-burbuja')).toContainText('Mes pasado');
    await expect(page.locator('.stat-burbuja')).toContainText('$1,320.00');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page.locator('.stat-burbuja')).toContainText('Mes pasado');
  });

  test('con el mes vacío el selector sigue: se puede ir a otro período', async ({ page }) => {
    await preparar(page, { stats: 'vacio' });
    await expect(page.getByText('Todavía no registramos consumos este mes.')).toBeVisible();
    await elegir(page, 'Mes pasado');
    await expect(page.locator('.stat-burbuja')).toContainText('$1,320.00');
    await elegir(page, 'Este mes');
    await expect(page.getByText('Todavía no registramos consumos este mes.')).toBeVisible();
  });

  test('🔴 backend anterior (no devuelve `period`): no hay selector y dice «Este mes»', async ({ page }) => {
    await preparar(page, { periodo: 'antiguo' });
    await expect(page.locator('.stat-burbuja')).toContainText('$2,165.00');
    await expect(page.locator('.stat-burbuja')).toContainText('Este mes');
    await expect(selector(page)).toHaveCount(0);
  });
});
