import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * D360-8 · en Mesas, a veces al deslizar una mesa a la izquierda no terminaba de
 * aparecer «Eliminar». El gesto ahora (`FilaDeslizable`):
 * - decidido el arrastre horizontal, el navegador ya no empieza un scroll (un
 *   scroll puede cancelar el gesto y la tarjeta volvía sola; que el iPhone lo
 *   haga es probable, no medido);
 * - si el navegador igual lo cancela, la tarjeta queda según lo que se corrió;
 * - un deslizamiento rápido abre aunque no llegue a la mitad del botón.
 *
 * Con el dedo de verdad: eventos táctiles por CDP (sólo Chromium). El puntero
 * del mouse no pasa por `touch-action` ni por la cancelación del navegador, que
 * es justo lo que se prueba. La prueba que vale es la de Mati en el iPhone
 * (D63): WebKit no corre acá.
 */

// CDP es sólo de Chromium, y toda la suite de navegador corre en Chromium
// (`playwright.config.ts`). Sin `test.skip`: en otro navegador estas pruebas
// tienen que fallar a la vista, no saltearse (`corteGuard.test.ts`).
test.use({ viewport: { width: 375, height: 667 } });

const tusMesas = (page: Page) => page.getByRole('region', { name: 'Tus mesas' });
const tarjeta = (page: Page) => tusMesas(page).locator('.tu-mesa').first();
const abierta = (l: Locator) => l.locator('.deslizable--abierta');
const corrimiento = (l: Locator) => l.locator('.deslizable-frente').evaluate(
  (e) => new DOMMatrixReadOnly(getComputedStyle(e).transform).m41,
);

async function aMesas(page: Page): Promise<void> {
  await ingresar(page);
  await irEnLaApp(page, '/mesas');
  await expect(tarjeta(page)).toBeVisible();
}

/** El punto donde apoya el dedo: sobre el nombre, a 120 del borde izquierdo de la tarjeta. */
async function punto(l: Locator): Promise<{ x: number; y: number }> {
  const caja = (await l.boundingBox())!;
  return { x: Math.round(caja.x + 120), y: Math.round(caja.y + Math.min(30, caja.height / 2)) };
}

interface Dedo { readonly cdp: CDPSession; x: number; y: number }

async function apoyar(page: Page, l: Locator): Promise<Dedo> {
  const cdp = await page.context().newCDPSession(page);
  const p = await punto(l);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  return { cdp, x: p.x, y: p.y };
}

/**
 * Mueve el dedo en `pasos` tramos iguales. 🔴 EXCEPCIÓN DECLARADA a la
 * convención «cero waitForTimeout» (e2e/_app.ts): acá la espera no aguarda un
 * estado, marca el RITMO del gesto, que es lo que se prueba (despacio = 30 ms
 * por tramo; rápido = sin espera).
 */
async function mover(page: Page, dedo: Dedo, dx: number, dy: number, pasos: number, msPorPaso: number): Promise<void> {
  const x0 = dedo.x;
  const y0 = dedo.y;
  for (let k = 1; k <= pasos; k += 1) {
    dedo.x = Math.round(x0 + (dx * k) / pasos);
    dedo.y = Math.round(y0 + (dy * k) / pasos);
    await dedo.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: dedo.x, y: dedo.y }] });
    if (msPorPaso > 0) await page.waitForTimeout(msPorPaso);
  }
}

async function soltar(dedo: Dedo): Promise<void> {
  await dedo.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await dedo.cdp.detach();
}

/** Lo que hace el navegador cuando se queda con el gesto (se cree que el iPhone lo hace al empezar un scroll; no medido). */
async function cancelar(dedo: Dedo): Promise<void> {
  await dedo.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await dedo.cdp.detach();
}

async function cerradaYQuieta(l: Locator): Promise<void> {
  await expect(abierta(l)).toHaveCount(0);
  await expect(l.locator('.deslizable-frente')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
}

async function abiertaYQuieta(l: Locator): Promise<void> {
  await expect(abierta(l)).toHaveCount(1);
  await expect.poll(() => corrimiento(l)).toBe(-96);
  await expect(l.locator('.deslizable-eliminar')).toBeInViewport({ ratio: 1 });
}

test.describe('D360-8 · deslizar una mesa con el dedo', () => {
  test('despacio, 60 px (pasada la mitad): abre; despacio, 30: vuelve', async ({ page }) => {
    await aMesas(page);
    const mesa = tarjeta(page);
    let dedo = await apoyar(page, mesa);
    await mover(page, dedo, -60, 0, 8, 30);
    await soltar(dedo);
    await abiertaYQuieta(mesa);
    // Tocar la tarjeta la cierra (lo de siempre).
    await mesa.locator('.deslizable-frente').click();
    await cerradaYQuieta(mesa);

    dedo = await apoyar(page, mesa);
    await mover(page, dedo, -30, 0, 8, 30);
    await soltar(dedo);
    await cerradaYQuieta(mesa);
  });

  test('🔴 rápido, 40 px: abre aunque no llegue a la mitad; despacio, los mismos 40: vuelve', async ({ page }) => {
    await aMesas(page);
    const mesa = tarjeta(page);
    // Despacio: 40 px en 8 tramos con 30 ms de espera. Medido: Chromium entrega un
    // movimiento cada ~42 ms, ≈ 0.12 px/ms, por debajo de 0.4. Manda la mitad (48): vuelve.
    let dedo = await apoyar(page, mesa);
    await mover(page, dedo, -40, 0, 8, 30);
    await soltar(dedo);
    await cerradaYQuieta(mesa);
    // Rápido: los mismos 40 px en 2 tramos sin espera. Chromium entrega los
    // movimientos de a uno por cuadro (medido: 16,7 ms entre ellos aun sin
    // esperas), así que 8 tramos daban 0.29 px/ms; con 2, ≈ 1.2 px/ms. Pasa el
    // tercio (32) y abre.
    dedo = await apoyar(page, mesa);
    await mover(page, dedo, -40, 0, 2, 0);
    await soltar(dedo);
    await abiertaYQuieta(mesa);
  });

  test('🔴 si el navegador cancela en medio del arrastre, la tarjeta queda según lo que se corrió (no vuelve sola)', async ({ page }) => {
    await aMesas(page);
    const mesa = tarjeta(page);
    // Corrida 70 (pasada la mitad) y el navegador se queda con el gesto: queda abierta.
    let dedo = await apoyar(page, mesa);
    await mover(page, dedo, -70, 0, 8, 30);
    await cancelar(dedo);
    await abiertaYQuieta(mesa);
    await mesa.locator('.deslizable-frente').click();
    await cerradaYQuieta(mesa);
    // Corrida 30 y cancelado: vuelve, como al soltar ahí.
    dedo = await apoyar(page, mesa);
    await mover(page, dedo, -30, 0, 8, 30);
    await cancelar(dedo);
    await cerradaYQuieta(mesa);
  });

  test('🔴 decidido el arrastre a la izquierda, si el dedo además sube la lista no se desplaza y la tarjeta abre', async ({ page }) => {
    await aMesas(page);
    const mesa = tarjeta(page);
    const scroll = page.locator('.scroll.history-scroll');
    // Control positivo: la lista tiene para desplazarse hacia abajo; si no, que no
    // se mueva no probaría nada.
    expect(await scroll.evaluate((s) => s.scrollHeight - s.clientHeight - s.scrollTop)).toBeGreaterThan(60);
    const antes = await scroll.evaluate((s) => s.scrollTop);
    const dedo = await apoyar(page, mesa);
    // Primero a la izquierda (pasa el umbral de 8 y decide el arrastre)…
    await mover(page, dedo, -40, 0, 6, 30);
    // …después sigue a la izquierda y sube 60 (lo que desplazaría la lista hacia
    // abajo): antes de D360 el navegador podía empezar el scroll, cancelar el
    // gesto y la tarjeta volvía.
    await mover(page, dedo, -40, -60, 8, 30);
    await soltar(dedo);
    await abiertaYQuieta(mesa);
    expect(await scroll.evaluate((s) => s.scrollTop)).toBe(antes);
  });
});
