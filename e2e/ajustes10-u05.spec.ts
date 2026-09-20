import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

async function capturar(page: import('@playwright/test').Page, name: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${name}.png`, fullPage: true });
}

test.describe('U05 · foto entre amigos y acuse explícito', () => {
  test('Ahora no conserva toda la app y no persiste un acuse local', async ({ page }) => {
    await ingresar(page);
    const notice = page.getByLabel('Actualización del Aviso de Privacidad');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link', { name: /Ver Aviso de Privacidad/ })).toHaveAttribute('href', '/privacy');
    await capturar(page, 'u05-aviso-foto-amigos');

    await notice.getByRole('button', { name: 'Ahora no', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    await expect(page.getByPlaceholder('Buscar entre tus amigos')).toBeVisible();
    await expect(page.getByLabel('Actualización del Aviso de Privacidad')).toHaveCount(0);

    const persisted = await page.evaluate(() => Object.entries(localStorage));
    expect(JSON.stringify(persisted)).not.toContain('avatar-notice');
    expect(JSON.stringify(persisted)).not.toContain('5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5');
  });

  test('Entendido acusa el texto mostrado; el acuse del lector no inventa fotos ajenas', async ({ page }) => {
    await ingresar(page);
    const notice = page.getByLabel('Actualización del Aviso de Privacidad');
    await expect(notice).toContainText('2.5.5');
    await notice.getByRole('button', { name: 'Entendido', exact: true }).click();
    await expect(notice).toHaveCount(0);

    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    const sofia = page.locator('.friend-row').filter({ hasText: 'Sofía Fernández' });
    const maria = page.locator('.friend-row').filter({ hasText: 'María Ruiz' });
    await expect(sofia.locator('.friend-avatar-image')).toBeVisible();
    await expect(sofia.locator('.friend-avatar-image')).toHaveAttribute('src', /^blob:/);
    // María no tiene una foto autorizada en el fixture. El acuse de quien la
    // mira no cambia eso: conserva el monograma y no aparece un <img>.
    await expect(maria.locator('.friend-avatar-image')).toHaveCount(0);
    await expect(maria.locator('.avatar')).toBeVisible();
    await capturar(page, 'u05-fotos-y-fallback');
  });
});
