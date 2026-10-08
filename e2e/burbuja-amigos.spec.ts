import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-INICIO-SAMSUNG-20261007 · adenda 1 · D230 · la burbuja roja de «Amigos».
 *
 * En la pestaña «Amigos» de la barra de abajo, una burbuja roja con la cantidad
 * de solicitudes de amistad recibidas sin responder. Desde 10 dice «9+»; en 0
 * no hay burbuja. Baja al aceptar o rechazar (Mati: «Al aceptar o rechazar»).
 * Se actualiza al abrir la app y al volver a ella; nunca en segundo plano. Si la
 * consulta falla, no hay burbuja. El nombre de la pestaña dice cuántas hay, con
 * el número exacto aunque se vea «9+».
 *
 * La cantidad se fija con la costura del mock `payme.app.mock.amigos.solicitudes.v1`
 * (un número o `falla`); sin ella, el seed tiene una entrante.
 */

const COSTURA = 'payme.app.mock.amigos.solicitudes.v1';

const barra = (page: Page) => page.getByRole('navigation', { name: 'Navegación principal' });
/** La pestaña «Amigos», tenga o no la cantidad en el nombre. */
const pestana = (page: Page) => barra(page).getByRole('button', { name: /^Amigos/ });
const burbuja = (page: Page) => barra(page).locator('.appbar-burbuja');

async function conSolicitudes(page: Page, valor: number | 'falla'): Promise<void> {
  await page.addInitScript(([clave, v]) => localStorage.setItem(clave, v), [COSTURA, String(valor)] as const);
}

async function inicioListo(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

async function captura(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${nombre}.png` });
}

test.describe('D230 · la burbuja roja de «Amigos»', () => {
  test('con una solicitud: «1», en rojo, y el nombre lo dice', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await conSolicitudes(page, 1);
    await ingresar(page);
    await inicioListo(page);
    await expect(burbuja(page)).toHaveText('1');
    await expect(pestana(page)).toHaveAccessibleName('Amigos, 1 solicitud pendiente');
    // El rojo de error de la app (--danger #b42318) con el número en blanco.
    await expect(burbuja(page)).toHaveCSS('background-color', 'rgb(180, 35, 24)');
    await expect(burbuja(page)).toHaveCSS('color', 'rgb(255, 255, 255)');
    // Arriba a la derecha del ícono, dentro de la pestaña.
    const caja = await burbuja(page).boundingBox();
    const icono = await pestana(page).locator('svg').boundingBox();
    expect(caja && icono).toBeTruthy();
    expect(caja!.x).toBeGreaterThan(icono!.x + icono!.width / 2);
    expect(caja!.y).toBeLessThan(icono!.y + icono!.height / 2);
    await captura(page, 'amigos-burbuja-1-375');
  });

  test('sin solicitudes: sin burbuja, y el nombre es «Amigos»', async ({ page }) => {
    await conSolicitudes(page, 0);
    await ingresar(page);
    await inicioListo(page);
    // Se espera a que la consulta haya vuelto: la pantalla de Amigos la repite y dice que no hay.
    await page.goto('/#/amigos');
    await page.getByRole('tab', { name: 'Solicitudes', exact: true }).click();
    await expect(page.getByText('No tienes solicitudes pendientes.')).toBeVisible();
    await expect(burbuja(page)).toHaveCount(0);
    await expect(barra(page).getByRole('button', { name: 'Amigos', exact: true })).toBeVisible();
  });

  test('con 9: «9»', async ({ page }) => {
    await conSolicitudes(page, 9);
    await ingresar(page);
    await expect(burbuja(page)).toHaveText('9');
    await expect(pestana(page)).toHaveAccessibleName('Amigos, 9 solicitudes pendientes');
  });

  test('🔴 con 10: «9+», y el nombre dice 10', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await conSolicitudes(page, 10);
    await ingresar(page);
    await expect(burbuja(page)).toHaveText('9+');
    await expect(pestana(page)).toHaveAccessibleName('Amigos, 10 solicitudes pendientes');
    await captura(page, 'amigos-burbuja-9mas-375');
  });

  test('con 23: «9+», y el nombre dice el número exacto', async ({ page }) => {
    await conSolicitudes(page, 23);
    await ingresar(page);
    await expect(burbuja(page)).toHaveText('9+');
    await expect(pestana(page)).toHaveAccessibleName('Amigos, 23 solicitudes pendientes');
  });

  test('🔴 aceptar y rechazar la bajan, y en cero se va', async ({ page }) => {
    await conSolicitudes(page, 3);
    await ingresar(page);
    await expect(burbuja(page)).toHaveText('3');
    await pestana(page).click();
    await page.getByRole('tab', { name: /^Solicitudes/ }).click();

    await page.getByRole('button', { name: 'Aceptar', exact: true }).first().click();
    await expect(burbuja(page)).toHaveText('2');
    await expect(pestana(page)).toHaveAccessibleName('Amigos, 2 solicitudes pendientes');

    await page.getByRole('button', { name: 'Rechazar', exact: true }).first().click();
    await expect(burbuja(page)).toHaveText('1');

    await page.getByRole('button', { name: 'Aceptar', exact: true }).first().click();
    await expect(burbuja(page)).toHaveCount(0);
    await expect(barra(page).getByRole('button', { name: 'Amigos', exact: true })).toBeVisible();
  });

  test('entrar a Amigos sin responder no la saca', async ({ page }) => {
    await conSolicitudes(page, 2);
    await ingresar(page);
    await pestana(page).click();
    await page.getByRole('tab', { name: /^Solicitudes/ }).click();
    await expect(page.getByRole('button', { name: 'Aceptar', exact: true })).toHaveCount(2);
    await expect(burbuja(page)).toHaveText('2');
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await inicioListo(page);
    await expect(burbuja(page)).toHaveText('2');
  });

  test('🔴 si una consulta falla después de tener número, la burbuja se va', async ({ page }) => {
    await conSolicitudes(page, 2);
    await ingresar(page);
    await expect(burbuja(page)).toHaveText('2');
    await page.evaluate((clave) => localStorage.setItem(clave, 'falla'), COSTURA);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(burbuja(page)).toHaveCount(0);
    await expect(barra(page).getByRole('button', { name: 'Amigos', exact: true })).toBeVisible();
  });

  test('si la consulta falla, no hay burbuja (sin número inventado)', async ({ page }) => {
    await conSolicitudes(page, 'falla');
    await ingresar(page);
    await inicioListo(page);
    await page.goto('/#/mesas');
    await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
    await expect(burbuja(page)).toHaveCount(0);
    await expect(barra(page).getByRole('button', { name: 'Amigos', exact: true })).toBeVisible();
  });

  test('🔴 al volver a la app se actualiza; en segundo plano no consulta', async ({ page }) => {
    await conSolicitudes(page, 1);
    await ingresar(page);
    await expect(burbuja(page)).toHaveText('1');

    // Llegan cuatro más mientras la app está en segundo plano.
    await page.evaluate((clave) => localStorage.setItem(clave, '5'), COSTURA);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // Oculta: no se consulta, así que el número no cambia.
    await page.waitForTimeout(600);
    await expect(burbuja(page)).toHaveText('1');

    // Vuelve a la vista: se consulta y llega el número nuevo.
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(burbuja(page)).toHaveText('5');
  });

  test('las otras pestañas no cambian', async ({ page }) => {
    await conSolicitudes(page, 4);
    await ingresar(page);
    await expect(burbuja(page)).toHaveText('4');
    await expect(barra(page).locator('.appbar-burbuja')).toHaveCount(1);
    await expect(barra(page).getByRole('button', { name: 'Inicio', exact: true })).toBeVisible();
    await expect(barra(page).getByRole('button', { name: 'Mesas', exact: true })).toBeVisible();
    await expect(barra(page).getByRole('button', { name: 'Más', exact: true })).toBeVisible();
    await expect(barra(page).getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    // La etiqueta visible sigue siendo «Amigos».
    await expect(pestana(page).locator('.appbar-label')).toHaveText('Amigos');
  });

  test('en inglés, el nombre también', async ({ page }) => {
    await conSolicitudes(page, 3);
    await ingresar(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(page.locator('.appbar-burbuja')).toHaveText('3');
    await expect(page.getByRole('button', { name: 'Friends, 3 pending requests', exact: true })).toBeVisible();
  });
});
