import { expect, test, type Page, type Locator } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { writeFile } from 'node:fs/promises';

async function ticket(page: Page, impreso: number, idioma: 'es' | 'en' = 'es', variante: 'normal' | 'original' | 'baja' = 'normal') {
  await configurarTicketSinQr(page);
  await ingresar(page);
  if (idioma === 'en') {
    await page.goto('/#/mas');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await page.goto('/#/home');
  }
  await page.evaluate(async ({ cents, variante }) => {
    const path = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ path);
    const scan = api.scanTicket.bind(api);
    api.scanTicket = async (...args: unknown[]) => {
      const result = await scan(...args);
      return { ...result, total_detected_cents: cents, items: result.items.map((item: Record<string, unknown>, idx: number) =>
        idx === 2 && variante === 'original' ? { ...item, original_name: 'PIZZA MARG' }
          : idx === 2 && variante === 'baja' ? { ...item, low_confidence: true } : item) };
    };
  }, { cents: impreso, variante });
  await page.getByRole('button', { name: idioma === 'es' ? 'Escanear' : 'Scan', exact: true }).click();
  if (idioma === 'es') await sacarFoto(page);
  else {
    await sacarFoto(page, undefined, { usar: false });
    await page.getByRole('button', { name: 'Use photo', exact: true }).click();
  }
}


async function tabHasta(page: Page, sheet: Locator, target: Locator) {
  for (let n = 0; n < 40; n += 1) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
    expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  throw new Error('Control fuera del recorrido de teclado');
}
async function editar(page: Page, sheet: Locator) {
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Modificar ítems', exact: true }));
  await page.keyboard.press('Enter');
}
async function abrirTercera(page: Page, sheet: Locator) {
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Modificar Pizza Margherita', exact: true }));
  await page.keyboard.press('Enter');
  await expect(sheet.getByLabel('Precio por unidad')).toBeFocused();
}
test('C182D H1 · Eliminar tercera fila conserva la zona y recorre hasta la lista vacía', async ({ page }) => {
  await ticket(page, 84001);
  const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
  await editar(page, sheet);
  await abrirTercera(page, sheet);
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Eliminar', exact: true }));
  await page.keyboard.press('Enter');
  await expect(sheet.getByRole('button', { name: 'Modificar Tiramisú', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(sheet.getByRole('button', { name: 'Modificar Agua mineral', exact: true })).toBeFocused();
  // También el último índice y la última fila: nunca enfocar un nodo desmontado.
  while (await sheet.locator('.tk-pencil').count()) {
    const pencils = sheet.locator('.tk-pencil');
    const count = await pencils.count();
    const previous = count > 1 ? await pencils.nth(count - 2).getAttribute('aria-label') : null;
    await tabHasta(page, sheet, pencils.last());
    await page.keyboard.press('Enter');
    await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Eliminar', exact: true }));
    await page.keyboard.press('Enter');
    if (previous) await expect(sheet.getByRole('button', { name: previous, exact: true })).toBeFocused();
    else await expect(sheet.getByRole('button', { name: 'Agregar consumo', exact: true })).toBeFocused();
  }
});
test('C182D H1 · Usar ese nombre en tercera fila conserva Consumo y el Tab cercano', async ({ page }) => {
  await ticket(page, 84001, 'es', 'original');
  const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
  await editar(page, sheet);
  await abrirTercera(page, sheet);
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Usar ese nombre', exact: true }));
  await page.keyboard.press('Enter');
  await expect(sheet.getByLabel('Consumo', { exact: true })).toBeFocused();
  await expect(sheet.getByLabel('Consumo', { exact: true })).toHaveValue('PIZZA MARG');
  await page.keyboard.press('Tab');
  await expect(sheet.getByLabel('Precio por unidad')).toBeFocused();
});
for (const key of ['Tab', 'Shift+Tab']) {
  test(`C182D H2 · foco forzado desde Volver con ${key}`, async ({ page }) => {
    await ticket(page, 84001);
    const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
    const outside = page.getByRole('button', { name: 'Volver', exact: true });
    await outside.focus();
    await expect(outside).toBeFocused();
    await page.keyboard.press(key);
    expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expect(sheet).toBeVisible();
    const controls = sheet.locator('button:visible:not([disabled]), input:visible:not([disabled]), [tabindex]:visible:not([tabindex="-1"])');
    await expect(key === 'Shift+Tab' ? controls.last() : controls.first()).toBeFocused();
  });
}
test('C182D H3 · Agregar consumo escribe letras en Consumo y el lápiz mantiene precio', async ({ page }) => {
  await ticket(page, 84001);
  const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
  await editar(page, sheet);
  await abrirTercera(page, sheet);
  const precio = sheet.getByLabel('Precio por unidad');
  const before = await precio.inputValue();
  await page.keyboard.type('9');
  await expect(precio).toHaveValue(`${before}9`);
  await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Agregar consumo', exact: true }));
  await page.keyboard.press('Enter');
  const nombre = sheet.getByLabel('Consumo', { exact: true });
  await expect(nombre).toBeFocused();
  await page.keyboard.type('Agua 35');
  await expect(nombre).toHaveValue('Agua 35');
  await expect(precio).toHaveValue('');
});
for (const width of [320, 390]) {
  for (const entrada of ['cuadra', 'reabrir', 'baja', 'grande'] as const) {
    test(`C182D P1 · franja con trinquete ${entrada} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await ticket(page, entrada === 'grande' ? 1234567 : 84000, 'es', entrada === 'baja' ? 'baja' : 'normal');
      const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
      if (entrada !== 'grande') await page.getByRole('button', { name: 'Ver el ticket' }).click();
      if (entrada !== 'baja') await editar(page, sheet);
      if (entrada === 'reabrir') {
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await page.getByRole('button', { name: 'Ver el ticket' }).click();
      }
      await tabHasta(page, sheet, sheet.getByRole('button', { name: 'Modificar Tagliatelle Bolognese', exact: true }));
      await page.keyboard.press('Enter');
      await expect(sheet.getByLabel('Precio por unidad')).toBeFocused();
      const precio = sheet.getByLabel('Precio por unidad');
      const sizes: number[] = [];
      const measure = async () => { sizes.push(await sheet.locator('.ticket-sheet-scroll').evaluate(el => el.clientHeight)); };
      await measure();
      await page.keyboard.press('ControlOrMeta+a');
      for (const key of ['Backspace', ...(entrada === 'grande' ? '12345.67' : '195.00'), 'Backspace', '1', 'Backspace', '0']) {
        if (key === 'Backspace') await page.keyboard.press(key);
        else await page.keyboard.type(key);
        await expect(precio).toBeFocused();
        await measure();
      }
      const changes = sizes.slice(1).filter((height, i) => height !== sizes[i]).length;
      expect(changes).toBeLessThanOrEqual(1);
      for (let i = 1; i < sizes.length; i += 1) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]!);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(124);
      await sheet.getByRole('button', { name: 'Listo', exact: true }).click();
      await expect.poll(() => sheet.locator('.ticket-cuadre-slot').evaluate(el => (el as HTMLElement).style.minHeight)).toBe('');
      const out = process.env.PAYME_C182D_EVIDENCIA;
      if (out) await writeFile(`${out}/recibos/franja-${entrada}-${width}.json`, JSON.stringify({ width, entrada, sizes, changes, improvement: 'parcial: máximo un crecimiento, sin contracción', data: 'mock D542' }, null, 2));
    });
  }
}

for (const idioma of ['es', 'en'] as const) {
  for (const width of [320, 390]) {
    test(`C182E R2 · lápiz fija baja confianza al vaciar precio ${idioma} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await ticket(page, 84001, idioma, 'baja');
      const sheet = page.getByRole('dialog', { name: /(?:Ticket|Receipt) ·/ });
      await expect(sheet).toHaveCount(1);
      await sheet.locator('.tk-pencil').first().click();
      const precio = sheet.getByLabel(idioma === 'es' ? 'Precio por unidad' : 'Price per unit');
      await expect(precio).toBeFocused();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await expect(sheet).toHaveCount(1);
      await expect(precio).toBeFocused();
      await page.keyboard.type('195.01');
      await expect(precio).toHaveValue('195.01');
      await expect(precio).toBeFocused();
      await expect(sheet).toHaveCount(1);
      await expect(sheet.locator('.cuadre-ticket')).toContainText(idioma === 'es' ? 'Cuadra con el ticket' : 'Matches the receipt');
      await expect(page.locator('.tk-fold-head')).not.toBeFocused();
    });
  }
}

for (const idioma of ['es', 'en'] as const) {
  for (const width of [320, 390]) {
    test(`C182F H1 · agregar primero fija la hoja forzada ${idioma} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await ticket(page, 84001, idioma, 'baja');
      const sheet = page.getByRole('dialog', { name: /(?:Ticket|Receipt) ·/ });
      await expect(sheet).toHaveCount(1);
      await expect(sheet.locator('.tk-edit')).toHaveCount(0);
      await sheet.getByRole('button', { name: idioma === 'es' ? 'Agregar consumo' : 'Add item', exact: true }).click();
      await expect(sheet).toHaveCount(1);
      const nombre = sheet.getByLabel(idioma === 'es' ? 'Consumo' : 'Item', { exact: true });
      await expect(nombre).toBeFocused();
      expect(await sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await page.keyboard.type('Agua 35');
      await expect(nombre).toHaveValue('Agua 35');
      await expect(page.locator('.tk-fold-head')).not.toBeFocused();
    });
  }
}
// Universo inicial: ninguna fila expandida; cada lápiz es una entrada de la clase.
for (let index = 0; index < 6; index += 1) {
  test(`C182F clase · primer control lápiz ${index + 1}`, async ({ page }) => {
    await ticket(page, 84001, 'es', 'baja');
    const sheet = page.getByRole('dialog', { name: /Ticket ·/ });
    await expect(sheet.locator('.tk-edit')).toHaveCount(0);
    await expect(sheet.locator('.tk-pencil')).toHaveCount(6);
    await sheet.locator('.tk-pencil').nth(index).click();
    const precio = sheet.getByLabel('Precio por unidad');
    await precio.fill('');
    await expect(sheet).toHaveCount(1);
    await expect(precio).toBeFocused();
  });
}
