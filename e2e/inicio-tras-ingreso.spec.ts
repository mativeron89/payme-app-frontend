import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-INICIO-TRAS-INGRESO · Mati, en Chrome del iPhone: «entra bien con Google
 * pero no ingresa de una al Inicio, ingresa a "Más"».
 *
 * La causa: cerrar sesión no tocaba la URL y la pantalla de ingreso se dibuja
 * sobre la ruta que haya. Al volver a entrar, la app mostraba la ruta que quedó
 * de la sesión anterior. Ahora, después de entrar, Inicio; salvo los enlaces de
 * entrada (invitación a una mesa, QR del restaurante), que siguen yendo a su
 * destino.
 */

const SESION_MOCK = 'payme_app_session__mock';

const ruta = (page: Page) => page.evaluate(() => ({
  path: location.pathname,
  search: location.search,
  hash: location.hash,
}));

async function entrarCon(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

/** Inicio, por la URL y por la pantalla: la pestaña de Inicio activa. */
async function enInicio(page: Page): Promise<void> {
  await expect(page).toHaveURL(/:\d+\/home$/);
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inicio', exact: true })).toHaveAttribute('aria-current', 'page');
}

test.describe('AF-INICIO-TRAS-INGRESO · después de entrar, Inicio', () => {
  test('cerrar sesión desde Más y volver a entrar lleva a Inicio, no a Más', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/mas$/);
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();

    // La URL vuelve a la pantalla de ingreso, sin arrastrar la ruta.
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    expect(await ruta(page)).toEqual({ path: '/', search: '', hash: '' });

    await entrarCon(page, 'mati@payme.mx');
    await enInicio(page);
  });

  test('lo de Mati: cerrar sesión desde Más y volver a entrar con Google lleva a Inicio', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/mas$/);
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
    await enInicio(page);
  });

  test('una ruta que quedó de una sesión vencida no cuenta como entrada: va a Inicio', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/mas$/);
    // La sesión se pierde sin «Cerrar sesión» (venció, o el navegador restauró
    // la pestaña): la URL sigue en /mas.
    await page.evaluate((k) => localStorage.removeItem(k), SESION_MOCK);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/:\d+\/mas$/);

    await entrarCon(page, 'mati@payme.mx');
    await enInicio(page);
  });

  test('una sesión viva que abre una ruta directa se queda ahí (no es un ingreso)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/mas');
    await expect(page).toHaveURL(/:\d+\/mas$/);
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
  });
});

test.describe('AF-INICIO-TRAS-INGRESO · los enlaces de entrada van a su destino', () => {
  test('el QR del restaurante: entrar desde /scan?r=… deja en el escaneo con su restaurante', async ({ page }) => {
    await page.goto('/scan?r=rest-qr-1');
    await entrarCon(page, 'mati@payme.mx');
    await expect(page).toHaveURL(/:\d+\/scan\?r=rest-qr-1$/);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
  });

  test('la invitación a una mesa: entrar desde el enlace lleva a la mesa', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    // Otra persona, sin sesión, abre el enlace en frío.
    await page.evaluate((k) => localStorage.removeItem(k), SESION_MOCK);
    await page.goto('about:blank');
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await entrarCon(page, 'invitada@payme.mx');
    await expect.poll(async () => (await ruta(page)).path).toBe(`/mesa/${mesa.code}`);
    expect(page.url()).not.toContain(mesa.token);
    await expect(page.getByText('¡Te sumaste a la mesa!', { exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/\/home$/);
  });

  test('una invitación de alta: después de crear la cuenta, la ruta en la que se abrió', async ({ page }) => {
    const invitacion = 'signup-token-dddddddddddddddddddd';
    await page.goto(`/#/mesas?signup_invitation=${invitacion}`);
    await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
    await page.getByLabel('Nombre', { exact: true }).fill('Sofía');
    await page.getByLabel('Apellido', { exact: true }).fill('Prueba');
    await page.getByLabel('Email', { exact: true }).fill('sofia.inicio@example.com');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Tus mesas' })).toBeVisible();
    await expect(page).not.toHaveURL(/\/home$/);
    expect(page.url()).not.toContain(invitacion);
  });
});
