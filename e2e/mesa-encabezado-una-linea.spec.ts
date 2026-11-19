import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

async function abrirMesa(page: Page, idioma: 'es' | 'en', largo: boolean) {
  await ingresar(page);
  const nombre = await page.evaluate(async ({ idioma, largo }) => {
    const ruta = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
    const mesa = state.mesas.find((fila) => fila.code === 'PA-2847');
    if (!mesa) throw new Error('Falta la mesa de ejemplo');
    const nombre = largo
      ? [...state.mesas.map((fila) => fila.restaurant.name),
          'Trattoria de la Abuela Giuseppina y sus Nietos del Barrio'].sort((a, b) => b.length - a.length)[0]!
      : 'Hanzo';
    mesa.restaurant = { ...mesa.restaurant, name: nombre };
    persist();
    localStorage.setItem('payme.app.idioma.v1', idioma);
    return nombre;
  }, { idioma, largo });
  await page.goto('/#/mesa/PA-2847');
  await page.reload();
  return nombre;
}

for (const ancho of [320, 390]) {
  for (const idioma of ['es', 'en'] as const) {
    test(`U1 · nombre largo entero a ${ancho} (${idioma})`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: 844 });
      const nombre = await abrirMesa(page, idioma, true);
      const contexto = page.locator('.mesa-selection-context');
      await expect(contexto.locator('.mesa-selection-context-main')).toHaveText(nombre);
      await expect(contexto.locator('strong')).toBeVisible();
      await expect(page.locator('.mesa-selection-title')).not.toContainText('PA-2847');
      const medida = await contexto.evaluate((el) => {
        const nombre = el.querySelector<HTMLElement>('.mesa-selection-context-main')!;
        const modo = el.querySelector<HTMLElement>('strong')!;
        const r = document.createRange();
        r.selectNodeContents(nombre);
        const caja = el.getBoundingClientRect();
        const texto = r.getBoundingClientRect();
        const opcion = modo.getBoundingClientRect();
        return {
          truncado: nombre.scrollWidth > nombre.clientWidth,
          dentro: texto.right <= caja.right + 1 && opcion.right <= caja.right + 1,
          mismoRenglon: Math.abs(opcion.y - texto.y) < 5,
          entra: texto.width + opcion.width + parseFloat(getComputedStyle(el).columnGap) <= caja.width,
        };
      });
      expect(medida.truncado).toBe(false);
      expect(medida.dentro).toBe(true);
      expect(medida.mismoRenglon).toBe(medida.entra);
      if (ancho === 390 && idioma === 'es' && process.env.PAYME_E2E_CAPTURAS) {
        await page.locator('.hdr-user').evaluateAll((els) => els.forEach(el => { el.textContent = 'Demo'; }));
        await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/mesa-encabezado.png`, animations: 'disabled' });
      }
    });
  }
}

test('U1 · si entra, nombre y modalidad conservan un renglón', async ({ page }) => {
  await abrirMesa(page, 'es', false);
  const alturas = await page.locator('.mesa-selection-context').evaluate(el => {
    const [nombre, modo] = el.children;
    return [nombre!.getBoundingClientRect().top, modo!.getBoundingClientRect().top];
  });
  expect(Math.abs(alturas[0]! - alturas[1]!)).toBeLessThan(5);
});
