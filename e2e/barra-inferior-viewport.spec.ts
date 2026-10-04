import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * E173-2 · decisión 173 de Mati, con capturas de su iPhone:
 * - app agregada a inicio: «la barra inferior queda desfasada más arriba,
 *   tengo que subir y bajar para que se ajuste a la pantalla»;
 * - Safari: «la barra inferior no queda correctamente abajo dejando mucho
 *   espacio en blanco».
 *
 * 🔴 LO QUE ESTO NO PRUEBA, dicho antes que lo que sí: corre en Chromium con
 * `isMobile` (proyecto `movil`), no en Safari de iOS. Ahí `100dvh` coincide
 * siempre con el viewport, así que el defecto de iOS no se reproduce y estas
 * mediciones también pasan sobre 0.210.4. El rojo del mecanismo lo da
 * `src/styles/shellViewport.test.ts`; la prueba en el iPhone es de Mati (D63).
 *
 * Lo que sí fija, como red de regresión:
 * - la barra termina exactamente en el borde inferior del viewport y no queda
 *   ningún hueco debajo, en cuatro tamaños de iPhone (390×664 es el alto
 *   visible de Safari en la captura de Mati);
 * - cuando el viewport cambia de alto, como al mostrarse u ocultarse las barras
 *   de Safari, la barra lo sigue sin que nadie haga scroll.
 *
 * La orden sugería repetirlo con `display-mode: standalone` emulado. No se
 * puede acá, medido: este Chromium ignora ese rasgo en
 * `Emulation.setEmulatedMedia` y `matchMedia('(display-mode: standalone)')`
 * sigue en false, antes y después de navegar. Tampoco cambiaría la medición:
 * la app no tiene CSS ni código que dependa de `display-mode`. Lo que difiere
 * en la app de inicio de iOS es cómo WebKit calcula el viewport, que ningún
 * emulador de Chromium reproduce.
 */

const TAMANOS = [
  [390, 664],
  [375, 667],
  [390, 844],
  [430, 932],
] as const;

async function medir(page: Page) {
  return page.evaluate(() => {
    const barra = document.querySelector('.appbar-block')!.getBoundingClientRect();
    const app = document.querySelector('.app')!.getBoundingClientRect();
    const alto = window.innerHeight;
    // Qué hay pegado al borde inferior, en el centro y a los costados de la
    // barra: si quedara un hueco debajo, ahí aparecería otra cosa.
    const xs = [barra.left + 8, barra.left + barra.width / 2, barra.right - 8];
    const alBorde = xs.map((x) => {
      const el = document.elementFromPoint(x, alto - 1);
      return !!el && !!el.closest('.appbar-block');
    });
    return {
      alto,
      barraBottom: barra.bottom,
      appTop: app.top,
      appBottom: app.bottom,
      alBorde,
    };
  });
}

test.describe('E173-2 · barra inferior en el borde', () => {
  for (const [ancho, alto] of TAMANOS) {
    test(`a ${ancho}×${alto}: la barra termina en el borde y no queda hueco debajo`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await ingresar(page);
      await expect(page.locator('.appbar-block')).toBeVisible();
      const m = await medir(page);
      const d = JSON.stringify(m);
      expect(Math.abs(m.barraBottom - m.alto), `la barra termina en el borde · ${d}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.appBottom - m.alto), `.app llega al borde · ${d}`).toBeLessThanOrEqual(1);
      expect(Math.abs(m.appTop), `.app arranca arriba · ${d}`).toBeLessThanOrEqual(1);
      expect(m.alBorde, `lo que toca el borde inferior es la barra · ${d}`).toEqual([true, true, true]);
    });
  }

  test('cuando el viewport cambia de alto, la barra lo sigue sin scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 664 });
    await ingresar(page);
    await expect(page.locator('.appbar-block')).toBeVisible();
    for (const alto of [750, 664, 844]) {
      await page.setViewportSize({ width: 390, height: alto });
      await expect.poll(async () => (await medir(page)).barraBottom).toBeCloseTo(alto, 0);
      const m = await medir(page);
      expect(m.alBorde, JSON.stringify(m)).toEqual([true, true, true]);
    }
  });
});
