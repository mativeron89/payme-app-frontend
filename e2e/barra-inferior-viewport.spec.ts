import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * E173-2 · decisión 173 de Mati, con capturas de su iPhone, las dos en la app
 * agregada a inicio (corrección del lease; en Safari la barra se ve bien):
 * - al abrir: «la barra inferior queda desfasada más arriba, tengo que subir y
 *   bajar para que se ajuste a la pantalla»;
 * - «la barra inferior no queda correctamente abajo dejando mucho espacio en
 *   blanco».
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

/**
 * E173-2 · la app agregada a inicio, SIMULADA. Las capturas 5 y 6 de Mati son en
 * modo standalone, no en Safari.
 *
 * Chromium no puede ser la app de inicio de iOS: ignora `display-mode` en la
 * emulación (medido) y no tiene el defecto de WebKit. Lo que se simula son las
 * SEÑALES que iOS le da al código, para probar que la corrección se arma y se
 * desarma:
 * - `navigator.standalone === true`, que en iOS sólo existe en la app de inicio;
 * - `screen.width`/`screen.height` del iPhone (390×844);
 * - el viewport achicado en el inset superior (844 − 59 = 785), que es el defecto;
 * - el inset superior de 59 px, que se inyecta en la medida de la sonda: en
 *   Chromium `env(safe-area-inset-top)` vale 0.
 * No acredita que el iPhone se comporte así: eso lo prueba Mati.
 */
const ALTO_PANTALLA = 844;
const INSET_SUPERIOR = 59;

async function simularIos(page: Page, opciones: { standalone: boolean }): Promise<void> {
  await page.addInitScript(({ standalone, alto, inset }) => {
    if (standalone) Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    Object.defineProperty(Screen.prototype, 'height', { configurable: true, get: () => alto });
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: () => 390 });
    const original = window.getComputedStyle.bind(window);
    window.getComputedStyle = ((el: Element, pseudo?: string | null) => {
      const estilo = original(el, pseudo);
      if (!(el instanceof HTMLElement) || !el.classList.contains('viewport-sonda')) return estilo;
      return new Proxy(estilo, {
        get: (target, prop) => (prop === 'paddingTop' ? `${inset}px` : Reflect.get(target, prop, target)),
      });
    }) as typeof window.getComputedStyle;
  }, { standalone: opciones.standalone, alto: ALTO_PANTALLA, inset: INSET_SUPERIOR });
}

const variableAlto = (page: Page) =>
  page.evaluate(() => document.documentElement.style.getPropertyValue('--app-alto-standalone'));

test.describe('E173-2 · app de inicio de iOS, simulada', () => {
  test('🔴 viewport achicado al abrir: la barra llega al alto real de la pantalla, y la corrección se va cuando WebKit se corrige', async ({ page }) => {
    await simularIos(page, { standalone: true });
    await page.setViewportSize({ width: 390, height: ALTO_PANTALLA - INSET_SUPERIOR });
    await ingresar(page);
    await expect(page.locator('.appbar-block')).toBeVisible();
    expect(await variableAlto(page)).toBe(`${ALTO_PANTALLA}px`);
    const achicado = await medir(page);
    expect(achicado.appBottom, JSON.stringify(achicado)).toBeCloseTo(ALTO_PANTALLA, 0);
    expect(achicado.barraBottom, JSON.stringify(achicado)).toBeCloseTo(ALTO_PANTALLA, 0);

    // WebKit se corrige solo (en el iPhone, al primer scroll): el viewport vuelve
    // al alto real y la corrección se retira.
    await page.setViewportSize({ width: 390, height: ALTO_PANTALLA });
    await expect.poll(() => variableAlto(page)).toBe('');
    const sano = await medir(page);
    expect(sano.barraBottom, JSON.stringify(sano)).toBeCloseTo(ALTO_PANTALLA, 0);
    expect(sano.alBorde, JSON.stringify(sano)).toEqual([true, true, true]);
  });

  test('Safari (sin navigator.standalone), mismo viewport corto: no corrige, la barra termina en el viewport', async ({ page }) => {
    await simularIos(page, { standalone: false });
    await page.setViewportSize({ width: 390, height: ALTO_PANTALLA - INSET_SUPERIOR });
    await ingresar(page);
    await expect(page.locator('.appbar-block')).toBeVisible();
    expect(await variableAlto(page)).toBe('');
    const m = await medir(page);
    expect(m.barraBottom, JSON.stringify(m)).toBeCloseTo(ALTO_PANTALLA - INSET_SUPERIOR, 0);
    expect(m.alBorde, JSON.stringify(m)).toEqual([true, true, true]);
  });

  test('app de inicio con una ventana más chica a propósito (el faltante no es el inset): no corrige', async ({ page }) => {
    await simularIos(page, { standalone: true });
    await page.setViewportSize({ width: 390, height: 700 });
    await ingresar(page);
    await expect(page.locator('.appbar-block')).toBeVisible();
    expect(await variableAlto(page)).toBe('');
    const m = await medir(page);
    expect(m.barraBottom, JSON.stringify(m)).toBeCloseTo(700, 0);
  });
});
