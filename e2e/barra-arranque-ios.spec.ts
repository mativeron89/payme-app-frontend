import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D179 · decisión 179 de Mati · la barra de abajo al abrir la app de inicio de iOS.
 *
 * 🔴 LO QUE ESTO NO PRUEBA: el runner es Chromium y no reproduce el viewport
 * achicado de WebKit al arrancar (ver `barra-inferior-viewport.spec.ts`). Si el
 * empujón hace que WebKit lo acomode lo dice el iPhone de Mati (D63).
 *
 * Lo que sí fija, con la app de inicio simulada (`navigator.standalone`):
 * - al arrancar con sesión, el documento se mueve 1 px y vuelve dos veces (al
 *   cargar y el segundo intento), y el `.scroll` de la pantalla al menos una
 *   (medido: en el primer intento, a ~110 ms, Inicio todavía no lo dibujó);
 * - mientras dura, `.app` sigue midiendo el viewport (nunca un alto forzado: lo
 *   que en 0.210.5 cortó la barra) y al terminar no queda estilo ni scroll;
 * - la barra termina entera en el borde de abajo;
 * - sin `standalone` (Safari, computadora) no se mueve nada.
 */

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

interface Registro {
  doc: number[];
  interior: number[];
  minHeight: string[];
  altoApp: number[];
  alto: number[];
}

/** Anota cada scroll del documento y del `.scroll`, con el alto de `.app` en ese momento. */
async function registrar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const r: Registro = { doc: [], interior: [], minHeight: [], altoApp: [], alto: [] };
    (window as unknown as { __empujon: Registro }).__empujon = r;
    addEventListener(
      'scroll',
      (e) => {
        if (e.target === document) {
          r.doc.push(scrollY);
          r.minHeight.push(document.documentElement.style.minHeight);
          r.altoApp.push(document.querySelector('.app')?.getBoundingClientRect().height ?? -1);
          r.alto.push(innerHeight);
        } else if (e.target instanceof HTMLElement && e.target.classList.contains('scroll')) {
          r.interior.push(e.target.scrollTop);
        }
      },
      true,
    );
  });
}

async function comoAppDeInicio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
  });
}

const leer = (page: Page) => page.evaluate(() => (window as unknown as { __empujon: Registro }).__empujon);

async function barraEntera(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({
    alto: innerHeight,
    app: document.querySelector('.app')!.getBoundingClientRect().height,
    barra: document.querySelector('.appbar-block')!.getBoundingClientRect().bottom,
    scrollY,
    minHeight: document.documentElement.style.minHeight,
  }));
  expect(m.app).toBe(m.alto);
  expect(m.barra).toBe(m.alto);
  expect(m.scrollY).toBe(0);
  expect(m.minHeight).toBe('');
}

test.describe('en la app de inicio de iOS', () => {
  test.use({ userAgent: SAFARI_IPHONE });

  for (const [ancho, alto] of [[390, 664], [390, 844]] as const) {
    test(`a ${ancho}×${alto}: al abrir, 1 px y vuelta (dos veces), sin alto forzado y con la barra entera`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await comoAppDeInicio(page);
      await registrar(page);
      await ingresar(page);
      // Abrir la app con la sesión ya iniciada: así arranca desde el ícono.
      await page.reload();
      await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

      await expect.poll(async () => (await leer(page)).doc).toEqual([1, 0, 1, 0]);
      // El `.scroll` de Inicio puede no existir todavía en el primer intento (llega
      // con los datos de la pantalla): el segundo lo encuentra. Siempre 1 px y vuelta.
      await expect.poll(async () => (await leer(page)).interior.length).toBeGreaterThanOrEqual(2);
      const r = await leer(page);
      expect(r.interior).toEqual(r.interior.map((_, i) => (i % 2 === 0 ? 1 : 0)));
      expect(r.interior.length % 2).toBe(0);
      // Mientras el documento estaba en 1 px, `html` medía 1 px más y `.app`, el viewport.
      expect(r.minHeight[0]).toBe('calc(100% + 1px)');
      expect(r.altoApp).toEqual(r.alto);
      await barraEntera(page);
    });
  }
});

async function sinMovimiento(page: Page): Promise<void> {
  await registrar(page);
  await page.setViewportSize({ width: 390, height: 664 });
  await ingresar(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  // El testigo positivo son los tests de arriba: ahí, en este mismo tiempo, se movió dos veces.
  await page.waitForTimeout(1500);
  const r = await leer(page);
  expect(r.doc).toEqual([]);
  expect(r.interior).toEqual([]);
  await barraEntera(page);
}

test.describe('en Safari del iPhone (sin la app de inicio)', () => {
  test.use({ userAgent: SAFARI_IPHONE });
  test('no se mueve nada', async ({ page }) => {
    await sinMovimiento(page);
  });
});

test('en la computadora no se mueve nada', async ({ page }) => {
  await sinMovimiento(page);
});
