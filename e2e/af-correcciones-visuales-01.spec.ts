import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });

async function acreditarPestanaMontada(page: Page, nombre: string) {
  const tab = page.getByRole('tab', { name: nombre, exact: true });
  const card = page.locator('.mounted-card');
  const [tabBox, cardBox] = await Promise.all([tab.boundingBox(), card.boundingBox()]);
  expect(Math.abs((tabBox?.y ?? 0) + (tabBox?.height ?? 0) - (cardBox?.y ?? 0))).toBeLessThanOrEqual(1);
}

test('Inicio y Amigos fusionan la pestaña activa con su tarjeta sin franja navy', async ({ page }) => {
  await ingresar(page);
  await expect(page.locator('.hdr-tabbed > .hdr-row').first()).toHaveCSS('height', '34px');
  await acreditarPestanaMontada(page, 'Cuenta');

  await page.goto('/#/amigos');
  await expect(page.locator('.hdr-tabbed > .hdr-row').first()).toHaveCSS('height', '34px');
  await acreditarPestanaMontada(page, 'Amigos');
});

test('Inicio alinea las tres pestañas con los extremos y el centro de la tarjeta', async ({ page }) => {
  await ingresar(page);
  const card = page.locator('.mounted-card');
  const cuenta = page.getByRole('tab', { name: 'Cuenta', exact: true });
  const estadisticas = page.getByRole('tab', { name: 'Estadísticas', exact: true });
  const asociadas = page.getByRole('tab', { name: 'Asociadas', exact: true });

  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();

  await cuenta.click();
  const cuentaBox = await cuenta.boundingBox();
  expect(Math.abs((cuentaBox?.x ?? 0) - cardBox!.x)).toBeLessThanOrEqual(1);

  await estadisticas.click();
  const estadisticasBox = await estadisticas.boundingBox();
  expect(Math.abs(
    (estadisticasBox!.x + estadisticasBox!.width / 2)
      - (cardBox!.x + cardBox!.width / 2),
  )).toBeLessThanOrEqual(1);

  await asociadas.click();
  const asociadasBox = await asociadas.boundingBox();
  expect(Math.abs(
    (asociadasBox!.x + asociadasBox!.width)
      - (cardBox!.x + cardBox!.width),
  )).toBeLessThanOrEqual(1);
});

test('Escaneo conserva 20 px entre la burbuja y el marco', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  const title = page.locator('.scan-title-card');
  const frame = page.locator('.scan-frame');
  await expect(title).toHaveCSS('margin-bottom', '20px');
  const [titleBox, frameBox] = await Promise.all([title.boundingBox(), frame.boundingBox()]);
  expect((frameBox?.y ?? 0) - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0))).toBeGreaterThanOrEqual(20);
});

test('División muestra un acceso al ticket compacto, centrado y sin subtítulo', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();

  const card = page.locator('.ticket-title-card');
  const trigger = page.getByRole('button', { name: 'Ver el ticket', exact: true });
  await expect(trigger.locator('.tk-fold-sub')).toHaveCount(0);
  const [cardBox, triggerBox] = await Promise.all([card.boundingBox(), trigger.boundingBox()]);
  expect(triggerBox?.width).toBeLessThan(180);
  expect(Math.abs(
    ((cardBox?.x ?? 0) + (cardBox?.width ?? 0) / 2)
      - ((triggerBox?.x ?? 0) + (triggerBox?.width ?? 0) / 2),
  )).toBeLessThanOrEqual(1);
});

test('Configuración retira el cartel demo y conserva reinicio como fila compacta', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/mas');
  await expect(page.getByText(/^Modo demo:/)).toHaveCount(0);
  const reset = page.getByRole('button', { name: 'Reiniciar la demo', exact: true });
  await expect(reset).toBeVisible();
  await expect(reset).toHaveCSS('height', '44px');
});

test('Notificaciones usa un solo título y enfatiza sólo el nombre acreditado', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/avisos');
  await expect(page.getByText('Notificaciones', { exact: true })).toHaveCount(1);
  const invitation = page.locator('.aviso-row').filter({ hasText: 'Sofía Fernández te invitó a una mesa' });
  const name = invitation.locator('strong');
  await expect(name).toHaveText('Sofía Fernández');
  await expect(name).toHaveCSS('font-weight', '700');
  await expect(invitation.locator('.aviso-title')).toHaveCSS('font-weight', '500');
});

async function hastaGarantia(page: Page) {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
  const sumar = page.getByRole('button', { name: 'Un comensal más' });
  for (let i = 0; i < 4; i += 1) await sumar.click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
}

test('Garantía agrupa tarjetas, omite el rótulo redundante y usa flecha', async ({ page }) => {
  await hastaGarantia(page);
  await expect(page.getByText('¿Con qué garantizas?', { exact: true })).toHaveCount(0);
  await expect(page.locator('.gar-cards-group')).toBeVisible();
  await expect(page.locator('.gar-cards-group .gar-method-card')).toHaveCount(2);
  await expect(page.locator('.gar-cards-group .gar-other-card')).toHaveCount(1);
  const fab = page.getByRole('button', { name: 'Garantizar', exact: true });
  await expect(fab.locator('path[d="M4.5 12h15"]')).toHaveCount(1);
});

test('Compartir muestra la composición compacta y el CTA Continuar', async ({ page }) => {
  await hastaGarantia(page);
  await page.getByRole('radio', { name: /Santander.*4532/ }).click();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
  await expect(page.locator('.share-actions')).toHaveCSS('display', 'grid');
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeVisible();
});

test('Pagar separa resumen, propina, método y total sin duplicar el monto', async ({ page }) => {
  await hastaGarantia(page);
  await page.getByRole('radio', { name: /Santander.*4532/ }).click();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await page.getByRole('button', { name: 'Vino tinto (copa)', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  const title = page.locator('.pay-title');
  await expect(title).toContainText('Consumos propios · $255.00');
  await expect(title).not.toContainText('$255.00$255.00');
  await expect(title.locator('.pay-title-amount')).toHaveCount(0);
  await expect(page.locator('.pay-total-card')).toContainText('Total a pagar');
  await page.getByRole('radio', { name: '5%', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lupita', exact: true })).toBeVisible();
  await expect(page.locator('.pay-total-card')).toContainText('$265.50');
});
