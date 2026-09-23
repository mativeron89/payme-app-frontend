import { expect, test } from '@playwright/test';

/**
 * RM-182 · 5b · decisión 11 de Mati («Aprobar el aviso»): bajo el botón de
 * Google, sólo en Safari/WebKit, el texto literal. El runner es Chromium: el
 * motor se simula con el `userAgent`, que es lo que la app lee.
 */
const TEXTO = 'Si entraste con Google y quieres usar otra cuenta, cierra sesión de Google en Safari y vuelve a intentar.';
const aviso = '[data-aviso="google-otra-cuenta"]';

test.describe('en Safari de iPhone', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('🔴 el aviso está bajo el botón de Google, con el texto exacto', async ({ page }) => {
    await page.goto('/');
    const boton = page.locator('.social-google-container');
    await expect(boton).toBeVisible();
    await expect(page.locator(aviso)).toHaveText(TEXTO);
    const [b, a] = await Promise.all([boton.boundingBox(), page.locator(aviso).boundingBox()]);
    expect(a!.y).toBeGreaterThanOrEqual(b!.y + b!.height);
    // Un solo aviso: no se duplica con el del Aviso de privacidad.
    await expect(page.locator(aviso)).toHaveCount(1);
  });
});

test('🔴 en Chrome no aparece (el problema es de WebKit)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.social-google-container')).toBeVisible();
  await expect(page.locator(aviso)).toHaveCount(0);
  await expect(page.getByText(TEXTO)).toHaveCount(0);
});
