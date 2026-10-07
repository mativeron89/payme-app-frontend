import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * D218 · el descuento impreso, aparte y sin repartir (App Backend 2.164.0,
 * `ticket_adjustments`). Y L1 · la mesa retomada con IVA agregado (2.165.0,
 * `totals_version=2`).
 *
 * El mock del dueño no emite ajustes; los seams `descuento` y `descuento_iva`
 * de `payme.app.mock.n179.ocr.v1` emiten las dos formas sobre el ticket de
 * siempre ($840 en ítems): descuento $50 → impreso $790; con IVA agregado
 * $134.40 → impreso $924.40. Lo que se divide sigue siendo $840.
 *
 * A 375×667, el ancho que pidió el Bibliotecario para las capturas.
 */
test.use({ viewport: { width: 375, height: 667 } });

const MENOS = '−';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  const desglose = page.locator('.tk-desglose, .ticket-digital-total').first();
  if (await desglose.count()) await desglose.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/descuento-${nombre}-375.png` });
}

async function hastaElTicket(page: Page, ocr?: 'descuento' | 'descuento_iva'): Promise<void> {
  await configurarTicketSinQr(page, ocr ? { ocr } : {});
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

const hoja = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('.tk-list') });
const nota = (page: Page) => page.locator('.ticket-title-iva');
const avisoAmbar = (page: Page) => page.locator('.title-card-note.warn');

async function abrirHoja(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  await expect(hoja(page)).toBeVisible();
}

const filas = (page: Page) => hoja(page).locator('.tk-desglose > div').evaluateAll((divs) =>
  divs.map((d) => (d as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

test.describe('D218 · «Ver el ticket» con el descuento aparte', () => {
  test('🔴 con descuento: la línea en negativo, la nota sin ámbar y nada se frena', async ({ page }) => {
    await hastaElTicket(page, 'descuento');
    // Lo que se divide no cambia: el descuento no se reparte.
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await expect(nota(page)).toHaveText(`Lo que paga cada uno todavía no incluye el descuento (${MENOS}$50)`);
    await expect(avisoAmbar(page)).toHaveCount(0);
    await expect(hoja(page)).toHaveCount(0);
    await capturar(page, 'nota');
    await abrirHoja(page);
    expect(await filas(page)).toEqual(['Subtotal $840', `Descuento ${MENOS}$50`, 'Total del ticket $790']);
    await capturar(page, 'hoja');
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  });

  test('🔴 con descuento e IVA agregado: las filas en el orden de la cuenta y una sola nota', async ({ page }) => {
    await hastaElTicket(page, 'descuento_iva');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await expect(nota(page)).toHaveCount(1);
    await expect(nota(page)).toHaveText(
      `Lo que paga cada uno todavía no incluye el IVA ($134.40) ni el descuento (${MENOS}$50)`,
    );
    await expect(avisoAmbar(page)).toHaveCount(0);
    await abrirHoja(page);
    expect(await filas(page)).toEqual([
      'Subtotal $840', 'IVA $134.40', `Descuento ${MENOS}$50`, 'Total del ticket $924.40',
    ]);
    await capturar(page, 'con-iva-hoja');
  });

  test('control · sin descuento, como hoy: sin filas ni nota', async ({ page }) => {
    await hastaElTicket(page);
    await expect(nota(page)).toHaveCount(0);
    await abrirHoja(page);
    await expect(hoja(page).locator('.tk-desglose')).toHaveCount(0);
    await capturar(page, 'sin-descuento-hoja');
  });

  test('🔴 un ítem corregido que ya no cierra con el descuento: sin filas y vuelve el aviso de siempre', async ({ page }) => {
    await hastaElTicket(page, 'descuento');
    await abrirHoja(page);
    await hoja(page).getByRole('button', { name: 'Modificar ítems' }).click();
    await hoja(page).getByRole('button', { name: 'Modificar Agua mineral' }).click();
    await hoja(page).getByRole('button', { name: 'Eliminar' }).click();
    await hoja(page).getByRole('button', { name: 'Listo' }).click();
    await expect(hoja(page).locator('.tk-desglose')).toHaveCount(0);
    await expect(nota(page)).toHaveCount(0);
    await expect(avisoAmbar(page)).toBeVisible();
  });
});

test.describe('D218 · L1 · la mesa retomada en el ticket digital', () => {
  /**
   * El ticket digital se abre desde «Tus restaurantes», sobre visitas del
   * modelo del mock (no pasan por el alta): se envuelve `getMesa` de la fachada
   * para que conteste lo que publicaría el dueño en `mesa_detail`. Lo que se
   * prueba es el decoder del visor y lo que dibuja.
   */
  async function abrirTicketDigital(page: Page, extra: 'descuento' | 'iva_agregado'): Promise<ReturnType<Page['getByRole']>> {
    await ingresar(page);
    await page.goto('/restaurantes');
    await page.evaluate(async (caso) => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as {
        api: { getMesa: (...a: unknown[]) => Promise<{ mesa: { total_cents: number } & Record<string, unknown> }> };
      };
      const original = api.getMesa.bind(api);
      api.getMesa = async (...args: unknown[]) => {
        const r = await original(...args);
        const total = r.mesa.total_cents;
        return {
          mesa: caso === 'descuento'
            ? { ...r.mesa, ticket_adjustments: [{ kind: 'discount', amount_cents: 5000 }] }
            // IVA agregado: el total de la mesa es el subtotal (D215).
            : { ...r.mesa, ticket_totals: { subtotal_cents: total, tax_cents: Math.round(total * 0.16) } },
        };
      };
    }, extra);
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia', exact: true });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.locator('.rest-visita-fila').click();
    await visita.getByRole('button', { name: 'Ver ticket completo', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
    await expect(dialog.locator('.ticket-digital-total')).toBeVisible();
    return dialog;
  }

  test('🔴 con descuento: «Total de los consumos», «Descuento» y «El descuento no se reparte.»', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, 'descuento');
    await expect(dialog.locator('.ticket-digital-total span')).toHaveText('Total de los consumos');
    await expect(dialog.locator('.ticket-digital-descuento')).toHaveText(new RegExp(`Descuento\\s*${MENOS}\\$50`));
    await expect(dialog.locator('.ticket-digital-nota')).toHaveText('El descuento no se reparte.');
    await expect(dialog.getByText('Total del ticket')).toHaveCount(0);
    await capturar(page, 'ticket-digital');
  });

  test('🔴 L1 · con IVA agregado: ya no falla; Subtotal, IVA, Total del ticket = S + IVA y la nota', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, 'iva_agregado');
    await expect(dialog.getByText('No pudimos cargar el detalle')).toHaveCount(0);
    const montos = await dialog.evaluate((d) => {
      const centavos = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100);
      const dd = [...d.querySelectorAll('.ticket-digital-desglose dd')].map((x) => centavos(x.textContent ?? ''));
      return { subtotal: dd[0]!, iva: dd[1]!, total: centavos(d.querySelector('.ticket-digital-total strong')?.textContent ?? '') };
    });
    expect(montos.subtotal + montos.iva).toBe(montos.total);
    await expect(dialog.locator('.ticket-digital-nota')).toHaveText(/^Lo que paga cada uno todavía no incluye el IVA \(\$/);
    await capturar(page, 'retomada-iva-agregado');
  });
});
