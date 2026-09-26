import { expect, test } from '@playwright/test';

/**
 * RM-182 · 5b · decisión 97 de Mati: el aviso «Si entraste con Google y quieres
 * usar otra cuenta, cierra sesión de Google en Safari y vuelve a intentar.» se
 * RETIRÓ. Antes salía sólo en WebKit; el runner es Chromium y el motor se
 * simula con el `userAgent`, que es lo que la app leía. Este spec reemplaza al
 * que fijaba el aviso y fija que no está, en los dos motores.
 */
const aviso = '[data-aviso="google-otra-cuenta"]';

test.describe('en Safari de iPhone', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  test('🔴 bajo el botón de Google no hay aviso (decisión 97)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.social-google-container')).toBeVisible();
    await expect(page.locator(aviso)).toHaveCount(0);
    await expect(page.getByText(/Si entraste con Google/)).toHaveCount(0);
  });
});

test('en Chrome tampoco', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.social-google-container')).toBeVisible();
  await expect(page.locator(aviso)).toHaveCount(0);
  await expect(page.getByText(/Si entraste con Google/)).toHaveCount(0);
});
