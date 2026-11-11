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
