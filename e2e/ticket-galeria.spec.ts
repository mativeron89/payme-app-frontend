import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-GALERIA · decisión 91 de Mati: al abrir una mesa con el ticket, la foto se
 * puede sacar o elegir del carrete («Sí, las dos»). El input de la foto tenía
 * `capture="environment"`, que en iOS y Android abre directo la cámara y no
 * ofrece la fototeca. Sin `capture`, el teléfono ofrece las dos.
 *
 * Y sin cartel de «ticket de ejemplo»: la misma decisión lo descartó («No, así
 * está bien»).
 *
 * Playwright no abre el selector del sistema, así que se afirma el atributo y
 * se elige un archivo con `setInputFiles`, que corre el mismo `onChange` que
 * una foto del carrete.
 *
 * D212 · la cámara volvió a tener `capture`, pero en OTRA entrada: la de la
 * cámara nativa, que abre «Nueva». La de la galería (abajo a la izquierda, en
 * `.camara-controles`) sigue sin `capture`, que es lo que se afirma acá.
 */
test.describe('AF-GALERIA · la foto del ticket, de la cámara o del carrete', () => {
  test('el input de la foto no fuerza la cámara y conserva su accept', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/scan$/);
    const input = page.locator('.camara-controles input[type="file"]');
    await expect(input).toHaveCount(1);
    // Testigo de que la capability llegó: el accept del dueño, con HEIC en mock.
    await expect(input).toHaveAttribute('accept', /image\/heic/);
    await expect(input).not.toHaveAttribute('capture', /.*/);
  });

  test('una foto elegida del carrete sigue el flujo hasta el ticket, sin cartel de ejemplo', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    const input = page.locator('.camara-controles input[type="file"]');
    await expect(input).toHaveAttribute('accept', /image\/heic/);
    // Por encima del piso que publica el dueño (mock: 10240 bytes, n81).
    await input.setInputFiles({
      name: 'IMG_0421.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(40 * 1024, 7),
    });
    // El mock lee el ticket de siempre y el flujo sigue a la división.
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByText(/ticket de ejemplo/i)).toHaveCount(0);
  });

  test('los rechazos locales siguen como estaban: una foto más chica que el piso no se sube', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    const input = page.locator('.camara-controles input[type="file"]');
    await expect(input).toHaveAttribute('accept', /image\/heic/);
    await input.setInputFiles({
      name: 'IMG_0422.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024, 1),
    });
    await expect(page.getByRole('alert')).toContainText('La foto es demasiado pequeña para leer el ticket.');
  });
});
