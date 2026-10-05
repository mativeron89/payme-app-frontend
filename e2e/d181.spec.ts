import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, irEnLaApp } from './_app';

/**
 * AF-E181 · decisión 181 de Mati, con capturas de su iPhone:
 * 1. Configuración sin la leyenda «Sólo en este navegador».
 * 2. Montos sin «.00» si son enteros (el formateador lo cubre
 *    `src/utils/format.test.ts`; acá, en pantallas reales).
 * 3. En la mesa, «Copiar link» e «Invitar amigos» en una fila, mitad y mitad, y
 *    debajo, centrado, «Cerrar mesa» en rojo clarito.
 * 4. En Inicio, una tarjeta por mesa abierta, sin «+N mesa abierta más» ni la
 *    hoja.
 */

/** Para las capturas de Inicio: las tarjetas de las mesas arriba (debajo vienen la invitación y avisos). */
async function verLasMesas(page: Page): Promise<void> {
  await page.locator('.home-mesas').evaluate((el) => el.scrollIntoView({ block: 'start' }));
}

async function captura(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${nombre}.png` });
}

const tarjetas = (page: Page) => page.locator('.home-mesas > .mesa-card');

/** La mesa sin garantía (como `cerrar-mesa.spec.ts`): ahí están los tres botones. Al fondo. */
async function mesaConSusBotones(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
  await page.goto(`/#/mesa/${mesa.code}`);
  await expect(page.getByRole('button', { name: 'Cerrar mesa', exact: true })).toBeAttached();
  await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
}

test.describe('D181', () => {
  test('1 · Configuración: sin «Sólo en este navegador» ni «Más sobre la ubicación» (D185)', async ({ page }) => {
    await ingresar(page);
    await irEnLaApp(page, '/mas');
    // Control positivo: Configuración está dibujada, con la fila de Ubicación.
    await expect(page.getByRole('button', { name: 'Ubicación', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
    await expect(page.getByText(/Sólo en este navegador/)).toHaveCount(0);
    // D185 · sin el bloque, ni su aviso, ni su ayuda, ni el reset.
    await expect(page.getByText('Más sobre la ubicación', { exact: true })).toHaveCount(0);
    await expect(page.locator('main details, .app details')).toHaveCount(0);
    await expect(page.getByText(/no se sincroniza entre dispositivos/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restablecer país y zona' })).toHaveCount(0);
    await captura(page, `${page.viewportSize()!.width}-configuracion`);
  });

  test('4 · Inicio: una tarjeta por mesa, la que vence antes arriba, sin «+N» ni hoja', async ({ page }) => {
    await ingresar(page);
    await expect(tarjetas(page)).toHaveCount(2);
    await expect(tarjetas(page).nth(0)).toContainText('Hanzo Sushi');
    await expect(tarjetas(page).nth(1)).toContainText('La Parolaccia');
    for (const i of [0, 1]) await expect(tarjetas(page).nth(i)).toContainText('Tu mesa abierta');
    await expect(page.getByRole('button', { name: /mesas? abiertas? más/ })).toHaveCount(0);
    await expect(page.locator('.mesa-more')).toHaveCount(0);
    await verLasMesas(page);
    await captura(page, `${page.viewportSize()!.width}-inicio-dos-mesas`);
    await tarjetas(page).nth(1).click();
    await expect(page).toHaveURL(/:\d+\/mesa\/PA-2847/);
  });

  test('4 · Inicio con tres mesas abiertas: tres tarjetas', async ({ page }) => {
    await ingresar(page);
    await abrirMesaConLink(page);
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(tarjetas(page)).toHaveCount(3);
    await verLasMesas(page);
    await captura(page, `${page.viewportSize()!.width}-inicio-tres-mesas`);
  });

  test('2 · los montos enteros sin «.00»: la tarjeta y la mesa', async ({ page }) => {
    await ingresar(page);
    await expect(tarjetas(page).first()).toBeVisible();
    for (const texto of await page.locator('.mesa-paid, .mesa-total').allTextContents()) {
      expect(texto).not.toMatch(/\.00\b/);
    }
  });

  test('3 · en la mesa: copiar e invitar en una fila, mitad y mitad; cerrar centrado en rojo clarito', async ({ page }) => {
    await mesaConSusBotones(page);
    const copiar = page.getByRole('button', { name: 'Copiar link de invitación', exact: true });
    const invitar = page.getByRole('button', { name: 'Invitar amigos de PayMe', exact: true });
    const cerrar = page.getByRole('button', { name: 'Cerrar mesa', exact: true });
    await expect(copiar).toBeVisible();
    await expect(copiar).toHaveText('Copiar link');
    await expect(invitar).toHaveText('Invitar amigos');
    const m = await page.evaluate(() => {
      const caja = (el: Element) => el.getBoundingClientRect();
      const fila = document.querySelector('.mesa-acciones-fila')!;
      const [a, b] = [...fila.querySelectorAll('.btn')];
      const contenedor = caja(document.querySelector('.mesa-secondary-actions')!);
      const c = caja(document.querySelector('.btn-cerrar-mesa')!);
      const cortado = (el: Element) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth;
      return {
        mismaFila: caja(a!).top === caja(b!).top,
        anchos: [caja(a!).width, caja(b!).width],
        filaAncho: caja(fila).width,
        dentro: caja(b!).right <= caja(fila).right + 0.5 && caja(a!).left >= caja(fila).left - 0.5,
        cerrarDebajo: c.top >= caja(a!).bottom,
        centrado: Math.abs((c.left + c.width / 2) - (contenedor.left + contenedor.width / 2)),
        cortados: [cortado(a!), cortado(b!), cortado(document.querySelector('.btn-cerrar-mesa')!)],
      };
    });
    expect(m.mismaFila).toBe(true);
    // Mitad y mitad (con los 8 px entre los dos), y los dos dentro de la fila.
    for (const ancho of m.anchos) expect(Math.abs(ancho - (m.filaAncho - 8) / 2)).toBeLessThanOrEqual(1);
    expect(m.dentro).toBe(true);
    expect(m.cerrarDebajo).toBe(true);
    expect(m.centrado).toBeLessThanOrEqual(1);
    expect(m.cortados).toEqual([false, false, false]);
    await expect(cerrar).toHaveCSS('background-color', 'rgb(253, 236, 234)');
    await expect(cerrar).toHaveCSS('color', 'rgb(155, 58, 38)');
    await captura(page, `${page.viewportSize()!.width}-mesa-botones`);
  });
});

test.describe('D181 · a 320 px', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('3 · los botones de la mesa entran sin cortarse', async ({ page }) => {
    await mesaConSusBotones(page);
    const cortados = await page.evaluate(() => [...document.querySelectorAll('.mesa-secondary-actions .btn')]
      .map((el) => (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth));
    expect(cortados).toEqual([false, false, false]);
    await captura(page, '320-mesa-botones');
  });

  for (const nombre of ['inicio', 'configuracion'] as const) {
    test(`captura a 320 px: ${nombre}`, async ({ page }) => {
      await ingresar(page);
      if (nombre === 'configuracion') await irEnLaApp(page, '/mas');
      await expect(nombre === 'inicio' ? tarjetas(page).first() : page.getByRole('button', { name: 'Ubicación', exact: true })).toBeVisible();
      if (nombre === 'inicio') await verLasMesas(page);
      await captura(page, `320-${nombre}`);
    });
  }
});
