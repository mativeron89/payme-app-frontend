/**
 * Splash de carga en navegador real — las dos ramas de «B sólo cuando tarda».
 *
 * La lógica de tiempos ya está cubierta pura en `src/splash.test.ts`; acá se
 * prueba lo que sin navegador no se puede: que el elemento de verdad
 * aparece cuando la carga tarda, y de verdad sale del árbol cuando no.
 *
 * La carga lenta se FUERZA demorando la respuesta del módulo de entrada
 * (`main.tsx`) por ruta interceptada: es la única manera de que localhost
 * tarde — servido desde la misma máquina, el caso lento no ocurre solo.
 */
import { test, expect } from '@playwright/test';
import { ingresar } from './_app';

test('carga rápida: la app abre directo y el splash no queda en el árbol', async ({ page }) => {
  await ingresar(page);
  // No alcanza con "no visible": el retiro lo SACA del DOM. Un splash
  // invisible pero presente sería un fixed z-index 9999 esperando volver.
  await expect(page.locator('#splash')).toHaveCount(0);
});

test('carga lenta: el splash asoma mientras tarda y se retira al montar', async ({ page }) => {
  // 🔴 El glob `**/src/main.tsx` NO matchea cuando Vite sirve el módulo con
  // query (`?v=…`, `?t=…`), y lo hace según el estado de su caché de deps. Ese
  // era el intermitente: sin intercepción no hay demora, la app monta rápido,
  // el splash NUNCA asoma y la aserción cae. **El test no era frágil por
  // carga: le erraba al recurso.** Con regex matchea las dos formas.
  await page.route(/\/src\/main\.tsx(\?.*)?$/, async (ruta) => {
    // Bien pasado el retardo de aparición (300ms), lejos del timeout global.
    await new Promise((listo) => setTimeout(listo, 1_200));
    await ruta.continue();
  });

  await page.goto('/');

  // Mientras el módulo no llegó, lo único pintado es el splash (D286: los
  // triángulos y el ícono). `toBeVisible` acá afirma que ASOMÓ, que es la rama
  // que la carga rápida no puede probar.
  await expect(page.locator('#splash .carga__icono')).toBeVisible();

  // Llegó el módulo → monta la app → el splash cumple su mínimo y se va.
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0);
});

/**
 * 🔴 D286 (revisión 6) · la pantalla de carga de `PANTALLA-pantalla-de-carga.md`, medida en el navegador a 375, 390 y
 * 430: los cuatro triángulos sobre la zona entera, el ícono de 128 px centrado en el punto de encuentro, la franja de la
 * barra de estado (en el navegador `env(safe-area-inset-top)` vale 0) y ningún texto.
 */
for (const ancho of [375, 390, 430] as const) {
  test(`D286 · a ${ancho}: cuatro triángulos, el ícono centrado, la franja y sin texto`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: ancho === 375 ? 667 : ancho === 390 ? 844 : 932 });
    await page.route(/\/src\/main\.tsx(\?.*)?$/, async (ruta) => {
      await new Promise((listo) => setTimeout(listo, 2_500));
      await ruta.continue();
    });
    await page.goto('/');
    const icono = page.locator('#splash .carga__icono');
    await expect(icono).toBeVisible();
    // Terminó de entrar: opacidad 1 y sin escala.
    await expect.poll(() => icono.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const medida = await page.evaluate(() => {
      const caja = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const triangulos = Array.from(document.querySelectorAll<HTMLElement>('#splash .t')).map((el) => ({
        clase: el.className,
        recorte: getComputedStyle(el).clipPath,
        fondo: getComputedStyle(el).backgroundImage,
        ...caja(`#splash .${el.className.split(' ')[1]}`),
      }));
      return {
        zona: caja('#splash .carga__zona'),
        icono: caja('#splash .carga__icono'),
        franja: caja('#splash .carga__franja'),
        franjaFondo: getComputedStyle(document.querySelector('#splash .carga__franja')!).backgroundColor,
        triangulos,
        texto: (document.getElementById('splash')!.textContent ?? '').trim(),
        tieneText: document.querySelectorAll('#splash text, #splash tspan').length,
      };
    });
    expect(medida.triangulos.map((t) => t.clase)).toEqual(['t t-arriba', 't t-izq', 't t-der', 't t-abajo']);
    for (const t of medida.triangulos) {
      expect(t.recorte, t.clase).toMatch(/^polygon\(/);
      expect(t.fondo, t.clase).toMatch(/^linear-gradient\(/);
      // Cada triángulo es la zona entera recortada (el degradé se calcula sobre la zona).
      expect([t.x, t.y, t.w, t.h], t.clase).toEqual([medida.zona.x, medida.zona.y, medida.zona.w, medida.zona.h]);
    }
    expect(medida.zona).toMatchObject({ x: 0, w: ancho });
    expect(medida.icono.w).toBeCloseTo(128, 0);
    expect(medida.icono.h).toBeCloseTo(128, 0);
    expect(medida.icono.x + medida.icono.w / 2).toBeCloseTo(medida.zona.x + medida.zona.w / 2, 0);
    expect(medida.icono.y + medida.icono.h / 2).toBeCloseTo(medida.zona.y + medida.zona.h / 2, 0);
    // La franja existe, navy, con el alto de la barra de estado (0 en el navegador).
    expect(medida.franja.h).toBe(0);
    expect(medida.franjaFondo).toBe('rgb(16, 30, 59)');
    expect(medida.texto).toBe('');
    expect(medida.tieneText).toBe(0);
  });
}

test('D286 · con «reducir movimiento», el ícono aparece sin animación', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route(/\/src\/main\.tsx(\?.*)?$/, async (ruta) => {
    await new Promise((listo) => setTimeout(listo, 1_500));
    await ruta.continue();
  });
  await page.goto('/');
  const icono = page.locator('#splash .carga__icono');
  await expect(icono).toBeVisible();
  expect(await icono.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  const conMovimiento = await page.context().newPage();
  await conMovimiento.emulateMedia({ reducedMotion: 'no-preference' });
  await conMovimiento.route(/\/src\/main\.tsx(\?.*)?$/, async (ruta) => {
    await new Promise((listo) => setTimeout(listo, 1_500));
    await ruta.continue();
  });
  await conMovimiento.goto('/');
  await expect(conMovimiento.locator('#splash .carga__icono')).toBeVisible();
  expect(await conMovimiento.locator('#splash .carga__icono').evaluate((el) => getComputedStyle(el).animationName)).toBe('carga-entra');
  await conMovimiento.close();
});
