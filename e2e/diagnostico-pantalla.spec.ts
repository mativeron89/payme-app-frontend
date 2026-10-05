import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * E173-2 · el diagnóstico de pantalla: 5 toques en el logo de PayMe lo abren.
 * Pedido del Bibliotecario IV tras la captura 7 del iPhone de Mati, para medir
 * con números reales cómo WebKit dispone la app de inicio.
 *
 * Se mide en la app de inicio SIMULADA: `navigator.standalone`, la pantalla del
 * iPhone (390×844), el viewport achicado en el inset (785) y los insets REALES
 * (`Emulation.setSafeAreaInsetsOverride`, que Chromium 151 respeta en `env()`).
 * No acredita el iPhone; acredita que el panel muestra lo que el navegador
 * informa.
 */
async function simularIos(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
  });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    Object.defineProperty(Screen.prototype, 'height', { configurable: true, get: () => 844 });
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: () => 390 });
  });
  await page.setViewportSize({ width: 390, height: 785 });
}

const panel = (page: Page) => page.getByRole('dialog', { name: 'Diagnóstico de pantalla' });
const logo = (page: Page) => page.locator('.hdr-mark').first();

async function tocarLogo(page: Page, veces: number): Promise<void> {
  for (let i = 0; i < veces; i += 1) await logo(page).click();
}

/** El valor de una fila del panel, por su clave exacta. */
async function valor(page: Page, clave: string): Promise<string> {
  return page.evaluate((k) => {
    const filas = [...document.querySelectorAll('.diag-fila')];
    const fila = filas.find((f) => f.querySelector('dt')?.textContent === k);
    return fila?.querySelector('dd')?.textContent ?? '(no está)';
  }, clave);
}

test.describe('E173-2 · diagnóstico de pantalla (5 toques en el logo)', () => {
  test('🔴 4 toques no lo abren; el quinto sí', async ({ page }) => {
    await ingresar(page);
    await tocarLogo(page, 4);
    await expect(panel(page)).toHaveCount(0);
    await tocarLogo(page, 1);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Cerrar' })).toBeFocused();
  });

  test('🔴 muestra lo que informa el navegador: viewport, pantalla, insets, `.app`, la barra y el modo', async ({ page }) => {
    await simularIos(page);
    await ingresar(page);
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    expect(await valor(page, 'innerWidth × innerHeight')).toBe('390 × 785');
    expect(await valor(page, 'screen width × height')).toBe('390 × 844');
    expect(await valor(page, 'safe-area-inset top · right · bottom · left')).toBe('59 · 0 · 34 · 0');
    expect(await valor(page, 'navigator.standalone')).toBe('true');
    expect(await valor(page, '100vh · 100svh · 100dvh · 100lvh')).toBe('785 · 785 · 785 · 785');
    expect(await valor(page, '.app height (computed)')).toBe('785');
    // La barra entera dentro de lo visible: arriba en 785 − 90, abajo en 785.
    expect(await valor(page, '.appbar-block top · bottom · height')).toBe('695 · 785 · 90');
    expect(await valor(page, 'html style (JS fix)')).toBe('none');
    expect(await valor(page, 'display-mode')).toBe('browser');
    expect(await valor(page, 'version')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('vuelve a medir solo cuando cambia el viewport', async ({ page }) => {
    await simularIos(page);
    await ingresar(page);
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    expect(await valor(page, 'innerWidth × innerHeight')).toBe('390 × 785');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => valor(page, 'innerWidth × innerHeight')).toBe('390 × 844');
    await expect.poll(() => valor(page, '.appbar-block top · bottom · height')).toBe('754 · 844 · 90');
  });

  test('🔴 sólo lee: abrir, volver a medir, copiar y cerrar no hacen ningún pedido de red', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ingresar(page);
    const pedidos: string[] = [];
    page.on('request', (r) => {
      if (['fetch', 'xhr', 'websocket', 'eventsource', 'ping'].includes(r.resourceType())) pedidos.push(r.url());
    });
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole('button', { name: 'Volver a medir' }).click();
    await panel(page).getByRole('button', { name: 'Copiar' }).click();
    await expect(page.getByText('Copiado')).toBeVisible();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado).toContain('innerWidth × innerHeight: ');
    expect(copiado).not.toMatch(/@|payme_/);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(pedidos).toEqual([]);
  });

  test('se cierra con ✕ y con tocar afuera; el logo sigue sin ser un botón', async ({ page }) => {
    await ingresar(page);
    await expect(page.locator('.hdr-mark').first()).not.toHaveAttribute('role', /.+/);
    await expect(page.locator('.hdr-mark').first()).not.toHaveAttribute('tabindex', /.+/);
    await tocarLogo(page, 5);
    await panel(page).getByRole('button', { name: 'Cerrar' }).click();
    await expect(panel(page)).toHaveCount(0);
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(panel(page)).toHaveCount(0);
  });
});
