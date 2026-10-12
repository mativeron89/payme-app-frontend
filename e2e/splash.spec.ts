/**
 * La pantalla de carga en un navegador real · D292 (Mati, 2026-10-12, «Siempre al abrir (Recomendada)»; la adenda 1 la
 * dejó en 1 s y la adenda 2, «Aumenta a dos segundos el icono de carga inicial», en 2 s): aparece en cada apertura o
 * recarga, también por un link o un QR de mesa, desde el primer cuadro, y queda al menos 2 s desde que empezó a cargar la
 * página. Si la app tarda más, sigue hasta que monte. Después, el fundido.
 *
 * 🔴 Corre en el proyecto `pantalla-de-carga`, contra el BUILD mock con la CSP real (`e2e/csp/servidor.mjs`, 5188): ahí
 * no está la marca de la e2e (`VITE_E2E_CARGA_SIN_MINIMO`, que sólo pone el servidor de desarrollo de las demás
 * pruebas) y un `vite build` la apaga igual. Es el comportamiento que se publica, con el hash nuevo del `<style>`.
 *
 * Cómo se mide: un script que corre antes que la página muestrea cada cuadro (`requestAnimationFrame`) desde el
 * principio. Anota cuándo aparece el `#splash` y con qué opacidad, cuándo monta la app (`#root` con contenido) y cuándo
 * sale del árbol. Los tiempos son `performance.now()`: desde que empezó a cargar la página, como el mínimo.
 *
 * La carga lenta se FUERZA demorando el módulo de entrada del build (lo lee de `index.html`): servido desde la misma
 * máquina, el caso lento no ocurre solo.
 */
import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/** El mínimo de D292 (adenda 2) y el fundido de `src/splash.ts`. */
const MINIMO_MS = 2_000;
const FUNDIDO_MS = 160;

interface Muestra {
  readonly t: number;
  readonly opacidad: number;
}
interface Carga {
  readonly muestras: Muestra[];
  /** El primer cuadro con el `#splash` en el árbol. */
  readonly vistoEn: number | null;
  readonly montoEn: number | null;
  readonly retiradoEn: number | null;
}

/** El muestreo, antes que la página: cada cuadro, la opacidad del `#splash`, el montaje y el retiro. */
async function medirLaCarga(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __carga: { muestras: Array<{ t: number; opacidad: number }>; vistoEn: number | null; montoEn: number | null; retiradoEn: number | null } };
    w.__carga = { muestras: [], vistoEn: null, montoEn: null, retiradoEn: null };
    const cuadro = () => {
      const t = performance.now();
      const el = document.getElementById('splash');
      const root = document.getElementById('root');
      if (w.__carga.montoEn === null && root && root.childElementCount > 0) w.__carga.montoEn = t;
      if (el) {
        if (w.__carga.vistoEn === null) w.__carga.vistoEn = t;
        w.__carga.muestras.push({ t, opacidad: Number(getComputedStyle(el).opacity) });
      } else if (w.__carga.vistoEn !== null) {
        w.__carga.retiradoEn = t;
        return;
      }
      requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
  });
}

/** Espera a que el splash salga del árbol y devuelve lo medido. */
async function laCarga(page: Page): Promise<Carga> {
  await expect(page.locator('#splash')).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __carga: Carga }).__carga.retiradoEn)).not.toBeNull();
  return page.evaluate(() => (window as unknown as { __carga: Carga }).__carga);
}

/** El módulo de entrada del build, leído de su `index.html` (con hash en el nombre). */
async function moduloDeEntrada(page: Page): Promise<string> {
  const html = await (await page.request.get('/')).text();
  const src = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1];
  expect(src, 'el index.html del build no tiene el módulo de entrada').toBeTruthy();
  return src!;
}

/** Demora el módulo de entrada: la app tarda en montar. */
async function demorarLaApp(page: Page, ms: number): Promise<void> {
  const src = await moduloDeEntrada(page);
  await page.route((url) => url.pathname === src, async (ruta) => {
    await new Promise((listo) => setTimeout(listo, ms));
    await ruta.continue();
  });
}

/** Lo común: se vio desde el primer cuadro, entero hasta cumplir el mínimo, y se fue con el fundido. */
function esperarElMinimoEntero(c: Carga): void {
  expect(c.vistoEn, 'el #splash nunca estuvo en el árbol').not.toBeNull();
  // 🔴 Desde el primer cuadro: entero, sin aparecer de a poco (antes nacía en 0 y aparecía a los 300 ms).
  expect(c.muestras[0]!.opacidad, 'el primer cuadro con el #splash no lo muestra entero').toBe(1);
  // Entero hasta cumplir el mínimo.
  const antesDelMinimo = c.muestras.filter((m) => m.t < MINIMO_MS);
  expect(antesDelMinimo.length).toBeGreaterThan(0);
  expect(antesDelMinimo.filter((m) => m.opacidad !== 1), 'el #splash dejó de verse entero antes del mínimo').toEqual([]);
  // Se va recién después del mínimo y el fundido.
  expect(c.retiradoEn!).toBeGreaterThanOrEqual(MINIMO_MS + FUNDIDO_MS);
}

test.describe('🔴 D292 · la pantalla de carga, al menos 2 segundos en cada apertura', () => {
  test('aparece de entrada y queda al menos 2 s aunque la app monte antes; después, el fundido', async ({ page }) => {
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    // La premisa: la app montó antes del mínimo (si no, este caso no estaría probando nada).
    expect(c.montoEn, 'la app no montó').not.toBeNull();
    expect(c.montoEn!, 'la app tardó más que el mínimo: este caso no lo probaría').toBeLessThan(MINIMO_MS);
    esperarElMinimoEntero(c);
    // Con la app ya montada debajo, el splash siguió entero hasta el mínimo.
    expect(c.muestras.filter((m) => m.t >= c.montoEn! && m.t < MINIMO_MS).every((m) => m.opacidad === 1)).toBe(true);
    // El fundido: hay cuadros a medio camino, después del mínimo.
    const fundido = c.muestras.filter((m) => m.opacidad > 0.05 && m.opacidad < 0.95);
    expect(fundido.length, 'se fue de golpe, sin fundido').toBeGreaterThan(0);
    expect(Math.min(...fundido.map((m) => m.t))).toBeGreaterThanOrEqual(MINIMO_MS);
    // Y no más que eso: con la app lista antes, el fundido arranca al cumplir el mínimo, no después (holgura para el
    // reloj del navegador de pruebas).
    expect(Math.min(...fundido.map((m) => m.t)), 'esperó de más: el mínimo es 2 s').toBeLessThan(MINIMO_MS + 400);
    expect(c.retiradoEn!).toBeLessThan(MINIMO_MS + FUNDIDO_MS + 600);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  });

  test('también al recargar: otra vez desde el primer cuadro y otra vez el mínimo entero', async ({ page }) => {
    await medirLaCarga(page);
    await page.goto('/');
    await laCarga(page);
    await page.reload();
    esperarElMinimoEntero(await laCarga(page));
  });

  test('si la app tarda más, sigue hasta que monta, y entonces se va (sin esperar otro mínimo)', async ({ page }) => {
    // 3,5 s: bien por encima del mínimo de 2 s (con 2,5 s quedaba a medio segundo).
    await demorarLaApp(page, 3_500);
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    expect(c.montoEn!).toBeGreaterThanOrEqual(3_500);
    // Entero hasta que montó la app.
    expect(c.muestras.filter((m) => m.t < c.montoEn!).filter((m) => m.opacidad !== 1)).toEqual([]);
    // Se fue enseguida después de montar: el fundido y nada más (sin otro mínimo).
    expect(c.retiradoEn! - c.montoEn!).toBeLessThan(700);
    esperarElMinimoEntero(c);
  });

  for (const [nombre, ruta] of [
    ['un link de mesa', '/mesa/PA-1234?t=token-de-prueba'],
    ['un QR de mesa', '/?r=qr-de-prueba'],
  ] as const) {
    test(`por ${nombre} también: desde el primer cuadro y al menos 2 s`, async ({ page }) => {
      await medirLaCarga(page);
      await page.goto(ruta);
      const c = await laCarga(page);
      expect(c.montoEn!).toBeLessThan(MINIMO_MS);
      esperarElMinimoEntero(c);
    });
  }

  test('con la sesión iniciada, cada apertura también (no sólo la primera)', async ({ page }) => {
    await ingresar(page);
    await medirLaCarga(page);
    await page.reload();
    const c = await laCarga(page);
    esperarElMinimoEntero(c);
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  });

  test('con «reducir movimiento»: el ícono quieto, y el mismo mínimo entero', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await medirLaCarga(page);
    await page.goto('/');
    const icono = page.locator('#splash .carga__icono');
    await expect(icono).toBeVisible();
    expect(await icono.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    esperarElMinimoEntero(await laCarga(page));
  });

  test('sin «reducir movimiento», el ícono entra con su animación desde que aparece la pantalla', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await demorarLaApp(page, 1_500);
    await page.goto('/');
    const icono = page.locator('#splash .carga__icono');
    await expect(icono).toBeVisible();
    const anim = await icono.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { nombre: cs.animationName, duracion: cs.animationDuration, retardo: cs.animationDelay };
    });
    expect(anim).toEqual({ nombre: 'carga-entra', duracion: '0.24s', retardo: '0s' });
  });

  test('🔴 la marca de la e2e no llegó al build: el módulo de entrada no la nombra', async ({ page }) => {
    const src = await moduloDeEntrada(page);
    const codigo = await (await page.request.get(src)).text();
    expect(codigo.length).toBeGreaterThan(1_000);
    expect(codigo).not.toContain('VITE_E2E_CARGA_SIN_MINIMO');
  });
});

/**
 * 🔴 D286 (revisión 6) · la pantalla de carga de `PANTALLA-pantalla-de-carga.md`, medida en el navegador a 375, 390 y
 * 430: los cuatro triángulos sobre la zona entera, el ícono de 128 px centrado en el punto de encuentro, la franja de la
 * barra de estado (en el navegador `env(safe-area-inset-top)` vale 0) y ningún texto.
 */
for (const ancho of [375, 390, 430] as const) {
  test(`D286 · a ${ancho}: cuatro triángulos, el ícono centrado, la franja y sin texto`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: ancho === 375 ? 667 : ancho === 390 ? 844 : 932 });
    await demorarLaApp(page, 2_500);
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
