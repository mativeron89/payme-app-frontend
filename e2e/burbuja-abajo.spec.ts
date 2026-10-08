import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { sacarFoto } from './_camara';

/**
 * AF-RECORTE-BURBUJA · D222, segunda elección de Mati: «Abajo, cerca de
 * Continuar (Recomendada)» — «Queda pegada abajo, justo encima de la barra y
 * del botón «Continuar», que es lo que tocás después. En cualquier celular
 * queda en el mismo lugar.» Su captura: en «¿Cómo dividen?» la burbuja
 * «¿Cuántos son en la mesa?» quedaba pegada a las opciones, con mucho vacío
 * hasta la barra.
 *
 * Se mide contra lo MÁS ALTO de la barra (`min(barra, círculo)`, como
 * `nombre-en-ticket`): el círculo de Continuar sobresale 26 px.
 *
 * - Donde sobra lugar (390×844, 430×932), la burbuja termina 12 px arriba de
 *   ese límite (±1 por el redondeo) y el vacío queda ENTRE las opciones y ella.
 * - Donde entra justo, el aire de abajo se achica hasta 8 px antes que
 *   desplazar: el pedido 127 es que «¿Cómo dividen?» entre en una vista.
 *   Medido: a 375×667 la burbuja mide 123 px (a 390, 103) y, con 12 px fijos,
 *   se pasaba 3,8 px; queda a 8,2. A 390×664 sobran 17,5 px y va a 12.
 * - Donde no entra (320×568, el iPhone SE de 4"), queda debajo de las opciones
 *   a 4 px, sin pisarlas: es un scroll, y al bajar termina 8 px arriba.
 * - D231 sacó la fila de arriba de la barra («Completa nombre y precio…»): con
 *   el ticket incompleto o vacío la barra no cambia y la burbuja tampoco.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

async function hastaComoDividen(page: Page): Promise<void> {
  await configurarTicketSinQr(page, { ocr: 'no_merchant' });
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

async function medir(page: Page) {
  return page.evaluate(() => {
    const r = (el: Element) => el.getBoundingClientRect();
    const barra = r(document.querySelector('.appbar-block')!);
    const circulo = r(document.querySelector('.appbar-fab')!);
    const tarjeta = document.querySelector('.division-stepper') as HTMLElement;
    const burbuja = r(tarjeta);
    const opciones = Array.from(document.querySelectorAll('.division-options .div-card')).map(r);
    const scroll = document.querySelector('.ticket-flow-scroll') as HTMLElement;
    const ultima = opciones[opciones.length - 1]!;
    return {
      limite: Math.min(barra.top, circulo.top),
      barraTop: barra.top,
      circuloTop: circulo.top,
      burbujaTop: burbuja.top,
      burbujaBottom: burbuja.bottom,
      ultimaOpcionBottom: ultima.bottom,
      // Entera: ni achicada ni cortada (la tarjeta tiene `overflow: hidden`).
      cortada: tarjeta.scrollHeight > tarjeta.clientHeight + 1,
      // Ninguna opción se cruza con la burbuja.
      pisa: opciones.some((o) => o.bottom > burbuja.top && o.top < burbuja.bottom),
      scrollTop: scroll.scrollTop,
      sobra: scroll.scrollHeight <= scroll.clientHeight,
    };
  });
}

test.describe('D222 · la burbuja «¿Cuántos son en la mesa?», abajo, encima de Continuar', () => {
  for (const [ancho, alto, alto2] of [
    [390, 844, 'alta'],
    [430, 932, 'alta'],
    [375, 667, 'baja'],
    [390, 664, 'baja'],
  ] as const) {
    test(`🔴 a ${ancho}×${alto}: pegada abajo, a 12 px del círculo, sin pisar las opciones`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await hastaComoDividen(page);
      const m = await medir(page);
      const info = JSON.stringify(m);
      expect(m.sobra, info).toBe(true);
      expect(m.scrollTop, info).toBe(0);
      expect(m.pisa, info).toBe(false);
      expect(m.cortada, info).toBe(false);
      expect(m.burbujaTop - m.ultimaOpcionBottom, info).toBeGreaterThanOrEqual(3.5);
      expect(m.limite - m.burbujaBottom, info).toBeGreaterThanOrEqual(7.5);
      expect(m.limite - m.burbujaBottom, info).toBeLessThanOrEqual(13);
      // Si sobra algo arriba de la burbuja, el aire de abajo está entero: los
      // 12 px se achican sólo cuando la burbuja ya está pegada a las opciones.
      if (m.burbujaTop - m.ultimaOpcionBottom > 4.5) {
        expect(m.limite - m.burbujaBottom, info).toBeGreaterThanOrEqual(11);
      }
      // En las altas, el vacío de la captura de Mati queda ARRIBA de la burbuja.
      if (alto2 === 'alta') expect(m.burbujaTop - m.ultimaOpcionBottom, info).toBeGreaterThan(40);
      console.log(`BURBUJA ${ancho}x${alto}`, info);
      await capturar(page, `burbuja-${ancho}x${alto}`);
    });
  }

  test('🔴 a 320×568 no entra: debajo de las opciones a 4 px, y al bajar termina a 8 px del círculo', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await hastaComoDividen(page);
    const arriba = await medir(page);
    expect(arriba.sobra, JSON.stringify(arriba)).toBe(false);
    expect(arriba.pisa, JSON.stringify(arriba)).toBe(false);
    expect(arriba.cortada, JSON.stringify(arriba)).toBe(false);
    expect(arriba.burbujaTop - arriba.ultimaOpcionBottom, JSON.stringify(arriba)).toBeGreaterThanOrEqual(3.5);
    expect(arriba.burbujaTop - arriba.ultimaOpcionBottom, JSON.stringify(arriba)).toBeLessThanOrEqual(4.5);
    await page.locator('.ticket-flow-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const abajo = await medir(page);
    expect(abajo.cortada, JSON.stringify(abajo)).toBe(false);
    expect(abajo.limite - abajo.burbujaBottom, JSON.stringify(abajo)).toBeGreaterThanOrEqual(7.5);
    expect(abajo.limite - abajo.burbujaBottom, JSON.stringify(abajo)).toBeLessThanOrEqual(8.5);
    console.log('BURBUJA 320x568', JSON.stringify({ arriba, abajo }));
  });

  test('🔴 «¿Cuántos pagan?» (partes iguales) también queda abajo', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await hastaComoDividen(page);
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await expect(page.locator('.division-stepper-title')).toHaveText('¿Cuántos pagan?');
    const m = await medir(page);
    expect(m.limite - m.burbujaBottom, JSON.stringify(m)).toBeGreaterThanOrEqual(11);
    expect(m.limite - m.burbujaBottom, JSON.stringify(m)).toBeLessThanOrEqual(13);
  });

  /**
   * 🔴 D231 · «Quitarlo del todo»: con un consumo incompleto o sin consumos ya
   * no hay fila sobre la barra («Completa nombre y precio…» / «Agrega al menos
   * un consumo.»), que en la captura de Mati quedaba cortada detrás del círculo.
   * La barra no cambia de alto y la burbuja queda donde estaba, sin pisar nada.
   */
  for (const [ancho, alto] of [[375, 667], [390, 844]] as const) {
    test(`🔴 D231 · a ${ancho}×${alto}, con un consumo incompleto: sin cartel, y nada se superpone`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await hastaComoDividen(page);
      // Cuántos son primero: si no, «Continuar» frena por el stepper y no mira el ticket.
      await page.getByRole('button', { name: 'Un comensal más' }).click();
      const antes = await medir(page);
      await page.getByRole('button', { name: /Ver el ticket/ }).click();
      await page.getByRole('button', { name: 'Modificar ítems' }).click();
      await page.getByRole('button', { name: 'Agregar consumo' }).click();
      await page.getByRole('button', { name: 'Listo' }).click();
      await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();

      await expect(page.locator('.appbar-above')).toHaveCount(0);
      await expect(page.getByText('Completa nombre y precio (mayor a cero) de cada consumo.')).toHaveCount(0);
      const m = await medir(page);
      const info = JSON.stringify({ antes, m });
      // La barra y el círculo, en el mismo lugar que con el ticket completo: sin
      // fila, la barra no crece. (La tarjeta del ticket sí cambia un poco con un
      // consumo pendiente, así que la burbuja se mide contra lo que la rodea.)
      expect(m.barraTop, info).toBe(antes.barraTop);
      expect(m.circuloTop, info).toBe(antes.circuloTop);
      expect(m.pisa, info).toBe(false);
      expect(m.cortada, info).toBe(false);
      // Ni el círculo ni la barra tapan la burbuja.
      expect(m.limite - m.burbujaBottom, info).toBeGreaterThanOrEqual(0);
      // Y al bajar del todo, termina arriba del círculo con su aire.
      await page.locator('.ticket-flow-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const abajo = await medir(page);
      expect(abajo.limite - abajo.burbujaBottom, JSON.stringify(abajo)).toBeGreaterThanOrEqual(7.5);
      await page.locator('.ticket-flow-scroll').evaluate((el) => { el.scrollTop = 0; });
      await capturar(page, `burbuja-${ancho}x${alto}-incompleto`);

      // «Continuar» sigue sin avanzar.
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.locator('.ticket-title-fold')).toHaveClass(/tk-fold--pulse/);
      await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toHaveCount(0);
      await expect(page.locator('.toast:not(.toast-hidden)')).toHaveCount(0);
    });
  }

  test('🔴 D231 · sin consumos: sin «Agrega al menos un consumo.», y «Continuar» no avanza', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await hastaComoDividen(page);
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await page.getByRole('button', { name: /Ver el ticket/ }).click();
    await page.getByRole('button', { name: 'Modificar ítems' }).click();
    // Cada consumo se abre con su lápiz y se elimina, hasta que no queda ninguno.
    const lapices = page.locator('.tk-pencil');
    const eliminar = page.getByRole('button', { name: 'Eliminar', exact: true });
    await expect(lapices.first().or(eliminar)).toBeVisible();
    for (let vuelta = 0; vuelta < 30; vuelta += 1) {
      if (await eliminar.count() > 0) await eliminar.click();
      else if (await lapices.count() > 0) await lapices.first().click();
      else break;
    }
    await expect(page.locator('.tk-row, .tk-edit')).toHaveCount(0);
    await page.getByRole('button', { name: 'Listo' }).click();
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();

    await expect(page.locator('.appbar-above')).toHaveCount(0);
    await expect(page.getByText('Agrega al menos un consumo.')).toHaveCount(0);
    const m = await medir(page);
    expect(m.pisa, JSON.stringify(m)).toBe(false);
    expect(m.limite - m.burbujaBottom, JSON.stringify(m)).toBeGreaterThanOrEqual(0);

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.locator('.ticket-title-fold')).toHaveClass(/tk-fold--pulse/);
    await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toHaveCount(0);
    await expect(page.locator('.toast:not(.toast-hidden)')).toHaveCount(0);
    await expect(page.getByText('Agrega al menos un consumo.')).toHaveCount(0);
  });
});
