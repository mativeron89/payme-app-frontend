import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * Decisión 32 de Mati (2026-09-24): «En esa pantalla ya muestra lo que elegí,
 * cuando selecciono Listo me debería llevar a la pantalla de Inicio».
 *
 * Regla: con el guardado OK, «Listo» vuelve a Inicio —también el segundo
 * toque, cuando ya estaba registrado y no hay nada nuevo—; si falla, no navega
 * y muestra el error; sin nada elegido ni registrado, la guarda de «Continuar».
 * La misma regla rige en «igual» (selección informativa, n225).
 *
 * Medido el 24/09 sobre 1c5ad226: tras el primer registro el círculo quedaba
 * vivo y mudo (`goToPay` retornaba en `selected.size === 0`). Todas estas
 * pruebas son rojas contra esa base.
 */

const RIEL = 'payme.app.mock.money_rail.v1';

async function conRielApagado(page: Page): Promise<void> {
  await page.addInitScript((k) => localStorage.setItem(k, 'disabled'), RIEL);
}

async function enInicio(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/home');
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

async function sigueEnLaMesa(page: Page, code: string): Promise<void> {
  // Se espera un momento real: la navegación, si ocurriera, sería asíncrona.
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => location.hash)).toBe(`#/mesa/${code}`);
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
}

/**
 * Cuenta llamadas reales al método del riel desde AHORA, sin cambiar lo que
 * hace. El contador vive en `localStorage` para sobrevivir la navegación, así
 * que se pone en cero al instalarlo: la segunda instalación de una misma
 * prueba (tras reentrar a la mesa) mide sólo lo que pasa después.
 */
async function contarLlamadas(page: Page, metodo: 'lockItems' | 'replaceInformativeSelection'): Promise<void> {
  await page.evaluate(async (nombre) => {
    const key = `payme.app.e2e.d32.${nombre}`;
    localStorage.setItem(key, '0');
    const route = '/src/api/index.ts';
    const module = await import(/* @vite-ignore */ route) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const original = module.api[nombre].bind(module.api);
    module.api[nombre] = async (...args: unknown[]) => {
      localStorage.setItem(key, String(Number(localStorage.getItem(key) ?? '0') + 1));
      return original(...args);
    };
  }, metodo);
}

async function llamadas(page: Page, metodo: 'lockItems' | 'replaceInformativeSelection'): Promise<number> {
  return page.evaluate((k) => Number(localStorage.getItem(k) ?? '0'), `payme.app.e2e.d32.${metodo}`);
}

async function cambiarEstadoEnMemoria(page: Page, code: string, status: string): Promise<void> {
  await page.evaluate(async ([c, st]) => {
    const storePath = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ storePath) as { state: { mesas: Array<{ code: string; status: string }> } };
    const mesa = store.state.mesas.find((m) => m.code === c);
    if (!mesa) throw new Error(`mesa ${c} ausente en el mock`);
    mesa.status = st;
  }, [code, status] as const);
}

test.describe('Decisión 32 · «Listo» lleva a Inicio', () => {
  test('consumo · elegir → Listo registra y vuelve a Inicio; al volver, la fila dice «Lo elegiste»', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    await page.goto(`/#/mesa/${mesa.code}`);
    await contarLlamadas(page, 'lockItems');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await enInicio(page);
    expect(await llamadas(page, 'lockItems')).toBe(1);

    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByText('Lo elegiste')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Asignado 23% de la mesa' })).toBeVisible();
  });

  test('consumo · ya registrado y sin nada nuevo (la captura de Mati): el segundo Listo también va a Inicio, sin otro lock', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    await page.goto(`/#/mesa/${mesa.code}`);
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await enInicio(page);

    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByText('Lo elegiste')).toBeVisible();
    await contarLlamadas(page, 'lockItems');
    const listo = page.getByRole('button', { name: 'Listo', exact: true });
    await expect(listo).toBeEnabled();
    await listo.click();
    await enInicio(page);
    expect(await llamadas(page, 'lockItems')).toBe(0);
  });

  test('consumo · sin nada elegido ni registrado: Listo frena explicando y no navega', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    await page.goto(`/#/mesa/${mesa.code}`);
    await contarLlamadas(page, 'lockItems');
    const listo = page.getByRole('button', { name: 'Listo', exact: true });
    await expect(listo).toBeEnabled();
    await listo.click();
    await expect(page.getByRole('status').filter({ hasText: 'Elige lo que consumiste para continuar' })).toBeVisible();
    await sigueEnLaMesa(page, mesa.code);
    expect(await llamadas(page, 'lockItems')).toBe(0);
  });

  test('consumo · el lock falla: no navega y muestra el error', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    await page.goto(`/#/mesa/${mesa.code}`);
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    // La mesa vence EN MEMORIA del mock justo antes del lock: el dueño contesta
    // 409 `mesa_not_active`, que el front dice con su toast genérico de reserva.
    await cambiarEstadoEnMemoria(page, mesa.code, 'expired');
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'No pudimos reservar lo que elegiste' })).toBeVisible();
    await sigueEnLaMesa(page, mesa.code);
  });

  test('igual · elegir → Listo guarda y vuelve a Inicio; al volver, nota fija y «Guardado» tocable que también va a Inicio sin otro PUT', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'igual' });
    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
    await contarLlamadas(page, 'replaceInformativeSelection');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await enInicio(page);
    expect(await llamadas(page, 'replaceInformativeSelection')).toBe(1);

    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByText('Tu selección quedó guardada.')).toBeVisible();
    await contarLlamadas(page, 'replaceInformativeSelection');
    const guardado = page.getByRole('button', { name: 'Guardado', exact: true });
    await expect(guardado).toBeEnabled();
    await guardado.click();
    await enInicio(page);
    expect(await llamadas(page, 'replaceInformativeSelection')).toBe(0);
  });

  test('igual · el guardado falla: no navega y muestra el error', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'igual' });
    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await cambiarEstadoEnMemoria(page, mesa.code, 'expired');
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'La mesa ya cerró. Conservamos tu selección local sin reemplazar la guardada.' })).toBeVisible();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => location.hash)).toBe(`#/mesa/${mesa.code}`);
  });
});
