import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * D209 · D215 · subtotal e IVA del ticket (`ticket_totals`, App Backend 2.156.0).
 *
 * El mock del dueño nunca emite `ticket_totals`; los seams `iva_incluido` e
 * `iva_agregado` de `payme.app.mock.n179.ocr.v1` emiten las dos formas de
 * 2.157.0 sobre el ticket de siempre ($840.00 en ítems):
 * - incluido: subtotal $724.14 + IVA $115.86 = $840 (los ítems ya lo traen);
 * - agregado: los ítems suman el subtotal $840, + IVA $134.40 = $974.40.
 * (La app muestra los montos enteros sin «.00».)
 *
 * El IVA no se reparte (D215, «Dejarlo para los pagos»): con IVA agregado lo
 * que se divide sigue siendo $840.00, y se dice con una nota sin ámbar.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  // La hoja scrollea: las filas nuevas van al pie de la lista.
  const desglose = page.locator('.tk-desglose');
  if (await desglose.count()) await desglose.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

async function hastaElTicket(page: Page, ocr?: 'iva_incluido' | 'iva_agregado'): Promise<void> {
  await configurarTicketSinQr(page, ocr ? { ocr } : {});
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

const hoja = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('.tk-list') });
const notaIva = (page: Page) => page.locator('.ticket-title-iva');
const avisoAmbar = (page: Page) => page.locator('.title-card-note.warn');

async function abrirHoja(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  await expect(hoja(page)).toBeVisible();
}

async function filas(page: Page): Promise<string[]> {
  return hoja(page).locator('.tk-desglose > div').evaluateAll((divs) =>
    divs.map((d) => (d as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
}

test.describe('D209 · «Ver el ticket» con subtotal e IVA', () => {
  test('🔴 IVA incluido: Subtotal e IVA arriba del total, sin nota ni aviso', async ({ page }) => {
    await hastaElTicket(page, 'iva_incluido');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await expect(notaIva(page)).toHaveCount(0);
    await expect(avisoAmbar(page)).toHaveCount(0);
    await abrirHoja(page);
    expect(await filas(page)).toEqual(['Subtotal $724.14', 'IVA $115.86', 'Total del ticket $840']);
    await capturar(page, 'iva-incluido-hoja');
  });

  test('🔴 IVA agregado: no es una lectura mala; la nota informa y nada se frena', async ({ page }) => {
    await hastaElTicket(page, 'iva_agregado');
    // Lo que se divide son los platos: el IVA no se reparte (D215).
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await expect(notaIva(page)).toHaveText('Lo que paga cada uno todavía no incluye el IVA ($134.40)');
    // Sin ámbar y sin abrir la hoja a la fuerza: el total cierra.
    await expect(avisoAmbar(page)).toHaveCount(0);
    await expect(hoja(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ver el ticket' })).toBeEnabled();
    await capturar(page, 'iva-agregado-nota');
    await abrirHoja(page);
    expect(await filas(page)).toEqual(['Subtotal $840', 'IVA $134.40', 'Total del ticket $974.40']);
    await capturar(page, 'iva-agregado-hoja');
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    // No bloquea: se puede seguir dividiendo y continuar.
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  });

  test('control · sin `ticket_totals` la pantalla queda como antes: sin filas ni nota', async ({ page }) => {
    await hastaElTicket(page);
    await expect(notaIva(page)).toHaveCount(0);
    await abrirHoja(page);
    await expect(hoja(page).locator('.tk-desglose')).toHaveCount(0);
    await capturar(page, 'sin-totales-hoja');
  });

  test('🔴 IVA agregado con un ítem corregido que ya no cierra: sin filas, y vuelve el aviso de siempre', async ({ page }) => {
    await hastaElTicket(page, 'iva_agregado');
    await abrirHoja(page);
    await hoja(page).getByRole('button', { name: 'Modificar ítems' }).click();
    // Se borra un plato: la suma deja de ser el subtotal.
    await hoja(page).getByRole('button', { name: 'Modificar Agua mineral' }).click();
    await hoja(page).getByRole('button', { name: 'Eliminar' }).click();
    await hoja(page).getByRole('button', { name: 'Listo' }).click();
    await expect(hoja(page).locator('.tk-desglose')).toHaveCount(0);
    await expect(notaIva(page)).toHaveCount(0);
    await expect(avisoAmbar(page)).toBeVisible();
  });
});

test.describe('D209 · el ticket digital con subtotal e IVA', () => {
  /**
   * El ticket digital se abre desde «Tus restaurantes», sobre una visita del
   * modelo del mock (esas mesas no pasan por el alta). Se envuelve `getMesa` de
   * la fachada para que conteste lo que publicaría el dueño en `mesa_detail`:
   * `ticket_totals` con subtotal + IVA = total de la mesa. Lo que se prueba es
   * el decoder del visor y lo que dibuja.
   */
  async function abrirTicketDigital(page: Page, conTotales: boolean): Promise<ReturnType<Page['getByRole']>> {
    await ingresar(page);
    await page.goto('/restaurantes');
    if (conTotales) {
      await page.evaluate(async () => {
        const ruta = '/src/api/index.ts';
        const { api } = await import(/* @vite-ignore */ ruta) as {
          api: { getMesa: (...a: unknown[]) => Promise<{ mesa: { total_cents: number } & Record<string, unknown> }> };
        };
        const original = api.getMesa.bind(api);
        api.getMesa = async (...args: unknown[]) => {
          const respuesta = await original(...args);
          const total = respuesta.mesa.total_cents;
          const subtotal = Math.round(total / 1.16);
          return { mesa: { ...respuesta.mesa, ticket_totals: { subtotal_cents: subtotal, tax_cents: total - subtotal } } };
        };
      });
    }
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia', exact: true });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.locator('.rest-visita-fila').click();
    await visita.getByRole('button', { name: 'Ver ticket completo', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
    await expect(dialog).toContainText('Total del ticket');
    return dialog;
  }

  test('🔴 con `ticket_totals`, Subtotal e IVA arriba del total, y suman el total', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, true);
    const desglose = dialog.locator('.ticket-digital-desglose');
    await expect(desglose).toBeVisible();
    await expect(desglose).toContainText('Subtotal');
    await expect(desglose).toContainText('IVA');
    const montos = await dialog.evaluate((d) => {
      const centavos = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100);
      const dd = [...d.querySelectorAll('.ticket-digital-desglose dd')].map((x) => centavos(x.textContent ?? ''));
      const total = centavos(d.querySelector('.ticket-digital-total strong')?.textContent ?? '');
      return { subtotal: dd[0]!, iva: dd[1]!, total };
    });
    expect(montos.subtotal + montos.iva).toBe(montos.total);
    await capturar(page, 'ticket-digital-con-iva');
  });

  test('control · sin `ticket_totals`, como antes', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, false);
    await expect(dialog.locator('.ticket-digital-desglose')).toHaveCount(0);
  });
});
