import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';

/**
 * AF-VIAJES-QUIEN-PAGO-Y-CONFIGURACION-20261010 · D255 tramo 2 con el mock de
 * App Backend 2.174.0: quién pagó, y el nombre, las fechas, el color y la foto
 * del viaje, que se ven en su burbuja y en su tarjeta de Abiertos.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';

async function conViajes(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

/** Un PNG de 1×1, real (el mock mira el tipo y el tamaño). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');

async function abrirConfiguracion(page: Page): Promise<void> {
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Configuración' }).click();
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
}

test.describe('D255 · tramo 2', () => {
  test('🔴 6 · quién pagó: cargo un gasto que pagó Luis; en Balance, «Pagó» de Luis sube y el mío no', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-balance/${CANCUN}`);
    await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).click();
    const pago = (quien: string) => page.locator('.vjb-fila').filter({ hasText: quien }).locator('.vjb-cifra');
    const antesLuis = await pago('Luis Pérez').innerText();
    const antesYo = await pago('Tú').innerText();
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill('Gasolina');
    await page.getByLabel('Monto', { exact: true }).fill('900');
    const selector = page.getByLabel('¿Quién pagó?', { exact: true });
    await expect(selector).toHaveValue('');
    await selector.selectOption({ label: 'Luis Pérez' });
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Cargaste el gasto.', { exact: true })).toBeVisible();
    await ir(page, `/viaje-balance/${CANCUN}`);
    await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).click();
    const centavos = (s: string) => Math.round(Number(s.replace(/[$,]/g, '')) * 100);
    await expect.poll(async () => centavos(await pago('Luis Pérez').innerText())).toBe(centavos(antesLuis) + 90000);
    expect(await pago('Tú').innerText()).toBe(antesYo);
  });

  test('🔴 6 · quién pagó en el ticket escaneado: lo escaneo yo, lo pagó Sofía', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-balance/${CANCUN}`);
    await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).click();
    const pago = (quien: string) => page.locator('.vjb-fila').filter({ hasText: quien }).locator('.vjb-cifra');
    const centavos = (s: string) => Math.round(Number(s.replace(/[$,]/g, '')) * 100);
    const antesSofia = centavos(await pago('Sofía Ramírez').innerText());
    const antesYo = await pago('Tú').innerText();
    await ir(page, `/viaje/${CANCUN}`);
    await page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true }).click();
    await sacarFoto(page);
    await expect(page.getByRole('heading', { name: 'Ticket nuevo' })).toBeVisible();
    const total = centavos((await page.locator('.vjt-cabeza .vjt-monto').innerText()).trim());
    await page.getByLabel('¿Quién pagó?', { exact: true }).selectOption({ label: 'Sofía Ramírez' });
    await page.getByRole('radio', { name: /Pagar el total/ }).click();
    await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    await ir(page, `/viaje-balance/${CANCUN}`);
    await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).click();
    await expect.poll(async () => centavos(await pago('Sofía Ramírez').innerText())).toBe(antesSofia + total);
    expect(await pago('Tú').innerText()).toBe(antesYo);
  });

  test('🔴 9 · nombre y fechas: se guardan y la burbuja del viaje cambia', async ({ page }) => {
    await conViajes(page);
    await abrirConfiguracion(page);
    await page.getByRole('button', { name: /Nombre y fechas/ }).click();
    await page.getByLabel('Nombre del viaje', { exact: true }).fill('Cancún 2027');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Guardamos los cambios.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.locator('.title-card-title')).toHaveText('Cancún 2027');
  });

  test('🔴 9 · el color: la burbuja del viaje y su tarjeta de Abiertos se pintan; «Sin color» vuelve al de la app', async ({ page }) => {
    await conViajes(page);
    await abrirConfiguracion(page);
    await page.getByRole('button', { name: /^Color/ }).click();
    await page.getByRole('radio', { name: 'Violeta', exact: true }).click();
    await expect(page.getByText('Guardamos los cambios.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.locator('.title-card')).toHaveCSS('background-color', 'rgb(109, 40, 217)');
    await expect(page.locator('.title-card-title')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await ir(page, '/');
    await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
    const insignia = page.locator('.vj-inicio-fila').filter({ hasText: 'Cancún 2026' }).locator('.vj-insignia');
    await expect(insignia).toHaveCSS('background-color', 'rgb(109, 40, 217)');
    await expect(insignia).toHaveCSS('color', 'rgb(255, 255, 255)');
    // Sin color: el teal claro de siempre.
    await abrirConfiguracion(page);
    await page.getByRole('button', { name: /^Color/ }).click();
    await page.getByRole('radio', { name: 'Sin color', exact: true }).click();
    // Guardado, el editor se cierra y la fila dice «Sin color».
    await expect(page.getByRole('radiogroup', { name: 'Color' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Color/ })).toContainText('Sin color');
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.locator('.title-card')).toHaveCSS('background-color', 'rgb(228, 251, 252)');
  });

  test('🔴 9 · la foto: subirla, verla en la burbuja y en Abiertos; quitarla', async ({ page }) => {
    await conViajes(page);
    await abrirConfiguracion(page);
    await page.getByRole('button', { name: /^Foto/ }).click();
    await expect(page.getByRole('button', { name: /Elegir foto/ })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({ name: 'viaje.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByText('Listo: el viaje tiene foto nueva.', { exact: true })).toBeVisible();
    await expect(page.locator('.vjcfg-fila .vj-insignia-foto')).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.locator('.title-card .vj-insignia-foto')).toBeVisible();
    await ir(page, '/');
    await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
    await expect(page.locator('.vj-inicio-fila').filter({ hasText: 'Cancún 2026' }).locator('.vj-insignia-foto')).toBeVisible();
    await abrirConfiguracion(page);
    await page.getByRole('button', { name: /^Foto/ }).click();
    await page.getByRole('button', { name: 'Eliminar foto', exact: true }).click();
    await expect(page.getByText('Quitamos la foto del viaje.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.locator('.title-card .vj-insignia-foto')).toHaveCount(0);
  });

  test('una foto que no sirve: lo dice y no sube nada', async ({ page }) => {
    await conViajes(page);
    await abrirConfiguracion(page);
    await page.getByRole('button', { name: /^Foto/ }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: 'viaje.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(page.getByText('Esa foto no sirve: usa una JPG, PNG o WEBP de hasta 5 MB.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Elegir foto/ })).toBeVisible();
  });
});
