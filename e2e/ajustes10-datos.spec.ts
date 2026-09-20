import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

async function capturar(page: import('@playwright/test').Page, name: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test('U04 · el recibo opaco se rotula como registro sin prometer estado pendiente', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/amigos');
  await page.getByRole('button', { name: 'Nuevo amigo', exact: true }).click();
  await page.getByPlaceholder('Email o ID PayMe (payme_mx_xxxx)').fill('recibo-opaco@example.com');
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByText('Si tiene PayMe, le va a llegar tu solicitud', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Solicitudes/ }).click();
  await expect(page.getByText('Envío registrado', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('· pendiente', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Solicitud enviada', { exact: true })).toHaveCount(0);
});

test('U08 · Historial abre únicamente el detalle propio canónico cuando vino en /mine', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro'));
  await ingresar(page);
  await page.goto('/#/mesas');
  const mesa = page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' });
  await mesa.getByRole('button').click();
  await expect(mesa.getByText('Tacos al pastor × 2')).toBeVisible();
  await expect(mesa).toContainText('$200.00');
  await expect(mesa).toContainText('Agua de jamaica');
});

test('U09 · una visita abre detalle digital completo y devuelve el foco al cerrar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await page.goto('/#/restaurantes');
  const restaurante = page.getByRole('region', { name: 'La Parolaccia' });
  await restaurante.getByRole('button', { name: /^La Parolaccia/ }).click();
  const trigger = restaurante.locator('.rest-visita-fila').first();
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
  await expect(dialog).toContainText('No es una foto, factura ni comprobante de pago.');
  await expect(dialog.locator('.ticket-digital-items li')).not.toHaveCount(0);
  await expect(dialog).toContainText('Total del ticket');
  await capturar(page, 'u09-ticket-digital');
  await dialog.getByRole('button', { name: 'Cerrar' }).click();
  await expect(trigger).toBeFocused();
});
