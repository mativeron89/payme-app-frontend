import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * AF-AVISO-FOTO · Mati, en el iPhone: «Funciona pero la imagen sale mal». En
 * «Escanea el ticket» el aviso de foto chica aparecía DEBAJO de la tarjeta del
 * marco, que lo tapaba: sólo se leía «leer el ticket.».
 *
 * Se mide la geometría real a 390×664 (el alto visible del iPhone), por clase: el aviso de
 * foto chica (local y del dueño) y los demás avisos de la pantalla. Para cada
 * uno: el título no está tapado (`elementFromPoint` en su centro da el aviso) y
 * el aviso no se superpone con el marco.
 */

/**
 * El alto VISIBLE del iPhone con las barras del navegador: la captura de Mati
 * mide 680×1152 px, o sea unos 390×660 CSS. Con los 844 del proyecto `movil`
 * sobra lugar y el defecto no aparece; es el mismo tamaño que usa
 * `login-desplazamiento.spec.ts`.
 */
test.use({ viewport: { width: 390, height: 664 } });

async function abrirEscaneo(page: Page): Promise<void> {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/scan$/);
  await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', /image\/heic/);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

/** El aviso se ve entero: su título no está tapado y no pisa el marco. */
async function avisoSinTapar(page: Page, titulo: string): Promise<void> {
  // El splash de carga tapa la pantalla mientras se retira (ver login-desplazamiento).
  await expect(page.locator('#splash')).toHaveCount(0);
  const aviso = page.getByRole('alert').filter({ hasText: titulo });
  await expect(aviso).toBeVisible();
  const tituloEl = aviso.locator('.state-error-title');
  await expect(tituloEl).toHaveText(titulo);
  await tituloEl.scrollIntoViewIfNeeded();
  const m = await tituloEl.evaluate((t) => {
    const avisoEl = t.closest('[role="alert"]')!;
    const marco = document.querySelector('.scan-frame')!.getBoundingClientRect();
    const a = avisoEl.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    const enPunto = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      tituloTapadoPor: enPunto && !avisoEl.contains(enPunto) ? `${enPunto.tagName}.${enPunto.className}` : null,
      superposicion: Math.min(marco.bottom, a.bottom) - Math.max(marco.top, a.top),
      marco: { top: Math.round(marco.top), bottom: Math.round(marco.bottom) },
      aviso: { top: Math.round(a.top), bottom: Math.round(a.bottom) },
    };
  });
  expect(m.tituloTapadoPor, `el título del aviso queda tapado: ${JSON.stringify(m)}`).toBeNull();
  expect(m.superposicion, `el aviso se superpone con el marco: ${JSON.stringify(m)}`).toBeLessThanOrEqual(0);
}

test.describe('AF-AVISO-FOTO · los avisos de «Escanea el ticket» se ven enteros', () => {
  test('foto chica, rechazada antes de subir (lo de Mati): el aviso entero y «Sacar otra foto»', async ({ page }) => {
    await abrirEscaneo(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'IMG_0500.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024, 1),
    });
    const aviso = page.getByRole('alert');
    await expect(aviso).toContainText('Toma otra más cerca, con buena luz y sin recortarla.');
    // La captura va ANTES de afirmar, para que exista también en la base.
    await expect(page.locator('#splash')).toHaveCount(0);
    await aviso.locator('.state-error-title').scrollIntoViewIfNeeded();
    await capturar(page, 'aviso-foto-chica');
    await avisoSinTapar(page, 'La foto es demasiado pequeña para leer el ticket.');

    // «Sacar otra foto» también se alcanza sin que nada lo tape (la barra de
    // abajo y su círculo incluidos). Se baja como un dedo, hasta el final: no
    // con `scrollIntoView`, que alinea contra el borde del contenedor y ése
    // corre DEBAJO de la barra fija (ver `.has-appbar .scroll`).
    const boton = aviso.getByRole('button', { name: 'Sacar otra foto' });
    await page.locator('.scan-flow-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const tapadoPor = await boton.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const p = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return p && !b.contains(p) ? `${p.tagName}.${p.className}` : null;
    });
    expect(tapadoPor, '«Sacar otra foto» queda tapado').toBeNull();
    await capturar(page, 'aviso-foto-chica-boton');
  });

  test('foto chica según el dueño (422 ticket_image_too_small)', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'too_small' });
    await abrirEscaneo(page);
    await page.getByRole('button', { name: 'Capturar' }).click();
    await avisoSinTapar(page, 'La foto es demasiado pequeña para leer el ticket.');
  });

  test('foto demasiado grande, rechazada antes de subir', async ({ page }) => {
    await abrirEscaneo(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'IMG_0501.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(9 * 1024 * 1024, 1),
    });
    const titulo = await page.getByRole('alert').locator('.state-error-title').textContent();
    expect(titulo).toBeTruthy();
    await avisoSinTapar(page, titulo!);
  });

  for (const ocr of ['no_items', 'budget_exhausted'] as const) {
    test(`el aviso de ${ocr}`, async ({ page }) => {
      await configurarTicketSinQr(page, { ocr });
      await abrirEscaneo(page);
      await page.getByRole('button', { name: 'Capturar' }).click();
      await expect(page.getByRole('alert').locator('.state-error-title')).toBeVisible();
      const titulo = await page.getByRole('alert').locator('.state-error-title').textContent();
      await avisoSinTapar(page, titulo!);
    });
  }
});
