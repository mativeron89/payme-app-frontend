import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-34 · n98 · el aviso `mesa_expired` en Avisos (dueño v2.112.0).
 *
 * La costura `payme.app.mock.avisos.v1 = mesa_vencida` suma dos avisos: uno a
 * PA-1099 (una mesa del seed ya cerrada) y otro sin código y con un
 * `closure_reason` desconocido.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

test.describe('AF-34 · aviso de mesa vencida', () => {
  test('se ve con su texto y su ícono, y tocarlo lleva a la mesa', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.avisos.v1', 'mesa_vencida'));
    await ingresar(page);
    await page.getByRole('button', { name: 'Avisos' }).click();
    await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
    const aviso = page.getByRole('button', { name: /La mesa PA-1099 en La Parolaccia se cerró por tiempo/ });
    await expect(aviso).toBeVisible();
    // El otro, sin código y con un motivo desconocido: se ve, no rompe y no es botón.
    await expect(page.getByText('Una mesa en la que elegiste se cerró.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Una mesa en la que elegiste se cerró/ })).toHaveCount(0);
    await capturar(page, 'aviso-01-en-avisos');
    await aviso.click();
    await expect(page).toHaveURL(/:\d+\/mesa\/PA-1099$/);
  });

  test('sin la costura, Avisos sigue como estaba (testigo)', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Avisos' }).click();
    await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
    await expect(page.getByText(/se cerró por tiempo/)).toHaveCount(0);
  });
});
