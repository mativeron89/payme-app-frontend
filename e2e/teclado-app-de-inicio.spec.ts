import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D182 · decisión 182 de Mati: «cuando selecciono el buscador en amigos, la
 * burbuja se rompe». En la captura 15 (app de inicio) la página entera subió
 * ≈ 58 pt con el teclado abierto, y el encabezado quedó bajo la barra de estado.
 * Y la condición (b) del Bibliotecario: con la cadena en 852 y el viewport corto
 * en 793, el documento no se puede arrastrar 59 px.
 *
 * 🔴 LO QUE ESTO NO PRUEBA: Chromium no tiene teclado de iOS ni el viewport
 * corto de WebKit. Se SIMULA lo que se puede:
 * - el documento 59 px más alto que el viewport (lo que en el iPhone hace la
 *   cadena en 852 con el viewport en 793), con una regla de prueba;
 * - el corrimiento de iOS al abrir el teclado, como un scroll del documento de
 *   58 px después de enfocar el campo.
 * Si iOS corre la página así (con `scrollY`) o corriendo el visualViewport lo
 * dice el panel de diagnóstico del iPhone de Mati («teclado: …»).
 */

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function preparar(page: Page, appDeInicio: boolean): Promise<void> {
  await page.addInitScript((enApp) => {
    if (enApp) Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
  }, appDeInicio);
  await page.setViewportSize({ width: 393, height: 794 });
  await ingresar(page);
  // Simulación: el documento 59 px más alto que el viewport, como 852 contra 793.
  // (Desde un init script se perdía a veces: va después de cargar.)
  await page.addStyleTag({ content: 'html { height: calc(100% + 59px) !important; }' });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBe(59);
}

async function abrirAmigos(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Amigos/ }).click();
  await expect(buscador(page)).toBeVisible();
}

const buscador = (page: Page) => page.getByPlaceholder('Buscar entre tus amigos');
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const corrimientoDeIos = (page: Page) => page.evaluate(() => window.scrollTo(0, 58));
const appTop = (page: Page) => page.evaluate(() => document.querySelector('.app')!.getBoundingClientRect().top);
const ultimo = (page: Page) => page.evaluate(async () => {
  const ruta = '/src/tecladoAppDeInicio.ts';
  const m = await import(/* @vite-ignore */ ruta) as { ultimoTeclado: () => unknown };
  return m.ultimoTeclado();
});

async function tocar(page: Page, ...tipos: Array<'touchstart' | 'touchmove' | 'touchend'>): Promise<void> {
  await page.evaluate((ts) => { for (const t of ts) window.dispatchEvent(new Event(t)); }, tipos);
}

test.describe('en la app de inicio de iOS (simulada)', () => {
  test.use({ userAgent: SAFARI_IPHONE });

  /*
   * El gesto: la rueda, no un arrastre táctil sintético. En el Chromium del CI
   * (Linux, headless) `Input.synthesizeScrollGesture` táctil no movía el
   * documento ni sin la regla (run 37332146088: el testigo dio 0), así que con
   * él la aserción principal no probaba nada ahí. La rueda es un scroll del
   * usuario que la misma regla frena y que se entrega por el mismo camino en
   * todas las plataformas; el testigo lo comprueba en cada corrida. El arrastre
   * con el dedo en el iPhone es la prueba de Mati.
   */
  test('🔴 (b) el documento más alto que el viewport no se mueve con un scroll del usuario', async ({ page }) => {
    await preparar(page, true);
    await page.evaluate(() => {
      (window as unknown as { ruedas: number }).ruedas = 0;
      window.addEventListener('wheel', () => { (window as unknown as { ruedas: number }).ruedas += 1; }, { passive: true });
    });
    const ruedas = () => page.evaluate(() => (window as unknown as { ruedas: number }).ruedas);
    // Sobre el encabezado, que no scrollea: el scroll que no consume encadena al documento.
    const girar = async () => {
      const antes = await ruedas();
      await page.mouse.move(196, 30);
      await page.mouse.wheel(0, 200);
      // Control positivo: la rueda llegó a la página.
      await expect.poll(ruedas).toBeGreaterThan(antes);
    };
    // El documento es scrolleable: por programa se mueve (la regla no frena eso).
    await page.evaluate(() => window.scrollTo(0, 30));
    expect(await scrollY(page)).toBe(30);
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await scrollY(page)).toBe(0);
    await girar();
    await page.waitForTimeout(500);
    expect(await scrollY(page)).toBe(0);
    // Testigo: sin el `overflow: hidden` de html, la misma rueda sí lo mueve.
    await page.addStyleTag({ content: 'html.app-de-inicio-ios { overflow: visible !important; }' });
    await girar();
    await expect.poll(() => scrollY(page)).toBeGreaterThan(0);
  });

  test('🔴 D182 · con el buscador de Amigos enfocado, el documento corrido vuelve a 0 y el encabezado a su lugar', async ({ page }) => {
    await preparar(page, true);
    await abrirAmigos(page);
    await buscador(page).focus();
    await corrimientoDeIos(page);
    await expect.poll(() => scrollY(page)).toBe(0);
    expect(await appTop(page)).toBe(0);
    await expect(buscador(page)).toBeInViewport();
    await expect(buscador(page)).toBeFocused();
    // El panel guarda lo que dejó «iOS», antes de corregir.
    expect(await ultimo(page)).toMatchObject({ scrollY: 58, appTop: -58, campo: 'Buscar entre tus amigos', reajustes: 1 });
    // Y lo muestra: con el teclado cerrado, 5 toques en el logo.
    await buscador(page).blur();
    for (let i = 0; i < 5; i += 1) await page.locator('.hdr-mark-toques .hdr-mark').first().click();
    const panel = page.getByRole('dialog', { name: 'Diagnóstico de pantalla' });
    await expect(panel).toBeVisible();
    const fila = (clave: string) => panel.locator('.diag-fila').filter({ has: page.getByText(clave, { exact: true }) }).locator('dd');
    await expect(fila('teclado: scrollY · .app top')).toHaveText('58 · -58');
    await expect(fila('teclado: campo · reajustes')).toHaveText('Buscar entre tus amigos · 1');
    await expect(fila('html class')).toHaveText('app-de-inicio-ios');
  });

  test('sin un campo de texto enfocado no toca el documento (aunque lo enfocado esté en la lista)', async ({ page }) => {
    await preparar(page, true);
    await abrirAmigos(page);
    // Un botón dentro del `.scroll` de Amigos: enfocado, pero no es un campo de texto.
    await page.locator('.app .scroll button').first().focus();
    await corrimientoDeIos(page);
    await page.waitForTimeout(300);
    expect(await scrollY(page)).toBe(58);
  });

  test('con un dedo apoyado no corrige; al soltarlo (un toque, sin arrastre), sí', async ({ page }) => {
    await preparar(page, true);
    await abrirAmigos(page);
    await tocar(page, 'touchstart');
    await buscador(page).focus();
    await corrimientoDeIos(page);
    await page.waitForTimeout(300);
    expect(await scrollY(page)).toBe(58);
    await tocar(page, 'touchend');
    await page.evaluate(() => window.scrollTo(0, 57));
    // Un toque no es un arrastre: corrige enseguida, sin los 500 ms de espera.
    await expect.poll(() => scrollY(page), { timeout: 400 }).toBe(0);
  });

  test('en el impulso de un arrastre espera 500 ms y después corrige', async ({ page }) => {
    await preparar(page, true);
    await abrirAmigos(page);
    await buscador(page).focus();
    await tocar(page, 'touchstart', 'touchmove', 'touchend');
    await corrimientoDeIos(page);
    await page.waitForTimeout(250);
    expect(await scrollY(page)).toBe(58);
    await expect.poll(() => scrollY(page), { timeout: 3000 }).toBe(0);
  });

  test('si «iOS» insiste, corrige tres veces y lo deja: no pelea', async ({ page }) => {
    await preparar(page, true);
    await abrirAmigos(page);
    await page.evaluate(() => {
      let veces = 0;
      document.addEventListener('scroll', () => {
        if (window.scrollY === 0 && veces < 10) {
          veces += 1;
          requestAnimationFrame(() => window.scrollTo(0, 58));
        }
      });
    });
    await buscador(page).focus();
    await corrimientoDeIos(page);
    await page.waitForTimeout(1000);
    expect(await scrollY(page)).toBe(58);
    expect(await ultimo(page)).toMatchObject({ reajustes: 3 });
  });

  test('un campo fuera de la vista de su contenedor vuelve a verse moviendo el contenedor, no el documento', async ({ page }) => {
    await preparar(page, true);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('button', { name: /Editar/ }).first().click();
    // El campo del @, un campo de texto de verdad. (Un `input` cualquiera tomaba el
    // de la foto, que es `file` y está fuera del flujo: el test no probaba nada.)
    const campo = page.locator('#config-arroba-campo');
    await expect(campo).toBeVisible();
    const aLaVista = () => campo.evaluate((el) => {
      const c = el.closest('.scroll')!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.top >= c.top && r.bottom <= c.bottom;
    });
    // El contenedor, scrolleado hasta abajo: el campo queda por encima de lo visible.
    await page.locator('.app .scroll').first().evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect(await aLaVista()).toBe(false);
    await campo.evaluate((el: HTMLElement) => el.focus({ preventScroll: true }));
    await expect.poll(aLaVista).toBe(true);
    expect(await scrollY(page)).toBe(0);
  });
});

test.describe('en Safari del iPhone', () => {
  test.use({ userAgent: SAFARI_IPHONE });

  test('no hay corrección: el documento corrido queda como lo deja el navegador', async ({ page }) => {
    // En Safari del iPhone sale la guía «Agregar a inicio» (D176) sobre Inicio: ya vista.
    await page.addInitScript(() => localStorage.setItem('payme.app.agregar_a_inicio.v1', '1'));
    await preparar(page, false);
    await abrirAmigos(page);
    await buscador(page).focus();
    await corrimientoDeIos(page);
    await page.waitForTimeout(300);
    expect(await scrollY(page)).toBe(58);
    expect(await ultimo(page)).toBeNull();
  });
});
