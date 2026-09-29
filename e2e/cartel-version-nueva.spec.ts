import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-CARTEL-VERSION-NUEVA · decisión 125 de Mati: «Cartel para actualizar».
 *
 * Con la sesión iniciada, una pestaña vieja NO se recarga sola: si hay una
 * versión publicada más nueva aparece «Hay una versión nueva · Actualizar», y
 * recarga sólo si la persona toca. El ingreso sigue como antes (recarga solo:
 * `version-nueva.spec.ts`).
 *
 * Misma técnica que `version-nueva.spec.ts`: la versión «publicada» se cambia
 * interceptando `/version.json` a mitad del test, y los testigos son cuántos
 * DOCUMENTOS cargó la pestaña y cuántas veces se pidió `/version.json`. Un «no
 * aparece» o «no recarga» se afirma con la revisión HECHA.
 */

const NUEVA = '99.0.0';
const MARCA = 'payme.app.recarga_por_version.v1';
const TEXTO = 'Hay una versión nueva';

interface Publicacion {
  /** `null`: la del servidor (la misma del bundle). `'rara'`: HTML con 200. */
  version: string | null | 'rara';
  pedidos: number;
}

async function preparar(page: Page): Promise<Publicacion> {
  const pub: Publicacion = { version: null, pedidos: 0 };
  await page.route('**/version.json', async (route) => {
    pub.pedidos += 1;
    if (pub.version === null) return route.continue();
    if (pub.version === 'rara') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ version: pub.version }),
    });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('e2e.cv.cargas', String(Number(sessionStorage.getItem('e2e.cv.cargas') ?? '0') + 1));
  });
  return pub;
}

const cargas = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem('e2e.cv.cargas') ?? '0'))
  .catch(() => -1);
const marca = (page: Page) => page.evaluate((k) => sessionStorage.getItem(k), MARCA);
const cartel = (page: Page) => page.getByText(TEXTO, { exact: true });
const actualizar = (page: Page) => page.getByRole('button', { name: 'Actualizar', exact: true });

async function salirYVolver(page: Page): Promise<void> {
  await page.evaluate(() => {
    let visible: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
    document.dispatchEvent(new Event('visibilitychange'));
    visible = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Revisa al volver, y espera a que la revisión se HAYA pedido. */
async function revisarAlVolver(page: Page, pub: Publicacion): Promise<void> {
  const antes = pub.pedidos;
  await salirYVolver(page);
  await expect.poll(() => pub.pedidos, 'con la sesión iniciada, volver a la pestaña revisa la versión').toBeGreaterThan(antes);
}

/**
 * Cada botón visible de la pantalla, salvo los del cartel, recibe el toque en
 * su centro: el cartel no tapa ninguno.
 */
async function nadaTapado(page: Page): Promise<void> {
  const tapados = await page.evaluate(() => {
    const cartel = document.querySelector('.cartel-version');
    const malos: string[] = [];
    for (const b of Array.from(document.querySelectorAll('button, a[href]'))) {
      if (cartel?.contains(b)) continue;
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom <= 0 || r.top >= innerHeight) continue;
      const x = r.left + r.width / 2;
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const arriba = document.elementFromPoint(x, y);
      if (arriba && cartel?.contains(arriba)) malos.push(b.textContent?.trim() || b.getAttribute('aria-label') || b.className);
    }
    return malos;
  });
  expect(tapados, 'el cartel tapa estos botones').toEqual([]);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png`, fullPage: false });
}

test.describe('AF-CARTEL-VERSION-NUEVA · con la sesión iniciada', () => {
  test('🔴 al abrir con una versión más nueva: aparece el cartel, NO recarga sola, y «Actualizar» recarga una vez', async ({ page }) => {
    const pub = await preparar(page);
    await ingresar(page);
    pub.version = NUEVA;
    // Abrir de nuevo la pestaña con la sesión ya iniciada (el ingreso no aparece).
    await page.reload();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(cartel(page)).toBeVisible();
    await expect(actualizar(page)).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await cargas(page), 'con sesión no recarga sola').toBe(2);
    expect(await marca(page)).toBeNull();
    await nadaTapado(page);

    await actualizar(page).click();
    await expect.poll(() => cargas(page)).toBe(3);
    // El JS sigue siendo el viejo (el servidor no cambió): el cartel vuelve,
    // pero no hay una recarga sola detrás.
    await expect(cartel(page)).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(await cargas(page)).toBe(3);
  });

  test('🔴 al volver a la pestaña (visibilitychange) aparece, y también desde el bfcache (pageshow)', async ({ page }) => {
    const pub = await preparar(page);
    await ingresar(page);
    await expect(cartel(page)).toHaveCount(0);
    pub.version = NUEVA;
    await revisarAlVolver(page, pub);
    await expect(cartel(page)).toBeVisible();
    expect(await cargas(page)).toBe(1);

    // La × lo cierra; en la próxima revisión, si sigue habiendo versión nueva, vuelve.
    await page.locator('.cartel-version').getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(cartel(page)).toHaveCount(0);
    const antes = pub.pedidos;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(() => pub.pedidos).toBeGreaterThan(antes);
    await expect(cartel(page)).toBeVisible();
    expect(await cargas(page)).toBe(1);
  });

  for (const [caso, version] of [['la misma versión', null], ['una respuesta rara (HTML con 200)', 'rara']] as const) {
    test(`control · con ${caso}: revisa y no aparece nada`, async ({ page }) => {
      const pub = await preparar(page);
      await ingresar(page);
      pub.version = version;
      await revisarAlVolver(page, pub);
      await page.waitForTimeout(1_000);
      await expect(cartel(page)).toHaveCount(0);
      expect(await cargas(page)).toBe(1);
    });
  }

  test('control · sin respuesta (red caída): no aparece nada', async ({ page }) => {
    const pub = await preparar(page);
    await ingresar(page);
    await page.unroute('**/version.json');
    await page.route('**/version.json', (route) => { pub.pedidos += 1; return route.abort('failed'); });
    await revisarAlVolver(page, pub);
    await page.waitForTimeout(1_000);
    await expect(cartel(page)).toHaveCount(0);
    expect(await cargas(page)).toBe(1);
  });
});

test('control · el ingreso sigue recargando solo, y ahí no hay cartel', async ({ page }) => {
  const pub = await preparar(page);
  pub.version = NUEVA;
  await page.goto('/');
  await expect.poll(() => cargas(page)).toBe(2);
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect(await marca(page)).toBe(NUEVA);
  await expect(cartel(page)).toHaveCount(0);
});

test.describe('AF-CARTEL-VERSION-NUEVA · capturas', () => {
  for (const ancho of [390, 1440] as const) {
    test(`a ${ancho} px: Inicio y una mesa, sin tapar nada`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: ancho === 390 ? 844 : 900 });
      const pub = await preparar(page);
      await ingresar(page);
      pub.version = NUEVA;
      await revisarAlVolver(page, pub);
      await expect(cartel(page)).toBeVisible();
      // En desktop va dentro de la columna de la app, no a lo ancho de la ventana.
      const caja = await page.locator('.cartel-version').boundingBox();
      const app = await page.locator('.app').boundingBox();
      expect(caja && app && caja.x >= app.x && caja.x + caja.width <= app.x + app.width + 0.5).toBe(true);
      await nadaTapado(page);
      await capturar(page, `cartel-${ancho}-inicio`);

      // Pagos tiene el único encabezado pegajoso (`.mes-sticky`). Con poca
      // altura la lista desborda; se desplaza SU contenedor (no la rueda: en la
      // emulación móvil la rueda corre la imagen de la captura sin mover ningún
      // offset, con cartel o sin él) y el mes queda DEBAJO del cartel.
      await page.getByRole('button', { name: 'Ver pagos' }).click();
      const mes = page.locator('.mes-sticky').first();
      await expect(mes).toBeVisible();
      await page.setViewportSize({ width: ancho, height: 560 });
      const desplazado = await mes.evaluate((el) => {
        let c = el.parentElement;
        while (c && !/(auto|scroll)/.test(getComputedStyle(c).overflowY)) c = c.parentElement;
        if (!c) return 0;
        c.scrollTop = c.scrollHeight;
        return c.scrollTop;
      });
      expect(desplazado, 'la lista de Pagos se desplazó').toBeGreaterThan(0);
      await expect(cartel(page)).toBeVisible();
      const borde = await page.locator('.cartel-version').boundingBox();
      const pegado = await mes.boundingBox();
      expect(borde && pegado && pegado.y >= borde.y + borde.height - 0.5, 'el encabezado del mes queda bajo el cartel').toBe(true);
      await nadaTapado(page);
      await capturar(page, `cartel-${ancho}-pagos`);
      await page.setViewportSize({ width: ancho, height: ancho === 390 ? 844 : 900 });
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();

      await abrirMesaConLink(page);
      await revisarAlVolver(page, pub);
      await expect(cartel(page)).toBeVisible();
      await nadaTapado(page);
      await capturar(page, `cartel-${ancho}-mesa`);
      expect(await cargas(page)).toBe(1);
    });
  }
});
