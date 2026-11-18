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
