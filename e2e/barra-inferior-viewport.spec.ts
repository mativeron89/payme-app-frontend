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
 * E173-2 · la app agregada a inicio, SIMULADA, y la REGRESIÓN de 0.210.5.
 *
 * 0.210.5 agregó una corrección en JS: en la app de inicio, si `innerHeight` era
 * más corto que la pantalla justo en el inset superior, estiraba `.app` hasta el
 * alto de la pantalla. En el iPhone de Mati (captura 7) eso CORTÓ la barra:
 * medido en píxeles, la barra empieza en 762 pt (= 852 − 90, su alto), es decir
 * que `.app` medía 852, pero la app se pinta sólo hasta 793 (= 852 − 59) y lo de
 * abajo queda fuera. 0.211.0 retira la corrección.
 *
 * Lo que se simula son las SEÑALES que iOS le da al código (Chromium no tiene el
 * defecto de WebKit ni respeta `display-mode` en la emulación, medido):
 * `navigator.standalone === true`, la pantalla del iPhone (390×844) y el viewport
 * achicado en el inset (844 − 59 = 785). La regla que se fija, pase lo que pase
 * con esas señales: **la barra nunca se dispone más allá del viewport visible**;
 * a lo sumo queda subida, entera, como en 0.210.4. No acredita el iPhone: eso
 * lo prueba Mati.
 */
const ALTO_PANTALLA = 844;
const INSET_SUPERIOR = 59;

const INSET_INFERIOR = 34;

/**
 * Los insets son REALES: Chromium 151 acepta `Emulation.setSafeAreaInsetsOverride`
 * y `env(safe-area-inset-*)` devuelve 59/34 (medido con una sonda). Así la
 * corrección de 0.210.5 se habría armado con su propia sonda, sin trucos.
 */
async function simularIos(page: Page, opciones: { standalone: boolean }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: {
      top: INSET_SUPERIOR, topMax: INSET_SUPERIOR,
      bottom: INSET_INFERIOR, bottomMax: INSET_INFERIOR,
      left: 0, leftMax: 0, right: 0, rightMax: 0,
    },
  });
  await page.addInitScript(({ standalone, alto }) => {
    if (standalone) Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    Object.defineProperty(Screen.prototype, 'height', { configurable: true, get: () => alto });
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: () => 390 });
  }, { standalone: opciones.standalone, alto: ALTO_PANTALLA });
}

/** Testigo de la simulación: los insets llegan de verdad al CSS de la app. */
async function insetsMedidos(page: Page): Promise<[string, string]> {
  return page.evaluate(() => {
    const s = document.createElement('div');
    s.style.paddingTop = 'env(safe-area-inset-top)';
    s.style.paddingBottom = 'env(safe-area-inset-bottom)';
    document.body.appendChild(s);
    const c = getComputedStyle(s);
    const r: [string, string] = [c.paddingTop, c.paddingBottom];
    s.remove();
    return r;
  });
}

async function enteraEnElViewport(page: Page): Promise<void> {
  const m = await medir(page);
  const extra = await page.evaluate(() => ({
    barraTop: document.querySelector('.appbar-block')!.getBoundingClientRect().top,
    varAlto: document.documentElement.style.getPropertyValue('--app-alto-standalone'),
  }));
  const d = JSON.stringify({ ...m, ...extra });
  expect(m.barraBottom, `la barra no pasa del viewport visible · ${d}`).toBeLessThanOrEqual(m.alto + 1);
  expect(m.appBottom, `.app no pasa del viewport visible · ${d}`).toBeLessThanOrEqual(m.alto + 1);
  expect(extra.barraTop, `la barra empieza adentro · ${d}`).toBeGreaterThanOrEqual(0);
  expect(m.alBorde, `lo que toca el borde visible es la barra · ${d}`).toEqual([true, true, true]);
  expect(extra.varAlto, `nadie impone un alto a .app · ${d}`).toBe('');
}

test.describe('E173-2 · app de inicio de iOS, simulada', () => {
  test('🔴 regresión de 0.210.5: con el viewport achicado al abrir, la barra queda ENTERA dentro de lo visible', async ({ page }) => {
    await simularIos(page, { standalone: true });
    await page.setViewportSize({ width: 390, height: ALTO_PANTALLA - INSET_SUPERIOR });
    await ingresar(page);
    await expect(page.locator('.appbar-block')).toBeVisible();
    expect(await insetsMedidos(page)).toEqual([`${INSET_SUPERIOR}px`, `${INSET_INFERIOR}px`]);
    await enteraEnElViewport(page);

    // Cuando WebKit se corrige (en el iPhone, al primer scroll), la barra baja al borde.
    await page.setViewportSize({ width: 390, height: ALTO_PANTALLA });
    await expect.poll(async () => (await medir(page)).barraBottom).toBeCloseTo(ALTO_PANTALLA, 0);
    await enteraEnElViewport(page);
  });

  test('control · Safari (sin navigator.standalone), mismo viewport corto: la barra entera en el viewport', async ({ page }) => {
    await simularIos(page, { standalone: false });
    await page.setViewportSize({ width: 390, height: ALTO_PANTALLA - INSET_SUPERIOR });
    await ingresar(page);
    await expect(page.locator('.appbar-block')).toBeVisible();
    await enteraEnElViewport(page);
  });
});
