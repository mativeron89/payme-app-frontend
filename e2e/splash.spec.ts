/**
 * La pantalla de carga en un navegador real · D292 (Mati, 2026-10-12, «Siempre al abrir (Recomendada)»; la adenda 1 la
 * dejó en 1 s y la adenda 2, «Aumenta a dos segundos el icono de carga inicial», en 2 s): aparece en cada apertura o
 * recarga, también por un link o un QR de mesa, desde el primer cuadro, y queda al menos 2 s. Si la app tarda más, sigue
 * hasta que monte. Después, el fundido.
 *
 * 🔴 D300 · los 2 s se cuentan desde el primer cuadro pintado, no desde que empezó la navegación; y cada imagen de
 * arranque del iPhone es esta misma pantalla, en su tamaño. D476 (opción A, enmienda D300 punto 3): la palabra «PayMe»
 * entra con un fundido mientras sube (quieta con «reducir movimiento»), y la imagen de arranque va sin ella.
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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DISPOSITIVOS, archivoDe, hrefDe, leerPng, mediaDe, type PngLeido } from '../scripts/imagenes-de-arranque.mjs';
import { ingresar } from './_app';

/** El mínimo de D292 (adenda 2) y el fundido de `src/splash.ts`. */
const MINIMO_MS = 2_000;
const FUNDIDO_MS = 160;

interface Muestra {
  readonly t: number;
  readonly opacidad: number;
  /** D491 · la opacidad de la palabra (su `<svg>`) en ese cuadro; `null` si no está. */
  readonly palabra: number | null;
}
interface Palabra {
  readonly opacidad: string;
  readonly animacion: string;
}
interface Carga {
  readonly muestras: Muestra[];
  /** El primer cuadro con el `#splash` en el árbol. */
  readonly vistoEn: number | null;
  /** D476 · la palabra (su `<svg>`, que es lo que se anima) en ese primer cuadro. */
  readonly palabraAlAparecer: Palabra | null;
  readonly montoEn: number | null;
  readonly retiradoEn: number | null;
}

/** El muestreo, antes que la página: cada cuadro, la opacidad del `#splash`, el montaje y el retiro. */
async function medirLaCarga(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __carga: { muestras: Array<{ t: number; opacidad: number; palabra: number | null }>; vistoEn: number | null; palabraAlAparecer: Palabra | null; montoEn: number | null; retiradoEn: number | null } };
    w.__carga = { muestras: [], vistoEn: null, palabraAlAparecer: null, montoEn: null, retiradoEn: null };
    const cuadro = () => {
      const t = performance.now();
      const el = document.getElementById('splash');
      const root = document.getElementById('root');
      if (w.__carga.montoEn === null && root && root.childElementCount > 0) w.__carga.montoEn = t;
      if (el) {
        if (w.__carga.vistoEn === null) {
          w.__carga.vistoEn = t;
          const palabra = el.querySelector('.carga__palabra svg');
          if (palabra) {
            const cs = getComputedStyle(palabra);
            w.__carga.palabraAlAparecer = { opacidad: cs.opacity, animacion: cs.animationName };
          }
        }
        const svg = el.querySelector('.carga__palabra svg');
        w.__carga.muestras.push({ t, opacidad: Number(getComputedStyle(el).opacity), palabra: svg ? Number(getComputedStyle(svg).opacity) : null });
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

/**
 * Lo común: se vio desde el primer cuadro, entero hasta cumplir el mínimo, y se fue con el fundido. 🔴 D300 · el mínimo
 * se cuenta desde el primer cuadro con el `#splash` (`vistoEn`), no desde que empezó la navegación.
 */
function esperarElMinimoEntero(c: Carga): void {
  expect(c.vistoEn, 'el #splash nunca estuvo en el árbol').not.toBeNull();
  // 🔴 Desde el primer cuadro: entero, sin aparecer de a poco (antes nacía en 0 y aparecía a los 300 ms).
  expect(c.muestras[0]!.opacidad, 'el primer cuadro con el #splash no lo muestra entero').toBe(1);
  // Entero hasta cumplir el mínimo, contado desde ese primer cuadro.
  const finDelMinimo = c.vistoEn! + MINIMO_MS;
  const antesDelMinimo = c.muestras.filter((m) => m.t < finDelMinimo);
  expect(antesDelMinimo.length).toBeGreaterThan(0);
  expect(antesDelMinimo.filter((m) => m.opacidad !== 1), 'el #splash dejó de verse entero antes del mínimo').toEqual([]);
  // Se va recién después del mínimo y el fundido.
  expect(c.retiradoEn!).toBeGreaterThanOrEqual(finDelMinimo + FUNDIDO_MS);
}

test.describe('🔴 D292 · la pantalla de carga, al menos 2 segundos en cada apertura', () => {
  test('aparece de entrada y queda al menos 2 s aunque la app monte antes; después, el fundido', async ({ page }) => {
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    // La premisa: la app montó antes del mínimo (si no, este caso no estaría probando nada).
    expect(c.montoEn, 'la app no montó').not.toBeNull();
    const finDelMinimo = c.vistoEn! + MINIMO_MS;
    expect(c.montoEn!, 'la app tardó más que el mínimo: este caso no lo probaría').toBeLessThan(finDelMinimo);
    esperarElMinimoEntero(c);
    // Con la app ya montada debajo, el splash siguió entero hasta el mínimo.
    expect(c.muestras.filter((m) => m.t >= c.montoEn! && m.t < finDelMinimo).every((m) => m.opacidad === 1)).toBe(true);
    // El fundido: hay cuadros a medio camino, después del mínimo.
    const fundido = c.muestras.filter((m) => m.opacidad > 0.05 && m.opacidad < 0.95);
    expect(fundido.length, 'se fue de golpe, sin fundido').toBeGreaterThan(0);
    expect(Math.min(...fundido.map((m) => m.t))).toBeGreaterThanOrEqual(finDelMinimo);
    // Y no más que eso: con la app lista antes, el fundido arranca al cumplir el mínimo, no después (holgura para el
    // reloj del navegador de pruebas y los cuadros entre el primero y su anotación en Paint Timing).
    expect(Math.min(...fundido.map((m) => m.t)), 'esperó de más: el mínimo es 2 s').toBeLessThan(finDelMinimo + 400);
    expect(c.retiradoEn!).toBeLessThan(finDelMinimo + FUNDIDO_MS + 600);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  });

  test('también al recargar: otra vez desde el primer cuadro y otra vez el mínimo entero', async ({ page }) => {
    await medirLaCarga(page);
    await page.goto('/');
    await laCarga(page);
    await page.reload();
    esperarElMinimoEntero(await laCarga(page));
  });

  /**
   * 🔴 D300 · la página tarda 3 s en llegar (la red, no la app) y la app monta enseguida. Contados desde la navegación, los
   * 2 s ya habían pasado al montar y la pantalla se iba enseguida: se veía un instante. Desde el primer cuadro pintado,
   * queda los 2 s enteros.
   */
  test('🔴 D300 · con la navegación demorada y la app rápida: los 2 s desde el primer cuadro pintado', async ({ page }) => {
    await page.route((url) => url.pathname === '/', async (ruta) => {
      await new Promise((listo) => setTimeout(listo, 3_000));
      await ruta.continue();
    });
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    // Las premisas: la página llegó tarde y la app montó antes de cumplir el mínimo desde que se vio.
    expect(c.vistoEn!, 'la página no llegó tarde: este caso no lo probaría').toBeGreaterThanOrEqual(3_000);
    expect(c.montoEn! - c.vistoEn!, 'la app tardó más que el mínimo: este caso no lo probaría').toBeLessThan(MINIMO_MS);
    esperarElMinimoEntero(c);
    // El primer cuadro pintado que anota el navegador es el de la pantalla de carga, no el comienzo de la navegación.
    const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null);
    expect(fcp).not.toBeNull();
    expect(fcp!).toBeGreaterThanOrEqual(c.vistoEn!);
    // Y no más que eso: se va al cumplir el mínimo desde que se vio.
    expect(c.retiradoEn!).toBeLessThan(c.vistoEn! + MINIMO_MS + FUNDIDO_MS + 600);
  });

  /**
   * 🔴 D300 · un navegador que no anota Paint Timing (o que todavía no anotó el primer cuadro): se cuenta desde que monta
   * la app, así que la pantalla nunca queda menos de 2 s desde que se vio. Contar desde la navegación, sin la entrada,
   * volvería al defecto: con la página demorada se iría al montar.
   */
  test('🔴 D300 · sin Paint Timing: desde que monta la app, nunca menos de 2 s desde el primer cuadro', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(performance, 'getEntriesByType', { value: () => [], configurable: true });
    });
    await page.route((url) => url.pathname === '/', async (ruta) => {
      await new Promise((listo) => setTimeout(listo, 3_000));
      await ruta.continue();
    });
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    expect(c.vistoEn!, 'la página no llegó tarde: este caso no lo probaría').toBeGreaterThanOrEqual(3_000);
    esperarElMinimoEntero(c);
    // Sin la entrada, cuenta desde que montó la app: se va 2 s después del montaje, no antes.
    expect(c.retiradoEn!).toBeGreaterThanOrEqual(c.montoEn! + MINIMO_MS);
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
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  });

  test('con «reducir movimiento»: la palabra quieta, y el mismo mínimo entero', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await medirLaCarga(page);
    await page.goto('/');
    const palabra = page.locator('#splash .carga__palabra svg');
    await expect(palabra).toBeVisible();
    expect(await palabra.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    expect(await palabra.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    esperarElMinimoEntero(await laCarga(page));
  });

  /**
   * 🔴 D476 (opción A; enmienda D300 punto 3) · con «reducir movimiento», la palabra entera y quieta desde el primer cuadro.
   * Sin preferencia, nace en 0.001 (no en 0: R1) con su entrada `carga-palabra`, y termina entera y en su lugar antes del
   * mínimo. El `#splash` en sí, entero desde el primer cuadro en los dos casos.
   */
  test('🔴 D476 · con «reducir movimiento», la palabra entera y quieta desde el primer cuadro', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    expect(c.palabraAlAparecer).toEqual({ opacidad: '1', animacion: 'none' });
    esperarElMinimoEntero(c);
  });

  test('🔴 D476 · sin «reducir movimiento», la palabra entra (nace en 0.001) y termina entera, antes del mínimo', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await medirLaCarga(page);
    await page.goto('/');
    const palabra = page.locator('#splash .carga__palabra svg');
    await expect.poll(() => palabra.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_500 }).toBe('1');
    expect(await palabra.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    const c = await laCarga(page);
    expect(c.palabraAlAparecer).toEqual({ opacidad: '0.001', animacion: 'carga-palabra' });
    esperarElMinimoEntero(c);
  });

  /**
   * 🔴 D491 · Mati: el logo «spawnea de una». Ahora la entrada espera a que pase el fundido de la apertura (~0,2 s en el
   * iPhone) y se ve aparecer: en los primeros 200 ms la palabra sigue casi invisible, y pasa al menos 400 ms entre que se
   * empieza a ver (> 10 %) y que queda casi entera (> 90 %). Con la entrada de D476 eran ~100 ms.
   */
  test('🔴 D491 · sin «reducir movimiento», la palabra se ve aparecer: espera el fundido y dura', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    const desde = c.vistoEn!;
    const conPalabra = c.muestras.filter((m) => m.palabra !== null);
    const alPrincipio = conPalabra.filter((m) => m.t - desde < 200);
    expect(alPrincipio.length, 'no hubo cuadros en los primeros 200 ms').toBeGreaterThan(0);
    expect(Math.max(...alPrincipio.map((m) => m.palabra!)), 'la palabra ya se veía antes de que pase el fundido').toBeLessThan(0.05);
    const seVe = conPalabra.find((m) => m.palabra! > 0.1);
    const casiEntera = conPalabra.find((m) => m.palabra! > 0.9);
    expect(seVe, 'la palabra nunca pasó del 10 %').toBeDefined();
    expect(casiEntera, 'la palabra nunca pasó del 90 % antes del retiro').toBeDefined();
    expect(casiEntera!.t - seVe!.t, 'la palabra apareció de una').toBeGreaterThanOrEqual(400);
    esperarElMinimoEntero(c);
  });

  /**
   * 🔴 R1 (informe D475) · la palabra nace casi transparente y las puntas son degradés (no cuentan como contenido): el
   * navegador igual tiene que anotar `first-contentful-paint` con la pantalla de carga, ANTES de que monte la app. Si no,
   * `src/splash.ts` contaría los 2 s de D300 desde el montaje. La app se demora para que las dos cosas no coincidan.
   */
  test('🔴 R1 · `first-contentful-paint` se anota con la pantalla de carga, antes de que monte la app', async ({ page }) => {
    await demorarLaApp(page, 1_500);
    await medirLaCarga(page);
    await page.goto('/');
    const c = await laCarga(page);
    const fcp = await page.evaluate(() => performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? null);
    expect(fcp, 'el build no anotó first-contentful-paint').not.toBeNull();
    expect(c.montoEn!).toBeGreaterThanOrEqual(1_500);
    expect(fcp!, 'el primer cuadro con contenido fue el de la app, no el de la pantalla de carga').toBeLessThan(c.montoEn!);
    expect(fcp! - c.vistoEn!, 'first-contentful-paint llegó lejos del primer cuadro con la pantalla').toBeLessThan(500);
    esperarElMinimoEntero(c);
  });

  test('🔴 la marca de la e2e no llegó al build: el módulo de entrada no la nombra', async ({ page }) => {
    const src = await moduloDeEntrada(page);
    const codigo = await (await page.request.get(src)).text();
    expect(codigo.length).toBeGreaterThan(1_000);
    expect(codigo).not.toContain('VITE_E2E_CARGA_SIN_MINIMO');
  });
});

/**
 * 🔴 D475 · la pantalla de carga de `PANTALLA-pantalla-de-carga.md` (7a), medida en el navegador a 375, 390 y 430: las dos
 * puntas sobre la zona entera, la palabra de 126 × 40 centrada en la zona, la franja de la barra de estado (en el
 * navegador `env(safe-area-inset-top)` vale 0) y ningún texto.
 */
for (const ancho of [375, 390, 430] as const) {
  test(`D475 · a ${ancho}: dos puntas, la palabra centrada, la franja y sin texto`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: ancho === 375 ? 667 : ancho === 390 ? 844 : 932 });
    await demorarLaApp(page, 2_500);
    await page.goto('/');
    const palabra = page.locator('#splash .carga__palabra svg');
    await expect(palabra).toBeVisible();
    // Terminada la entrada: entera y en su lugar (D491: termina a 1,5 s del primer cuadro).
    await expect.poll(() => palabra.evaluate((el) => getComputedStyle(el).opacity), { timeout: 2_500 }).toBe('1');
    const medida = await page.evaluate(() => {
      const caja = (sel: string) => {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      };
      const puntas = Array.from(document.querySelectorAll<HTMLElement>('#splash .carga__punta')).map((el) => ({
        clase: el.className,
        recorte: getComputedStyle(el).clipPath,
        fondo: getComputedStyle(el).backgroundImage,
        ...caja(`#splash .${el.className.split(' ')[1]}`),
      }));
      return {
        zona: caja('#splash .carga__zona'),
        palabra: caja('#splash .carga__palabra'),
        svg: caja('#splash .carga__palabra svg'),
        franja: caja('#splash .carga__franja'),
        franjaFondo: getComputedStyle(document.querySelector('#splash .carga__franja')!).backgroundColor,
        puntas,
        paths: Array.from(document.querySelectorAll('#splash .carga__palabra svg path')).map((p) => p.getAttribute('fill')),
        texto: (document.getElementById('splash')!.textContent ?? '').trim(),
        tieneText: document.querySelectorAll('#splash text, #splash tspan').length,
      };
    });
    expect(medida.puntas.map((t) => t.clase)).toEqual(['carga__punta carga__punta--arriba', 'carga__punta carga__punta--abajo']);
    for (const t of medida.puntas) {
      expect(t.recorte, t.clase).toMatch(/^polygon\(/);
      expect(t.fondo, t.clase).toMatch(/^linear-gradient\(/);
      // Cada punta es la zona entera recortada (el degradé se calcula sobre la zona).
      expect([t.x, t.y, t.w, t.h], t.clase).toEqual([medida.zona.x, medida.zona.y, medida.zona.w, medida.zona.h]);
    }
    expect(medida.zona).toMatchObject({ x: 0, w: ancho });
    for (const caja of [medida.palabra, medida.svg]) {
      expect(caja.w).toBeCloseTo(126, 0);
      expect(caja.h).toBeCloseTo(40, 0);
      expect(caja.x + caja.w / 2).toBeCloseTo(medida.zona.x + medida.zona.w / 2, 0);
      expect(caja.y + caja.h / 2).toBeCloseTo(medida.zona.y + medida.zona.h / 2, 0);
    }
    expect(medida.paths).toEqual(['#FFFFFF', '#0FB5C9']);
    // La franja existe, navy, con el alto de la barra de estado (0 en el navegador).
    expect(medida.franja.h).toBe(0);
    expect(medida.franjaFondo).toBe('rgb(16, 30, 59)');
    expect(medida.texto).toBe('');
    expect(medida.tieneText).toBe(0);
  });
}

/**
 * 🔴 D300 · cada imagen de arranque del iPhone ES la pantalla de carga servida, en su tamaño: el build con la CSP real,
 * con el ancho, el alto y la densidad del iPhone, y la franja de su barra de estado (`Emulation.setSafeAreaInsetsOverride`,
 * como el generador). Se compara píxel por píxel con la imagen que sirve el mismo build. D476 (opción A): la imagen va sin
 * la palabra, así que antes de capturar se oculta igual que en el generador (`visibility: hidden`); el resto, idéntico.
 *
 * Tolerancia declarada: un píxel cuenta como distinto si algún canal difiere en más de 2 (de 255); se admite hasta el
 * 0,1 % de píxeles distintos. Lo dibuja el mismo Chromium con los mismos estilos: medido el 2026-10-13, 0 píxeles
 * distintos en los once tamaños (diferencia máxima 0).
 */
const TOLERANCIA_CANAL = 2;
const TOLERANCIA_PIXELES = 0.001;

function diferencia(a: PngLeido, b: PngLeido): { distintos: number; total: number } {
  expect([a.ancho, a.alto]).toEqual([b.ancho, b.alto]);
  let distintos = 0;
  for (let i = 0; i < a.ancho * a.alto; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      if (Math.abs(a.pixeles[i * a.canales + k]! - b.pixeles[i * b.canales + k]!) > TOLERANCIA_CANAL) {
        distintos += 1;
        break;
      }
    }
  }
  return { distintos, total: a.ancho * a.alto };
}

test.describe('🔴 D300 · las imágenes de arranque son la pantalla de carga servida', () => {
  test('el index.html servido las enlaza, una por tamaño, y el build las sirve tal cual', async ({ page }) => {
    const html = await (await page.request.get('/')).text();
    for (const d of DISPOSITIVOS) {
      expect(html, archivoDe(d)).toContain(`<link rel="apple-touch-startup-image" media="${mediaDe(d)}" href="${hrefDe(d)}" />`);
      const r = await page.request.get(hrefDe(d));
      expect(r.status(), archivoDe(d)).toBe(200);
      expect(r.headers()['content-type'], archivoDe(d)).toBe('image/png');
      expect(Buffer.compare(await r.body(), readFileSync(resolve('public/arranque', archivoDe(d)))), archivoDe(d)).toBe(0);
    }
  });

  for (const d of DISPOSITIVOS) {
    test(`${archivoDe(d)}: ${d.ancho}×${d.alto}@${d.dpr} con la barra de ${d.barra}`, async ({ browser, baseURL }) => {
      const contexto = await browser.newContext({
        baseURL, viewport: { width: d.ancho, height: d.alto }, deviceScaleFactor: d.dpr, isMobile: true, hasTouch: true,
      });
      try {
        const page = await contexto.newPage();
        const cdp = await contexto.newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: d.barra, topMax: d.barra } });
        // La app no monta mientras se mide: queda la pantalla de carga sola. `commit`: `goto` esperaría el `load`, que
        // espera al módulo demorado, y la captura saldría con la app montada.
        await demorarLaApp(page, 6_000);
        await page.goto('/', { waitUntil: 'commit' });
        const palabra = page.locator('#splash .carga__palabra');
        await expect(palabra).toBeVisible();
        await palabra.evaluate((el) => { (el as HTMLElement).style.visibility = 'hidden'; });
        expect(await page.locator('#splash .carga__franja').evaluate((el) => el.getBoundingClientRect().height)).toBe(d.barra);
        const pantalla = leerPng(await page.screenshot());
        const imagen = leerPng(await (await page.request.get(hrefDe(d))).body());
        const { distintos, total } = diferencia(pantalla, imagen);
        expect(distintos / total, `${distintos} de ${total} píxeles distintos`).toBeLessThanOrEqual(TOLERANCIA_PIXELES);
      } finally {
        await contexto.close();
      }
    });
  }
});
