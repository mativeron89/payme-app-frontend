import { expect, test, type Page } from '@playwright/test';
import { hastaCompartir, pedidosDePropina, selectorDePropina } from './fixtures/mi-parte-d344';
import { abrirConfiguracionDeLaMesa, abrirTusConsumos } from './_mesa';

/**
 * D469 · la pantalla de la mesa después de «Listo» (Mati, con captura):
 *   1. el engranaje de «Configuración de la mesa» arriba a la derecha de la
 *      tarjeta del encabezado, visible también después de «Listo»;
 *   2. «Cómo se arma tu parte» → desplegable «Tu parte» con flecha;
 *   3. sin la línea «Propina de la mesa: X %»;
 *   4. «Quiénes están en la mesa», «Tu parte», «Tus consumos», cerrados al abrir.
 *
 * Mesa del mock sin garantía (pagos apagados), por consumo entre 4, ticket con
 * $50 de descuento y propina del 15 %: el organizador elige el Tagliatelle
 * ($195) y su parte es $210.90 (las cuentas, en `mi-parte-d344.spec.ts`).
 * Capturas a 390×844 sólo con `PAYME_E2E_CAPTURAS`.
 */
test.use({ viewport: { width: 390, height: 844 } });

const MENOS = '−';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

const engranaje = (page: Page) => page.getByRole('button', { name: 'Configuración de la mesa', exact: true });
const region = (page: Page, nombre: string) => page.getByRole('region', { name: nombre, exact: true });
const cabecera = (page: Page, nombre: string) => region(page, nombre).locator('.desplegable-cabecera');

/** Hasta «Tu mesa» después de «Listo», con el Tagliatelle elegido y la propina del 15 %. */
async function tuMesaDespuesDeListo(page: Page): Promise<string> {
  const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await selectorDePropina(page).getByRole('radio', { name: '15%', exact: true }).click();
  await expect.poll(() => pedidosDePropina(page)).toBe(1);
  await expect(selectorDePropina(page).getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
  // Al abrir la mesa, «Tus consumos» también arranca cerrado.
  await expect(cabecera(page, 'Tus consumos')).toHaveAttribute('aria-expanded', 'false');
  await abrirTusConsumos(page);
  await page.getByRole('button', { name: /Tagliatelle Bolognese/ }).click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
  await page.goto(`/#/mesa/${code}`);
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
  return code;
}

/**
 * La vista de la captura de Mati: una mesa por partes iguales que ya cerró (venció por tiempo) y a la que se vuelve
 * después de «Listo». Es el único camino en que «Tu mesa» se ve con la mesa que ya no recibe gente (`MesaScreen`:
 * `showClosedInformativeSelection`); con la mesa abierta el engranaje siempre estuvo. La línea de la propina se veía
 * y el engranaje no: no quedaba nada que configurar.
 */
async function laMesaVencio(page: Page, code: string): Promise<void> {
  await page.evaluate(async (c) => {
    const route = '/src/api/mock/store.ts';
    const module = await import(/* @vite-ignore */ route);
    const mesa = module.state.mesas.find((candidate: { code: string }) => candidate.code === c);
    if (!mesa) throw new Error(`no está la mesa ${c}`);
    mesa.status = 'expired';
    mesa.closure_reason = 'time';
    module.persist();
  }, code);
  await page.goto(`/#/mesa/${code}`);
  await expect(page.getByText('Esta mesa ya cerró. Lo guardado es sólo de lectura.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
}

test.describe('D469 · «Tu mesa»: engranaje arriba a la derecha y tres desplegables cerrados', () => {
  test('🔴 después de «Listo»: engranaje a la derecha, sin la línea de la propina y «Quiénes», «Tu parte», «Tus consumos» cerrados y en orden', async ({ page }) => {
    await tuMesaDespuesDeListo(page);

    // 1 · el engranaje, arriba a la derecha de la tarjeta del encabezado.
    await expect(engranaje(page)).toBeVisible();
    await expect(engranaje(page)).toHaveAttribute('aria-expanded', 'false');
    const tarjeta = await page.locator('.mesa-selection-title').boundingBox();
    const titulo = await page.getByRole('heading', { name: 'Tu mesa', exact: true }).boundingBox();
    const boton = await engranaje(page).boundingBox();
    // A la derecha: su centro en el cuarto derecho de la tarjeta y pegado al borde.
    expect(boton!.x + boton!.width / 2).toBeGreaterThan(tarjeta!.x + tarjeta!.width * 0.75);
    expect(boton!.x + boton!.width).toBeGreaterThan(tarjeta!.x + tarjeta!.width - 16);
    // Arriba: su centro a la altura del título.
    expect(boton!.y + boton!.height / 2).toBeGreaterThan(titulo!.y);
    expect(boton!.y + boton!.height / 2).toBeLessThan(titulo!.y + titulo!.height);
    // El título no pasa por debajo del ícono.
    const textoDelTitulo = await page.getByRole('heading', { name: 'Tu mesa', exact: true }).evaluate((h) => {
      const rango = document.createRange();
      rango.selectNodeContents(h);
      return rango.getBoundingClientRect().right;
    });
    expect(textoDelTitulo).toBeLessThan(boton!.x);
    expect(boton!.width).toBeGreaterThanOrEqual(44);
    expect(boton!.height).toBeGreaterThanOrEqual(44);
    // El cuadro de la izquierda es la tienda, no el engranaje.
    await expect(page.locator('.title-card-cuadro[data-icono="tienda"]')).toBeVisible();
    await expect(page.locator('.title-card-cuadro[data-icono="engranaje"]')).toHaveCount(0);

    // 3 · sin «Propina de la mesa: 15 %» en la página, ni el título viejo.
    await expect(page.getByText('Propina de la mesa: 15 %', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Cómo se arma tu parte')).toHaveCount(0);

    // 4 · el orden y los tres cerrados.
    for (const nombre of ['Quiénes están en la mesa', 'Tu parte', 'Tus consumos']) {
      await expect(cabecera(page, nombre), nombre).toHaveAttribute('aria-expanded', 'false');
      await expect(cabecera(page, nombre), nombre).toHaveText(nombre);
    }
    const orden = await page.evaluate(() => {
      const selectores = ['.desplegable.quienes', '.desplegable.mi-parte-desglose', '.desplegable.tus-consumos', '.mesa-cerrar'];
      const els = selectores.map((s) => document.querySelector(s));
      if (els.some((e) => !e)) return selectores.filter((_, i) => !els[i]);
      return els.every((e, i) => i === 0 || (els[i - 1]!.compareDocumentPosition(e!) & Node.DOCUMENT_POSITION_FOLLOWING))
        ? 'en orden' : 'desordenado';
    });
    expect(orden).toBe('en orden');
    await expect(region(page, 'Tu parte').locator('.desplegable-flecha')).toBeVisible();
    await capturar(page, 'd469-01-tu-mesa-despues-de-listo');

    // 2 · «Tu parte» abierto: platos, descuento, propina y total; se vuelve a cerrar.
    await cabecera(page, 'Tu parte').click();
    await expect(cabecera(page, 'Tu parte')).toHaveAttribute('aria-expanded', 'true');
    const filas = await region(page, 'Tu parte').locator('.mi-parte-desglose-fila').evaluateAll((fs) =>
      fs.map((f) => (f as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
    expect(filas).toEqual([
      'Tus platos $195',
      `Descuento ${MENOS}$11.61`,
      'Propina (15 % de la mesa) $27.51',
      'Total $210.90',
    ]);
    await capturar(page, 'd469-02-tu-parte-abierto');
    await cabecera(page, 'Tu parte').click();
    await expect(cabecera(page, 'Tu parte')).toHaveAttribute('aria-expanded', 'false');
    await expect(region(page, 'Tu parte').locator('.mi-parte-desglose-fila').first()).toBeHidden();

    // El engranaje abre la hoja de siempre: código, compartir y la propina guardada.
    await engranaje(page).click();
    await expect(engranaje(page)).toHaveAttribute('aria-expanded', 'true');
    const hoja = page.getByRole('dialog', { name: 'Configuración de la mesa' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText(/Código para unirse:/)).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Invitar amigos de PayMe' })).toBeVisible();
    await expect(selectorDePropina(page).getByRole('radio', { name: '15%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await capturar(page, 'd469-03-hoja-del-engranaje');
    await page.keyboard.press('Escape');
    await expect(hoja).toHaveCount(0);
    await expect(engranaje(page)).toBeFocused();
  });

  test('🔴 la mesa que ya cerró (la vista de la captura) conserva el engranaje: la hoja muestra la propina leída', async ({ page }) => {
    const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'igual' });
    await selectorDePropina(page).getByRole('radio', { name: '15%', exact: true }).click();
    await expect.poll(() => pedidosDePropina(page)).toBe(1);
    await expect(selectorDePropina(page).getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await abrirTusConsumos(page);
    await page.getByRole('button', { name: /Tagliatelle Bolognese/ }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await laMesaVencio(page, code);

    await expect(engranaje(page)).toBeVisible();
    await expect(page.getByText('Propina de la mesa: 15 %', { exact: true })).toHaveCount(0);
    await capturar(page, 'd469-04-mesa-cerrada-con-engranaje');
    await abrirConfiguracionDeLaMesa(page);
    const hoja = page.getByRole('dialog', { name: 'Configuración de la mesa' });
    await expect(hoja.getByText('Propina de la mesa: 15 %', { exact: true })).toBeVisible();
    // Sin código ni invitar (la mesa ya no recibe gente) y sin selector (la propina no se cambia).
    await expect(hoja.getByText(/Código para unirse:/)).toHaveCount(0);
    await expect(hoja.getByRole('button', { name: 'Invitar amigos de PayMe' })).toHaveCount(0);
    await expect(selectorDePropina(page)).toHaveCount(0);
    await capturar(page, 'd469-05-hoja-con-la-propina-leida');
  });

  test('en inglés: «Your share» cerrado con «Total», y el engranaje con su nombre', async ({ page }) => {
    await tuMesaDespuesDeListo(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Table settings', exact: true })).toBeVisible();
    await expect(page.getByText('Table tip: 15 %', { exact: true })).toHaveCount(0);
    const tuParte = region(page, 'Your share').locator('.desplegable-cabecera');
    await expect(tuParte).toHaveAttribute('aria-expanded', 'false');
    await tuParte.click();
    await expect(region(page, 'Your share').locator('.mi-parte-desglose-total')).toHaveText(/^Total\s*\$210\.90$/);
    await capturar(page, 'd469-06-en');
  });
});
