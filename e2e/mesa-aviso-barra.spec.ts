import { expect, test, type Page } from '@playwright/test';
import type { Api } from '../src/api';
import { ingresar } from './_app';
import { abrirTusConsumos } from './_mesa';
import { hastaCompartir } from './fixtures/mi-parte-d344';

const mesa = /\/mesa\/PA-2847$/;
const destinos = [
  { nombre: 'Inicio', ruta: /\/home$/ },
  { nombre: 'Mesas', ruta: /\/mesas$/ },
  { nombre: 'Continuar', ruta: mesa },
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

async function observarEscrituras(page: Page, respuesta: 'normal' | 'retenida' | 'rechazada' = 'normal') {
  await page.evaluate(async (respuesta) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Api };
    const originalLock = api.lockItems.bind(api);
    const originalReemplazar = api.replaceInformativeSelection.bind(api);
    const { body } = document;
    body.dataset.escriturasDeSeleccion = '0';
    let liberar!: () => void;
    const ack = new Promise<void>((resolve) => { liberar = resolve; });
    document.addEventListener('liberar-guardado', liberar, { once: true });
    async function antesDeEscribir() {
      body.dataset.escriturasDeSeleccion = String(Number(body.dataset.escriturasDeSeleccion) + 1);
      if (respuesta === 'retenida') await ack;
      if (respuesta === 'rechazada') throw Object.assign(new Error('Rechazo de la fixture'), { status: 403 });
    }
    api.lockItems = async (...args) => {
      await antesDeEscribir();
      return originalLock(...args);
    };
    api.replaceInformativeSelection = async (...args) => {
      await antesDeEscribir();
      return originalReemplazar(...args);
    };
  }, respuesta);
}

for (const { nombre, ruta } of destinos) {
  test(`W1 · sin borrador, ${nombre} conserva su acción`, async ({ page }) => {
    await preparar(page, false);
    await observarEscrituras(page);
    await control(page, nombre).click();
    await expect(page).toHaveURL(ruta);
    await expect(aviso(page)).toHaveCount(0);
    if (nombre === 'Continuar') await expect(page.getByText('Elige lo que consumiste para continuar')).toBeVisible();
    await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '0');
  });

  test(`W1 · ${nombre} permite seguir y después descartar sin escribir`, async ({ page }) => {
    await preparar(page, true);
    await observarEscrituras(page);
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
    if (nombre !== 'Continuar') await page.goto('/#/mesa/PA-2847');
    await abrirTusConsumos(page);
    await expect(fila(page).locator('.qc-libre')).toBeVisible();
  });

  test(`W1 · Guardar desde ${nombre} espera la escritura`, async ({ page }) => {
    await preparar(page, true);
    await observarEscrituras(page, 'retenida');
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
    if (nombre === 'Continuar') {
      await expect(page.locator('.mesa-guardado')).toBeVisible();
    } else {
      await page.goto('/#/mesa/PA-2847');
    }
    await abrirTusConsumos(page);
    await expect(fila(page).locator('[data-estado="registrado"]')).toBeVisible();
  });
}

test('W1 · un rechazo de Guardar conserva la mesa y su borrador', async ({ page }) => {
  await preparar(page, true);
  await observarEscrituras(page, 'rechazada');
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
  await observarEscrituras(page);
  await control(page, 'Mesas').click();
  await aviso(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page).toHaveURL(/\/mesas$/);
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '1');
  await page.goto(`/#/mesa/${code}`);
  await abrirTusConsumos(page);
  const marcado = plato.locator('.qc-circulo--marcado');
  await expect(marcado).toBeVisible();
  await observarEscrituras(page);
  await marcado.click();
  await expect(marcado).toHaveCount(0);
  await control(page, 'Continuar').click();
  await aviso(page).getByRole('button', { name: 'Salir sin guardar' }).click();
  await expect(aviso(page)).toHaveCount(0);
  await expect(marcado).toBeVisible();
  await expect(lecturas(page)).toHaveAttribute('data-escrituras-de-seleccion', '0');
});
