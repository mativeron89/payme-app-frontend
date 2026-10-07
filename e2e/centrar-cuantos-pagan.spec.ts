import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { sacarFoto } from './_camara';

/**
 * AF-CENTRAR-CUANTOS-PAGAN · pedido 136 de Mati: «Centra el ¿Cuántos pagan?»,
 * sobre la captura de 0.209.0 a 390×664, donde el título y el selector iban a
 * la izquierda y el monto por persona a la derecha.
 *
 * - El título, centrado.
 * - El grupo `– N +` con el monto, JUNTO y centrado en la tarjeta.
 * - El «+» no se mueve bajo el dedo al cambiar N (1, 9 y 12).
 * - Sigue entrando todo en una vista a 390×664 y 375×667 (pedido 127).
 *
 * 🔴 Se mide el TEXTO (con un `Range`), no la caja: un título de ancho completo
 * con el texto a la izquierda tiene la caja centrada. Y en la base el selector
 * y el monto están en los dos bordes (`space-between`), así que su extensión
 * conjunta TAMBIÉN está centrada; lo que no hay es grupo. Por eso además se
 * pide que el monto esté pegado al selector.
 *
 * 🔴 D181 · los montos ya no miden todos lo mismo («$840», «$93.34»): con el
 * «+» fijo y el monto pegado al selector, el grupo VISIBLE no puede quedar
 * centrado para todos los montos a la vez. Lo que se centra es el LUGAR del
 * grupo: el selector y la caja reservada para el monto más ancho posible
 * (`reservaDelMonto`). Un monto más corto que la reserva deja el grupo visible
 * corrido a la izquierda, a lo sumo la mitad de lo que le falta: se mide eso.
 */

const FORMAS = [
  { nombre: 'Pagar el total', radio: /Pagar el total/ },
  { nombre: 'En partes iguales', radio: /En partes iguales/ },
  { nombre: 'Por lo que pidió cada uno', radio: /Por lo que pidió cada uno/ },
] as const;

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

const mas = (page: Page) => page.getByRole('button', { name: 'Un comensal más' });

/** Lleva N al valor pedido desde el estado actual (piso incluido). */
async function ponerN(page: Page, n: number): Promise<void> {
  for (let i = 0; i < 25; i += 1) {
    const actual = Number(await page.locator('.division-stepper .stepper .val').textContent());
    if (actual === n) return;
    await (Number.isNaN(actual) || actual < n ? mas(page) : page.getByRole('button', { name: 'Un comensal menos' })).click();
  }
  throw new Error(`no se llegó a N=${n}`);
}

async function medir(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector('.division-stepper')!.getBoundingClientRect();
    const texto = (el: Element) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      return r.getBoundingClientRect();
    };
    const titulo = texto(document.querySelector('.division-stepper-title')!);
    const stepper = document.querySelector('.division-stepper .stepper')!.getBoundingClientRect();
    // Lo VISIBLE del monto: el importe y su rótulo («c/u» o «base de propina ·
    // c/u»), o sin número el marcador «$—» y su rótulo. Nunca la reserva
    // invisible de ancho (`.reserva-monto`).
    const montoEl = document.querySelector('.division-stepper .split-amt, .division-stepper .marcador-monto');
    const rotuloEl = document.querySelector('.division-stepper .split-amt-lbl, .division-stepper .marcador-rotulo');
    const monto = montoEl ? texto(montoEl) : null;
    const rotulo = rotuloEl ? texto(rotuloEl) : null;
    const boton = document.querySelector('.division-stepper .stepper button[aria-label="Un comensal más"]')!.getBoundingClientRect();
    const derecha = Math.max(stepper.right, monto?.right ?? 0, rotulo?.right ?? 0);
    const izquierdaMonto = monto ? Math.min(monto.left, rotulo?.left ?? Infinity) : null;
    // El lugar del grupo: el selector y la caja del monto (que reserva el más ancho).
    const caja = document.querySelector('.division-stepper-monto')!.getBoundingClientRect();
    return {
      centro: card.left + card.width / 2,
      tituloCentro: (titulo.left + titulo.right) / 2,
      grupoCentro: (stepper.left + caja.right) / 2,
      // Lo que el grupo visible se corre: la mitad de lo que el monto no llena de la caja.
      corrimientoVisible: (stepper.left + derecha) / 2 - (stepper.left + caja.right) / 2,
      faltante: caja.right - derecha,
      hueco: izquierdaMonto === null ? null : izquierdaMonto - stepper.right,
      mas: boton.left,
    };
  });
}

for (const [ancho, alto] of [[390, 664], [375, 667]] as const) {
  test.describe(`AF-CENTRAR-CUANTOS-PAGAN · a ${ancho}×${alto}`, () => {
    for (const forma of FORMAS) {
      test(`🔴 «${forma.nombre}»: título y grupo «– N + monto» centrados, el monto junto al selector`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await hastaComoDividen(page);
        await page.getByRole('radio', { name: forma.radio }).click();

        // Sin número: el marcador apagado ocupa el lugar del monto y el grupo
        // ya se lee centrado.
        const marcador = page.locator('.division-stepper .marcador-monto');
        await expect(marcador).toHaveText('$—');
        await expect(marcador).toHaveAttribute('aria-hidden', 'true');
        const grises = await page.evaluate(() => {
          const c = (s: string) => getComputedStyle(document.querySelector(s)!).color;
          return { marcador: c('.division-stepper .marcador-monto'), rotulo: c('.division-stepper .marcador-rotulo') };
        });
        expect(grises.marcador, 'el marcador va en el gris del texto secundario').toBe(grises.rotulo);
        const sin = await medir(page);
        const ds = JSON.stringify(sin);
        expect(Math.abs(sin.tituloCentro - sin.centro), `título sin número · ${ds}`).toBeLessThanOrEqual(2);
        expect(Math.abs(sin.grupoCentro - sin.centro), `grupo sin número · ${ds}`).toBeLessThanOrEqual(2);
        if (forma.nombre === 'Pagar el total') await capturar(page, `cuantos-pagan-${ancho}x${alto}-sin-numero`);

        await ponerN(page, 4);
        await expect(page.locator('.division-stepper .split-amt[aria-live]')).toBeVisible();
        await expect(marcador).toHaveCount(0);
        const m = await medir(page);
        const d = JSON.stringify(m);
        expect(Math.abs(m.tituloCentro - m.centro), `título · ${d}`).toBeLessThanOrEqual(2);
        expect(Math.abs(m.grupoCentro - m.centro), `grupo · ${d}`).toBeLessThanOrEqual(2);
        // D181 · el monto entra en su reserva: si la pasara, la caja crecería y el «+» se correría.
        expect(m.faltante, `el monto entra en la reserva · ${d}`).toBeGreaterThanOrEqual(-1);
        expect(m.hueco, `el monto va junto al selector · ${d}`).not.toBeNull();
        // Junto al selector: con «c/u» el monto define el ancho y el hueco es el
        // del grupo (12). Por consumo lo define «base de propina · c/u», que a
        // 375 se parte en dos líneas alineadas a la derecha y deja más aire: ahí
        // se pide sólo el centrado.
        if (forma.nombre !== 'Por lo que pidió cada uno') {
          expect(m.hueco!, `el monto va junto al selector · ${d}`).toBeLessThanOrEqual(16);
        }
        if (forma.nombre === 'Pagar el total') await capturar(page, `cuantos-pagan-${ancho}x${alto}-con-numero`);
      });
    }

    // «Pagar el total» (con «c/u», el monto define el ancho) y «Por lo que pidió
    // cada uno» (lo define «base de propina · c/u»). Las dos arrancan en 1.
    for (const forma of [FORMAS[0], FORMAS[2]]) {
      test(`«${forma.nombre}»: el «+» no se mueve al cambiar N (1, 9 y 12), tampoco al primer toque`, async ({ page }) => {
        await page.setViewportSize({ width: ancho, height: alto });
        await hastaComoDividen(page);
        await page.getByRole('radio', { name: forma.radio }).click();
        const antes = (await medir(page)).mas;
        const posiciones: number[] = [];
        for (const n of [1, 9, 12]) {
          await ponerN(page, n);
          posiciones.push((await medir(page)).mas);
        }
        for (const x of [...posiciones, antes]) {
          expect(Math.abs(x - posiciones[0]!), JSON.stringify({ antes, posiciones })).toBeLessThanOrEqual(1);
        }
      });
    }
  });
}
