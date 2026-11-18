import { expect, test, type Page } from '@playwright/test';
import { hastaCompartir } from './fixtures/mi-parte-d344';
const TIP = 'La eliges tú para toda la mesa y se reparte según lo que consumió cada quien. Es voluntaria y puedes cambiarla después.';
async function foto(page: Page, nombre: string) {
  if (process.env.PAYME_E2E_CAPTURAS) {
    await page.locator('.hdr-user').evaluateAll(xs => xs.forEach(x => { x.textContent = 'Demo'; }));
    await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/${nombre}.png`, animations: 'disabled' });
  }
}
test('K18 · explicación y enlace en la hoja nativa', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: (data: ShareData) => {
    (window as unknown as { textoCompartido: string }).textoCompartido = data.text ?? ''; return Promise.resolve();
  } }));
  const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await expect(page.getByText(TIP, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compartir…', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { textoCompartido: string }).textoCompartido)).toContain(code);
  await foto(page, '18-compartir-mesa');
});
test('K18 · sin soporte no ofrece Compartir…', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await expect(page.getByText(TIP, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compartir…', exact: true })).toHaveCount(0);
});
test('K19 · Google principal en cuenta de entrada por link', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('payme.app.mock.public_signup.v1', 'true'); });
  await page.goto('/#/mesa/PA-1234?t=ejemplo-link-de-mesa');
  await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
  const google = page.getByRole('group', { name: 'Continuar con Google', exact: true });
  await expect(google).toBeVisible();
  expect(await google.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('input[type=email]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.ingreso-desde-mesa .ingreso-entrar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await foto(page, '19-cuenta-desde-link');
});
