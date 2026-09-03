import { expect, test, type Page } from '@playwright/test';
import { ingresar, CORTE } from './_app';

/**
 * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-04) · los recorridos que
 * necesitan el checkout o el alta de tarjeta DUERMEN mientras el gate esté
 * activo, y leen el MISMO gate que la app: el `CORTE` de `_app.ts` sale del
 * decoder de produccion sobre la fuente que el mock sirve, asi que cuando el
 * dueno habilite los pagos vuelven solos, sin editar este archivo. Nunca un skip con `true`
 * fijo: eso es evidencia que no vuelve. `src/corteGuard.test.ts` censa cada
 * uno de estos skips y pone la suite roja ante uno nuevo o permanente.
 */
const MOTIVO = 'CORTE DEL VIERNES: el checkout del participante y el alta de tarjeta están cerrados en producción pública sin pagos; este recorrido vuelve solo cuando el dueño publique los pagos habilitados en money_rail.';

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
  await page.getByRole('tab', { name: /^Solicitudes/ }).click();
  await expect(page.locator('.mounted-card')).toHaveCSS('border-top-left-radius', '22px');
  await expect(page.locator('.mounted-card')).toHaveCSS('border-top-right-radius', '0px');
});

test('Inicio y Social alinean su chrome sin mover pestañas ni burbujas', async ({ page }) => {
  await ingresar(page);
  const centroMarca = async () => {
    const box = await page.locator('.hdr-mark').boundingBox();
    expect(box).not.toBeNull();
    return box!.y + box!.height / 2;
  };

  const centroHome = await centroMarca();
  await page.goto('/#/avisos');
  const centroComun = await centroMarca();
  await page.goto('/#/amigos');
  const centroSocial = await centroMarca();

  expect(Math.abs(centroHome - centroComun)).toBeLessThanOrEqual(1);
  expect(Math.abs(centroSocial - centroComun)).toBeLessThanOrEqual(1);
  await acreditarPestanaMontada(page, 'Amigos');
});

test('el badge de Solicitudes no desplaza la etiqueta y queda anclado arriba-derecha', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/amigos');
  const tabConBadge = page.getByRole('tab', { name: /^Solicitudes/ });
  const badge = tabConBadge.locator('.btab-badge');
  const [antes, badgeBox] = await Promise.all([tabConBadge.boundingBox(), badge.boundingBox()]);
  expect(antes).not.toBeNull();
  expect(badgeBox).not.toBeNull();
  expect(badgeBox!.y).toBeLessThan(antes!.y + antes!.height / 2);
  expect(badgeBox!.x + badgeBox!.width).toBeLessThanOrEqual(antes!.x + antes!.width);

  await tabConBadge.click();
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  const tabSinBadge = page.getByRole('tab', { name: 'Solicitudes', exact: true });
  await expect(tabSinBadge.locator('.btab-badge')).toHaveCount(0);
  const despues = await tabSinBadge.boundingBox();
  expect(despues).not.toBeNull();
  expect(Math.abs(despues!.x - antes!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(despues!.width - antes!.width)).toBeLessThanOrEqual(1);
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
  await expect(card).toHaveCSS('border-top-left-radius', '0px');
  await expect(card).toHaveCSS('border-top-right-radius', '22px');

  await estadisticas.click();
  const estadisticasBox = await estadisticas.boundingBox();
  expect(Math.abs(
    (estadisticasBox!.x + estadisticasBox!.width / 2)
      - (cardBox!.x + cardBox!.width / 2),
  )).toBeLessThanOrEqual(1);
  await expect(card).toHaveCSS('border-top-left-radius', '22px');
  await expect(card).toHaveCSS('border-top-right-radius', '22px');

  await asociadas.click();
  const asociadasBox = await asociadas.boundingBox();
  expect(Math.abs(
    (asociadasBox!.x + asociadasBox!.width)
      - (cardBox!.x + cardBox!.width),
  )).toBeLessThanOrEqual(1);
  await expect(card).toHaveCSS('border-top-left-radius', '22px');
  await expect(card).toHaveCSS('border-top-right-radius', '0px');
  await acreditarPestanaMontada(page, 'Asociadas');
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
  await expect(card).not.toContainText('La Parolaccia');
  expect(cardBox?.height).toBeLessThan(150);
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

test('Notificaciones conserva la invitación sólo en su tarjeta accionable', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/avisos');
  await expect(page.getByText('Notificaciones', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Sumarme', exact: true })).toBeVisible();
  await expect(page.locator('.aviso-row').filter({ hasText: 'Sofía Fernández te invitó a una mesa' }))
    .toHaveCount(0);
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
  /**
   * 🔴 **El testigo va PRIMERO, y el orden no es estilo.**
   *
   * `.gar-cards-group` sólo se renderiza con la superficie de garantía viva, o
   * sea con `money_rail` **ya aplicado** y los pagos habilitados: es un testigo
   * positivo **de la misma capability** que gatea la ausencia de abajo.
   *
   * Estaba al revés, y así la ausencia se afirmaba sobre una pantalla que podía
   * no haber recibido el config todavía: `toHaveCount(0)` se cumple de
   * inmediato, así que pasaba por llegar temprano, no por ser cierta. Es el
   * mismo falso verde que un mutante destapó en `alta-publica` durante F1.
   */
  await expect(page.locator('.gar-cards-group')).toBeVisible();
  await expect(page.getByText('¿Con qué garantizas?', { exact: true })).toHaveCount(0);
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
  test.skip(CORTE.pagosCortados, MOTIVO);
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
