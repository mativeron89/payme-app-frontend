import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-VIAJES · D242 · **sin la capacidad `features.viajes`, la app queda
 * exactamente como hoy.** Es el estado del dueño en producción (V1: apagada
 * hasta que Mati apruebe el Aviso) y el default del mock.
 *
 * El testigo positivo de que la capacidad se mira es `viajes.spec.ts`: con el
 * seam encendido, la tercera pestaña SÍ es «Viajes». Acá se afirma la ausencia
 * sobre el estado declarado (el seam fijado en `apagado` antes del render).
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'apagado');
  });
});

test('Inicio sigue con «Asociadas» y sin «Viajes»', async ({ page }) => {
  await ingresar(page);
  await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Viajes', exact: true })).toHaveCount(0);
});

for (const ruta of [
  '/viajes/abiertos',
  '/viaje-nuevo',
  '/viaje/d1000000-0000-4000-8000-000000000001',
  '/viaje-balance/d1000000-0000-4000-8000-000000000001',
  '/viaje-cerrado/d1000000-0000-4000-8000-000000000003',
]) {
  test(`🔴 ${ruta} vuelve a Inicio`, async ({ page }) => {
    await ingresar(page);
    await page.goto(ruta);
    await expect(page).toHaveURL(/:\d+\/home$/);
    await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toBeVisible();
  });
}

test('/scan/<viaje> es la cámara de la mesa de siempre', async ({ page }) => {
  await ingresar(page);
  await page.goto('/scan/d1000000-0000-4000-8000-000000000001');
  await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
  // «Volver» de la cámara de la mesa va a Inicio, no a un viaje.
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/home$/);
});

test('Avisos no trae avisos de viajes', async ({ page }) => {
  await ingresar(page);
  await page.goto('/avisos');
  await expect(page.getByRole('heading', { name: 'Notificaciones', level: 1 })).toBeVisible();
  await expect(page.getByText('te invitó al viaje', { exact: false })).toHaveCount(0);
});
