import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { cerrarAntesDelFrame } from './_foco';
import { abrirTusConsumos, asentarEscriturasDeSeleccion, observarEscriturasDeSeleccion } from './_mesa';
import { hastaCompartir } from './fixtures/mi-parte-d344';

const mesa = /\/mesa\/PA-2847$/;
const destinos = [
  { nombre: 'Inicio', ruta: /\/home$/ },
  { nombre: 'Mesas', ruta: /\/mesas$/ },
  { nombre: 'Amigos', ruta: /\/amigos$/ },
  { nombre: 'Más', ruta: /\/mas$/ },
];
const aviso = (page: Page) => page.getByRole('dialog', { name: 'Tienes cambios sin guardar' });
const control = (page: Page, nombre: string) =>
  page.locator('.appbar-block').getByRole('button', {
    name: nombre === 'Amigos' ? /^Amigos(?:, .+)?$/ : nombre, exact: true,
  });
const fila = (page: Page) => page.locator('.qc-renglon').first();
const lecturas = (page: Page) => page.locator('body');

async function preparar(page: Page, sucia: boolean) {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page, { sinInvitaciones: true });
  await page.goto('/#/mesa/PA-2847');
  await abrirTusConsumos(page);
  if (sucia) await fila(page).locator('.qc-libre').click();
}

for (const { nombre, ruta } of destinos) {
  test(`W1 · sin borrador, ${nombre} conserva su acción`, async ({ page }) => {
    await preparar(page, false);
    await observarEscriturasDeSeleccion(page);
    await control(page, nombre).click();
    await expect(page).toHaveURL(ruta);
    await expect(aviso(page)).toHaveCount(0);
    await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '0');
  });

  test(`W1 · ${nombre} permite seguir y después descartar sin escribir`, async ({ page }) => {
    await preparar(page, true);
    await observarEscriturasDeSeleccion(page);
    await control(page, nombre).click();
    await expect(aviso(page)).toBeVisible();
    await expect(page).toHaveURL(mesa);
    await aviso(page).getByRole('button', { name: 'Seguir editando' }).click();
    await expect(aviso(page)).toHaveCount(0);
    await expect(control(page, nombre)).toBeFocused();
    await expect(fila(page).locator('.qc-circulo--marcado')).toBeVisible();
    await control(page, nombre).click();
    await aviso(page).getByRole('button', { name: 'Salir sin guardar' }).click();
    await expect(page).toHaveURL(ruta);
    await expect(aviso(page)).toHaveCount(0);
    await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '0');
    await page.goto('/#/mesa/PA-2847');
    await abrirTusConsumos(page);
    await expect(fila(page).locator('.qc-libre')).toBeVisible();
  });

  test(`W1 · Guardar desde ${nombre} espera la escritura`, async ({ page }) => {
    await preparar(page, true);
    await observarEscriturasDeSeleccion(page, 'retenida');
    await control(page, nombre).click();
    await expect(aviso(page)).toBeVisible();
    if (nombre === 'Mesas' && process.env.PAYME_E2E_CAPTURAS) {
      await page.locator('.hdr-user').evaluateAll((els) => els.forEach(el => { el.textContent = 'Demo'; }));
      await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/mesa-aviso-barra.png` });
    }
    await aviso(page).getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
    await expect(page).toHaveURL(mesa);
    await expect(page.locator('.mesa-guardado')).toHaveCount(0);
    await page.evaluate(() => document.dispatchEvent(new Event('liberar-guardado')));
    await expect(page).toHaveURL(ruta);
    await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
    await page.goto('/#/mesa/PA-2847');
    await abrirTusConsumos(page);
    await expect(fila(page).locator('[data-estado="registrado"]')).toBeVisible();
  });
}

test('W1 · un rechazo de Guardar conserva la mesa y su borrador', async ({ page }) => {
  await preparar(page, true);
  await observarEscriturasDeSeleccion(page, 'rechazada');
  await control(page, 'Mesas').press('Enter');
  await aviso(page).getByRole('button', { name: 'Guardar', exact: true }).press('Enter');
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
  await expect(page.getByText('No pudimos reservar lo que elegiste', { exact: true })).toBeVisible();
  await expect(control(page, 'Mesas')).toBeFocused();
  await expect(page).toHaveURL(mesa);
  await expect(fila(page).locator('.qc-circulo--marcado')).toBeVisible();
});

test('W1 · un rechazo de Guardar con mouse conserva la mesa y su borrador', async ({ page }) => {
  await preparar(page, true);
  await observarEscriturasDeSeleccion(page, 'rechazada');
  await control(page, 'Mesas').click();
  await aviso(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
  await expect(page.getByText('No pudimos reservar lo que elegiste', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(mesa);
  await expect(fila(page).locator('.qc-circulo--marcado')).toBeVisible();
});

test('W1 · partes iguales guarda desde la barra y descarta al último valor guardado', async ({ page }) => {
  const code = await hastaCompartir(page, { modo: 'igual', ocr: 'descuento' });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await abrirTusConsumos(page);
  const plato = page.locator('.qc-renglon').filter({ hasText: 'Tagliatelle Bolognese' });
  await plato.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await observarEscriturasDeSeleccion(page);
  await control(page, 'Mesas').click();
  await aviso(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL(/\/mesas$/);
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
  await page.goto(`/#/mesa/${code}`);
  await abrirTusConsumos(page);
  const marcado = plato.locator('.qc-circulo--marcado');
  await expect(marcado).toBeVisible();
  await observarEscriturasDeSeleccion(page);
  await marcado.click();
  await expect(marcado).toHaveCount(0);
  await control(page, 'Mesas').click();
  await aviso(page).getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(page).toHaveURL(/\/mesas$/);
  await expect(aviso(page)).toHaveCount(0);
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '0');
  await page.goto(`/#/mesa/${code}`);
  await abrirTusConsumos(page);
  await expect(marcado).toBeVisible();
});

test('W1 · Continuar sin borrador conserva la indicación para elegir', async ({ page }) => {
  await preparar(page, false);
  await observarEscriturasDeSeleccion(page);
  await control(page, 'Continuar').click();
  await expect(page).toHaveURL(mesa);
  await expect(aviso(page)).toHaveCount(0);
  await expect(page.getByText('Elige lo que consumiste para continuar')).toBeVisible();
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '0');
});

async function comprobarGuardadoDirecto(page: Page) {
  await expect(aviso(page)).toHaveCount(0);
  await expect(page.getByText('Listo, quedó guardado', { exact: true })).toBeVisible();
  await asentarEscriturasDeSeleccion(page);
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
  await expect(page).toHaveURL(mesa);
  await expect(fila(page).locator('[data-estado="registrado"]')).toHaveCount(1);
  await page.reload();
  await abrirTusConsumos(page);
  await expect(fila(page).locator('[data-estado="registrado"]')).toBeVisible();
}

test('Y1 · Continuar guarda con un toque y sin aviso', async ({ page }) => {
  await preparar(page, true);
  await observarEscriturasDeSeleccion(page);
  await control(page, 'Continuar').click();
  await comprobarGuardadoDirecto(page);
});

for (const { width, height, intervalo } of [
  { width: 320, height: 568, intervalo: 80 },
  { width: 375, height: 667, intervalo: 250 },
  { width: 390, height: 844, intervalo: 80 },
  { width: 390, height: 844, intervalo: 250 },
]) {
  test(`Y2 · dos toques a ${intervalo} ms en Continuar guardan una vez a ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await preparar(page, true);
    await observarEscriturasDeSeleccion(page);
    const continuar = control(page, 'Continuar');
    await continuar.scrollIntoViewIfNeeded();
    const caja = await continuar.boundingBox();
    if (!caja) throw new Error('Continuar debe tener una posición visible');
    const x = caja.x + caja.width / 2;
    const y = caja.y + caja.height / 2;
    await page.touchscreen.tap(x, y);
    // El segundo toque cae en las mismas coordenadas aunque cambie la UI.
    await new Promise<void>(resolver => setTimeout(resolver, intervalo));
    const avisosEntreToques = await aviso(page).count();
    await page.touchscreen.tap(x, y);
    expect(avisosEntreToques).toBe(0);
    await comprobarGuardadoDirecto(page);
  });
}

test('Y2 · dblclick en Continuar guarda una vez', async ({ page }) => {
  await preparar(page, true);
  await observarEscriturasDeSeleccion(page);
  await control(page, 'Continuar').dblclick();
  await comprobarGuardadoDirecto(page);
});

test('Continuar devuelve el foco al aviso después de guardar con el teclado', async ({ page }) => {
  await preparar(page, true);
  await control(page, 'Continuar').press('Enter');
  const guardado = page.locator('.mesa-guardado');
  await expect(guardado).toBeVisible();
  await expect(guardado).toBeFocused();
});

test('Y4 · Volver y Guardar devuelve el foco a Volver cuando queda en el documento', async ({ page }) => {
  await preparar(page, true);
  await observarEscriturasDeSeleccion(page, 'retenida');
  const volver = page.getByRole('button', { name: 'Volver', exact: true });
  await volver.click();
  await aviso(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(aviso(page)).toHaveCount(0);
  await expect(volver).toBeFocused();
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
  await page.evaluate(() => document.dispatchEvent(new Event('liberar-guardado')));
  await expect(page.getByText('Listo, quedó guardado', { exact: true })).toBeVisible();
  await expect(volver).toBeFocused();
});

test('Y4 · Volver y Guardar respeta el foco que tomó otro control', async ({ page }) => {
  await preparar(page, true);
  await observarEscriturasDeSeleccion(page, 'retenida');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await cerrarAntesDelFrame(page, aviso(page).getByRole('button', { name: 'Guardar', exact: true }),
    aviso(page), control(page, 'Mesas'));
  await page.evaluate(() => document.dispatchEvent(new Event('liberar-guardado')));
  await expect(page.getByText('Listo, quedó guardado', { exact: true })).toBeVisible();
});
