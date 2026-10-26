import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * D464 · D465 · D466 · la foto del ticket: la miniatura en la fila de Mesas (A)
 * y el visor a pantalla completa (E), APAGADOS. Mati: «Vamos por AE».
 *
 * - 🔴 Sin la capacidad (el backend de hoy, sin el seam): la pantalla de
 *   siempre, sin botones nuevos ni el aviso del escaneo.
 * - Con el seam `payme.app.mock.ticket_image.v1 = encendido` (90 días +
 *   miniatura, D465) y `mis_mesas = sin_cobro`, los tres estados: Café Tacuba
 *   con la foto completa, Tacos El Güero con sólo la miniatura (la completa «se
 *   borró a los 90 días») y la mesa del seed sin foto (el ícono de siempre).
 *
 * El reloj fijo (13 de octubre de 2026) deja a las dos mesas con foto en el
 * mismo mes. Capturas sólo con `PAYME_E2E_CAPTURAS`.
 */

const SEAM = 'payme.app.mock.ticket_image.v1';
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/foto-ticket-${page.viewportSize()!.width}-${nombre}.png`, animations: 'disabled' });
}

async function entrar(page: Page, foto: 'encendido' | 'apagado' | null, extra: Record<string, string> = {}): Promise<void> {
  await page.addInitScript(({ seam, foto: f, extra: e }) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro');
    if (f) localStorage.setItem(seam, f);
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, { seam: SEAM, foto, extra });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

const tusMesas = (page: Page) => page.getByRole('region', { name: 'Tus mesas' });
const filaDe = (page: Page, nombre: string) => tusMesas(page).locator('.tu-mesa').filter({ hasText: nombre });
const fotoDe = (page: Page, nombre: string) => page.getByRole('button', { name: `Ver la foto del ticket de ${nombre}`, exact: true });

async function imagenCargada(img: Locator): Promise<void> {
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

async function altoDeLaFila(fila: Locator): Promise<number> {
  // D481 · 2a · la fila nueva (`button.fila-ticket`), sin desplegable.
  return (await fila.locator('button.fila-ticket').boundingBox())!.height;
}

test.describe('🔴 D466 · apagado: la app de siempre', () => {
  test('sin el seam (el backend de hoy): ni miniaturas ni visor ni el aviso del escaneo', async ({ page }) => {
    await entrar(page, null);
    await page.goto('/#/mesas');
    await expect(filaDe(page, 'Café Tacuba')).toBeVisible();
    await expect(page.locator('.fila-ticket-foto, .miniatura-ticket')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Ver la foto del ticket/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    await expect(page.getByText('PayMe guarda la foto de este ticket', { exact: false })).toHaveCount(0);
  });

  test('con el bloque del dueño apagado (su constante en false), igual', async ({ page }) => {
    await entrar(page, 'apagado');
    await page.goto('/#/mesas');
    await expect(filaDe(page, 'Café Tacuba')).toBeVisible();
    await expect(page.locator('.fila-ticket-foto')).toHaveCount(0);
  });
});

test.describe('D466 · A + E · encendido (mock)', () => {
  test('🔴 A · la miniatura reemplaza al ícono con la misma altura de fila; sin foto, el ícono', async ({ page }) => {
    // Sin el seam en el init script: así el cambio de abajo sobrevive a la recarga.
    await entrar(page, null);
    await page.goto('/#/mesas');
    const altoSinFoto = await altoDeLaFila(filaDe(page, 'Café Tacuba'));

    await page.evaluate((seam) => localStorage.setItem(seam, 'encendido'), SEAM);
    await page.reload();
    await expect(fotoDe(page, 'Café Tacuba')).toBeVisible();
    await imagenCargada(fotoDe(page, 'Café Tacuba').locator('img'));
    await imagenCargada(fotoDe(page, 'Tacos El Güero').locator('img'));
    expect(Math.abs(await altoDeLaFila(filaDe(page, 'Café Tacuba')) - altoSinFoto)).toBeLessThanOrEqual(1);

    // La mesa del seed, sin foto (cargada a mano): el ícono en la misma columna, sin botón de foto.
    const sinFoto = tusMesas(page).locator('.tu-mesa').filter({ hasNot: page.locator('.fila-ticket-foto') }).first();
    await expect(sinFoto.locator('.fila-ticket-columna svg')).toBeVisible();
    await capturar(page, 'a-mesas');

    // D481 · tocar el resto de la fila ya no la despliega: abre la pantalla del ticket (3b), no el visor.
    const fila = filaDe(page, 'Café Tacuba').locator('button.fila-ticket');
    await expect(fila).not.toHaveAttribute('aria-expanded', /.*/);
    await fila.click({ position: { x: 200, y: 20 } });
    await expect(page.getByRole('heading', { level: 1, name: 'Café Tacuba' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('🔴 E · el visor: foco, flechas, deslizar, zoom, la foto vencida, «Ver consumos» y Escape', async ({ page }) => {
    await entrar(page, 'encendido');
    await page.goto('/#/mesas');
    const foto = fotoDe(page, 'Café Tacuba');
    await imagenCargada(foto.locator('img'));
    await foto.click();

    await expect(page.getByRole('dialog', { name: /^Ticket 2 de 2 · / })).toBeVisible();
    // El nombre del diálogo cambia al pasar de ticket: de acá en más, el diálogo a secas.
    const visor = page.getByRole('dialog');
    await expect(visor.getByRole('button', { name: 'Cerrar' }).first()).toBeFocused();
    const imagen = visor.getByRole('img', { name: 'Foto del ticket de Café Tacuba' });
    // La completa (primero se ve la miniatura, mientras llega).
    await expect(imagen).toHaveAttribute('data-tamano', 'full');
    await imagenCargada(imagen);
    await expect(visor.getByText('La foto completa se borró', { exact: false })).toHaveCount(0);
    await expect(visor).toContainText('Café Tacuba');
    await capturar(page, 'e-visor');

    // ← el ticket anterior del mes: Tacos El Güero, sólo con la miniatura (D465, 90 días).
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('dialog', { name: /^Ticket 1 de 2 · / })).toBeVisible();
    const vencida = visor.getByRole('img', { name: 'Foto del ticket de Tacos El Güero' });
    await imagenCargada(vencida);
    await expect(vencida).toHaveAttribute('data-tamano', 'thumb');
    await expect(visor.getByText('La foto completa se borró a los 90 días.', { exact: true })).toBeVisible();
    await capturar(page, 'e-vencida');

    // Deslizar a la izquierda: el siguiente.
    const escenario = visor.locator('.visor-ticket-escenario');
    const caja = (await escenario.boundingBox())!;
    const y = caja.y + caja.height / 2;
    await page.mouse.move(caja.x + caja.width * 0.8, y);
    await page.mouse.down();
    await page.mouse.move(caja.x + caja.width * 0.5, y, { steps: 5 });
    await page.mouse.move(caja.x + caja.width * 0.2, y, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: /^Ticket 2 de 2 · / })).toBeVisible();

    // Doble toque: acerca; otro doble toque: vuelve.
    await page.mouse.dblclick(caja.x + caja.width / 2, y);
    await expect(imagen).toHaveAttribute('style', /scale\(2\.5\)/);
    await page.mouse.dblclick(caja.x + caja.width / 2, y);
    await expect(imagen).toHaveAttribute('style', /scale\(1\)/);

    // Escape cierra y el foco vuelve a la miniatura.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(foto).toBeFocused();

    // D481 · 1h · «Ver consumos»: el detalle digital de esa mesa se abre ENCIMA del visor; su ✕ vuelve a la foto, con el
    // foco en «Ver consumos». Cerrar el visor devuelve el foco a la miniatura.
    await foto.click();
    const verConsumos = page.getByRole('dialog').getByRole('button', { name: 'Ver consumos', exact: true });
    await verConsumos.click();
    const detalle = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
    await expect(detalle).toContainText('Chilaquiles');
    await expect(page.getByRole('dialog')).toHaveCount(2);
    await detalle.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(verConsumos).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(foto).toBeFocused();
  });

  test('el escaneo avisa que la foto se guarda (texto provisorio)', async ({ page }) => {
    await entrar(page, 'encendido');
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    await expect(page.getByText('PayMe guarda la foto de este ticket para que la veas después en Mesas.', { exact: true })).toBeVisible();
    await capturar(page, 'escaneo-aviso');
  });

  test('a 1280×720: la foto entra en la pantalla y las flechas se ven', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await entrar(page, 'encendido');
    await page.goto('/#/mesas');
    await capturar(page, 'a-mesas');
    await fotoDe(page, 'Tacos El Güero').click();
    await expect(page.getByRole('dialog', { name: /^Ticket 1 de 2 · / })).toBeVisible();
    const visor = page.getByRole('dialog');
    const imagen = visor.getByRole('img', { name: 'Foto del ticket de Tacos El Güero' });
    await imagenCargada(imagen);
    const caja = (await imagen.boundingBox())!;
    expect(caja.y).toBeGreaterThanOrEqual(0);
    expect(caja.y + caja.height).toBeLessThanOrEqual(720);
    await expect(visor.getByRole('button', { name: 'Ticket siguiente', exact: true })).toBeVisible();
    await expect(visor.getByRole('button', { name: 'Ticket anterior', exact: true })).toHaveCount(0);
    await visor.getByRole('button', { name: 'Ticket siguiente', exact: true }).click();
    await expect(page.getByRole('dialog', { name: /^Ticket 2 de 2 · / })).toBeVisible();
    await capturar(page, 'e-visor');
  });

  test('en inglés', async ({ page }) => {
    await entrar(page, 'encendido');
    // El idioma, después de entrar (el formulario de ingreso se busca en español).
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.goto('/#/mesas');
    // Cambiar sólo el fragmento no recarga: el idioma se lee al arrancar.
    await page.reload();
    const foto = page.getByRole('button', { name: 'See the receipt photo from Café Tacuba', exact: true });
    await expect(foto).toBeVisible();
    await page.getByRole('button', { name: 'See the receipt photo from Tacos El Güero', exact: true }).click();
    const visor = page.getByRole('dialog', { name: /^Receipt 1 of 2 · / });
    await expect(visor.getByText('The full photo was deleted after 90 days.', { exact: true })).toBeVisible();
    await expect(visor.getByRole('button', { name: 'See items', exact: true })).toBeVisible();
    // D481 · 1d · la vencida no se acerca: sin la píldora del zoom. La completa (el siguiente), con la píldora.
    await expect(visor.locator('.visor-ticket-pista')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('dialog', { name: /^Receipt 2 of 2 · / }).locator('.visor-ticket-pista'))
      .toHaveText('Pinch or double-tap to zoom.');
    await capturar(page, 'e-visor-en');
  });
});

test.describe('D466 · E · el ticket de un viaje', () => {
  test('con foto: el botón debajo del título abre el visor; «Ver consumos» vuelve al ticket', async ({ page }) => {
    await entrar(page, 'encendido', { 'payme.app.mock.viajes.v1': 'encendido' });
    await page.goto(`/viaje-ticket/${CANCUN}.${MARISCOS}`);
    const boton = page.getByRole('button', { name: 'Ver la foto del ticket', exact: true });
    await expect(boton).toBeVisible();
    await imagenCargada(boton.locator('img'));
    await capturar(page, 'viaje-ticket');
    await boton.click();
    const visor = page.getByRole('dialog', { name: 'Foto del ticket' });
    await expect(visor).toBeVisible();
    await imagenCargada(visor.getByRole('img', { name: /^Foto del ticket de / }));
    await expect(visor.getByRole('button', { name: 'Ticket siguiente' })).toHaveCount(0);
    await capturar(page, 'viaje-visor');
    await visor.getByRole('button', { name: 'Ver consumos', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(boton).toBeFocused();
  });

  test('🔴 sin la capacidad, el ticket de siempre', async ({ page }) => {
    await entrar(page, null, { 'payme.app.mock.viajes.v1': 'encendido' });
    await page.goto(`/viaje-ticket/${CANCUN}.${MARISCOS}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver la foto del ticket', exact: true })).toHaveCount(0);
  });
});
