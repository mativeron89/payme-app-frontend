import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar } from './_app';

const CAPTURES_DIR = process.env.AF_CAPTURES_DIR;

test.use({ viewport: { width: 414, height: 868 }, deviceScaleFactor: 2 });

async function capturarSiCorresponde(page: Page, nombre: string): Promise<void> {
  if (!CAPTURES_DIR) return;
  mkdirSync(CAPTURES_DIR, { recursive: true });
  const marco = await page.addStyleTag({ content: `
    html, body, #root { width: 100%; height: 100%; overflow: hidden; }
    body { background: #101e3b; }
    .app {
      position: relative;
      width: 390px;
      height: 844px;
      min-height: 844px;
      margin: 12px auto 0;
      overflow: hidden;
      border-radius: 34px;
    }
    .appbar-block {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-width: none;
      transform: none;
    }
  ` });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.scrollingElement?.scrollTo(0, 0);
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.screenshot({
    path: join(CAPTURES_DIR, nombre),
    fullPage: false,
    animations: 'disabled',
  });
  await marco.evaluate((style) => style.parentNode?.removeChild(style));
}

async function abrirTicket(page: Page, conTotalDetectado = false): Promise<void> {
  await page.addInitScript(() => {
    Math.random = () => 0.8088;
  });
  await ingresar(page);
  if (conTotalDetectado) {
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const modulo = await import(/* @vite-ignore */ ruta);
      const scanOriginal = modulo.api.scanTicket.bind(modulo.api);
      modulo.api.scanTicket = async (image?: Blob) => ({
        ...await scanOriginal(image),
        total_detected_cents: 84000,
      });
    });
  }
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?' })).toBeVisible();
}

async function abrirGarantia(page: Page, modo: 'igual' | 'consumo' = 'igual'): Promise<void> {
  await abrirTicket(page);
  await page.getByRole('radio', { name: modo === 'igual' ? /En partes iguales/ : /Por lo que pidió cada uno/ }).click();
  const sumar = page.getByRole('button', { name: 'Un comensal más' });
  const toques = modo === 'igual' ? 3 : 4;
  for (let i = 0; i < toques; i += 1) await sumar.click();
  await expect(page.getByRole('group', { name: '¿Cuántos pagan?' })).toContainText('4');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa', exact: true })).toBeVisible();
}

async function elegirSantander(page: Page): Promise<void> {
  const santander = page.getByRole('radio', { name: /Santander.*4532/ });
  await expect(santander).toBeVisible();
  await santander.click();
}

async function abrirTresDs(page: Page, modo: 'igual' | 'consumo' = 'igual'): Promise<void> {
  await abrirGarantia(page, modo);
  await elegirSantander(page);
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar', exact: true })).toBeVisible();
}

async function abrirCompartir(page: Page, modo: 'igual' | 'consumo' = 'igual'): Promise<void> {
  await abrirTresDs(page, modo);
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
}

async function abrirPago(page: Page): Promise<void> {
  await abrirCompartir(page, 'consumo');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await page.getByRole('button', { name: 'Vino tinto (copa)', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte', exact: true })).toBeVisible();
}

test.describe('AF-DISENO-02 · composición ratificada de las seis pantallas', () => {
  test('Ticket + División compacta la tarjeta y conserva ubicación dentro de la hoja', async ({ page }) => {
    await abrirTicket(page);

    const titulo = page.locator('.title-card').first();
    await expect(page.locator('.demo-strip')).toHaveCount(0);
    await expect(titulo).not.toContainText('La Parolaccia');
    await expect(titulo).not.toContainText('Roma Norte, CDMX');
    await expect(titulo.getByText('$840.00', { exact: true })).toBeVisible();
    await expect(titulo.getByRole('button', { name: /Ver el ticket/ })).toBeVisible();
    await expect(titulo.getByText('$840.00', { exact: true })).toHaveCSS('font-size', '26px');
    await expect(titulo).toHaveCSS('text-align', 'center');

    const stepper = page.locator('.division-stepper');
    await expect(stepper).toContainText('¿Cuántos pagan?');
    await expect(stepper.locator('.division-stepper-title')).toHaveCSS('text-transform', 'uppercase');
    await expect(stepper.locator('svg')).toHaveCount(0);
    await expect(stepper).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(stepper).toHaveCSS('border-top-style', 'dashed');

    const total = page.getByRole('radio', { name: /Pagar el total/ });
    await expect(total.locator('.div-total-icon')).toHaveCount(1);

    const abrir = titulo.getByRole('button', { name: /Ver el ticket/ });
    await abrir.click();
    const dialogo = page.getByRole('dialog', { name: /Ticket ·/ });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByText('La Parolaccia', { exact: true })).toBeVisible();
    await expect(dialogo.getByText('Roma Norte, CDMX', { exact: true })).toBeVisible();
    const [dialogBox, layerBox] = await Promise.all([
      dialogo.boundingBox(),
      page.locator('.ticket-sheet-layer').boundingBox(),
    ]);
    expect((dialogBox?.height ?? Infinity) / (layerBox?.height ?? 1)).toBeLessThanOrEqual(0.581);
    await expect(dialogo.getByText('$840.00', { exact: true })).toHaveCount(0);
    await expect(page.locator('.ticket-flow-scroll')).toHaveCSS('overflow-y', 'hidden');
    await expect(page.getByRole('button', { name: 'Cerrar hoja del ticket' })).toBeFocused();

    // La sheet cubre también la barra (z19). Un toque físico en el centro del
    // FAB cierra por overlay, pero jamás ejecuta Capturar/Continuar ni navega.
    const fabBox = await page.locator('.appbar-fab').boundingBox();
    expect(fabBox).not.toBeNull();
    const urlAntesFab = page.url();
    await page.mouse.click(fabBox!.x + fabBox!.width / 2, fabBox!.y + fabBox!.height / 2);
    await expect(dialogo).toBeVisible();
    expect(page.url()).toBe(urlAntesFab);
    await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialogo).toHaveCount(0);
    await expect(abrir).toBeFocused();

    await abrir.click();
    await dialogo.evaluate((node) => {
      const start = new Touch({ identifier: 1, target: node, clientY: 100 });
      node.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start] }));
      const end = new Touch({ identifier: 1, target: node, clientY: 180 });
      node.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [end] }));
    });
    await expect(dialogo).toHaveCount(0);

    await abrir.click();
    await page.getByRole('button', { name: 'Cerrar ticket tocando fuera' }).click({ position: { x: 4, y: 4 } });
    await expect(dialogo).toHaveCount(0);
    await capturarSiCorresponde(page, '01-ticket-division.png');

  });

  test('un total impreso distinto fuerza la hoja abierta sin cierres falsos', async ({ page }) => {
    await abrirTicket(page, true);
    const abrir = page.getByRole('button', { name: /Ver el ticket/ });
    await abrir.click();
    const dialogo = page.getByRole('dialog', { name: /Ticket ·/ });
    await dialogo.getByRole('button', { name: 'Modificar ítems', exact: true }).click();
    await dialogo.getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();
    await dialogo.getByLabel('Precio por unidad').fill('196');

    await expect(dialogo.getByText(/Checa que el total coincida/)).toContainText('$840.00');
    expect(await dialogo.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await expect(page.getByRole('button', { name: 'Cerrar hoja del ticket' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cerrar ticket tocando fuera' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialogo).toBeVisible();
    await dialogo.focus();
    await page.keyboard.press('Shift+Tab');
    expect(await dialogo.evaluate((node) => node.contains(document.activeElement) && document.activeElement !== node)).toBe(true);
    await dialogo.focus();
    await page.keyboard.press('Tab');
    expect(await dialogo.evaluate((node) => node.contains(document.activeElement) && document.activeElement !== node)).toBe(true);
  });

  test('Garantía usa title-card, opciones compactas y CTA circular sin tocar su gate', async ({ page }) => {
    await abrirGarantia(page);

    const titulo = page.locator('.title-card.gar-title');
    await expect(titulo).toContainText('Se retiene $840.00 hasta que todos paguen');
    const header = page.locator('.hdr-flow');
    const [headerBox, titleBox] = await Promise.all([header.boundingBox(), titulo.boundingBox()]);
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(titleBox!.y).toBeLessThan(headerBox!.y + headerBox!.height);

    const santander = page.getByRole('radio', { name: /Santander.*4532/ });
    await expect(santander.locator('.gar-radio')).toHaveCount(1);
    await expect(santander.locator('.gar-brand-chip')).toContainText('VISA');
    await expect(santander.locator('.gar-card-principal')).toHaveCSS('text-transform', 'uppercase');

    const otra = page.getByRole('radio', { name: /Agregar nueva tarjeta/ });
    await expect(otra).toHaveClass(/gar-other-card/);
    await expect(otra.locator('.radio')).toHaveCount(0);
    await expect(otra.locator('.gar-other-icon')).toHaveCSS('color', 'rgb(10, 123, 128)');

    const [radioBox, chipBox] = await Promise.all([
      santander.locator('.gar-radio').boundingBox(),
      santander.locator('.gar-brand-chip').boundingBox(),
    ]);
    expect(radioBox).not.toBeNull();
    expect(chipBox).not.toBeNull();
    expect(radioBox!.x).toBeLessThan(chipBox!.x);

    const cta = page.getByRole('button', { name: 'Garantizar', exact: true });
    await expect(cta).toHaveClass(/appbar-fab/);
    await expect(cta).toHaveCSS('width', '56px');
    await expect(cta).toHaveCSS('height', '56px');
    const nota = page.locator('.gar-note-fixed');
    await expect(nota).toHaveText('La retención no es un cobro: si todos pagan lo suyo, se libera sola al cerrar la mesa.');
    const [notaBox, appBox] = await Promise.all([nota.boundingBox(), page.locator('.app').boundingBox()]);
    expect(Math.round((appBox?.y ?? 0) + (appBox?.height ?? 0) - (notaBox?.y ?? 0) - (notaBox?.height ?? 0))).toBe(104);
    await elegirSantander(page);
    await expect(cta).toBeEnabled();
    await capturarSiCorresponde(page, '02-garantia.png');
  });

  test('3DS usa Volver, espera visible, tarjeta elegida y rótulo Confirmar', async ({ page }) => {
    await abrirTresDs(page);

    const urlAntesDeAvisos = page.url();
    await page.getByRole('button', { name: 'Avisos', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Termina este paso para abrir tus avisos.');
    expect(page.url()).toBe(urlAntesDeAvisos);

    await expect(page.getByRole('button', { name: 'Volver', exact: true })).toBeVisible();
    const espera = page.locator('.tds-espera');
    await expect(espera).toContainText('Esperando a tu banco');
    await expect(espera).toContainText('No cierres la app: la confirmación se abre en un momento.');
    await expect(espera).toHaveAttribute('aria-busy', 'false');
    await expect(espera).toHaveAttribute('aria-live', 'off');
    await expect(espera).not.toHaveAttribute('role', 'status');
    await expect(espera.locator('.spinner')).toBeVisible();

    const tarjeta = page.locator('.tds-card');
    await expect(tarjeta.locator('.gar-brand-chip')).toContainText('VISA');
    await expect(tarjeta).toContainText('Santander ···· 4532');
    await expect(tarjeta).toContainText('La tarjeta que elegiste para garantizar');
    const confirmar = page.getByRole('button', { name: 'Confirmar', exact: true });
    await expect(confirmar).toHaveClass(/appbar-fab/);
    await capturarSiCorresponde(page, '03-confirma-banco.png');

    // La tarjeta está siempre por composición, pero sólo se vuelve live-region
    // cuando hay una confirmación real en vuelo. Se deja la promesa pendiente
    // para medir ese estado sin afirmar un resultado del banco.
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const modulo = await import(/* @vite-ignore */ ruta);
      modulo.api.confirmGuarantee3ds = () => new Promise(() => undefined);
    });
    await confirmar.click();
    await expect(espera).toHaveAttribute('aria-busy', 'true');
    await expect(espera).toHaveAttribute('aria-live', 'polite');
    await expect(espera).toHaveAttribute('role', 'status');
  });

  test('Compartir rotula el código, copia el link completo y conserva la salida segura a Inicio', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await abrirCompartir(page);

    await expect(page.getByRole('button', { name: 'Ir a Inicio', exact: true })).toBeVisible();
    const credencial = page.locator('.share-card');
    await expect(credencial.locator('.share-code-label')).toHaveCSS('display', 'none');
    await expect(credencial.locator('.share-code-help')).toHaveCSS('display', 'none');
    const codigo = credencial.locator('.share-code');
    await expect(codigo).toHaveAttribute('type', 'button');
    await expect(codigo).toBeEnabled();
    const copiar = page.getByRole('button', { name: 'Copiar link', exact: true });
    const whatsapp = page.locator('.share-wa');
    await expect(whatsapp).toHaveAttribute('href', /wa\.me/);
    const href = await whatsapp.getAttribute('href');
    expect(href, 'WhatsApp no transporta el link de invitación').not.toBeNull();
    const textoCompartido = decodeURIComponent(new URL(href!).searchParams.get('text') ?? '');
    const link = textoCompartido.match(/https?:\/\/\S+/)?.[0] ?? '';
    expect(link).toContain('#/mesa/PA-');
    expect(link).toContain('?t=');

    await expect(page.getByText('Sofía Fernández', { exact: true })).toBeVisible();
    const amigosTab = page.getByRole('tab', { name: 'Amigos', exact: true });
    const gruposTab = page.getByRole('tab', { name: 'Grupos', exact: true });
    await expect(amigosTab).toHaveAttribute('aria-selected', 'true');
    await expect(gruposTab).toHaveAttribute('aria-selected', 'false');
    await expect(page.getByRole('tabpanel')).toHaveCount(1);
    await expect(page.getByPlaceholder('Buscar por nombre o ID')).toBeVisible();
    await gruposTab.click();
    await expect(gruposTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByPlaceholder('Buscar grupo por nombre')).toBeVisible();
    await expect(page.getByRole('button', { name: /Familia/ })).toBeVisible();
    await expect(credencial.locator('.share-code-txt')).toHaveCSS('font-size', '26px');
    await expect(credencial.locator('.share-code-txt')).toHaveCSS('letter-spacing', '4.16px');
    await expect(copiar).toHaveCSS('color', 'rgb(10, 123, 128)');
    await expect(copiar).toHaveCSS('border-top-style', 'solid');
    const barra = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(barra).toBeVisible();
    await expect(barra.locator('[aria-current="page"]')).toHaveCount(0);
    await expect(barra.getByRole('button', { name: 'Continuar', exact: true })).toBeVisible();
    await capturarSiCorresponde(page, '04-compartir.png');

    await codigo.click();
    await expect(page.getByRole('status')).toHaveText('Link de invitación copiado ✓');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });

  test('Pagar centra el título, contiene destinatario y usa tarjeta en el CTA', async ({ page }) => {
    await abrirPago(page);

    await expect(page.getByRole('button', { name: 'Volver', exact: true })).toBeVisible();
    const titulo = page.locator('.title-card.pay-title');
    await page.getByRole('radio', { name: '5%', exact: true }).click();
    await expect(titulo).toContainText('Pagar mi parte');
    await expect(titulo).toContainText('Consumos propios · $255.00');
    await expect(titulo).not.toContainText('La Parolaccia');
    await expect(titulo.locator('.pay-title-amount')).toHaveCount(0);
    await expect(page.locator('.pay-total-card')).toContainText('$265.50');

    const [headerBox, titleBox] = await Promise.all([
      page.locator('.hdr-flow').boundingBox(),
      titulo.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(titleBox!.y).toBeLessThan(headerBox!.y + headerBox!.height);

    const destinatario = page.locator('.tip-recipient-card');
    await expect(destinatario).toContainText('¿Para quién?');
    await expect(destinatario.locator('.sectlabel')).toHaveCSS('text-transform', 'uppercase');

    const pagar = page.getByRole('button', { name: 'Pagar', exact: true });
    await expect(pagar.locator('svg')).toHaveCount(1);
    await expect(pagar.locator('path').first()).toHaveAttribute('d', 'M3 6.5h18v11H3z');
    await capturarSiCorresponde(page, '05-pagar-parte.png');
  });

  test('Comprobante solapa el cierre, rotula la tarjeta y conserva sus acciones', async ({ page }) => {
    await abrirPago(page);
    await page.getByRole('radio', { name: '5%', exact: true }).click();
    await page.getByRole('button', { name: 'Lupita', exact: true }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();

    const cierre = page.locator('.title-card.recibo-cierre');
    await expect(cierre).toContainText('¡Listo!');
    await expect(cierre).toContainText('Pagaste tu parte de la mesa');
    await expect(page.getByRole('button', { name: 'Volver', exact: true })).toBeVisible();
    const comprobante = page.locator('.recibo-card');
    await expect(comprobante.locator('.success-circle')).toHaveCount(1);
    await expect(comprobante).toContainText('Comprobante');
    await expect(comprobante.locator('.recibo-label')).toHaveCSS('text-transform', 'uppercase');
    await expect(comprobante.getByText('Total pagado', { exact: true })).toHaveCount(1);
    await expect(comprobante).toContainText('PA-8279');
    await expect(comprobante).toContainText('Santander ···· 4532');
    await expect(comprobante).toContainText('$255.00');
    await expect(comprobante).toContainText('Propina (5% · Lupita)');
    await expect(comprobante).toContainText('$10.50');
    await expect(comprobante).toContainText('$265.50');
    await expect(page.getByText('$265.50', { exact: true })).toHaveCount(1);
    await expect(comprobante.getByRole('button', { name: 'Enviar', exact: true })).toBeVisible();
    await expect(comprobante.getByRole('button', { name: 'Descargar', exact: true })).toBeVisible();
    await expect(page.locator('.demo-strip')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const [headerBox, closeBox] = await Promise.all([
      page.locator('.receipt-screen > .hdr').boundingBox(),
      cierre.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect(closeBox!.y).toBeLessThan(headerBox!.y + headerBox!.height);
    await capturarSiCorresponde(page, '06-comprobante.png');
  });
});
