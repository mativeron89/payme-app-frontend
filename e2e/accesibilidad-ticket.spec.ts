import { test, expect } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { hastaCompartir } from './fixtures/mi-parte-d344';

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\//, route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

for (const idioma of ['es', 'en'] as const) {
  const en = idioma === 'en';
  test(`ticket en la App mock: total de consumos separado, cantidad y salida por teclado (${idioma})`, async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await ingresar(page);
    if (en) {
      await irEnLaApp(page, '/mas');
      await page.getByRole('button', { name: 'EN', exact: true }).click();
      await irEnLaApp(page, '/home');
    }
    await page.getByRole('button', { name: en ? 'Scan' : 'Escanear', exact: true }).click();
    await sacarFoto(page, undefined, { usar: false });
    await page.getByRole('button', { name: en ? 'Use photo' : 'Usar foto', exact: true }).click();
    const total = page.locator('.ticket-total-consumos');
    await expect(total.locator('dt')).toHaveText(en ? 'Total of the items' : 'Total de los consumos');
    await expect(total.locator('dd')).toHaveText('$840');
    await expect(total.locator('dd')).toBeVisible();
    const trigger = page.getByRole('button', { name: en ? 'View the receipt' : 'Ver el ticket' });
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: en ? /^Receipt ·/ : /^Ticket ·/ });
    await expect(sheet).toHaveAccessibleName(en ? /Receipt · \d+ items/ : /Ticket · \d+ consumos/);
    await expect(sheet.locator('.tk-desglose')).toHaveCount(0);
    await expect(sheet.getByText('Tiramisú', { exact: true })).toBeVisible();
    await expect(sheet.getByText('2 × $70', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });
}

test('mesa en la App mock: selección con teclado y controles de porción', async ({ page }) => {
  await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
  const dish = page.getByRole('button', { name: 'Tagliatelle Bolognese, $195', exact: true });
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
  await group.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const blanco = await active.evaluate(el => {
    const caja = el.getBoundingClientRect();
    const centro = caja.left + caja.width / 2;
    return {
      visible: caja.height,
      arriba: document.elementFromPoint(centro, caja.top - 6) === el,
      abajo: document.elementFromPoint(centro, caja.bottom + 6) === el,
    };
  });
  expect(blanco).toEqual({ visible: 28, arriba: true, abajo: true });
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
    await expect(alerta.locator('.state-error-body')).toHaveText(en ? 'Take another photo or fix it manually.' : 'Saca otra foto o corrígelo a mano.');
    const otraFoto = alerta.getByRole('button', { name: en ? 'Take another photo' : 'Sacar otra foto' });
    const corregir = alerta.getByRole('button', { name: en ? 'Fix it manually' : 'Corregir a mano' });
    await expect(otraFoto).toBeVisible();
    await expect(corregir).toBeVisible();
    expect.soft((await otraFoto.boundingBox())?.height).toBe(44);
    expect.soft((await corregir.boundingBox())?.height).toBe(44);
    await corregir.click();
    await expect(page.getByRole('heading', { name: en ? 'How are you splitting?' : '¿Cómo dividen?' })).toBeVisible();
  });
}

for (const idioma of ['es', 'en'] as const) {
  const en = idioma === 'en';
  test(`una foto de Viajes de más de 8 MB pide otra captura (${idioma})`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    });
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    if (en) {
      await irEnLaApp(page, '/mas');
      await page.getByRole('button', { name: 'EN', exact: true }).click();
    }
    await page.evaluate(async () => {
      const rutaApi = '/src/api/index.ts';
      const rutaMock = '/src/api/mock/mockApi.ts';
      const { api } = await import(/* @vite-ignore */ rutaApi) as typeof import('../src/api');
      const { MockApiError } = await import(/* @vite-ignore */ rutaMock) as typeof import('../src/api/mock/mockApi');
      api.scanTicket = async () => { throw new MockApiError(413, 'image_too_large'); };
    });
    await irEnLaApp(page, '/viaje/d1000000-0000-4000-8000-000000000001');
    await page.getByRole('button', { name: en ? 'Scan a ticket for Cancún 2026' : 'Escanear ticket para Cancún 2026', exact: true }).click();
    await expect(page).toHaveURL(/\/scan\/d1000000-0000-4000-8000-000000000001$/);
    await sacarFoto(page, undefined, { usar: false });
    await page.getByRole('button', { name: en ? 'Use photo' : 'Usar foto', exact: true }).click();
    const alerta = page.getByRole('alert').filter({ hasText: en ? 'The photo is over 8 MB' : 'La foto pesa más de 8 MB' });
    await expect(alerta.locator('.state-error-body')).toHaveText(en ? 'Take another photo.' : 'Saca otra foto.');
    await expect(alerta.getByRole('button', { name: en ? 'Take another photo' : 'Sacar otra foto' })).toBeVisible();
    await expect(alerta.getByRole('button', { name: en ? 'Fix it manually' : 'Corregir a mano' })).toHaveCount(0);
  });
}
