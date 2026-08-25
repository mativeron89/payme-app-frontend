import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar } from './_app';

const CAPTURES_DIR = process.env.AF_CAPTURES_DIR;

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

async function acreditar(
  page: Page,
  nombre: string,
  titleCard = true,
  titlePadding = { top: '16px', right: '18px', bottom: '16px', left: '18px' },
): Promise<void> {
  const app = page.locator('.app');
  await expect(app).toBeVisible();
  const header = page.locator('.screen > .hdr').first();
  const nav = page.getByRole('navigation', { name: 'Navegación principal' });
  const fab = nav.locator('.appbar-fab');
  const mark = header.locator('.hdr-mark');
  const identity = header.locator('.hdr-user').first();
  const bell = header.locator('.hdr-bell');
  const [box, headerBox, navBox, fabBox, markBox, identityBox, bellBox] = await Promise.all([
    app.boundingBox(), header.boundingBox(), nav.boundingBox(), fab.boundingBox(),
    mark.boundingBox(), identity.boundingBox(), bell.boundingBox(),
  ]);
  expect(box?.width).toBe(390);
  expect(box?.height).toBe(844);
  expect(headerBox?.height).toBe(154);
  expect(navBox?.height).toBe(64);
  expect(fabBox?.width).toBe(56);
  expect(fabBox?.height).toBe(56);
  expect((navBox?.y ?? 0) - (fabBox?.y ?? 0)).toBe(26);
  expect(markBox?.x).toBe(16);
  expect(markBox?.height).toBe(34);
  expect((identityBox?.x ?? 0) - ((markBox?.x ?? 0) + (markBox?.width ?? 0))).toBe(12);
  expect(bellBox?.width).toBeGreaterThanOrEqual(44);
  expect(bellBox?.height).toBeGreaterThanOrEqual(44);
  await expect(header).toHaveCSS('padding-top', '14px');
  await expect(header).toHaveCSS('padding-right', '16px');
  await expect(header).toHaveCSS('padding-bottom', '56px');
  await expect(header).toHaveCSS('padding-left', '16px');
  const row2 = header.locator('.hdr-row-2');
  if (await row2.count()) {
    await expect(row2).toHaveCSS('margin-top', '10px');
    await expect(row2).toHaveCSS('height', '40px');
    const back = row2.locator('.hdr-back');
    await expect(back).toHaveCSS('font-weight', '700');
    const backBox = await back.boundingBox();
    expect(backBox?.width).toBeGreaterThanOrEqual(44);
    expect(backBox?.height).toBeGreaterThanOrEqual(44);
  }
  if (titleCard) {
    const title = page.locator('.screen > .title-card').first();
    const titleBox = await title.boundingBox();
    expect(titleBox?.y).toBe(112);
    expect(titleBox?.height).toBeGreaterThanOrEqual(83);
    await expect(title).toHaveCSS('box-sizing', 'border-box');
    await expect(title).toHaveCSS('padding-top', titlePadding.top);
    await expect(title).toHaveCSS('padding-right', titlePadding.right);
    await expect(title).toHaveCSS('padding-bottom', titlePadding.bottom);
    await expect(title).toHaveCSS('padding-left', titlePadding.left);
    await expect(title).toHaveCSS('justify-content', 'center');
  }
  await expect(page.locator('.screen > .scroll')).toHaveCount(1);
  await expect(page.locator('.screen > .appbar-block')).toHaveCount(1);
  const appbarBlock = nav.locator('..');
  await expect(appbarBlock).toHaveCSS('position', 'absolute');
  await expect(appbarBlock).toHaveCSS('border-top-left-radius', '24px');
  await expect(appbarBlock).toHaveCSS('border-top-right-radius', '24px');
  expect(await page.locator('.screen').evaluate((screen) => {
    const scroll = screen.querySelector(':scope > .scroll');
    const bar = screen.querySelector(':scope > .appbar-block');
    return Boolean(scroll && bar && scroll.parentElement === bar.parentElement);
  })).toBe(true);
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
  const cuentaTab = page.getByRole('tab', { name: 'Cuenta', exact: true });
  await expect(cuentaTab).toHaveCSS('height', '40px');
  await expect(cuentaTab).toHaveCSS('padding-left', '18px');
  await expect(cuentaTab).toHaveCSS('border-top-left-radius', '12px');
  await expect(page.locator('.btabs')).toHaveCSS('display', 'grid');
  await expect(cuentaTab).toHaveCSS('justify-self', 'start');
  await expect(page.getByRole('tab', { name: 'Estadísticas', exact: true })).toHaveCSS('justify-self', 'center');
  await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toHaveCSS('justify-self', 'end');
  await expect(page.locator('.mounted-card')).toHaveCSS('border-top-left-radius', '0px');

  await page.getByRole('button', { name: 'Avisos', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Notificaciones', exact: true })).toBeVisible();
  const garantiaAgregada = page.locator('.aviso-row--guarantee');
  await expect(garantiaAgregada).toHaveCount(1);
  await expect(garantiaAgregada).toHaveCSS('background-color', 'rgb(251, 231, 227)');
  // v0.142.0 · el CTA privado ya está ratificado, pero el censo captura la
  // pantalla ANTES del toque: lazy significa que ningún nombre ni residual se
  // materializa por renderizar el aviso agregado.
  await expect(garantiaAgregada.getByRole('button', { name: 'Quién no pagó' })).toBeVisible();
  await expect(garantiaAgregada).not.toContainText(/Luis|Valeria|Sin asignar/);
  await acreditar(page, '02-notificaciones');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();

  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
  await acreditar(page, '03-scan');
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?' })).toBeVisible();
  await acreditar(page, '04-division', true, {
    top: '10px', right: '18px', bottom: '12px', left: '18px',
  });
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
  const [noteBox, guaranteeFabBox] = await Promise.all([
    page.locator('.gar-note-fixed').boundingBox(),
    page.locator('.appbar-fab').boundingBox(),
  ]);
  expect((noteBox?.y ?? Infinity) + (noteBox?.height ?? 0)).toBeLessThan(guaranteeFabBox?.y ?? 0);
  await expect(page.locator('.gar-flow-scroll')).toHaveCSS('padding-bottom', '120px');
  await page.getByRole('radio', { name: /Santander.*4532/ }).click();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
  await acreditar(page, '06-compartir');

  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Elige lo que consumiste', { exact: true })).toBeVisible();
  await expect(page.getByText(/queda reservado/)).toHaveCount(0);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await page.getByRole('button', { name: 'Copiar link de invitación', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('Link de invitación copiado ✓');
  await acreditar(page, '07-mis-items');
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await page.getByRole('button', { name: 'Vino tinto (copa)', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte', exact: true })).toBeVisible();
  await expect(page.locator('.title-card.pay-title')).toContainText('Consumos propios · $255.00');
  await acreditar(page, '08-pago');
  await page.getByRole('radio', { name: '5%', exact: true }).click();
  await page.getByRole('button', { name: 'Lupita', exact: true }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!', { exact: true })).toBeVisible();
  await acreditar(page, '09-comprobante');

  await page.goto('/#/mas');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
  await expect(page.locator('.config-card .list-row').first()).toHaveCSS('height', '60px');
  await expect(page.locator('.config-card').getByText('Idioma', { exact: true }).locator('..').locator('svg')).toHaveCount(1);
  await acreditar(page, '10-configuracion');
  await page.goto('/#/mesas');
  await expect(page.getByRole('heading', { name: 'Historial', exact: true })).toBeVisible();
  await acreditar(page, '11-historial');
  await page.goto('/#/estadisticas');
  await expect(page.getByRole('heading', { name: 'Mis estadísticas', exact: true })).toBeVisible();
  await acreditar(page, '12-estadisticas');
});
