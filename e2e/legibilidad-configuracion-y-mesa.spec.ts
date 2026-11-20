import { expect, test } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

for (const [idioma, width] of [['es', 320], ['en', 390]] as const) {
  const en = idioma === 'en';
  test(`texto a 200 % en Configuración, sin desbordar (${idioma})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await ingresar(page);
    await irEnLaApp(page, '/mas');
    if (en) await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const nombre = en ? 'Notifications' : 'Notificaciones';
    const fila = page.getByRole('button', { name: nombre, exact: true }).last();
    await expect(fila.getByText(nombre, { exact: true })).toHaveCSS('font-size', '32px');
    expect(await page.locator('.config-card .list-row').evaluateAll(rows =>
      rows.filter(row => row.clientWidth > 0 && row.scrollWidth > row.clientWidth + 1).length)).toBe(0);
    await fila.press('Enter');
    await expect(page.getByRole('heading', { name: nombre, exact: true })).toBeVisible();
  });

  test(`Inicio traduce el reloj cuando resta menos de un minuto (${idioma})`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-13T18:00:00Z'));
    await ingresar(page, { sinInvitaciones: true });
    if (en) {
      await irEnLaApp(page, '/mas');
      await page.getByRole('button', { name: 'EN', exact: true }).click();
    }
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { findMesa, persist } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
      const mesa = findMesa('PA-2847');
      if (!mesa) throw new Error('Falta la mesa de ejemplo');
      mesa.expires_at = '2026-10-13T18:00:45Z';
      persist();
    });
    await page.goto('/home');
    await expect(page.locator('.mesa-card').filter({ hasText: 'PA-2847' }).locator('.mesa-cd'))
      .toHaveText(en ? 'Expires in less than 1 min' : 'Vence en menos de 1 min');
  });

  test(`la hoja de mesa tiene blanco táctil y contraste de controles (${idioma})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toHaveCSS('border-top-color', 'rgb(123, 138, 160)');
    await ingresar(page);
    if (en) {
      await irEnLaApp(page, '/mas');
      await page.getByRole('button', { name: 'EN', exact: true }).click();
    }
    await irEnLaApp(page, '/mesa/PA-2847');
    const engranaje = page.getByRole('button', { name: en ? 'Table settings' : 'Configuración de la mesa', exact: true });
    await engranaje.press('Enter');
    const hoja = page.locator('.hoja-de-la-mesa');
    const cerrar = hoja.getByRole('button', { name: en ? 'Close' : 'Cerrar', exact: true });
    await expect(cerrar).toBeFocused();
    await expect(cerrar).toHaveCSS('height', '44px');
    await expect(cerrar).toHaveCSS('width', '44px');
    await page.keyboard.press('Escape');
    await expect(engranaje).toBeFocused();
  });
}
