import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

test.use({ viewport: { width: 375, height: 667 } });

async function capturar(page: import('@playwright/test').Page, name: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
}

test('AF-AJUSTES10 · Asociadas queda mínima y el header alinea marca/nombre sin perder campana', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('tab', { name: 'Asociadas' }).click();
  await expect(page.getByText('Todavía no está disponible', { exact: true })).toBeVisible();
  await expect(page.getByText(/cómo se autoriza un pago/)).toHaveCount(0);

  const identity = page.locator('.hdr-user-group');
  const [identityBox, logoBox, userBox, bellBox] = await Promise.all([
    identity.boundingBox(),
    identity.locator('.hdr-mark').boundingBox(),
    identity.locator('.hdr-user').boundingBox(),
    page.getByRole('button', { name: 'Avisos' }).boundingBox(),
  ]);
  expect(identityBox?.height).toBe(34);
  // Decisión de Mati del 22/09 (AF-HEADER-WEBKIT, iteración 2): el nombre va
  // deliberadamente por debajo del centro del lockup, exactamente la constante
  // `--hdr-user-nudge` (5.5 px desde AF-HEADER-ITER3). La guarda ya no exige cajas centradas: exige que
  // lo único que las separe sea esa constante.
  const nudge = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-user-nudge')));
  expect(nudge).toBe(5.5);
  expect(Math.abs((((userBox?.y ?? 0) + (userBox?.height ?? 0) / 2) - ((logoBox?.y ?? 0) + (logoBox?.height ?? 0) / 2)) - nudge))
    .toBeLessThanOrEqual(1);
  expect(bellBox?.width).toBeGreaterThanOrEqual(44);
  await capturar(page, 'u03-u07-header-asociadas');
});

test('AF-AJUSTES10 · pestañas de Qué comes forman una pieza con el panel', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/platos');
  const tab = page.getByRole('tab', { name: 'Platos' });
  const panel = page.getByRole('tabpanel');
  await expect(tab).toHaveAttribute('aria-controls', 'que-comes-panel');
  await expect(panel).toHaveAttribute('aria-labelledby', 'que-comes-tab-platos');
  const [tabBox, panelBox] = await Promise.all([tab.boundingBox(), panel.boundingBox()]);
  expect(Math.abs(((tabBox?.y ?? 0) + (tabBox?.height ?? 0)) - (panelBox?.y ?? 0))).toBeLessThanOrEqual(1);
  await expect(tab).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await capturar(page, 'u10-tabs-panel');
});
