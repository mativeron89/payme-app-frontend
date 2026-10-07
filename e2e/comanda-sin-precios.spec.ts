import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * AF-NOCHE-COMANDA · App Backend 2.161.0 avisa `no_prices_found` cuando la foto
 * es una comanda de cocina: renglones de texto y ningún precio. «Escanea el
 * ticket» lo dice con su propio aviso y ofrece sólo las dos salidas a otra foto
 * (D212: sin manualidades). El mock del dueño nunca lo emite; el seam `no_prices`
 * de `payme.app.mock.n179.ocr.v1` lo hace con la forma del dueño.
 */
const TITULO = 'Parece una comanda sin precios';
const TEXTO = 'Para dividir la cuenta necesitamos el ticket con los importes. Sácale una foto a ese ticket o elígelo de la galería.';

async function escanearCon(page: Page, ocr: 'no_prices' | 'no_items'): Promise<void> {
  await configurarTicketSinQr(page, { ocr });
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await sacarFoto(page);
}

const aviso = (page: Page) => page.getByRole('alert').filter({ hasText: TITULO });

test.describe('AF-NOCHE-COMANDA · comanda sin precios', () => {
  test('🔴 el aviso propio, con su texto y sólo las dos salidas a otra foto', async ({ page }) => {
    await escanearCon(page, 'no_prices');
    await expect(aviso(page)).toBeVisible();
    await expect(aviso(page).locator('.state-error-title')).toHaveText(TITULO);
    await expect(aviso(page).locator('.state-error-body')).toHaveText(TEXTO);
    await expect(aviso(page).getByRole('button')).toHaveText(['Sacar otra foto', 'Elegir de la galería o Drive']);
    await expect(aviso(page).getByRole('button', { name: 'Cargarlo a mano' })).toHaveCount(0);
    // Y no es el aviso de siempre.
    await expect(page.getByText('Prueba sacar la foto de nuevo con más luz')).toHaveCount(0);
  });

  test('🔴 «Sacar otra foto» abre la cámara nativa; «Elegir de la galería o Drive», el selector sin `capture`', async ({ page }) => {
    await escanearCon(page, 'no_prices');
    const [camara] = await Promise.all([
      page.waitForEvent('filechooser'),
      aviso(page).getByRole('button', { name: 'Sacar otra foto', exact: true }).click(),
    ]);
    expect(await camara.element().getAttribute('capture')).toBe('environment');
    const [galeria] = await Promise.all([
      page.waitForEvent('filechooser'),
      aviso(page).getByRole('button', { name: 'Elegir de la galería o Drive', exact: true }).click(),
    ]);
    expect(await galeria.element().getAttribute('capture')).toBeNull();
  });

  test('control · sin `no_prices_found`, el aviso de siempre, con «Cargarlo a mano»', async ({ page }) => {
    await escanearCon(page, 'no_items');
    const deSiempre = page.getByRole('alert').filter({ hasText: 'No pudimos leer el ticket' });
    await expect(deSiempre).toContainText('Prueba sacar la foto de nuevo con más luz, o carga los consumos a mano.');
    await expect(deSiempre.getByRole('button', { name: 'Cargarlo a mano' })).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
  });
});

test.describe('AF-NOCHE-COMANDA · el aviso entero a 375 px', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('🔴 el título y las dos salidas se ven sin nada encima', async ({ page }) => {
    await escanearCon(page, 'no_prices');
    await expect(page.locator('#splash')).toHaveCount(0);
    await expect(aviso(page)).toBeVisible();
    // El aviso entero cabe en el panel, sin tener que desplazarlo: la foto se
    // achica para dejarle lugar (el hueco de la foto con base 0).
    const panel = await page.locator('.camara-panel').evaluate((el) => ({ alto: el.clientHeight, contenido: el.scrollHeight }));
    expect(panel.contenido, `el panel necesita scroll: ${JSON.stringify(panel)}`).toBeLessThanOrEqual(panel.alto + 1);
    const titulo = aviso(page).locator('.state-error-title');
    await titulo.scrollIntoViewIfNeeded();
    const tapado = (el: Element) => {
      const r = el.getBoundingClientRect();
      const p = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return p && !el.contains(p) ? `${p.tagName}.${(p as HTMLElement).className}` : null;
    };
    expect(await titulo.evaluate(tapado)).toBeNull();
    if (process.env.PAYME_E2E_CAPTURAS) {
      await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/comanda-sin-precios-375.png` });
    }
    for (const nombre of ['Sacar otra foto', 'Elegir de la galería o Drive']) {
      const boton = aviso(page).getByRole('button', { name: nombre, exact: true });
      await boton.scrollIntoViewIfNeeded();
      expect(await boton.evaluate(tapado), `«${nombre}» queda tapado`).toBeNull();
    }
  });
});
