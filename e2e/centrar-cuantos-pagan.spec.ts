import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { sacarFoto } from './_camara';

/**
 * AF-CENTRAR-CUANTOS-PAGAN · pedido 136 de Mati: «Centra el ¿Cuántos pagan?».
 *
 * D377 · «Como el diseño» (Mati, 2026-10-18): en las tres formas el contador es
 * sólo −, el número y +, centrado y sin el monto de al lado («cuánto paga cada
 * uno se ve después, en «Mi parte»»). Sale la caja que reservaba el ancho del
 * monto (pedidos 127 y 136, D181): era lo que descentraba el grupo (P03).
 *
 * - El título, centrado.
 * - El grupo `− N +` centrado en la tarjeta, sin número y con número.
 * - Ningún monto al lado: ni «$», ni «c/u», ni la reserva invisible.
 * - Sin número, el «—» y la tarjeta con el borde punteado en --warning (canvas
 *   69 del paquete del tutorial); con número, el borde vuelve a ser sólido.
 * - El «−» y el «+» no se mueven bajo el dedo al cambiar N (del piso a 50, el
 *   tope desde D375), tampoco al primer toque.
 *
 * 🔴 Se mide el TEXTO del título (con un `Range`), no su caja: un título de
 * ancho completo con el texto a la izquierda tiene la caja centrada. Y el grupo
 * se mide desde el borde izquierdo del «−» hasta el derecho del «+», no por la
 * caja de `.stepper`: una caja de ancho completo con el contenido a la
 * izquierda también está «centrada».
 */

const FORMAS = [
  { nombre: 'Pagar el total', radio: /Pagar el total/, pregunta: '¿Cuántos pagan?', piso: 1 },
  { nombre: 'En partes iguales', radio: /En partes iguales/, pregunta: '¿Cuántos pagan?', piso: 2 },
  { nombre: 'Por lo que pidió cada uno', radio: /Por lo que pidió cada uno/, pregunta: '¿Cuántos son en la mesa?', piso: 1 },
] as const;

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

async function hastaComoDividen(page: Page): Promise<void> {
  await configurarTicketSinQr(page, { ocr: 'no_merchant' });
  await ingresar(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

const mas = (page: Page) => page.getByRole('button', { name: 'Un comensal más' });

/** Lleva N al valor pedido desde el estado actual (piso incluido). */
async function ponerN(page: Page, n: number): Promise<void> {
  for (let i = 0; i < 60; i += 1) {
    const actual = Number(await page.locator('.division-stepper .stepper .val').textContent());
    if (actual === n) return;
    await (Number.isNaN(actual) || actual < n ? mas(page) : page.getByRole('button', { name: 'Un comensal menos' })).click();
  }
  throw new Error(`no se llegó a N=${n}`);
}

async function medir(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector('.division-stepper')!.getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(document.querySelector('.division-stepper-title')!);
    const titulo = r.getBoundingClientRect();
    const boton = (nombre: string) =>
      document.querySelector(`.division-stepper .stepper button[aria-label="${nombre}"]`)!.getBoundingClientRect();
    const menos = boton('Un comensal menos');
    const mas = boton('Un comensal más');
    return {
      centro: card.left + card.width / 2,
      tituloCentro: (titulo.left + titulo.right) / 2,
      grupoCentro: (menos.left + mas.right) / 2,
      menos: menos.left,
      mas: mas.left,
    };
  });
}

/** El color computado de un token, para comparar bordes sin escribir el valor a mano. */
async function colorDelToken(page: Page, token: string): Promise<string> {
  return page.evaluate((tk) => {
    const el = document.createElement('span');
    el.style.color = `var(${tk})`;
    document.body.append(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, token);
}

/**
 * D377 · ningún monto al lado del contador. Antes de llamarla, el control
 * positivo (el grupo con su «—» o su número): si no, una ausencia pasa sin
 * probar nada. Se mira el texto (que también ve una copia invisible) y las
 * clases que tenía el monto.
 */
async function sinMonto(page: Page): Promise<void> {
  const tarjeta = page.locator('.division-stepper');
  await expect(tarjeta).not.toContainText('$');
  await expect(tarjeta).not.toContainText('c/u');
  await expect(tarjeta.locator('.split-amt, .split-amt-lbl, .reserva-monto, .marcador-monto, .marcador-rotulo, .division-stepper-monto')).toHaveCount(0);
}

for (const [ancho, alto] of [[390, 664], [375, 667]] as const) {
  test.describe(`AF-CENTRAR-CUANTOS-PAGAN · D377 · a ${ancho}×${alto}`, () => {
    for (const forma of FORMAS) {
      test(`🔴 «${forma.nombre}»: título y grupo «− N +» centrados, sin monto al lado; sin número, el borde punteado`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await hastaComoDividen(page);
        await page.getByRole('radio', { name: forma.radio }).click();
        await expect(page.getByRole('radio', { name: forma.radio })).toHaveAttribute('aria-checked', 'true');
        const grupo = page.getByRole('group', { name: forma.pregunta, exact: true });
        const tarjeta = page.locator('.division-stepper');
        const advertencia = await colorDelToken(page, '--warning');
        expect(advertencia, 'el token existe y no es el del borde de siempre').not.toBe(await colorDelToken(page, '--border'));

        // Sin número: «—», sin monto y el borde punteado en --warning.
        await expect(grupo.locator('.val')).toHaveText('—');
        await sinMonto(page);
        await expect(tarjeta).toHaveCSS('border-top-style', 'dashed');
        await expect(tarjeta).toHaveCSS('border-top-color', advertencia);
        const sin = await medir(page);
        const ds = JSON.stringify(sin);
        expect(Math.abs(sin.tituloCentro - sin.centro), `título sin número · ${ds}`).toBeLessThanOrEqual(2);
        expect(Math.abs(sin.grupoCentro - sin.centro), `grupo sin número · ${ds}`).toBeLessThanOrEqual(2);
        await capturar(page, `cuantos-pagan-${ancho}x${alto}-${forma.piso === 2 ? 'iguales' : forma.nombre === 'Pagar el total' ? 'total' : 'consumo'}-sin-numero`);

        // Con número: el número, sin monto y el borde sólido.
        await ponerN(page, 4);
        await expect(grupo.locator('.val')).toHaveText('4');
        await sinMonto(page);
        await expect(tarjeta).toHaveCSS('border-top-style', 'solid');
        const m = await medir(page);
        const d = JSON.stringify(m);
        expect(Math.abs(m.tituloCentro - m.centro), `título · ${d}`).toBeLessThanOrEqual(2);
        expect(Math.abs(m.grupoCentro - m.centro), `grupo · ${d}`).toBeLessThanOrEqual(2);
        await capturar(page, `cuantos-pagan-${ancho}x${alto}-${forma.piso === 2 ? 'iguales' : forma.nombre === 'Pagar el total' ? 'total' : 'consumo'}-con-numero`);
      });
    }

    for (const forma of FORMAS) {
      test(`«${forma.nombre}»: el «−» y el «+» no se mueven al cambiar N (${forma.piso}, 9, 12, 20 y 50), tampoco al primer toque`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await hastaComoDividen(page);
        await page.getByRole('radio', { name: forma.radio }).click();
        const antes = await medir(page);
        const posiciones: Array<{ menos: number; mas: number }> = [];
        for (const n of [forma.piso, 9, 12, 20, 50]) {
          await ponerN(page, n);
          await expect(page.locator('.division-stepper .stepper .val')).toHaveText(String(n));
          const { menos, mas: x } = await medir(page);
          posiciones.push({ menos, mas: x });
        }
        const d = JSON.stringify({ antes, posiciones });
        for (const p of [...posiciones, antes]) {
          expect(Math.abs(p.mas - posiciones[0]!.mas), `+ · ${d}`).toBeLessThanOrEqual(1);
          expect(Math.abs(p.menos - posiciones[0]!.menos), `− · ${d}`).toBeLessThanOrEqual(1);
        }
      });
    }
  });
}
