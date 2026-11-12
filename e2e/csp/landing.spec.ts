import { expect, test } from '@playwright/test';
import { vigilarCsp, violaciones } from './violaciones';

/**
 * n186 · la landing con su CSP OBLIGATORIA (la misma que en producción),
 * sobre su build real (proyecto `csp-landing`, `e2e/csp/servidor.mjs`).
 * El script de idioma es inline y pasa por su hash: si no pasara, el botón EN
 * no haría nada y la landing quedaría en español fijo.
 */
test.beforeEach(async ({ page }) => {
  await vigilarCsp(page);
});

test('carga entera, con el script de idioma andando, sin ninguna violación', async ({ page }) => {
  const r = await page.goto('/');
  expect(r?.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(r?.headers()['x-payme-csp-origen']).toBe('Content-Security-Policy');
  const idioma = page.locator('#lang-toggle');
  await expect(idioma).toHaveText('EN');
  await idioma.click();
  // El script inline corrió: cambió el idioma.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(idioma).toHaveText('ES');
  // Imágenes y fuentes propias cargaron.
  const imagenesRotas = await page.locator('img').evaluateAll((imgs) => imgs.filter((i) => !(i as HTMLImageElement).complete || (i as HTMLImageElement).naturalWidth === 0).length);
  expect(imagenesRotas).toBe(0);
  expect(await violaciones(page)).toEqual([]);
});

test('control: un script inline ajeno queda bloqueado', async ({ page }) => {
  await page.goto('/');
  const corrio = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__ajeno = true;';
    document.head.appendChild(s);
    await new Promise((r) => setTimeout(r, 50));
    return (window as unknown as { __ajeno?: boolean }).__ajeno === true;
  });
  expect(corrio).toBe(false);
  expect((await violaciones(page)).map((v) => v.directiva)).toContain('script-src-elem');
});

// D785 · comprueba también los diccionarios servidos: una clave huérfana
// podría volver a publicar la promesa aunque hoy no tenga nodo visible.
test('D785: sin promesa de privacidad en ES/EN y los otros perks cambian de idioma', async ({ page }) => {
  const response = await page.goto('/');
  const html = await response!.text();
  expect(html).not.toMatch(/Nadie en la mesa ve qué pediste|sees what you ordered/i);
  expect(html).not.toContain('comensal.perk5');
  const keys = [1, 2, 3, 4, 6];
  for (const lang of ['es', 'en', 'es']) {
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await expect(page.locator('[data-i18n="comensal.perk5"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/Nadie en la mesa ve qué pediste|sees what you ordered/i);
    const texts = lang === 'es'
      ? ['Tomas solo tus platillos de la cuenta', 'Eliges cuánta propina dejar', 'Pagas con tarjeta desde tu teléfono', 'Puedes pagar más de una parte, si te toca', 'Te queda el historial de lo que pagaste']
      : ['You only take your own dishes off the bill', 'You choose how much tip to leave', 'Pay with your card, right from your phone', "You can pay more than one share, if it's on you", "You keep a history of what you've paid"];
    for (const [index, key] of keys.entries()) {
      await expect(page.locator(`[data-i18n="comensal.perk${key}"]`)).toHaveText(texts[index]!);
    }
    expect(await violaciones(page)).toEqual([]);
    await page.locator('#lang-toggle').click();
  }
});
