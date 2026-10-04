import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * E173-1 · decisión 173 de Mati, sobre la captura de su Historial: «Quitar el
 * mensaje de "Fechas mostradas.."». La leyenda «Fechas mostradas en {zona}; no
 * indican la zona original.» salía en Historial, en Tus restaurantes y en
 * «Sólo en este navegador» de Configuración. Sale de las tres.
 *
 * Con una zona aplicada (Manual, México), que es el caso en que se mostraba.
 * Los avisos de navegador degradado («Fallback UTC…», «Fechas en ISO UTC…»)
 * son otro mensaje y siguen: los cubre `src/utils/personalDates.test.ts`.
 */

const LEYENDA = /Fechas mostradas en/;

async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    localStorage.setItem('payme.app.region.v1', JSON.stringify({ country: 'MX', timeZone: 'America/Mexico_City' }));
  });
  await ingresar(page);
}

test.describe('E173-1 · sin la leyenda «Fechas mostradas…»', () => {
  test('🔴 Historial', async ({ page }) => {
    await preparar(page);
    await page.goto('/#/mesas');
    await expect(page.getByRole('heading', { name: 'Historial', exact: true })).toBeVisible();
    await expect(page.getByText(LEYENDA)).toHaveCount(0);
  });

  test('🔴 Tus restaurantes', async ({ page }) => {
    await preparar(page);
    await page.getByRole('tab', { name: 'Estadísticas', exact: true }).click();
    await page.getByRole('button', { name: 'Ver mis estadísticas', exact: true }).click();
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page).toHaveURL(/\/restaurantes$/);
    await expect(page.getByRole('heading', { name: 'Tus restaurantes', exact: true })).toBeVisible();
    await expect(page.getByText(LEYENDA)).toHaveCount(0);
  });

  test('🔴 Configuración · «Sólo en este navegador»', async ({ page }) => {
    await preparar(page);
    await page.goto('/#/mas');
    await page.locator('.region-settings-management summary').click();
    const ayuda = page.locator('.region-settings-management');
    // Control: el resto del texto de ayuda sigue ahí.
    await expect(ayuda).toContainText('No detectamos tu ubicación');
    await expect(ayuda).not.toContainText('Fechas mostradas en');
  });
});
