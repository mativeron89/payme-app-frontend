import { devices, expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D214 · Mati preguntó si la cámara directa anda también en Android.
 *
 * ⚠️ **ESTO NO ES UNA PRUEBA EN UN ANDROID REAL.** Es el Chromium de la suite
 * con el perfil `Pixel 7` de Playwright: user-agent de Android, pantalla,
 * táctil y móvil. Lo que acredita es que, con un navegador que se presenta como
 * Android, la app pide la cámara con el mecanismo estándar de la web
 * (`capture="environment"`) y que la galería no lo lleva. Que Chrome en un
 * Android abra de verdad la app de cámara o el selector es conducta del
 * teléfono: queda para la prueba de Mati.
 *
 * `defaultBrowserType` se saca del perfil: la suite corre en Chromium y el
 * perfil también es de Chromium.
 */
const { defaultBrowserType: _navegador, ...pixel7 } = devices['Pixel 7'];
test.use(pixel7);

test('perfil Pixel 7 (no es un Android real): «Escanear» y el botón redondo abren la cámara trasera (D536); la galería no', async ({ page }) => {
  await ingresar(page);
  expect(await page.evaluate(() => navigator.userAgent)).toContain('Android');
  const [barra] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Escanear', exact: true }).click(),
  ]);
  // D536 · el «Escanear» de la barra, con `capture` (la cámara trasera, sin el menú de D368).
  expect(await barra.element().getAttribute('capture')).toBe('environment');
  expect(await barra.element().getAttribute('data-camara')).toBe('nativa');
  // El botón redondo de «Escanea el ticket» también pide la cámara trasera.
  const [camara] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Sacar foto', exact: true }).click(),
  ]);
  expect(await camara.element().getAttribute('capture')).toBe('environment');
  expect(await camara.element().getAttribute('accept')).toBe('image/*');

  const galeria = page.getByRole('button', { name: 'Elegir de la galería o Drive', exact: true });
  await expect(galeria).toBeVisible();
  const [selector] = await Promise.all([page.waitForEvent('filechooser'), galeria.click()]);
  expect(await selector.element().getAttribute('capture')).toBeNull();
  expect(await selector.element().getAttribute('accept')).toMatch(/image\/jpeg/);
});
