import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

async function enviar(page: Parameters<typeof ingresar>[0], query: string) {
  await page.getByRole('button', { name: 'Nuevo amigo', exact: true }).click();
  await page.getByPlaceholder('Email o ID PayMe (payme_mx_xxxx)').fill(query);
  await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(page.getByText('Si tiene PayMe, le va a llegar tu solicitud', { exact: true }))
    .toBeVisible();
}

test('G-25 · salientes son recibos no-oraculares y cancelar espera el 200', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/amigos');

  await enviar(page, 'nico@mail.com');
  await enviar(page, 'fantasma-que-no-existe@mail.com');

  // El mock persiste los recibos. Recargar acredita el consumo real del GET,
  // no sólo el estado React que dejó el POST.
  await page.reload();
  await page.getByRole('tab', { name: /^Solicitudes/ }).click();

  await expect(page.getByText('Enviadas (2)', { exact: true })).toBeVisible();
  await expect(page.getByText('Solicitud enviada', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Nicolás Salas', { exact: true })).toHaveCount(0);
  await expect(page.getByText('payme_mx_nico', { exact: true })).toHaveCount(0);
  await expect(page.getByText('fantasma-que-no-existe', { exact: false })).toHaveCount(0);

  // Incoming conserva identidad y decisiones.
  await expect(page.getByText('Valentina Ríos', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aceptar', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rechazar', exact: true })).toBeVisible();

  const cancelar = page.getByRole('button', { name: 'Cancelar', exact: true });
  await expect(cancelar).toHaveCount(2);
  await cancelar.first().click();
  await expect(cancelar).toHaveCount(1);
  await expect(page.getByText('Enviadas (1)', { exact: true })).toBeVisible();
});
