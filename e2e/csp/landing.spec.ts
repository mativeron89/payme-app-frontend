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
