import { expect, test } from '@playwright/test';
import { ingresar } from './_app';
import {
  completarDivision,
  configurarTicketSinQr,
  estadoN179,
} from './fixtures/ticket-sin-qr';

async function escanearSinQr(page: import('@playwright/test').Page): Promise<void> {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page).toHaveURL(/#\/scan$/);
  await page.getByRole('button', { name: 'Capturar' }).click();
}

test.describe('n179 · ticket real sin QR', () => {
  test('merchant → resolve privado → mesa record-only, sólo después del CTA', async ({ page }, testInfo) => {
    await configurarTicketSinQr(page);
    await escanearSinQr(page);
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();

    const before = await estadoN179(page);
    expect(before.mesas).toHaveLength(0);
    expect(before.privateRestaurantIds).toHaveLength(1);
    expect(before.privateRestaurantIds[0]).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.locator('body')).not.toContainText('TEG010101AB1');

    await completarDivision(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

    const after = await estadoN179(page);
    expect(after.mesas).toHaveLength(1);
    expect(after.mesas[0]?.restaurant.id).toBe(before.privateRestaurantIds[0]);
    await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('captura-movil-ticket-sin-qr.png'),
      fullPage: true,
    });
  });

  test('respuesta perdida después de crear reusa UUID y conserva count=1', async ({ page }) => {
    await configurarTicketSinQr(page, { lostResponse: true });
    await escanearSinQr(page);
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await completarDivision(page);

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText(/Puede que la mesa ya se haya creado/)).toBeVisible();
    const lost = await estadoN179(page);
    expect(lost.mesas).toHaveLength(1);
    expect(lost.mesaLedgerKeys).toHaveLength(1);
    expect(lost.mesaLedgerKeys[0]).toMatch(/^mesa:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    const retry = await estadoN179(page);
    expect(retry.mesas).toHaveLength(1);
    expect(retry.mesas[0]?.id).toBe(lost.mesas[0]?.id);
    expect(retry.mesaLedgerKeys).toEqual(lost.mesaLedgerKeys);
  });

  test('contrato OCR malformado da error visible y conserva carga manual', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'malformed' });
    await escanearSinQr(page);
    await expect(page.getByRole('alert')).toContainText('No pudimos leer el ticket');
    await page.getByRole('button', { name: 'Cargarlo a mano' }).click();
    await page.getByRole('button', { name: 'Ver el ticket' }).click();
    await page.getByRole('textbox', { name: 'Consumo', exact: true }).fill('Tacos al pastor');
    await page.getByRole('textbox', { name: 'Precio por unidad', exact: true }).fill('120');
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await completarDivision(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    expect((await estadoN179(page)).mesas).toHaveLength(1);
  });

  for (const [mode, message] of [
    ['budget_exhausted', 'Se alcanzó el límite mensual de lectura'],
    ['budget_unavailable', 'El servicio de lectura no está disponible'],
  ] as const) {
    test(`${mode} conserva el ticket, ofrece carga manual y no reintenta`, async ({ page }) => {
      await configurarTicketSinQr(page, { ocr: mode });
      await escanearSinQr(page);
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.n179.ocr_attempts.v1'))).toBe('1');

      await page.getByRole('button', { name: 'Cargarlo a mano' }).click();
      await page.getByRole('button', { name: 'Ver el ticket' }).click();
      await page.getByRole('textbox', { name: 'Consumo', exact: true }).fill('Tacos al pastor');
      await page.getByRole('textbox', { name: 'Precio por unidad', exact: true }).fill('120');
      await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
      await completarDivision(page);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
      const state = await estadoN179(page);
      expect(state.privateRestaurantIds).toHaveLength(1);
      expect(state.mesas).toHaveLength(1);
      expect(state.mesas[0]?.restaurant.id).toBe(state.privateRestaurantIds[0]);
      expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.n179.ocr_attempts.v1'))).toBe('1');
    });
  }
});
