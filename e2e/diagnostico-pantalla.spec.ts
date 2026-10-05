import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { SEGUNDO_INTENTO_MS } from '../src/empujonDeArranque';

/**
 * E173-2 · el diagnóstico de pantalla: 5 toques en el logo de PayMe lo abren.
 * Pedido del Bibliotecario IV tras la captura 7 del iPhone de Mati, para medir
 * con números reales cómo WebKit dispone la app de inicio.
 *
 * Se mide en la app de inicio SIMULADA: `navigator.standalone`, la pantalla del
 * iPhone (390×844), el viewport achicado en el inset (785) y los insets REALES
 * (`Emulation.setSafeAreaInsetsOverride`, que Chromium 151 respeta en `env()`).
 * No acredita el iPhone; acredita que el panel muestra lo que el navegador
 * informa.
 */
async function simularIos(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
  });
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    Object.defineProperty(Screen.prototype, 'height', { configurable: true, get: () => 844 });
    Object.defineProperty(Screen.prototype, 'width', { configurable: true, get: () => 390 });
    // D179 · cuándo corrió el primer empujón de arranque (el primer scroll del
    // documento): el ancla para saber que el segundo también pasó.
    const w = window as unknown as { __primerEmpujon: number | null };
    w.__primerEmpujon = null;
    addEventListener('scroll', (e) => {
      if (e.target === document && w.__primerEmpujon === null) w.__primerEmpujon = performance.now();
    }, true);
  });
  await page.setViewportSize({ width: 390, height: 785 });
}

/**
 * D179 · con la app de inicio simulada corre el empujón de arranque: el
 * documento baja 1 px durante dos cuadros, al cargar y ~700 ms después. Si el
 * panel se abre y se lee dentro de esos dos cuadros, lee la barra 1 px más
 * arriba: «694 · 784 · 90» en el CI 37269618527 (flaky, pasó al reintentar), y
 * el mismo valor reproducido abriendo el panel a mitad de un empujón (ver el
 * test de abajo, que también muestra que el panel se corrige solo). Se abre
 * cuando los dos ya pasaron; las aserciones no cambian.
 */
async function sinEmpujonEnCurso(page: Page): Promise<void> {
  const primero = () => page.evaluate(() => (window as unknown as { __primerEmpujon: number | null }).__primerEmpujon);
  await expect.poll(primero).not.toBeNull();
  await expect.poll(async () => (await page.evaluate(() => performance.now())) - (await primero())!)
    .toBeGreaterThan(SEGUNDO_INTENTO_MS + 300);
  await expect.poll(() => page.evaluate(() => scrollY === 0 && document.documentElement.style.minHeight === '')).toBe(true);
}

const panel = (page: Page) => page.getByRole('dialog', { name: 'Diagnóstico de pantalla' });
const logo = (page: Page) => page.locator('.hdr-mark-toques .hdr-mark').first();

async function tocarLogo(page: Page, veces: number): Promise<void> {
  for (let i = 0; i < veces; i += 1) await logo(page).click();
}

/** El valor de una fila del panel, por su clave exacta. */
async function valor(page: Page, clave: string): Promise<string> {
  return page.evaluate((k) => {
    const filas = [...document.querySelectorAll('.diag-fila')];
    const fila = filas.find((f) => f.querySelector('dt')?.textContent === k);
    return fila?.querySelector('dd')?.textContent ?? '(no está)';
  }, clave);
}

test.describe('E173-2 · diagnóstico de pantalla (5 toques en el logo)', () => {
  test('🔴 4 toques no lo abren; el quinto sí', async ({ page }) => {
    await ingresar(page);
    await tocarLogo(page, 4);
    await expect(panel(page)).toHaveCount(0);
    await tocarLogo(page, 1);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Cerrar' })).toBeFocused();
  });

  test('🔴 muestra lo que informa el navegador: viewport, pantalla, insets, `.app`, la barra y el modo', async ({ page }) => {
    await simularIos(page);
    await ingresar(page);
    await sinEmpujonEnCurso(page);
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    expect(await valor(page, 'innerWidth × innerHeight')).toBe('390 × 785');
    expect(await valor(page, 'screen width × height')).toBe('390 × 844');
    expect(await valor(page, 'safe-area-inset top · right · bottom · left')).toBe('59 · 0 · 34 · 0');
    expect(await valor(page, 'navigator.standalone')).toBe('true');
    expect(await valor(page, '100vh · 100svh · 100dvh · 100lvh')).toBe('785 · 785 · 785 · 785');
    expect(await valor(page, '.app height (computed)')).toBe('785');
    // La barra entera dentro de lo visible: arriba en 785 − 90, abajo en 785.
    expect(await valor(page, '.appbar-block top · bottom · height')).toBe('695 · 785 · 90');
    expect(await valor(page, 'html style (JS fix)')).toBe('none');
    expect(await valor(page, 'display-mode')).toBe('browser');
    expect(await valor(page, 'version')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('vuelve a medir solo cuando cambia el viewport', async ({ page }) => {
    await simularIos(page);
    await ingresar(page);
    await sinEmpujonEnCurso(page);
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    expect(await valor(page, 'innerWidth × innerHeight')).toBe('390 × 785');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => valor(page, 'innerWidth × innerHeight')).toBe('390 × 844');
    await expect.poll(() => valor(page, '.appbar-block top · bottom · height')).toBe('754 · 844 · 90');
  });

  test('D179 · abierto a mitad de un empujón, el panel ve la barra 1 px arriba y se corrige solo', async ({ page }) => {
    await simularIos(page);
    await ingresar(page);
    await sinEmpujonEnCurso(page);
    await tocarLogo(page, 4);
    // Un empujón (volver de segundo plano) y el quinto toque en su tercer cuadro,
    // con el documento en 1 px. Se anota lo que muestra el panel cuadro a cuadro.
    const traza = await page.evaluate(() => new Promise<{ y: number[]; panel: string[] }>((listo) => {
      const leer = () => [...document.querySelectorAll('.diag-fila')]
        .find((f) => f.querySelector('dt')?.textContent === '.appbar-block top · bottom · height')
        ?.querySelector('dd')?.textContent ?? '';
      const logoEl = document.querySelector('.hdr-mark-toques .hdr-mark') as HTMLElement;
      const y: number[] = [];
      const panel: string[] = [];
      let cuadro = 0;
      const paso = () => {
        cuadro += 1;
        if (cuadro === 3) logoEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        y.push(scrollY);
        panel.push(leer());
        if (cuadro < 10) requestAnimationFrame(paso);
        else listo({ y, panel });
      };
      document.dispatchEvent(new Event('visibilitychange'));
      requestAnimationFrame(paso);
    }));
    // Testigo: el toque cayó con el documento en 1 px y el panel lo vio así…
    expect(traza.y[2]).toBe(1);
    expect(traza.panel).toContain('694 · 784 · 90');
    // …y se corrigió solo cuando el empujón volvió, sin tocar nada.
    expect(traza.panel.at(-1)).toBe('695 · 785 · 90');
  });

  test('🔴 sólo lee: abrir, volver a medir, copiar y cerrar no hacen ningún pedido de red', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await ingresar(page);
    const pedidos: string[] = [];
    page.on('request', (r) => {
      if (['fetch', 'xhr', 'websocket', 'eventsource', 'ping'].includes(r.resourceType())) pedidos.push(r.url());
    });
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    await panel(page).getByRole('button', { name: 'Volver a medir' }).click();
    await panel(page).getByRole('button', { name: 'Copiar' }).click();
    await expect(page.getByText('Copiado')).toBeVisible();
    const copiado = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiado).toContain('innerWidth × innerHeight: ');
    expect(copiado).not.toMatch(/@|payme_/);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    expect(pedidos).toEqual([]);
  });

  test('se cierra con ✕ y con tocar afuera; el logo sigue sin ser un botón', async ({ page }) => {
    await ingresar(page);
    for (const el of [page.locator('.hdr-mark-toques').first(), logo(page)]) {
      await expect(el).not.toHaveAttribute('role', /.+/);
      await expect(el).not.toHaveAttribute('tabindex', /.+/);
    }
    await tocarLogo(page, 5);
    await panel(page).getByRole('button', { name: 'Cerrar' }).click();
    await expect(panel(page)).toHaveCount(0);
    await tocarLogo(page, 5);
    await expect(panel(page)).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(panel(page)).toHaveCount(0);
  });
});
