import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar } from './_app';

const CAPTURES_DIR = process.env.AF_CAPTURES_DIR;

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

async function acreditar(page: Page, nombre: string, titleCard = true): Promise<void> {
  const app = page.locator('.app');
  await expect(app).toBeVisible();
  const header = page.locator('.screen > .hdr').first();
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  const fab = nav.locator('.appbar-fab');
  const [box, headerBox, navBox, fabBox] = await Promise.all([
    app.boundingBox(), header.boundingBox(), nav.boundingBox(), fab.boundingBox(),
  ]);
  expect(box?.width).toBe(390);
  expect(box?.height).toBe(844);
  expect(headerBox?.height).toBe(154);
  expect(navBox?.height).toBe(64);
  expect(fabBox?.width).toBe(56);
  expect(fabBox?.height).toBe(56);
  expect((navBox?.y ?? 0) - (fabBox?.y ?? 0)).toBe(26);
  if (titleCard) {
    const titleBox = await page.locator('.screen > .title-card').first().boundingBox();
    expect(titleBox?.y).toBe(112);
    expect(titleBox?.height).toBeGreaterThanOrEqual(83);
  }
  await expect(page.locator('.screen > .scroll')).toHaveCount(1);
  await expect(page.locator('.screen > .appbar-block')).toHaveCount(1);
  const shell = await app.evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(shell.scrollHeight).toBe(shell.clientHeight);
  if (!CAPTURES_DIR) return;
  mkdirSync(CAPTURES_DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await app.screenshot({ path: join(CAPTURES_DIR, `${nombre}.png`), animations: 'disabled' });
}

test('las doce superficies aprobadas quedan medidas a 390 × 844', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0.8088; });
  await ingresar(page);
  await acreditar(page, '01-inicio', false);

  await page.getByRole('button', { name: 'Avisos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Avisos', exact: true })).toBeVisible();
  await acreditar(page, '02-notificaciones');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();

  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
  await acreditar(page, '03-scan');
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?' })).toBeVisible();
  await acreditar(page, '04-division');
  const divisionScroll = await page.locator('.ticket-flow-scroll').evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  expect(divisionScroll.scrollHeight).toBe(divisionScroll.clientHeight);

  await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
  const sumar = page.getByRole('button', { name: 'Un comensal más' });
  for (let i = 0; i < 4; i += 1) await sumar.click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa', exact: true })).toBeVisible();
  await acreditar(page, '05-garantia');
  await page.getByRole('radio', { name: /Santander.*4532/ }).click();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¡Mesa garantizada!', exact: true })).toBeVisible();
  await acreditar(page, '06-compartir');

  await page.getByRole('button', { name: 'Elegir mis ítems', exact: true }).click();
  await expect(page.getByText('Elige lo que consumiste', { exact: true })).toBeVisible();
  await acreditar(page, '07-mis-items');
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await page.getByRole('button', { name: 'Vino tinto (copa)', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagas solo tu parte', exact: true })).toBeVisible();
  await acreditar(page, '08-pago');
  await page.getByRole('radio', { name: '5%', exact: true }).click();
  await page.getByRole('button', { name: 'Lupita', exact: true }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!', { exact: true })).toBeVisible();
  await acreditar(page, '09-comprobante');

  await page.goto('/#/mas');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
  await acreditar(page, '10-configuracion');
  await page.goto('/#/mesas');
  await expect(page.getByRole('heading', { name: 'Historial', exact: true })).toBeVisible();
  await acreditar(page, '11-historial');
  await page.goto('/#/estadisticas');
  await expect(page.getByRole('heading', { name: 'Mis estadísticas', exact: true })).toBeVisible();
  await acreditar(page, '12-estadisticas');
});
