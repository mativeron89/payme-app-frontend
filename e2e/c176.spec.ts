import { expect, test, type Page, type Locator } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { writeFile } from 'node:fs/promises';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

async function ticket(page: Page, impreso: number, idioma: 'es' | 'en' = 'es') {
  await configurarTicketSinQr(page);
  await ingresar(page);
  if (idioma === 'en') {
    await page.goto('/#/mas');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.goto('/#/home');
  }
  await page.evaluate(async (cents) => {
    const path = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ path);
    const scan = api.scanTicket.bind(api);
    api.scanTicket = async (...args: unknown[]) => ({ ...await scan(...args), total_detected_cents: cents });
  }, impreso);
  await page.getByRole('button', { name: idioma === 'es' ? 'Escanear' : 'Scan', exact: true }).click();
  if (idioma === 'es') await sacarFoto(page);
  else {
    await sacarFoto(page, undefined, { usar: false });
    await page.getByRole('button', { name: 'Use photo', exact: true }).click();
  }
}

async function borrarConTeclado(page: Page, sheet: Locator, precio: Locator) {
  await precio.click();
  // Fijar sólo el cursor: en macOS End desplaza la página, no el caret.
  await precio.evaluate((input: HTMLInputElement) => input.setSelectionRange(input.value.length, input.value.length));
  for (const esperado of ['195.0', '195.', '195', '19', '1', '']) {
    await page.keyboard.press('Backspace');
    await expect(sheet).toBeVisible();
    await expect(precio).toBeFocused();
    await expect(precio).toHaveValue(esperado);
  }
}

for (const forzada of [true, false]) {
  test(`C176 · teclado conserva hoja y foco ${forzada ? 'forzada' : 'abierta por la persona'}`, async ({ page }) => {
    await ticket(page, forzada ? 84001 : 84000);
    if (!forzada) await page.getByRole('button', { name: 'Ver el ticket' }).click();
    const sheet = page.getByRole('dialog', { name: /(?:Ticket|Receipt) ·/ });
    await sheet.getByRole('button', { name: forzada ? /Corregir (consumos a mano|a mano)/ : 'Modificar ítems', exact: true }).click();
    await sheet.getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();
    const precio = sheet.getByLabel('Precio por unidad');
    await borrarConTeclado(page, sheet, precio);
    const nuevo = forzada ? '195.01' : '195.00';
    for (const tecla of nuevo) {
      await page.keyboard.type(tecla);
      await expect(precio).toBeFocused();
      await expect(sheet).toBeVisible();
    }
    await expect(precio).toHaveValue(nuevo);
    await expect(sheet.locator('.cuadre-ticket')).toHaveClass(/cuadre-ticket--cuadra/);
    await expect(sheet.locator('.cuadre-ticket')).toContainText('Cuadra con el ticket');
    await sheet.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await expect(sheet).toHaveCount(0);
  });
}

for (const idioma of ['es', 'en'] as const) {
  for (const width of [320, 390]) {
    test(`C176 · salidas apiladas sin recortes ${idioma} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await ticket(page, 84001, idioma);
      const sheet = page.getByRole('dialog', { name: /(?:Ticket|Receipt) ·/ });
      const foto = sheet.getByRole('button', { name: idioma === 'es' ? 'Sacar otra foto' : 'Take another photo', exact: true });
      const corregir = sheet.getByRole('button', { name: idioma === 'es' ? 'Corregir a mano' : 'Fix it manually', exact: true });
      await expect(foto).toBeVisible();
      await expect(corregir).toBeVisible();
      await expect(sheet.getByText(idioma === 'es'
        ? 'Para continuar, corrige los consumos o saca otra foto.'
        : 'To continue, fix the items or take another photo.', { exact: true })).toBeVisible();
      await expect(foto.locator('svg')).toHaveCount(1);
      await expect(corregir.locator('svg')).toHaveCount(1);
      const medidas = await sheet.evaluate((el) => {
        const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; };
        const recovery = el.querySelector('.ticket-recovery')!;
        return { sheet:rect(el), franja:rect(el.querySelector('.cuadre-ticket')!), recovery:rect(recovery),
          buttons:[...recovery.querySelectorAll('button')].map((b) => ({...rect(b),scrollWidth:b.scrollWidth,clientWidth:b.clientWidth})),
          overflow:el.scrollWidth-el.clientWidth, viewport: {width:innerWidth,height:innerHeight} };
      });
      expect(medidas.overflow).toBe(0);
      expect(medidas.recovery.y).toBeGreaterThanOrEqual(medidas.franja.bottom - 1);
      const [a,b] = medidas.buttons;
      expect(a!.x).toBeGreaterThan(medidas.sheet.x);
      expect(a!.right).toBeLessThan(medidas.sheet.right);
      expect(a!.x).toBe(b!.x);
      expect(a!.width).toBe(b!.width);
      expect(a!.height).toBeGreaterThanOrEqual(44);
      expect(b!.height).toBeGreaterThanOrEqual(44);
      expect(b!.y).toBeGreaterThanOrEqual(a!.bottom);
      expect(b!.bottom).toBeLessThanOrEqual(medidas.viewport.height);
      for (const button of medidas.buttons) expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
      const evidencia = process.env.PAYME_C176_EVIDENCIA;
      if (evidencia) {
        await page.screenshot({ path: `${evidencia}/capturas/hoja-${idioma}-${width}.png`, fullPage: true });
        await writeFile(`${evidencia}/recibos/layout-${idioma}-${width}.json`, `${JSON.stringify(medidas,null,2)}\n`);
      }
    });
  }
}


/** C179: desde que aparece la hoja, sólo teclas; cada paso mantiene el foco modal. */
async function focoDentro(sheet: Locator) {
  await expect(sheet).toHaveCount(1);
  expect(await sheet.evaluate((el) => el.contains(document.activeElement)
    && document.activeElement !== document.body)).toBe(true);
}
async function tecla(page: Page, sheet: Locator, key: string) {
  await page.keyboard.press(key);
  await focoDentro(sheet);
}
async function tabHasta(page: Page, sheet: Locator, destino: Locator) {
  for (let i = 0; i < 30; i += 1) {
    if (await destino.evaluate((el) => el === document.activeElement)) return;
    await tecla(page, sheet, 'Tab');
  }
  throw new Error('El control no se alcanzó dentro de la hoja');
}
async function escribirPrecio(page: Page, sheet: Locator, texto: string) {
  const precio = sheet.getByLabel('Precio por unidad');
  await expect(precio).toBeFocused();
  await tecla(page, sheet, 'ControlOrMeta+a');
  await tecla(page, sheet, 'Backspace');
  for (const char of texto) {
    await page.keyboard.type(char);
    await focoDentro(sheet);
    await expect(precio).toBeFocused();
    await expect(sheet.locator('.ticket-recovery')).toBeHidden();
  }
  await expect(precio).toHaveValue(texto);
}
for (const entrada of ['Corregir a mano', 'Modificar ítems']) {
  test(`C179 · sólo teclado por ${entrada} hasta Cuadra y Listo`, async ({ page }) => {
    await ticket(page, 84001);
    const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
    await expect(sheet).toBeVisible();
    await focoDentro(sheet);
    await tabHasta(page, sheet, sheet.getByRole('button', { name: entrada, exact: true }));
    await tecla(page, sheet, 'Enter');
    await expect(sheet.locator('.ticket-recovery')).toBeHidden();
    await tecla(page, sheet, 'Tab');
    await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Modificar Tagliatelle Bolognese', exact: true }));
    await tecla(page, sheet, 'Enter');
    await escribirPrecio(page, sheet, '195.01');
    await expect(sheet.locator('.cuadre-ticket')).toContainText('Cuadra con el ticket');
    await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Listo', exact: true }));
    await tecla(page, sheet, 'Enter');
    await expect(sheet).toBeVisible();
  });
}

test('C179 · Escape forzado usa el estado actual y después cuadra sin desmontar', async ({ page }) => {
  await ticket(page, 84000);
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
  await focoDentro(sheet);
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Modificar ítems', exact: true }));
  await tecla(page, sheet, 'Enter');
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Modificar Tagliatelle Bolognese', exact: true }));
  await tecla(page, sheet, 'Enter');
  await escribirPrecio(page, sheet, '195.01');
  await expect(sheet.locator('.cuadre-ticket')).toHaveClass(/no-cuadra/);
  await tecla(page, sheet, 'Escape');
  await escribirPrecio(page, sheet, '195.00');
  await expect(sheet.locator('.cuadre-ticket')).toContainText('Cuadra con el ticket');
  await expect(sheet).toBeVisible();
  await focoDentro(sheet);
});

test('C179 · tercera fila conserva su precio y el Tab externo vuelve al diálogo', async ({ page }) => {
  await ticket(page, 84001);
  const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Corregir a mano', exact: true }));
  await tecla(page, sheet, 'Enter');
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Modificar Pizza Margherita', exact: true }));
  await tecla(page, sheet, 'Enter');
  const precio = sheet.getByLabel('Precio por unidad');
  await expect(precio).toBeFocused();
  const antes = await precio.inputValue();
  await page.keyboard.type('9');
  await focoDentro(sheet);
  await expect(precio).toHaveValue(`${antes}9`);
  await tecla(page, sheet, 'Tab');
  await expect(sheet.getByRole('button', { name: /Una unidad menos de Pizza/ })).toBeFocused();
  // Sonda defensiva: simula una pérdida de foco externa y mide ambos sentidos.
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await tecla(page, sheet, 'Tab');
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await tecla(page, sheet, 'Shift+Tab');
});

for (const idioma of ['es', 'en'] as const) {
  for (const width of [320, 390]) {
    test(`C179 · edición estable ${idioma} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await ticket(page, 84001, idioma);
      const sheet = page.getByRole('dialog', { name: /(?:Ticket|Receipt) ·/ });
      await tabHasta(page, sheet, sheet.getByRole('button', { name: idioma === 'es' ? 'Corregir a mano' : 'Fix it manually', exact: true }));
      await tecla(page, sheet, 'Enter');
      await tabHasta(page, sheet, sheet.getByRole('button', { name: /^(Modificar|Edit) Tagliatelle Bolognese$/ }));
      await tecla(page, sheet, 'Enter');
      await expect(sheet.locator('input.amt')).toBeFocused();
      await expect(sheet.locator('.ticket-recovery')).toBeHidden();
      const area = await sheet.locator('.ticket-sheet-scroll').evaluate((el) => el.clientHeight);
      expect(area).toBeGreaterThanOrEqual(124);
      await tecla(page, sheet, 'ControlOrMeta+a');
      await tecla(page, sheet, 'Backspace');
      await expect(sheet.locator('.ticket-recovery')).toBeHidden();
      const vacia = await sheet.locator('.ticket-sheet-scroll').evaluate((el) => el.clientHeight);
      expect(vacia).toBe(area);
      const out = process.env.PAYME_C179_EVIDENCIA;
      for (const char of '195.01') {
        await page.keyboard.type(char);
        await focoDentro(sheet);
        await expect(sheet.locator('.ticket-recovery')).toBeHidden();
      }
      if (out) {
        await page.screenshot({ path: `${out}/capturas/edicion-${idioma}-${width}.png`, fullPage: true });
        await writeFile(`${out}/recibos/edicion-${idioma}-${width}.json`, JSON.stringify({ idioma, width, area, vacia,
          final: await sheet.locator('.ticket-sheet-scroll').evaluate((el) => el.clientHeight), datos: 'mock sintético D542' }, null, 2));
      }
    });
  }
}
