import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * Decisión 77 de Mati (2026-09-25): en «¿Qué consumiste?» el encabezado lleva
 * el restaurante y la modalidad en UNA línea, sin el código de mesa. Un nombre
 * que no entra se recorta con «…»; la modalidad nunca.
 */
async function nombrarRestaurante(page: Page, code: string, nombre: string): Promise<void> {
  await page.evaluate(async ({ code, nombre }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; restaurant: { name: string } }> };
    };
    const mesa = state.mesas.find((candidate) => candidate.code === code);
    if (!mesa) throw new Error(`${code} ausente`);
    mesa.restaurant = { ...mesa.restaurant, name: nombre };
  }, { code, nombre });
}

/** Una línea = la caja no supera 1,5 veces su propio interlineado. */
async function medirLinea(page: Page) {
  return page.locator('.mesa-selection-context').evaluate((el) => {
    const main = el.querySelector('.mesa-selection-context-main') as HTMLElement;
    const modo = el.querySelector('strong') as HTMLElement;
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    return {
      alto: el.getBoundingClientRect().height,
      lh,
      nombreRecortado: main.scrollWidth > main.clientWidth,
      modoRecortado: modo.scrollWidth > modo.clientWidth,
      topNombre: main.getBoundingClientRect().top,
      topModo: modo.getBoundingClientRect().top,
    };
  });
}

for (const ancho of [390, 320]) {
  test(`${ancho} px · «Restaurante sin identificar · cada uno lo suyo» en una línea y sin código`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 844 });
    await ingresar(page);
    await nombrarRestaurante(page, 'PA-2847', 'Restaurante sin identificar');
    await page.goto('/#/mesa/PA-2847');
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();

    await expect(page.locator('.mesa-selection-context-main')).toHaveText('Restaurante sin identificar');
    await expect(page.locator('.mesa-selection-context strong')).toHaveText('cada uno lo suyo');
    await expect(page.locator('.mesa-selection-title')).not.toContainText('PA-2847');

    const m = await medirLinea(page);
    expect(m.alto).toBeLessThanOrEqual(m.lh * 1.5);
    expect(Math.abs(m.topNombre - m.topModo)).toBeLessThanOrEqual(2);
    expect(m.modoRecortado).toBe(false);
    if (ancho === 390) expect(m.nombreRecortado).toBe(false);
  });
}

test('320 px · un nombre largo se recorta con «…» y la modalidad queda entera', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await ingresar(page);
  await nombrarRestaurante(page, 'PA-2847', 'Trattoria de la Abuela Giuseppina y sus Nietos del Barrio');
  await page.goto('/#/mesa/PA-2847');
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();

  const m = await medirLinea(page);
  expect(m.alto).toBeLessThanOrEqual(m.lh * 1.5);
  expect(m.nombreRecortado).toBe(true);
  expect(m.modoRecortado).toBe(false);
  await expect(page.locator('.mesa-selection-context strong')).toBeVisible();
});
