import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * D622 · AF-2 · mejora 4 (§5 de la especificación): cuánto sobra o falta para
 * cuadrar el ticket. La franja va FIJA al pie de la hoja del ticket (se sigue
 * viendo mientras se edita una fila), dice la diferencia exacta en palabras y,
 * cuando cuadra al centavo con un total impreso, lo dice en verde. No bloquea
 * «Continuar» y la regla de cuándo no cuadra es la de siempre.
 *
 * El ticket del mock suma $840 en platos (Tagliatelle Bolognese $195, …). El
 * total impreso se agrega envolviendo `scanTicket`, como `af-diseno-02`.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

async function hastaElTicket(page: Page, impreso: number | null): Promise<void> {
  await configurarTicketSinQr(page);
  await ingresar(page);
  if (impreso !== null) {
    await page.evaluate(async (cents) => {
      const ruta = '/src/api/index.ts';
      const modulo = await import(/* @vite-ignore */ ruta);
      const scanOriginal = modulo.api.scanTicket.bind(modulo.api);
      modulo.api.scanTicket = async (image?: Blob) => ({ ...await scanOriginal(image), total_detected_cents: cents });
    }, impreso);
  }
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?' })).toBeVisible();
}

const hoja = (page: Page) => page.getByRole('dialog', { name: /Ticket ·/ });
const franja = (page: Page) => hoja(page).locator('.cuadre-ticket');
const anuncio = (page: Page) => hoja(page).locator('.cuadre-ticket-anuncio');

/** La franja entra entera en la pantalla y nada la tapa (está a la vista, no sólo en el DOM). */
async function franjaALaVista(page: Page): Promise<void> {
  const caja = await franja(page).boundingBox();
  expect(caja, 'la franja tiene caja').not.toBeNull();
  const vp = page.viewportSize()!;
  expect(caja!.y, 'arriba del borde inferior').toBeGreaterThanOrEqual(0);
  expect(caja!.y + caja!.height, 'entra entera').toBeLessThanOrEqual(vp.height);
  const encima = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.cuadre-ticket') !== null,
    [caja!.x + caja!.width / 2, caja!.y + caja!.height / 2] as const);
  expect(encima, 'nada la tapa').toBe(true);
}

async function precioDelTagliatelle(page: Page, pesos: string): Promise<void> {
  await hoja(page).getByLabel('Precio por unidad').fill(pesos);
}

test.describe('D622 · AF-2 · cuadrar el ticket', () => {
  test('🔴 cuadra al centavo: la franja verde con el tilde y el total impreso', async ({ page }) => {
    await hastaElTicket(page, 84000);
    await page.getByRole('button', { name: 'Ver el ticket' }).click();
    await expect(franja(page)).toHaveText('Cuadra con el ticket: $840.');
    await expect(franja(page)).toHaveClass(/cuadre-ticket--cuadra/);
    await expect(franja(page).locator('svg')).toHaveCount(1);
    await franjaALaVista(page);
    await capturar(page, 'cuadre-01-cuadra');
  });

  test('🔴 sobran y faltan en vivo mientras se edita, con la franja a la vista; al corregir, cuadra', async ({ page }) => {
    await hastaElTicket(page, 84000);
    await page.getByRole('button', { name: 'Ver el ticket' }).click();
    await hoja(page).getByRole('button', { name: 'Modificar ítems', exact: true }).click();
    await hoja(page).getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();

    await precioDelTagliatelle(page, '240');
    await expect(franja(page)).toHaveText('Tus platos suman $885 y el ticket dice $840: sobran $45.');
    await expect(franja(page)).toHaveClass(/cuadre-ticket--no-cuadra/);
    await franjaALaVista(page);
    await capturar(page, 'cuadre-02-sobran-editando');

    await precioDelTagliatelle(page, '150');
    await expect(franja(page)).toHaveText('Tus platos suman $795 y el ticket dice $840: faltan $45.');
    await franjaALaVista(page);

    await precioDelTagliatelle(page, '195');
    await expect(franja(page)).toHaveText('Cuadra con el ticket: $840.');
    await expect(franja(page)).toHaveClass(/cuadre-ticket--cuadra/);
  });

  test('🔴 el anuncio para lectores de pantalla cambia sólo cuando cambia el estado', async ({ page }) => {
    await hastaElTicket(page, 84000);
    await page.getByRole('button', { name: 'Ver el ticket' }).click();
    await expect(anuncio(page)).toHaveAttribute('aria-live', 'polite');
    await hoja(page).getByRole('button', { name: 'Modificar ítems', exact: true }).click();
    await hoja(page).getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();
    await precioDelTagliatelle(page, '240');
    await expect(anuncio(page)).toHaveText('Tus platos suman $885 y el ticket dice $840: sobran $45.');
    // Sigue sobrando: la franja cambia, el anuncio no se repite con cada tecla.
    await precioDelTagliatelle(page, '250');
    await expect(franja(page)).toHaveText('Tus platos suman $895 y el ticket dice $840: sobran $55.');
    await expect(anuncio(page)).toHaveText('Tus platos suman $885 y el ticket dice $840: sobran $45.');
    await precioDelTagliatelle(page, '195');
    await expect(anuncio(page)).toHaveText('Cuadra con el ticket: $840.');
  });

  test('no cuadra no bloquea «Continuar» y ya no hay «Checa que…» en ámbar', async ({ page }) => {
    await hastaElTicket(page, 84000);
    await page.getByRole('button', { name: 'Ver el ticket' }).click();
    await hoja(page).getByRole('button', { name: 'Modificar ítems', exact: true }).click();
    await hoja(page).getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();
    await precioDelTagliatelle(page, '240');
    await expect(franja(page)).toHaveClass(/cuadre-ticket--no-cuadra/);
    await expect(hoja(page).locator('.title-card-note.warn')).toHaveCount(0);
    await expect(hoja(page).getByText(/Checa que el total coincida/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continuar' })).toBeEnabled();
  });

  test('control · sin total impreso no se afirma nada: sin franja, con la ayuda de siempre', async ({ page }) => {
    await hastaElTicket(page, null);
    await page.getByRole('button', { name: 'Ver el ticket' }).click();
    await expect(hoja(page)).toBeVisible();
    await expect(hoja(page).getByText('Checa que el total coincida con el total del ticket', { exact: true })).toBeVisible();
    await expect(franja(page)).toHaveCount(0);
  });
});
