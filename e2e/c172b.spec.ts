import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { completarDivision, configurarTicketSinQr, estadoN179 } from './fixtures/ticket-sin-qr';

async function ticket(page: Page, impreso: number) {
  await configurarTicketSinQr(page);
  await ingresar(page);
  await page.evaluate(async (cents) => {
    const path = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ path);
    const scan = api.scanTicket.bind(api);
    api.scanTicket = async (...args: unknown[]) => ({ ...await scan(...args), total_detected_cents: cents });
  }, impreso);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  if (impreso === 84000) await completarDivision(page);
}

test('D790 · un centavo bloquea Continuar, permite corregir manualmente y al cuadrar se puede avanzar', async ({ page }) => {
  await ticket(page, 84000);
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Modificar ítems', exact: true }).click();
  await sheet.getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();
  await sheet.getByLabel('Precio por unidad').fill('195.01');
  await sheet.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  await expect(sheet.getByRole('button', { name: 'Sacar nuevamente la foto', exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Corregir consumos a mano', exact: true }).click();
  await sheet.getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();
  await sheet.getByLabel('Precio por unidad').fill('195');
  await expect(sheet.locator('.cuadre-ticket')).toHaveClass(/cuadre-ticket--cuadra/);
  await sheet.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
});

test('D790 · se puede volver a capturar el ticket con diferencia', async ({ page }) => {
  await ticket(page, 84001);
  await page.getByRole('button', { name: 'Sacar nuevamente la foto', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Ticket ·/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sacar foto', exact: true })).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(0);
});

test('D790 · suma igual al total permite continuar', async ({ page }) => {
  await ticket(page, 84000);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
});


test('D791 · sin confirmación conserva la guarda; con not_found abre con un ticket distinto', async ({ page }) => {
  await configurarTicketSinQr(page);
  await ingresar(page);
  await page.evaluate(async () => {
    const path = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ path);
    const create = api.createMesa.bind(api);
    api.createMesa = async () => {
      api.createMesa = create;
      throw new TypeError('c172b-respuesta-perdida-antes-del-envio');
    };
  });
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await completarDivision(page);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No pudimos confirmar la apertura.');
  await page.reload();
  await page.evaluate(async () => {
    const path = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ path);
    const lookup = api.getMesaCreation.bind(api);
    api.getMesaCreation = async () => {
      api.getMesaCreation = lookup;
      throw new TypeError('c172b-lectura-no-confirmada');
    };
  });
  const check = page.getByRole('button', { name: 'Revisar cómo quedó esa apertura' });
  await check.click();
  await expect(page.getByText(/No pudimos verificar cómo quedó esa apertura/)).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(0);
  await check.click();
  await expect(page.locator('.toast')).toContainText('El servidor confirmó que esta apertura no existe.');
  await expect(check).toHaveCount(0);
  await page.getByRole('button', { name: 'Sacar foto', exact: true }).click();
  await sacarFoto(page);
  await completarDivision(page);
  // Cambiar los comensales cambia la intención económica del nuevo ticket.
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(1);
});
