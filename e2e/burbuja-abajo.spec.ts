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
 * `nombre-en-ticket`): el círculo de Continuar sobresale 26 px, y con la fila
 * «Completa nombre y precio…» la barra entera sube.
 *
 * - Donde sobra lugar (390×844, 430×932), la burbuja termina 12 px arriba de
 *   ese límite (±1 por el redondeo) y el vacío queda ENTRE las opciones y ella.
 * - Donde entra justo, el aire de abajo se achica hasta 8 px antes que
 *   desplazar: el pedido 127 es que «¿Cómo dividen?» entre en una vista.
 *   Medido: a 375×667 la burbuja mide 123 px (a 390, 103) y, con 12 px fijos,
 *   se pasaba 3,8 px; queda a 8,2. A 390×664 sobran 17,5 px y va a 12.
 * - Donde no entra (320×568, el iPhone SE de 4"), queda debajo de las opciones
 *   a 4 px, sin pisarlas: es un scroll, y al bajar termina 8 px arriba.
 * - Con la fila de arriba de la barra, tampoco queda tapada.
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

  test('🔴 con la fila «Completa nombre y precio…» sobre la barra, la burbuja sube con ella', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await hastaComoDividen(page);
    await page.getByRole('button', { name: /Ver el ticket/ }).click();
    await page.getByRole('button', { name: 'Modificar ítems' }).click();
    await page.getByRole('button', { name: 'Agregar consumo' }).click();
    await page.getByRole('button', { name: 'Listo' }).click();
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await expect(page.locator('.appbar-above .tk-invalid')).toBeVisible();
    // La fila sube la barra: el límite es la barra, no el círculo.
    await expect.poll(async () => {
      const m = await medir(page);
      return Math.round(m.limite - m.burbujaBottom);
    }).toBeGreaterThanOrEqual(11);
    const m = await medir(page);
    const info = JSON.stringify(m);
    expect(m.barraTop, info).toBeLessThan(m.circuloTop);
    expect(m.limite - m.burbujaBottom, info).toBeLessThanOrEqual(13);
    expect(m.pisa, info).toBe(false);
    expect(m.cortada, info).toBe(false);
    console.log('BURBUJA con fila', info);
    await capturar(page, 'burbuja-390x844-con-fila');
  });
});
