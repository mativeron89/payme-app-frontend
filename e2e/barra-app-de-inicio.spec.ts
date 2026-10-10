import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D179 · E179b · la barra de abajo en la app de inicio de iOS, con los números
 * REALES del iPhone de Mati (captura 11, 0.214.0 al abrir): viewport de layout
 * 393 × 794, pantalla 393 × 852, insets 59/34, `100dvh` 794 y `100lvh` 852.
 *
 * 🔴 LO QUE ESTO NO PRUEBA: Chromium no tiene el viewport corto de WebKit; acá
 * `100lvh` vale lo mismo que `100dvh` (el viewport), así que la barra termina
 * en 794 con o sin el arreglo. Si con `100lvh` la barra baja a 852 lo dice el
 * iPhone de Mati (D63).
 *
 * Lo que sí fija:
 * - con la app de inicio simulada, `<html>` lleva la clase y toda la cadena
 *   html → body → #root → `.app` mide `100lvh` (contra una sonda de 100lvh);
 * - `.app` sigue en el flujo (`relative`), con la barra entera en su borde;
 * - en Safari del iPhone y en la computadora no hay clase y `.app` mide
 *   `100dvh`, como siempre.
 */

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function comoElIphoneDeMati(page: Page, standalone: boolean): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
  });
  await page.addInitScript((enApp) => {
    if (enApp) Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    Object.defineProperty(Screen.prototype, 'height', { configurable: true, get: () => 852 });
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: () => 393 });
  }, standalone);
  await page.setViewportSize({ width: 393, height: 794 });
}

/** Alturas de la cadena y de la barra, contra sondas de 100lvh y 100dvh. */
function medir(page: Page) {
  return page.evaluate(() => {
    const sonda = (unidad: string) => {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;visibility:hidden;height:100${unidad}`;
      document.body.appendChild(el);
      const h = el.getBoundingClientRect().height;
      el.remove();
      return h;
    };
    const alto = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().height;
    const app = document.querySelector('.app')!;
    const barra = document.querySelector('.appbar-block')!.getBoundingClientRect();
    return {
      clase: document.documentElement.classList.contains('app-de-inicio-ios'),
      lvh: sonda('lvh'),
      dvh: sonda('dvh'),
      html: alto('html'),
      body: alto('body'),
      root: alto('#root'),
      app: alto('.app'),
      appTop: app.getBoundingClientRect().top,
      posicion: getComputedStyle(app).position,
      barraAbajo: barra.bottom,
      barraAlto: barra.height,
      appAbajo: app.getBoundingClientRect().bottom,
      desbordeX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function abrirConSesion(page: Page): Promise<void> {
  await ingresar(page);
  // Abrir desde el ícono con la sesión iniciada.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

test.describe('en la app de inicio de iOS (simulada con los números de Mati)', () => {
  test.use({ userAgent: SAFARI_IPHONE });

  test('🔴 html, body, #root y `.app` miden 100lvh; `.app` en el flujo y la barra entera en su borde', async ({ page }) => {
    await comoElIphoneDeMati(page, true);
    await abrirConSesion(page);
    const m = await medir(page);
    expect(m.clase).toBe(true);
    for (const h of [m.html, m.body, m.root, m.app]) expect(h).toBe(m.lvh);
    expect(m.posicion).toBe('relative');
    expect(m.appTop).toBe(0);
    expect(m.barraAbajo).toBe(m.appAbajo);
    // D255-1 · Mati: «bajarla un poco, está muy alta». Con el inset de 34, 56 + (34 − 12) = 78; antes 90.
    expect(m.barraAlto).toBe(78);
    expect(m.desbordeX).toBeLessThanOrEqual(0);
  });

  test('la clase sigue en otras pantallas y después de volver de segundo plano', async ({ page }) => {
    await comoElIphoneDeMati(page, true);
    await abrirConSesion(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const m = await medir(page);
    expect(m.clase).toBe(true);
    expect(m.app).toBe(m.lvh);
  });
});

test.describe('en Safari del iPhone', () => {
  test.use({ userAgent: SAFARI_IPHONE });

  test('sin clase: `.app` mide 100dvh, como siempre', async ({ page }) => {
    await comoElIphoneDeMati(page, false);
    await abrirConSesion(page);
    const m = await medir(page);
    expect(m.clase).toBe(false);
    expect(m.app).toBe(m.dvh);
    expect(m.barraAbajo).toBe(m.appAbajo);
  });
});

test('en la computadora tampoco hay clase', async ({ page }) => {
  await abrirConSesion(page);
  const m = await medir(page);
  expect(m.clase).toBe(false);
  expect(m.app).toBe(m.dvh);
  // D255-1 · sin inset la barra no cambia: 56 + 8.
  expect(m.barraAlto).toBe(64);
});
