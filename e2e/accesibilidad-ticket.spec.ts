import { test, expect } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { hastaCompartir } from './fixtures/mi-parte-d344';

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

test('ticket en la App mock: resumen, total visible dentro de la hoja y salida por teclado', async ({ page }) => {
  await configurarTicketSinQr(page, { ocr: 'no_merchant' });
  await ingresar(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.locator('.ticket-lectura-resumen')).toContainText(/consumo/);
  const trigger = page.getByRole('button', { name: 'Ver el ticket' });
  await trigger.click();
  const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
  await expect(sheet.locator('.tk-desglose-total')).toContainText(/Total/);
  await expect(sheet.locator('.tk-desglose-total dd')).toContainText('$');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('mesa en la App mock: selección con teclado y controles de porción', async ({ page }) => {
  await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
  const dish = page.getByRole('button', { name: /Tagliatelle Bolognese/ });
  await dish.focus();
  await page.keyboard.press('Enter');
  const group = page.getByRole('radiogroup', { name: /Porción de Tagliatelle/ });
  await expect(group).toBeVisible();
  const active = group.locator('button:focus');
  await expect(active).toHaveAttribute('aria-checked', 'true');
  const primera = await active.innerText();
  await page.keyboard.press('ArrowRight');
  await expect(active).toHaveAttribute('aria-checked', 'true');
  await expect(active).not.toHaveText(primera);
  const box = await active.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.mi-parte')).toHaveAttribute('aria-live', 'polite');
  await page.keyboard.press('Escape');
  await expect(group).toBeHidden();
  await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese', exact: true })).toBeFocused();
});

for (const idioma of ['es', 'en'] as const) {
  const en = idioma === 'en';
  test(`una foto demasiado pesada ofrece otra captura o carga manual (${idioma})`, async ({ page }) => {
    await ingresar(page);
    if (en) {
      await irEnLaApp(page, '/mas');
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await irEnLaApp(page, '/home');
    }
    await page.evaluate(async () => {
      const rutaApi = '/src/api/index.ts';
      const rutaMock = '/src/api/mock/mockApi.ts';
      const { api } = await import(/* @vite-ignore */ rutaApi) as typeof import('../src/api');
      const { MockApiError } = await import(/* @vite-ignore */ rutaMock) as typeof import('../src/api/mock/mockApi');
      api.scanTicket = async () => { throw new MockApiError(413, 'image_too_large'); };
    });
    await page.getByRole('button', { name: en ? 'Scan' : 'Escanear', exact: true }).click();
    await sacarFoto(page, undefined, { usar: false });
    await page.getByRole('button', { name: en ? 'Use photo' : 'Usar foto', exact: true }).click();
    const alerta = page.getByRole('alert').filter({ hasText: en ? 'The photo is over 8 MB' : 'La foto pesa más de 8 MB' });
    await expect(alerta).toContainText(en ? 'Take another photo from closer up.' : 'Saca otra foto más de cerca.');
    await expect(alerta.getByRole('button', { name: en ? 'Take another photo' : 'Sacar otra foto' })).toBeVisible();
    await alerta.getByRole('button', { name: en ? 'Enter it by hand' : 'Cargarlo a mano' }).click();
    await expect(page.getByRole('heading', { name: en ? 'How are you splitting?' : '¿Cómo dividen?' })).toBeVisible();
  });
}
