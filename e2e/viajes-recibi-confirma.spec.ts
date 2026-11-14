import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

const VIAJE = 'd1000000-0000-4000-8000-000000000002';
type Llamada = [string, string, string];
interface Instrumento {
  llamadas: Llamada[];
  demorar: boolean;
  fallar: boolean;
  resolver: (() => void) | null;
  restaurar: () => void;
}
type Ventana = Window & { __c194: Instrumento };

async function preparar(page: Page, idioma: 'es' | 'en' = 'es') {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(u.hostname) ? route.fallback() : route.abort('blockedbyclient');
  });
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
  });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
  if (idioma === 'en') {
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
  }
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const original = api.marcarTransferenciaDeViaje;
    const i: Instrumento = { llamadas: [], demorar: false, fallar: false, resolver: null,
      restaurar: () => { api.marcarTransferenciaDeViaje = original; } };
    (window as unknown as Ventana).__c194 = i;
    api.marcarTransferenciaDeViaje = (viaje, transferencia, accion) => {
      i.llamadas.push([viaje, transferencia, accion]);
      const ejecutar = () => i.fallar ? Promise.reject(new Error('fallo inventado C194')) : original(viaje, transferencia, accion);
      if (!i.demorar) return ejecutar();
      return new Promise((resolve, reject) => { i.resolver = () => { void ejecutar().then(resolve, reject); }; });
    };
    history.pushState(null, '', `/viaje/${'d1000000-0000-4000-8000-000000000002'}`);
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.getByRole('heading', { name: 'Monterrey fin de semana', exact: true })).toBeVisible();
}
const fila = (page: Page, nombre: string) => page.locator('.vjv-tr-item').filter({ has: page.locator('.vjv-tr-nombre', { hasText: nombre }) });
const boton = (page: Page, nombre: string) => fila(page, nombre).getByRole('button', { name: 'Recibí', exact: true });
const llamadas = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__c194.llamadas);

async function comprobarHoja(page: Page, nombre: string, monto: string) {
  const hoja = page.getByRole('dialog', { name: `¿Recibiste ${monto} de ${nombre}?`, exact: true });
  await expect(hoja).toBeVisible();
  await expect(hoja.getByRole('heading')).toHaveText(`¿Recibiste ${monto} de ${nombre}?`);
  await expect(hoja.getByText('Queda como pagado y no se puede deshacer.', { exact: true })).toBeVisible();
  await expect(hoja.getByRole('button', { name: 'Sí, recibí', exact: true })).toBeEnabled();
  await expect(hoja.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  expect(await llamadas(page)).toEqual([]);
  return hoja;
}

test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.evaluate(() => (window as unknown as Ventana).__c194?.restaurar());
});

test('C194 A1 · desde Pendiente pide confirmación y no marca', async ({ page }) => {
  await preparar(page);
  await boton(page, 'Sofía').click();
  await comprobarHoja(page, 'Sofía', '$300');
});

test('C194 A2 · desde marcó que te pagó pide confirmación y no marca', async ({ page }) => {
  await preparar(page);
  await boton(page, 'Luis').click();
  await comprobarHoja(page, 'Luis', '$750');
});

for (const nombre of ['Sofía', 'Luis']) {
  for (const salida of ['Cancelar', 'Escape', 'afuera']) {
    test(`C194 A3 · ${salida} devuelve el foco a Recibí de ${nombre} sin marcar`, async ({ page }) => {
      await preparar(page);
      const disparador = boton(page, nombre);
      // Safari puede no enfocar un botón al tocarlo: no depender del foco anterior.
      await page.getByRole('heading', { name: 'Monterrey fin de semana' }).evaluate((el) => (el as HTMLElement).focus());
      await disparador.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      if (salida === 'Cancelar') await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      else if (salida === 'Escape') await page.keyboard.press('Escape');
      else await page.locator('.sheet-overlay').click({ position: { x: 5, y: 5 } });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(disparador).toBeFocused();
      expect(await llamadas(page)).toEqual([]);
      await expect(fila(page, nombre)).not.toContainText('Pagado');
    });
  }
}

test('C194 A4 A6 · confirmar una vez, doble toque bloqueado, Pagado y última transferencia a Cerrados', async ({ page }) => {
  await preparar(page);
  await page.evaluate(() => { (window as unknown as Ventana).__c194.demorar = true; });
  await boton(page, 'Luis').click();
  await comprobarHoja(page, 'Luis', '$750');
  const confirmar = page.getByRole('button', { name: 'Sí, recibí', exact: true });
  await confirmar.evaluate((el) => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(confirmar).toBeDisabled();
  expect(await llamadas(page)).toEqual([[VIAJE, expect.any(String), 'recibi']]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(() => { (window as unknown as Ventana).__c194.resolver?.(); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(fila(page, 'Luis')).toContainText('Pagado');
  await page.evaluate(() => { (window as unknown as Ventana).__c194.demorar = false; });
  await boton(page, 'Sofía').click();
  await page.getByRole('button', { name: 'Sí, recibí', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-cerrado/${VIAJE}$`));
  await expect(page.getByText('Monterrey fin de semana quedó cerrado. Todos pagaron y ya está en Cerrados.', { exact: true })).toBeVisible();
  const pedidos = await llamadas(page);
  expect(pedidos).toHaveLength(2);
  expect(pedidos[1]).toEqual([VIAJE, expect.any(String), 'recibi']);
  expect(pedidos[0]?.[1]).not.toBe(pedidos[1]?.[1]);
});

test('C194 A5 · confirmación en inglés con el texto exacto', async ({ page }) => {
  await preparar(page, 'en');
  await fila(page, 'Luis').getByRole('button', { name: 'I got it', exact: true }).click();
  const hoja = page.getByRole('dialog', { name: 'Did you receive $750 from Luis?', exact: true });
  await expect(hoja).toBeVisible();
  await expect(hoja.getByRole('heading')).toHaveText('Did you receive $750 from Luis?');
  await expect(hoja.getByText("It will be marked as paid and can't be undone.", { exact: true })).toBeVisible();
  await expect(hoja.getByRole('button', { name: 'Yes, I received it', exact: true })).toBeEnabled();
  await expect(hoja.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  expect(await llamadas(page)).toEqual([]);
});

test('C194 · un error conserva el aviso y el refresco existentes sin dar por pagado', async ({ page }) => {
  await preparar(page);
  await page.evaluate(() => { (window as unknown as Ventana).__c194.fallar = true; });
  await boton(page, 'Luis').click();
  await page.getByRole('button', { name: 'Sí, recibí', exact: true }).click();
  await expect(page.getByText('No pudimos guardarlo. Prueba de nuevo.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(boton(page, 'Luis')).toBeEnabled();
  expect(await llamadas(page)).toEqual([[VIAJE, expect.any(String), 'recibi']]);
});
