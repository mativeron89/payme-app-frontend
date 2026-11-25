import { expect, test, type Page } from '@playwright/test';
import type { CreateMesaRequest } from '../src/api/types';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

const original = 'SOPA DE FID';
const sugerido = 'Sopa de fideo';
const recibo = 'or1.ticket-sintetico-f2';

async function leer(page: Page, en: boolean, conSugerencia: boolean) {
  await page.route(/^https?:\/\//, route => {
    const host = new URL(route.request().url()).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
  });
  await configurarTicketSinQr(page);
  await ingresar(page);
  if (en) {
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
  }
  // Fixture en el límite del OCR. El test de transporte ejercita la negociación
  // y el decoder real. Acá la app arma la apertura con el nombre elegido.
  const aperturas: CreateMesaRequest[] = [];
  await page.exposeFunction('observarAperturaF2', (body: CreateMesaRequest) => aperturas.push(body));
  await page.evaluate(async (datos) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    api.scanTicket = async () => ({
      contract_version: 2, mock: false, warnings: [], total_cents: 2000, receipt: datos.recibo,
      items: [
        { name: datos.original, original_name: datos.original, price_cents: 1500, quantity: 1, category: 'other',
          ...(datos.conSugerencia && { suggested_name: datos.sugerido }) },
        { name: 'Agua', original_name: 'Agua', price_cents: 500, quantity: 1, category: 'other' },
      ],
    });
    const crear = api.createMesa.bind(api);
    api.createMesa = async (body, intento) => {
      await (window as unknown as { observarAperturaF2(b: CreateMesaRequest): Promise<void> }).observarAperturaF2(body);
      return crear(body, intento);
    };
  }, { original, sugerido, recibo, conSugerencia });

  await page.getByRole('button', { name: en ? 'Scan' : 'Escanear', exact: true }).click();
  await sacarFoto(page, undefined, { usar: false });
  await page.getByRole('button', { name: en ? 'Use photo' : 'Usar foto', exact: true }).click();
  await page.getByRole('button', { name: en ? 'View the receipt' : 'Ver el ticket' }).click();
  return aperturas;
}

for (const caso of ['aceptar', 'aceptar desde el lápiz', 'editar después', 'escribir primero', 'ignorar', 'sin sugerencia'] as const) {
  test(`C283-F2 · ${caso} conserva el recibo y los demás consumos`, async ({ page }) => {
    const en = caso === 'editar después';
    const aperturas = await leer(page, en, caso !== 'sin sugerencia');
    const hoja = page.getByRole('dialog');
    const usar = hoja.getByRole('button', { name: en ? 'Use suggestion “Sopa de fideo”' : 'Usar sugerencia «Sopa de fideo»' });
    const campo = hoja.getByRole('textbox', { name: en ? 'Item' : 'Consumo', exact: true });
    let esperado = original;
    if (caso === 'sin sugerencia') {
      await expect(usar).toHaveCount(0);
    } else {
      await expect(usar).toBeVisible();
    }
    if (caso === 'escribir primero' || caso === 'aceptar desde el lápiz') {
      await hoja.getByRole('button', { name: 'Modificar ítems' }).click();
      await hoja.getByRole('button', { name: /Modificar sopa de fid/i }).click();
      await expect(campo).toHaveValue(original);
    }
    if (caso === 'aceptar' || caso === 'aceptar desde el lápiz' || caso === 'editar después') {
      await usar.focus();
      await usar.press('Enter');
      await expect(campo).toBeFocused();
      await expect(campo).toHaveValue(sugerido);
      esperado = sugerido;
    }
    if (caso === 'escribir primero' || caso === 'editar después') {
      esperado = 'Sopa de la casa';
      await campo.fill(esperado);
      await expect(usar).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    const abrir = page.getByRole('button', { name: en ? 'View the receipt' : 'Ver el ticket' });
    await expect(abrir).toBeFocused();
    await abrir.click();
    if (await campo.count()) await expect(campo).toHaveValue(esperado);
    await hoja.getByRole('button', { name: en ? 'Close receipt sheet' : 'Cerrar hoja del ticket' }).click();
    await page.getByRole('radio', { name: en ? /Split evenly/ : /En partes iguales/ }).click();
    await page.getByRole('button', { name: en ? 'One more diner' : 'Un comensal más' }).click();
    await page.getByRole('button', { name: en ? 'Continue' : 'Continuar', exact: true }).click();
    await expect.poll(() => aperturas.length).toBe(1);
    expect(aperturas[0]?.ocr_receipt).toBe(recibo);
    expect(aperturas[0]?.total_cents).toBe(2000);
    expect(aperturas[0]?.items).toEqual([
      { name: esperado, category: 'other', price_cents: 1500, quantity: 1 },
      { name: 'Agua', category: 'other', price_cents: 500, quantity: 1 },
    ]);
  });
}
