import { expect, test, type Page } from '@playwright/test';

/**
 * AF-LOGIN-D73 · (A) en Chrome de iPhone, al desplazarse, la tarjeta de ingreso
 * quedaba CORTADA: ni el botón de Google ni «Crea tu cuenta» (captura de Mati).
 *
 * `.app` tiene `height: 100dvh` y `overflow: hidden`, y `.ingreso` no era un
 * contenedor de desplazamiento: lo que no entraba se recortaba. Playwright no lo
 * veía porque `click()` desplaza por código hasta un `overflow: hidden`; un dedo
 * no puede. Este spec modela al dedo: sólo desplaza el documento y los
 * contenedores `overflow: auto|scroll`, y recién ahí mira con
 * `elementFromPoint` si el último elemento está a la vista.
 *
 * Tamaño de iPhone 14 (390×664 en Playwright). Corre en Chromium, que es el
 * navegador del CI: el recorte es de layout, no de WebKit. Contra WebKit se
 * midió en la orden (CIERRE).
 */
test.use({ viewport: { width: 390, height: 664 } });

async function desplazarComoUnDedo(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scrolleables = [...document.querySelectorAll<HTMLElement>('*')].filter((el) => {
      const oy = getComputedStyle(el).overflowY;
      return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight;
    });
    for (const el of scrolleables) el.scrollTop = el.scrollHeight;
    const doc = document.scrollingElement;
    if (doc) doc.scrollTop = doc.scrollHeight;
  });
}

async function aLaVista(page: Page, nombre: string): Promise<boolean> {
  return page.evaluate((texto) => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent ?? '').trim() === texto);
    if (!b) return false;
    const r = b.getBoundingClientRect();
    if (r.bottom > window.innerHeight || r.top < 0) return false;
    const enPunto = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!enPunto && (enPunto === b || b.contains(enPunto));
  }, nombre);
}

for (const encendido of [true, false]) {
  test(`«Crea tu cuenta» se alcanza desplazándose (paquete legal ${encendido ? 'encendido' : 'apagado'})`, async ({ page }) => {
    await page.addInitScript((on) => {
      if (on) localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
      localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    }, encendido);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    // La pantalla ya se armó entera (Google y el pie cargados).
    await expect(page.getByRole('button', { name: 'Crea tu cuenta', exact: true })).toHaveCount(1);
    await desplazarComoUnDedo(page);
    expect(await aLaVista(page, 'Crea tu cuenta'), 'el pie de la tarjeta quedó fuera del alcance del dedo').toBe(true);
  });
}
