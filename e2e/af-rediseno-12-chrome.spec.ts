import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

test.use({ viewport: { width: 375, height: 667 } });

test.describe('AF-REDISENO-12 · chrome compartido a 375 × 667', () => {
  test('el shell exterior no scrollea y el flujo conserva geometría y campana navegable', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();

    const header = page.locator('.hdr-flow');
    const titulo = page.locator('.title-card').first();
    const barra = page.getByRole('navigation', { name: 'Navegación principal' });

    await expect(header).toBeVisible();
    await expect(titulo).toBeVisible();
    await expect(barra).toBeVisible();

    const [headerBox, titleBox, fabBox, navBox, backBox, bellBox] = await Promise.all([
      header.boundingBox(),
      titulo.boundingBox(),
      barra.locator('.appbar-fab').boundingBox(),
      barra.boundingBox(),
      header.getByRole('button', { name: 'Volver', exact: true }).boundingBox(),
      header.getByRole('button', { name: 'Avisos', exact: true }).boundingBox(),
    ]);
    expect(headerBox?.height).toBe(154);
    expect(titleBox?.y).toBe(112);
    expect(titleBox?.height).toBeGreaterThanOrEqual(83);
    expect(navBox?.height).toBe(64);
    expect(fabBox?.width).toBe(56);
    expect(fabBox?.height).toBe(56);
    expect((navBox?.y ?? 0) - (fabBox?.y ?? 0)).toBe(26);
    expect(backBox?.width).toBeGreaterThanOrEqual(44);
    expect(backBox?.height).toBeGreaterThanOrEqual(44);
    expect(bellBox?.width).toBeGreaterThanOrEqual(44);
    expect(bellBox?.height).toBeGreaterThanOrEqual(44);
    await expect(header).toHaveCSS('padding-left', '16px');
    await expect(header).toHaveCSS('padding-right', '16px');
    await expect(header.locator('.hdr-row-2')).toHaveCSS('margin-top', '10px');
    await expect(header.locator('.hdr-back')).toHaveCSS('font-weight', '700');
    await expect(titulo).toHaveCSS('padding-left', '18px');
    await expect(titulo).toHaveCSS('padding-top', '16px');
    await expect(titulo).toHaveCSS('justify-content', 'center');
    await expect(barra.locator('..')).toHaveCSS('position', 'absolute');
    await expect(barra.locator('..')).toHaveCSS('border-top-left-radius', '24px');

    const shell = await page.locator('.app').evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(shell.scrollHeight).toBe(shell.clientHeight);

    await header.getByRole('button', { name: 'Avisos', exact: true }).click();
    await expect(page).toHaveURL(/#\/avisos$/);
  });

  test('Configuración muestra identidad y foto sin controles de edición inventados', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    await expect(page.getByText('payme_mx_mati', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/La identidad y la foto se muestran/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Editar|Cambiar foto/i })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByText('Modo demo:', { exact: true })).toBeVisible();
  });
});
