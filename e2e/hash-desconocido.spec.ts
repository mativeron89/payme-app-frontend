import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * G-35 · el unit test fija el parser y `replaceState`; estos recorridos cierran
 * el seam que faltaba: el hook montado en un navegador, con historial real.
 */
test.describe('hash desconocido · normalización real del hook', () => {
  test('al montar descarta la query y reemplaza la entrada inválida', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/cuenta');
    await expect(page).toHaveURL(/#\/cuenta$/);

    await page.goto('/#/saldo?t=secret');

    await expect(page).toHaveURL(/#\/home$/);
    expect(page.url()).not.toContain('secret');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/#\/cuenta$/);
    expect(page.url()).not.toContain('saldo');
    expect(page.url()).not.toContain('secret');
  });

  test('después del montaje normaliza un hashchange sin ensuciar Atrás', async ({ page }) => {
    await ingresar(page);
    await page.evaluate(() => { window.location.hash = '#/cuenta'; });
    await expect(page).toHaveURL(/#\/cuenta$/);

    await page.evaluate(() => { window.location.hash = '#/zzz?t=secret'; });

    await expect(page).toHaveURL(/#\/home$/);
    expect(page.url()).not.toContain('secret');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL(/#\/cuenta$/);
    expect(page.url()).not.toContain('zzz');
    expect(page.url()).not.toContain('secret');
  });
});
