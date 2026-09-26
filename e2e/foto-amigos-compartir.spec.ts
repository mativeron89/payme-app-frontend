import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-FOTO-COMPARTIR · pedido de Mati (2026-09-25): «si voy a amigos veo la foto
 * de mis contactos pero en compartir mesa no figura la imagen». Compartir mesa
 * muestra la MISMA foto que Amigos (n196), con el mismo componente y la misma
 * ruta del dueño. Sin foto queda el monograma de esa pantalla.
 *
 * Fixture del mock (el mismo que usa `ajustes10-u05`): Sofía tiene foto
 * autorizada; María no.
 */
async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png`, fullPage: true });
}

async function abrirCompartir(page: Page): Promise<void> {
  await ingresar(page);
  const aviso = page.getByLabel('Actualización del Aviso de Privacidad');
  await aviso.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect(aviso).toHaveCount(0);
  await page.goto('/#/mesa/PA-2847');
  await page.getByRole('button', { name: 'Invitar amigos de PayMe' }).click();
}

test.describe('compartir mesa · la foto de los amigos', () => {
  test('control positivo: en Amigos, Sofía tiene foto y María no', async ({ page }) => {
    await ingresar(page);
    await page.getByLabel('Actualización del Aviso de Privacidad').getByRole('button', { name: 'Entendido', exact: true }).click();
    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    await expect(page.locator('.friend-row').filter({ hasText: 'Sofía Fernández' }).locator('.friend-avatar-image')).toBeVisible();
    await expect(page.locator('.friend-row').filter({ hasText: 'María Ruiz' }).locator('.friend-avatar-image')).toHaveCount(0);
  });

  test('en compartir mesa aparece la misma foto; sin foto, el monograma de la pantalla', async ({ page }) => {
    await abrirCompartir(page);
    const sofia = page.locator('.inv-row').filter({ hasText: 'Sofía Fernández' });
    const maria = page.locator('.inv-row').filter({ hasText: 'María Ruiz' });
    await expect(sofia).toBeVisible();
    await expect(sofia.locator('.friend-avatar-image')).toBeVisible();
    await expect(sofia.locator('.friend-avatar-image')).toHaveAttribute('src', /^blob:/);
    await expect(maria.locator('.friend-avatar-image')).toHaveCount(0);
    // Sin foto: el monograma de esta pantalla, sin color por persona.
    await expect(maria.locator('.avatar.avatar-marca')).toBeVisible();
    // La lista vive dentro de un contenedor con scroll: se la trae a la vista.
    await maria.scrollIntoViewIfNeeded();
    await capturar(page, 'foto-compartir-390');
  });

  test('en la pestaña Grupos, los integrantes también muestran su foto', async ({ page }) => {
    await abrirCompartir(page);
    await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
    await page.getByRole('button', { name: /Familia/ }).click();
    const sofia = page.locator('.inv-row').filter({ hasText: 'Sofía Fernández' });
    const leo = page.locator('.inv-row').filter({ hasText: 'Leo Paz' });
    await expect(sofia.locator('.friend-avatar-image')).toBeVisible();
    await expect(leo.locator('.friend-avatar-image')).toHaveCount(0);
    await expect(leo.locator('.avatar.avatar-marca')).toBeVisible();
  });
});
