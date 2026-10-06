import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * D202 · H-04 de la auditoría Codex del 06/10: en la hoja «¿Borrar todas las
 * notificaciones?» el tercer Tab enfocaba «Volver» de la pantalla de atrás con
 * la hoja abierta. Lo mismo, por lectura, en la guía «Agregar a inicio» y el
 * panel de diagnóstico. Las tres usan `useHojaModal`.
 *
 * En cada una: el foco entra; Tab y Shift+Tab, el doble de veces que botones
 * tiene la hoja, nunca salen y la recorren entera; el fondo (`.app`) queda
 * inerte y un botón de atrás no toma el foco; al cerrar, el fondo vuelve.
 */

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Índice del elemento enfocado entre los enfocables de la hoja; -1 si está afuera. */
async function dondeEstaElFoco(hoja: Locator): Promise<number> {
  return hoja.evaluate((el) => {
    const enfocables = [...el.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])')];
    return enfocables.indexOf(document.activeElement as Element);
  });
}

async function cuantosEnfocables(hoja: Locator): Promise<number> {
  return hoja.evaluate((el) => el.querySelectorAll('button:not([disabled]), a[href], input:not([disabled])').length);
}

async function recorrer(page: Page, hoja: Locator, tecla: 'Tab' | 'Shift+Tab'): Promise<Set<number>> {
  const n = await cuantosEnfocables(hoja);
  const vistos = new Set<number>();
  for (let i = 0; i < n * 2; i += 1) {
    await page.keyboard.press(tecla);
    const donde = await dondeEstaElFoco(hoja);
    expect(donde, `${tecla} n.º ${i + 1}: el foco salió de la hoja`).toBeGreaterThanOrEqual(0);
    vistos.add(donde);
  }
  return vistos;
}

const appInerte = (page: Page) => page.evaluate(() => document.querySelector<HTMLElement>('.app')?.inert ?? null);

/** El foco no sale, el fondo no lo toma, y al cerrar vuelve a responder. */
async function contieneElFoco(page: Page, hoja: Locator, cerrar: () => Promise<void>): Promise<void> {
  await expect(hoja).toBeVisible();
  expect(await dondeEstaElFoco(hoja)).toBeGreaterThanOrEqual(0);
  const n = await cuantosEnfocables(hoja);
  expect(n).toBeGreaterThan(1);
  // Control: recorre TODOS los botones de la hoja, no se queda quieto en uno.
  expect((await recorrer(page, hoja, 'Tab')).size).toBe(n);
  expect((await recorrer(page, hoja, 'Shift+Tab')).size).toBe(n);
  // El fondo, inerte: un botón de atrás no toma el foco.
  expect(await appInerte(page)).toBe(true);
  await page.evaluate(() => document.querySelector<HTMLElement>('.app button')?.focus());
  expect(await dondeEstaElFoco(hoja)).toBeGreaterThanOrEqual(0);
  await cerrar();
  await expect(hoja).toHaveCount(0);
  expect(await appInerte(page)).toBe(false);
}

test.describe('D202 · H-04 · el foco no sale de las hojas modales', () => {
  test('🔴 «¿Borrar todas las notificaciones?»: Tab cicla adentro y al cerrar vuelve a «Borrar todas»', async ({ page }) => {
    await ingresar(page);
    await irEnLaApp(page, '/avisos');
    const borrarTodas = page.getByRole('button', { name: 'Borrar todas', exact: true });
    await borrarTodas.click();
    const hoja = page.getByRole('dialog', { name: '¿Borrar todas las notificaciones?' });
    await expect(hoja.getByRole('button', { name: 'Volver', exact: true })).toBeFocused();
    await contieneElFoco(page, hoja, () => page.keyboard.press('Escape'));
    await expect(borrarTodas).toBeFocused();
  });

  test.describe('en Safari del iPhone', () => {
    test.use({ userAgent: IPHONE_SAFARI });

    test('🔴 la guía «Agregar a inicio»: Tab cicla adentro y al cerrar vuelve a la fila', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('payme.app.agregar_a_inicio.v1', '1'));
      await ingresar(page);
      await page.goto('/#/mas');
      const fila = page.getByRole('button', { name: 'Agregar a inicio', exact: true });
      await fila.click();
      const hoja = page.getByRole('dialog', { name: 'Agrega PayMe a tu inicio' });
      await expect(hoja.getByRole('button', { name: 'Entendido', exact: true })).toBeFocused();
      await contieneElFoco(page, hoja, () => page.keyboard.press('Escape'));
      await expect(fila).toBeFocused();
    });
  });

  test('🔴 el panel de diagnóstico: Tab cicla adentro', async ({ page }) => {
    await ingresar(page);
    for (let i = 0; i < 5; i += 1) await page.locator('.hdr-mark-toques .hdr-mark').first().click();
    const hoja = page.getByRole('dialog', { name: 'Diagnóstico de pantalla' });
    await expect(hoja.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();
    await contieneElFoco(page, hoja, () => hoja.getByRole('button', { name: 'Cerrar', exact: true }).click());
  });
});
