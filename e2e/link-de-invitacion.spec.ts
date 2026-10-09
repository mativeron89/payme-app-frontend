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

async function conLink(page: Page, compartir: 'ok' | 'cancela' | 'sin' = 'sin'): Promise<void> {
  await page.addInitScript(({ seam, compartir }) => {
    localStorage.setItem(seam, 'encendido');
    // La hoja de compartir del teléfono, espiada; o ninguna.
    const w = window as unknown as { __compartido: unknown[]; __copiado: string[] };
    w.__compartido = [];
    w.__copiado = [];
    if (compartir === 'sin') {
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    } else {
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (datos: unknown) => {
          w.__compartido.push(datos);
          if (compartir === 'cancela') throw new DOMException('cancelado', 'AbortError');
        },
      });
    }
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (s: string) => { w.__copiado.push(s); } },
    });
  }, { seam: SEAM, compartir });
  await ingresar(page);
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Invita a alguien a PayMe' })).toBeVisible();
}

const espias = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __compartido: Array<{ title?: string; text?: string; url?: string }>; __copiado: string[] };
  return { compartido: w.__compartido, copiado: w.__copiado };
});

test('D252 · con la hoja de compartir del teléfono: título, mensaje y el link, sin copiar nada', async ({ page }) => {
  await conLink(page, 'ok');
  const url = (await page.locator('.invitar-link-url').innerText()).trim();
  expect(url).toMatch(/^app\.paymemx\.com\/invitacion\/[A-Za-z0-9]{12}$/);
  await page.getByRole('button', { name: 'Compartir mi link', exact: true }).click();
  await expect.poll(async () => (await espias(page)).compartido.length).toBe(1);
  const { compartido, copiado } = await espias(page);
  expect(compartido[0]).toEqual({
    title: 'PayMe',
    text: 'Te invito a PayMe para dividir la cuenta en el restaurante. Regístrate con mi link:',
    url: `https://${url}`,
  });
  expect(copiado).toEqual([]);
});

test('D252 · si la persona cierra la hoja de compartir, no se copia nada', async ({ page }) => {
  await conLink(page, 'cancela');
  await page.getByRole('button', { name: 'Compartir mi link', exact: true }).click();
  await expect.poll(async () => (await espias(page)).compartido.length).toBe(1);
  await page.waitForTimeout(300);
  expect((await espias(page)).copiado).toEqual([]);
  await expect(page.getByText('Copiamos tu link.', { exact: true })).toHaveCount(0);
});

test('D252 · sin la hoja de compartir, se copia el mensaje con el link y se avisa', async ({ page }) => {
  await conLink(page, 'sin');
  const url = (await page.locator('.invitar-link-url').innerText()).trim();
  await page.getByRole('button', { name: 'Compartir mi link', exact: true }).click();
  await expect(page.getByText('Copiamos tu link.', { exact: true })).toBeVisible();
  expect((await espias(page)).copiado).toEqual([
    `Te invito a PayMe para dividir la cuenta en el restaurante. Regístrate con mi link: https://${url}`,
  ]);
});

test('D252 · «Cambiar mi link»: con confirmación, el link cambia; «Cancelar» no cambia nada', async ({ page }) => {
  await conLink(page);
  const antes = (await page.locator('.invitar-link-url').innerText()).trim();
  await page.getByRole('button', { name: 'Cambiar mi link', exact: true }).click();
  const hoja = page.getByRole('dialog', { name: '¿Cambiar tu link?' });
  await expect(hoja).toContainText('Tu link actual deja de funcionar. Quien ya se registró con él sigue siendo tu amigo.');
  await expect(hoja.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await hoja.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(hoja).toHaveCount(0);
  expect((await page.locator('.invitar-link-url').innerText()).trim()).toBe(antes);
  await page.getByRole('button', { name: 'Cambiar mi link', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cambiar mi link', exact: true }).click();
  await expect(page.getByText('Listo: tu link es nuevo. El anterior ya no funciona.', { exact: true })).toBeVisible();
  await expect(page.locator('.invitar-link-url')).not.toHaveText(antes);
});

test('🔴 D252 · sin sesión, el link abre «Crea tu cuenta» y deja el código guardado para el alta', async ({ page }) => {
  await page.addInitScript((seam) => {
    localStorage.setItem(seam, 'encendido');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
  }, SEAM);
  await page.goto('/invitacion/abc123def456');
  // El alta, no el login: el formulario de registro.
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), CLAVE_CODIGO)).toBe('abc123def456');
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
    history.pushState(null, '', '/invitacion/abc123def456');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/amigos$/);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), CLAVE_CODIGO)).toBeNull();
});

test('🔴 D252 · sin la capacidad no hay tarjeta', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nuevo amigo' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Invita a alguien a PayMe' })).toHaveCount(0);
});
