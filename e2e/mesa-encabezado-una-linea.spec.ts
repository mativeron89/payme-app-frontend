import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

const LARGO = 'Trattoria de la Abuela Giuseppina y sus Nietos del Barrio';

async function abrirMesa(page: Page, idioma: 'es' | 'en', escenario: 'sin-identificar' | 'largo' | 'corto') {
  const nombre = await page.evaluate(async ({ idioma, escenario, largo }) => {
    const ruta = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
    const mesa = state.mesas.find((fila) => fila.code === 'PA-2847');
    if (!mesa) throw new Error('Falta la mesa de ejemplo');
    const nombre = escenario === 'largo'
      ? [...state.mesas.map((fila) => fila.restaurant.name), largo].sort((a, b) => b.length - a.length)[0]!
      : escenario === 'sin-identificar' ? 'Restaurante sin identificar' : 'Hanzo';
    mesa.restaurant = { ...mesa.restaurant, name: nombre };
    persist();
    localStorage.setItem('payme.app.idioma.v1', idioma);
    return nombre;
  }, { idioma, escenario, largo: LARGO });
  await page.goto('/#/mesa/PA-2847');
  await page.reload();
  return nombre;
}

function contexto(page: Page) {
  return page.locator('.mesa-selection-context');
}

async function geometria(page: Page) {
  return contexto(page).evaluate((el) => {
    const nombre = el.querySelector<HTMLElement>('.mesa-selection-context-main')!;
    const modo = el.querySelector<HTMLElement>('strong')!;
    const nombreCaja = nombre.getBoundingClientRect();
    const modoCaja = modo.getBoundingClientRect();
    const seccion = el.getBoundingClientRect();
    const texto = document.createRange();
    texto.selectNodeContents(nombre);
    const nombreVisible = texto.getBoundingClientRect();
    const separador = getComputedStyle(modo, '::before');
    return {
      truncado: nombre.scrollWidth > nombre.clientWidth,
      elipsis: getComputedStyle(nombre).textOverflow,
      modoDentro: modoCaja.right <= seccion.right + 1,
      textoDentro: nombreVisible.right <= seccion.right + 1,
      mismaLinea: Math.abs(modoCaja.top - nombreCaja.top) < 5,
      abajo: modoCaja.top >= nombreCaja.bottom - 1,
      separador: separador.display !== 'none' && separador.content.includes('·'),
    };
  });
}

for (const idioma of ['es', 'en'] as const) {
  for (const escenario of ['sin-identificar', 'largo'] as const) {
    test(`U1 · nombre y modalidad a 320, 375 y 390 px (${idioma}, ${escenario})`, async ({ page }) => {
      await ingresar(page);
      const nombre = await abrirMesa(page, idioma, escenario);
      await expect(contexto(page).locator('.mesa-selection-context-main')).toHaveText(nombre);
      await expect(contexto(page).locator('strong')).toBeVisible();
      await expect(page.locator('.mesa-selection-title')).not.toContainText('PA-2847');

      for (const ancho of [320, 375, 390]) {
        await page.setViewportSize({ width: ancho, height: 844 });
        const abajo = ancho === 320;
        await expect.poll(() => geometria(page)).toMatchObject({
          mismaLinea: !abajo, abajo, modoDentro: true, separador: !abajo,
          ...(abajo ? { truncado: false, textoDentro: true } : { elipsis: 'ellipsis' }),
          ...(!abajo && escenario === 'largo' ? { truncado: true } : {}),
        });
        if (idioma === 'es' && escenario === 'largo' && process.env.PAYME_E2E_CAPTURAS) {
          await page.locator('.hdr-user').evaluateAll((els) => els.forEach(el => { el.textContent = 'Demo'; }));
          await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/mesa-encabezado-${ancho}.png`, animations: 'disabled' });
        }
      }
    });
  }
}

test('U1 · el límite es 359 px y un nombre corto sigue en un renglón', async ({ page }) => {
  await page.setViewportSize({ width: 359, height: 844 });
  await ingresar(page);
  await abrirMesa(page, 'es', 'largo');
  await expect.poll(() => geometria(page)).toMatchObject({ abajo: true, truncado: false });
  await page.setViewportSize({ width: 360, height: 844 });
  await expect.poll(() => geometria(page)).toMatchObject({ mismaLinea: true, truncado: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await abrirMesa(page, 'es', 'corto');
  await expect.poll(() => geometria(page)).toMatchObject({ mismaLinea: true, truncado: false, separador: true });
});
