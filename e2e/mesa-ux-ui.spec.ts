import { expect, test, type Page } from '@playwright/test';
import { hastaCompartir, selectorDePropina, pedidosDePropina } from './fixtures/mi-parte-d344';

async function mesa(page: Page): Promise<string> {
  const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await selectorDePropina(page).getByRole('button', { name: '10%', exact: true }).click();
  await expect.poll(() => pedidosDePropina(page)).toBe(1);
  await expect(selectorDePropina(page).getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
  return code;
}
const consumos = (page: Page) => page.locator('.tus-consumos .desplegable-cabecera');
const continuar = (page: Page) => page.getByRole('button', { name: /^(Continuar|Listo)$/, exact: true });
async function elegir(page: Page): Promise<void> {
  if (await consumos(page).getAttribute('aria-expanded') !== 'true') await consumos(page).click();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese, $195', exact: true }).click();
}
async function captura(page: Page, nombre: string): Promise<void> {
  if (process.env.PAYME_E2E_CAPTURAS) {
    await page.locator('.hdr-user').evaluateAll((els) => els.forEach((el) => { el.textContent = 'Demo'; }));
    await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/${nombre}.png`, animations: 'disabled' });
  }
}

test('K1 · mesa nueva: platos abiertos, guía y cerrar después de la lista', async ({ page }) => {
  await mesa(page);
  await expect(consumos(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Toca lo que consumiste', { exact: true })).toBeVisible();
  expect(await page.locator('.tus-consumos').evaluate((lista) => !!(lista.compareDocumentPosition(document.querySelector('.mesa-cerrar')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await captura(page, '01-mesa-recien-abierta');
});

test('K2 K3 K4 · importes, textos ES/EN, botón ancho y cámara en Inicio', async ({ page }) => {
  const code = await mesa(page); await elegir(page);
  await expect(page.locator('.mi-parte-amt')).toHaveCSS('font-size', '28px');
  await expect(page.locator('.mi-parte-amt')).toHaveCSS('color', 'rgb(16, 30, 59)');
  await expect(page.locator('.mi-meta-amt')).toHaveText('Elegido $195 de $840');
  await expect(page.locator('.mi-parte')).toContainText('con propina');
  await expect(page.locator('.mi-parte-amt')).toHaveText('$201.73');
  const boton = page.getByRole('button', { name: 'Continuar', exact: true });
  expect((await boton.boundingBox())!.width).toBeGreaterThan(340);
  await expect(page.locator('.appbar-center')).toHaveCount(0);
  for (const nombre of ['02-mesa-mi-parte-grande', '03-mesa-rotulos', '04-mesa-boton-ancho']) await captura(page, nombre);
  await page.keyboard.press('Tab'); await boton.focus(); await expect(boton).toBeFocused();
  expect(await boton.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/mesa/${code}$`));
  await expect(page.getByText('Listo, quedó guardado', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await expect(page.locator('.appbar-center')).toHaveAccessibleName('Escanear');
  await expect(page.locator('.appbar-fab')).toHaveCSS('width', '64px');
  await page.goto(`/#/mesa/${code}`);
  await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en')); await page.reload();
  await expect(page.locator('.mi-meta-amt')).toHaveText('Chosen $195 of $840');
  if (await consumos(page).getAttribute('aria-expanded') !== 'true') await consumos(page).click();
  await page.getByRole('button', { name: 'Pizza Margherita, $185', exact: true }).click();
  await expect(page.locator('.mi-parte')).toContainText('My share');
  await expect(page.locator('.mi-parte')).toContainText('tip included');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
});

test('K5 · guardar con éxito confirma en la mesa; error sin aviso', async ({ page }) => {
  const code = await mesa(page); await elegir(page);
  await page.evaluate(() => {
    const estados: string[] = [];
    (window as unknown as { guardadosMedidos: string[] }).guardadosMedidos = estados;
    new MutationObserver(() => {
      const texto = document.querySelector('.mesa-guardado p')?.textContent;
      if (texto && texto !== estados.at(-1)) estados.push(texto);
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta);
    const errors = '/src/api/mock/mockApi.ts'; const { MockApiError } = await import(/* @vite-ignore */ errors);
    const original = api.lockItems;
    api.lockItems = async () => { api.lockItems = original; throw new MockApiError(409, 'item_already_locked'); };
  });
  await continuar(page).click();
  await expect(page.getByText('Alguien ya tomó uno de esos consumos', { exact: true })).toBeVisible();
  await expect(page.getByText('Listo, quedó guardado', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/mesa/${code}$`));
  await continuar(page).click();
  await expect(page.getByText('Listo, quedó guardado', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/mesa/${code}$`));
  await expect(page.locator('.mesa-guardado')).toContainText('Tu parte: $201.73');
  expect(await page.evaluate(() => (window as unknown as { guardadosMedidos: string[] }).guardadosMedidos)).toEqual(['Tu parte: $201.73']);
  const titulo = await page.getByRole('heading', { name: 'Tu mesa', exact: true }).boundingBox();
  const aviso = await page.locator('.mesa-guardado').boundingBox(); expect(aviso!.y).toBeGreaterThan(titulo!.y + titulo!.height);
  await expect(page.locator('.toast')).toHaveClass(/toast-hidden/);
  await captura(page, '05-despues-de-listo');
  await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en')); await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText("Done, it's saved", { exact: true })).toBeVisible();
  await expect(page.locator('.mesa-guardado')).toContainText('Your share: $201.73');
});

for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`K5 · aviso dentro de la vista después de elegir abajo a ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    if (viewport.width === 320) await page.emulateMedia({ reducedMotion: 'reduce' });
    await mesa(page);
    const lista = page.locator('.qc-renglon');
    await expect(lista).toHaveCount(7);
    const plato = lista.last().locator('.qc-libre');
    await plato.scrollIntoViewIfNeeded();
    await plato.click();
    expect(await page.locator('.mesa-selection-scroll').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await continuar(page).click();
    const aviso = page.locator('.mesa-guardado');
    await expect(aviso).toBeVisible();
    await expect(aviso).toBeInViewport({ ratio: 1 });
    expect(await aviso.evaluate(el => {
      const { left, top, width, height } = el.getBoundingClientRect();
      const scroll = el.closest('.mesa-selection-scroll')!.getBoundingClientRect();
      const hit = document.elementFromPoint(left + width / 2, top + height / 2);
      return top >= scroll.top && top + height <= scroll.bottom && el.contains(hit);
    })).toBe(true);
    await expect(aviso).toHaveCSS('padding-top', '12px');
    await expect(aviso.locator('p')).toHaveCSS('font-weight', '700');
    await expect(aviso.locator('.mesa-guardado-check svg')).toBeVisible();
    await captura(page, `05c-guardado-${viewport.width}`);
  });
}

const medidasDeGuardado = [
  { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 375, height: 667 },
  { width: 390, height: 664 }, { width: 414, height: 736 },
];

for (const viewport of medidasDeGuardado) {
  for (const platos of [1, 6]) {
    test(`N0 · dos guardados a ${viewport.width}×${viewport.height} con ${platos === 1 ? '1 plato' : '6 platos'}`, async ({ page }, info) => {
      await page.setViewportSize(viewport);
      if (viewport.width === 320) await page.emulateMedia({ reducedMotion: 'reduce' });
      await mesa(page);
      const filas = page.locator('.qc-renglon');
      const aviso = page.locator('.mesa-guardado');
      const desplazable = page.locator('.mesa-selection-scroll');
      await expect(filas).toHaveCount(7);
      const clickSinDesplazarAncestros = (el: HTMLButtonElement) => el.click();

      const guardarYMedir = async (numero: number, esperados: number) => {
        await desplazable.evaluate(el => { el.scrollTop = el.scrollHeight; });
        await expect(continuar(page)).toBeEnabled();
        await continuar(page).evaluate(clickSinDesplazarAncestros);
        await expect(aviso).toContainText('Listo, quedó guardado');
        await expect(filas.locator('[data-estado="registrado"]')).toHaveCount(esperados);
        const medidas = await aviso.evaluate(el => {
          const app = el.closest('.app')!;
          const lista = el.closest('.mesa-selection-scroll')!.getBoundingClientRect();
          const barra = app.querySelector('.appbar-block')!.getBoundingClientRect();
          const cabecera = app.querySelector('.hdr')!.getBoundingClientRect();
          const r = el.getBoundingClientRect();
          const centro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            scrollTop: app.scrollTop, scrollHeight: app.scrollHeight, clientHeight: app.clientHeight,
            fondoBarra: barra.bottom, altoVentana: innerHeight, inicioCabecera: cabecera.top,
            avisoVisible: r.top >= Math.max(0, lista.top) && r.bottom <= Math.min(barra.top, lista.bottom)
              && r.left >= 0 && r.right <= innerWidth && el.contains(centro),
          };
        });
        await info.attach(`guardado-${numero}`, { body: JSON.stringify(medidas), contentType: 'application/json' });
        await captura(page, `n0-${viewport.width}x${viewport.height}-${platos}-${numero}`);
        return medidas;
      };

      // Clics DOM de la app, sin el scroll de accionabilidad de Playwright.
      for (let i = 1; i <= platos; i += 1) {
        await filas.nth(i).locator('.qc-libre').evaluate(clickSinDesplazarAncestros);
      }
      const primero = await guardarYMedir(1, platos);
      await consumos(page).evaluate(clickSinDesplazarAncestros);
      // Cambia un plato ya guardado por uno libre para mantener la cantidad
      // y evitar que el segundo guardado complete la mesa.
      await filas.nth(platos).getByRole('button', { name: /^Soltar / }).evaluate(clickSinDesplazarAncestros);
      await expect(filas.nth(platos).locator('.qc-libre')).toBeEnabled();
      await filas.nth(platos === 6 ? 0 : 6).locator('.qc-libre').evaluate(clickSinDesplazarAncestros);
      await expect(aviso).toHaveCount(0);
      const segundo = await guardarYMedir(2, platos);
      const invariante = ({ clientHeight, altoVentana }: typeof primero) => ({
        scrollTop: 0, scrollHeight: clientHeight, clientHeight: altoVentana,
        fondoBarra: altoVentana, inicioCabecera: 0, avisoVisible: true,
      });
      expect(primero).toMatchObject(invariante(primero));
      expect(segundo).toMatchObject(invariante(segundo));
    });
  }
}

for (const caso of ['lectura fallida', 'importe cero', 'importe ausente'] as const) {
  test(`K5 · ${caso} después de guardar deja el aviso sin importe`, async ({ page }) => {
    const code = await mesa(page);
    await elegir(page);
    await page.evaluate(async ({ code, caso }) => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
      const leer = api.getMesa.bind(api);
      const guardar = api.lockItems.bind(api);
      let guardado = false;
      api.lockItems = async (...args) => {
        const respuesta = await guardar(...args);
        if (args[0] === code) guardado = true;
        return respuesta;
      };
      api.getMesa = async (...args) => {
        if (!guardado || args[0] !== code) return leer(...args);
        api.getMesa = leer;
        if (caso === 'lectura fallida') throw new TypeError('falló la lectura posterior al lock del mock');
        const respuesta = await leer(...args);
        const my_share = caso === 'importe cero'
          ? { items_cents: 0, adjustments_cents: 0, tip_cents: 0, total_cents: 0 }
          : null;
        return { ...respuesta, mesa: { ...respuesta.mesa, my_share } };
      };
    }, { code, caso });
    await continuar(page).click();
    const aviso = page.locator('.mesa-guardado');
    await expect(aviso).toHaveText('Listo, quedó guardado');
    await expect(aviso.locator('p')).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/mesa/${code}$`));
    await expect(page.getByRole('button', { name: 'Tus consumos' })).toBeEnabled();
    if (caso === 'lectura fallida') await captura(page, '05b-guardado-sin-importe');
  });
}

test('K6 · cerrar avisa sólo los platos sin dueño confirmados', async ({ page }) => {
  const code = await mesa(page); await elegir(page); await continuar(page).click();
  await expect.poll(() => page.evaluate(async (c) => {
    const ruta = '/src/api/mock/store.ts'; const { state } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
    return state.mesas.find((m) => m.code === c)!.items.filter((i) => i.claims.length > 0).length;
  }, code)).toBe(1);
  await page.goto(`/#/mesa/${code}`);
  await page.getByRole('button', { name: 'Cerrar mesa', exact: true }).click();
  const hoja = page.getByRole('dialog', { name: '¿Cerrar la mesa?', exact: true });
  await expect(hoja.getByText('Quedan 6 platos sin dueño ($645)', { exact: false })).toBeVisible();
  await captura(page, '06-cerrar-mesa'); await page.keyboard.press('Escape');
  await page.evaluate(async (code) => {
    const ruta = '/src/api/mock/store.ts'; const { state, persist } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
    const m = state.mesas.find((m) => m.code === code)!;
    for (const i of m.items) if (i.claims.length === 0) i.claims.push({ who: 'other', fraction_bps: 5000, status: 'locked', amount_cents: null });
    persist();
  }, code);
  await page.reload(); await page.getByRole('button', { name: 'Cerrar mesa', exact: true }).click();
  await expect(hoja.locator('.cerrar-mesa-sin-dueno')).toHaveCount(0);
});
