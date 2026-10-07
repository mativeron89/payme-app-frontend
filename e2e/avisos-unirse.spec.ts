import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-UNIRSE-CODIGO · D219 · los dos avisos nuevos (turno 1 · 10 y 11; casos
 * N01–N07 de Codex): `join_request_received` al titular y
 * `join_request_accepted` a quien pidió. El mock los trae con la costura
 * `payme.app.mock.avisos.v1 = unirse`, con la forma del dueño.
 */
test.use({ viewport: { width: 375, height: 667 } });

async function enAvisos(page: Page, unirse: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((u) => {
    localStorage.setItem('payme.app.mock.avisos.v1', 'unirse');
    localStorage.setItem('payme.app.mock.unirse.v1', JSON.stringify(u));
  }, unirse);
  await ingresar(page);
  await page.goto('/avisos');
  await expect(page.getByRole('heading', { name: 'Notificaciones', exact: true })).toBeVisible();
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

test.describe('D219 · los avisos de unirse con el código', () => {
  test('🔴 N01 · N02 · al titular: el cuerpo del dueño tal cual, con y sin @', async ({ page }) => {
    await enAvisos(page);
    await expect(page.getByText('Ana López (@ana.lopez) quiere unirse a tu mesa PA-2847', { exact: true })).toBeVisible();
    await expect(page.getByText('Sofía Torres quiere unirse a tu mesa PA-2847', { exact: true })).toBeVisible();
    await expect(page.locator('.avisos-lista')).not.toContainText('(@null)');
    await capturar(page, 'avisos-unirse-375');
  });

  test('🔴 N05 · a quien pidió: título y cuerpo del dueño (X08), sin reescribir', async ({ page }) => {
    await enAvisos(page);
    const fila = page.locator('.aviso-row').filter({ hasText: 'Te aceptaron en la mesa' });
    await expect(fila.locator('.aviso-title')).toHaveText('Te aceptaron en la mesaYa estás en la mesa PA-4520');
    await expect(fila.locator('.aviso-title strong')).toHaveText('Te aceptaron en la mesa');
  });

  test('🔴 N03 · tocar el aviso del titular abre «Tu mesa» con las solicitudes abiertas', async ({ page }) => {
    await enAvisos(page, { solicitudes: 1 });
    await page.getByRole('button', { name: /Ana López \(@ana\.lopez\) quiere unirse a tu mesa PA-2847/ }).click();
    await expect(page).toHaveURL(/\/mesa\/PA-2847$/);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    const solicitudes = page.getByRole('region', { name: 'Solicitudes para unirse' });
    await expect(solicitudes.locator('.desplegable-cabecera')).toHaveAttribute('aria-expanded', 'true');
    await expect(solicitudes.getByText('Ana López (@ana.lopez) quiere unirse')).toBeVisible();
  });

  test('🔴 N04 · un aviso viejo, sin solicitudes ya: la mesa como está, sin fila resucitada', async ({ page }) => {
    await enAvisos(page, { solicitudes: 0 });
    await page.getByRole('button', { name: /Sofía Torres quiere unirse a tu mesa PA-2847/ }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.getByRole('region', { name: 'Solicitudes para unirse' })).toHaveCount(0);
  });

  test('🔴 N06 · tocar el de aceptación abre la mesa, sin pedir de nuevo', async ({ page }) => {
    await enAvisos(page);
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
      const w = window as unknown as { __pedidos: number };
      w.__pedidos = 0;
      const pedir = api.requestJoin!.bind(api);
      api.requestJoin = (...a: unknown[]) => { w.__pedidos += 1; return pedir(...a); };
    });
    await page.getByRole('button', { name: /Te aceptaron en la mesa/ }).click();
    await expect(page).toHaveURL(/\/mesa\/PA-4520$/);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __pedidos: number }).__pedidos)).toBe(0);
  });
});
