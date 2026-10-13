import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/** D310-E1: las medidas de una maqueta corta no recortan datos reales.
 * Sólo fixtures mock; no sesión, API ni cámara productivas. */
async function captura(page: Page, info: TestInfo, nombre: string) {
  const destino = process.env.AF_CAPTURES_DIR;
  if (!destino) return;
  mkdirSync(destino, { recursive: true });
  const archivo = join(destino, `${nombre}.png`);
  await page.screenshot({ path: archivo, animations: 'disabled' });
  await info.attach(nombre, { path: archivo, contentType: 'image/png' });
}

for (const caso of [
  { ancho: 390, alto: 844, top: 0, bottom: 0 },
  { ancho: 375, alto: 667, top: 0, bottom: 0 },
  { ancho: 320, alto: 568, top: 0, bottom: 0 },
  { ancho: 393, alto: 852, top: 59, bottom: 34 },
]) {
  test(`D310 · barra, paleta y contenido largo a ${caso.ancho}×${caso.alto}, inset ${caso.bottom}`, async ({ page }, info) => {
    await page.setViewportSize({ width: caso.ancho, height: caso.alto });
    if (caso.bottom) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {
        top: caso.top, topMax: caso.top, bottom: caso.bottom, bottomMax: caso.bottom,
        left: 0, leftMax: 0, right: 0, rightMax: 0,
      } });
    }
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    await page.evaluate(() => document.fonts.ready);
    const nav = page.getByRole('navigation', { name: 'Navegación principal' });
    const geometria = await nav.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const fab = el.querySelector('.appbar-fab')!;
      const f = fab.getBoundingClientRect();
      const pie = parseFloat(getComputedStyle(el).paddingBottom);
      return {
        alto: box.height, fab: [f.width, f.height, box.top - f.top], pie,
        fondo: getComputedStyle(fab).backgroundColor,
        sombra: getComputedStyle(fab).boxShadow,
        items: Array.from(el.querySelectorAll('button')).map((b) => {
          const r = b.getBoundingClientRect();
          const label = b.querySelector('.appbar-label')!.getBoundingClientRect();
          return { ancho: r.width, alto: r.height, pie: box.bottom - label.bottom,
            icono: b.querySelector('svg')!.getAttribute('width') };
        }),
      };
    });
    expect(geometria.alto).toBe(caso.bottom ? 78 : 64);
    expect(geometria.fab).toEqual([56, 56, 26]);
    expect(geometria.fondo).toBe('rgb(240, 112, 60)');
    expect(geometria.sombra).toBe('rgba(240, 112, 60, 0.34) 0px 6px 16px 0px');
    for (const item of geometria.items) {
      expect(item.ancho).toBeGreaterThanOrEqual(44);
      expect(item.alto).toBeGreaterThanOrEqual(44);
      expect(item.pie).toBeCloseTo(geometria.pie + 1, 1);
      expect(item.icono).toBe('24');
    }
    await captura(page, info, `d310-inicio-${caso.ancho}`);

    await nav.getByRole('button', { name: 'Más', exact: true }).click();
    const titulo = page.locator('.screen > .title-card');
    await expect(titulo).toBeVisible();
    await expect(titulo).toHaveCSS('background-color', 'rgb(255, 255, 255)'); // D285 se conserva.
    await expect(titulo).toHaveCSS('border-color', 'rgb(227, 233, 240)');
    await expect(page.locator('.hdr-back')).toHaveCSS('font-size', '15px');
    expect((await titulo.boundingBox())!.y).toBe(112 + caso.top);

    // Estrés de presentación aislado: texto sintético largo sobre el DOM de la
    // pantalla existente. No escribe perfil, contratos ni storage del producto.
    await page.locator('.screen > .scroll').evaluate((scroll) => {
      const datos = document.createElement('section');
      datos.dataset.d310Stress = 'true';
      for (let i = 1; i <= 30; i++) {
        const p = document.createElement('p');
        p.textContent = `Dato sintético ${i}: restaurante con un nombre extenso, notas y varias líneas para comprobar que todo se puede leer.`;
        datos.appendChild(p);
      }
      scroll.appendChild(datos);
      scroll.scrollTop = scroll.scrollHeight;
    });
    const ultimo = page.locator('[data-d310-stress] p').last();
    await expect(ultimo).toBeVisible();
    const contenido = await page.locator('.screen').evaluate((screen) => {
      const scroll = screen.querySelector(':scope > .scroll')!;
      const bar = screen.querySelector(':scope > .appbar-block')!;
      const ultimo = screen.querySelector('[data-d310-stress] p:last-child')!;
      const fab = bar.querySelector('.appbar-fab')!;
      return {
        hermanos: scroll.parentElement === bar.parentElement,
        desplazable: scroll.scrollHeight > scroll.clientHeight,
        horizontal: screen.scrollWidth - screen.clientWidth,
        ultimoAbajo: ultimo.getBoundingClientRect().bottom,
        circuloArriba: fab.getBoundingClientRect().top,
      };
    });
    expect(contenido.hermanos).toBe(true);
    expect(contenido.desplazable).toBe(true);
    expect(contenido.horizontal).toBeLessThanOrEqual(0);
    expect(contenido.ultimoAbajo).toBeLessThanOrEqual(contenido.circuloArriba - 11);
    await captura(page, info, `d310-largo-${caso.ancho}`);
  });
}
