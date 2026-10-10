import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-LINK-DE-INVITACION · D252 · el link de invitación en Amigos, con el mock
 * (tramo 1: el seam `payme.app.mock.invite_link.v1` lo enciende; apagado por
 * defecto). Mati: «ahora solo es el link que necesito que se genere y se pueda
 * compartir para que se empiece a masificar».
 */
const SEAM = 'payme.app.mock.invite_link.v1';
const CLAVE_CODIGO = 'payme.app.mock.referral_code.v1';
/** `codigo.formato` del contrato del dueño: 16 caracteres base64url. */
const CODIGO = 'Ab12Cd34Ef56Gh78';

/** La burbuja de Amigos: toda ella es el botón (D255-4). */
const BURBUJA = 'button.invitar-link';

async function conLink(page: Page, opciones: { portapapeles?: 'ok' | 'falla'; error?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ seam, portapapeles, error }) => {
    localStorage.setItem(seam, 'encendido');
    if (error) localStorage.setItem('payme.app.mock.invite_link.estado.v1', 'error');
    // La hoja de compartir existe y se espía: D255-4 ya no la usa.
    const w = window as unknown as { __compartido: unknown[]; __copiado: string[] };
    w.__compartido = [];
    w.__copiado = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (datos: unknown) => { w.__compartido.push(datos); },
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (s: string) => {
          if (portapapeles === 'falla') throw new DOMException('no', 'NotAllowedError');
          w.__copiado.push(s);
        },
      },
    });
  }, { seam: SEAM, portapapeles: opciones.portapapeles ?? 'ok', error: opciones.error ?? false });
  await ingresar(page);
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.locator(BURBUJA)).toBeVisible();
  // Mientras el link carga, tocar no hace nada (a propósito): se espera a que esté.
  await expect(page.locator(BURBUJA)).not.toHaveAttribute('aria-busy', 'true');
}

const espias = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __compartido: unknown[]; __copiado: string[] };
  return { compartido: w.__compartido, copiado: w.__copiado };
});

test('🔴 D255-4 · tocar la burbuja copia el link (sólo el link) y avisa «Link copiado»; no abre la hoja de compartir', async ({ page }) => {
  await conLink(page);
  await page.locator(BURBUJA).click();
  await expect(page.getByText('Link copiado', { exact: true })).toBeVisible();
  const { compartido, copiado } = await espias(page);
  // Como en producción: `FRONTEND_PUBLIC_URL` termina en `/#`.
  expect(copiado).toHaveLength(1);
  expect(copiado[0]).toMatch(/^https:\/\/app\.paymemx\.com\/#\/invitacion\/[A-Za-z0-9_-]{16}$/);
  expect(compartido).toEqual([]);
});

test('🔴 D255-4 · una sola burbuja con su nombre: sin el texto, el link a la vista, «Compartir» ni «Cambiar mi link»', async ({ page }) => {
  await conLink(page);
  await expect(page.getByRole('button', { name: 'Invita a alguien a PayMe', exact: true })).toHaveCount(1);
  const amigos = page.locator('.scroll');
  for (const fuera of ['Comparte tu link', 'Compartir mi link', 'Cambiar mi link', 'app.paymemx.com']) {
    await expect(amigos.getByText(fuera)).toHaveCount(0);
  }
});

test('D255-4 · si el navegador no deja copiar, lo dice', async ({ page }) => {
  await conLink(page, { portapapeles: 'falla' });
  await page.locator(BURBUJA).click();
  await expect(page.getByText('No se pudo copiar: tu navegador no habilitó el portapapeles', { exact: true })).toBeVisible();
  await expect(page.getByText('Link copiado', { exact: true })).toHaveCount(0);
});

test('D255-4 · si el link no cargó, tocar lo dice y lo vuelve a pedir; ya cargado, copia', async ({ page }) => {
  await conLink(page, { error: true });
  await page.evaluate(() => localStorage.removeItem('payme.app.mock.invite_link.estado.v1'));
  await page.locator(BURBUJA).click();
  await expect(page.getByText('No pudimos cargar tu link. Prueba de nuevo.', { exact: true })).toBeVisible();
  expect((await espias(page)).copiado).toEqual([]);
  // El segundo pedido ya anda: la burbuja copia.
  await expect(page.locator(BURBUJA)).not.toHaveAttribute('aria-busy', 'true');
  await page.locator(BURBUJA).click();
  await expect(page.getByText('Link copiado', { exact: true })).toBeVisible();
  expect((await espias(page)).copiado).toHaveLength(1);
});

test('🔴 D252 · sin sesión, el link abre «Crea tu cuenta» y deja el código guardado para el alta', async ({ page }) => {
  await page.addInitScript((seam) => {
    localStorage.setItem(seam, 'encendido');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
  }, SEAM);
  await page.goto(`/invitacion/${CODIGO}`);
  // El alta, no el login: el formulario de registro.
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), CLAVE_CODIGO)).toBe(CODIGO);
});

test('🔴 D252 · el link de producción (`/#/invitacion/<código>`) también lleva al alta con el código', async ({ page }) => {
  await page.addInitScript((seam) => {
    localStorage.setItem(seam, 'encendido');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
  }, SEAM);
  await page.goto(`/#/invitacion/${CODIGO}`);
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), CLAVE_CODIGO)).toBe(CODIGO);
});

test('🔴 D252 · el alta por correo lleva el código; con la cuenta creada, a Amigos y el código se olvida', async ({ page }) => {
  await page.addInitScript((seam) => {
    localStorage.setItem(seam, 'encendido');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
  }, SEAM);
  await page.goto(`/invitacion/${CODIGO}`);
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByLabel('Apellido', { exact: true }).fill('Invitada');
  await page.getByLabel('Email', { exact: true }).fill('ana-invitada@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('con-link-1');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
  await expect(page).toHaveURL(/\/amigos$/);
  expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.ultimo_referral_code.v1'))).toBe(CODIGO);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), CLAVE_CODIGO)).toBeNull();
});

test('D252 · sin la capacidad, el alta no lleva el código (el alta de siempre)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.public_signup.v1', 'true'));
  await page.goto(`/invitacion/${CODIGO}`);
  await page.getByLabel('Nombre', { exact: true }).fill('Beto');
  await page.getByLabel('Apellido', { exact: true }).fill('SinLink');
  await page.getByLabel('Email', { exact: true }).fill('beto-sin-link@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('sin-link-1');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
  await expect(page).toHaveURL(/\/amigos$/);
  expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.ultimo_referral_code.v1'))).toBeNull();
});

test('D252 · sin sesión, un código mal formado no se guarda (el alta sigue igual)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.public_signup.v1', 'true'));
  await page.goto('/invitacion/no%20vale');
  // El alta, no el login: el formulario de registro.
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), CLAVE_CODIGO)).toBeNull();
});

test('🔴 D252 · con sesión, el link no cambia nada: lleva a Amigos y no guarda el código', async ({ page }) => {
  await conLink(page);
  await page.evaluate(() => {
    history.pushState(null, '', '/invitacion/Ab12Cd34Ef56Gh78');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/amigos$/);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), CLAVE_CODIGO)).toBeNull();
});

test('🔴 D252 · sin la capacidad no hay tarjeta', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nuevo amigo' })).toBeVisible();
  await expect(page.locator(BURBUJA)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Invita a alguien a PayMe' })).toHaveCount(0);
});
