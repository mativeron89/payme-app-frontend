import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

const VIAJE = 'd1000000-0000-4000-8000-000000000002';
type Llamada = [string, string, string];
interface Instrumento {
  llamadas: Llamada[];
  idsFixture: { luis: string; sofia: string };
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
    const idsFixture = { luis: '', sofia: '' };
    const original = api.marcarTransferenciaDeViaje;
    const i: Instrumento = { idsFixture, llamadas: [], demorar: false, fallar: false, resolver: null,
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
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const fixture = await api.getViaje('d1000000-0000-4000-8000-000000000002');
    // La semilla crea UUID nuevos: expectativa exacta tomada ANTES de confirmar.
    (window as unknown as Ventana).__c194.idsFixture = {
      luis: fixture.transferencias.find((tr) => tr.de === 'd4000000-0000-4000-8000-000000000045')!.id,
      sofia: fixture.transferencias.find((tr) => tr.de === 'd4000000-0000-4000-8000-000000000046')!.id,
    };
  });


}
const fila = (page: Page, nombre: string) => page.locator('.vjv-tr-item').filter({ has: page.locator('.vjv-tr-nombre', { hasText: nombre }) });
const boton = (page: Page, nombre: string) => fila(page, nombre).getByRole('button', { name: 'Recibí', exact: true });
const idFixture = (page: Page, nombre: 'luis' | 'sofia') => page.evaluate((n) => (window as unknown as Ventana).__c194.idsFixture[n], nombre);
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

async function confirmar(page: Page) {
  await page.waitForTimeout(360);
  await page.getByRole('button', { name: 'Sí, recibí', exact: true }).click();
}

// A4 y A6 conservan sus aserciones en pruebas independientes (H2).
test('C194 A4 · doble clic sincrónico confirma una sola vez', async ({ page }) => {
  await preparar(page);
  await page.evaluate(() => { (window as unknown as Ventana).__c194.demorar = true; });
  await boton(page, 'Luis').click();
  await comprobarHoja(page, 'Luis', '$750');
  await page.waitForTimeout(360);
  const aceptar = page.getByRole('button', { name: 'Sí, recibí', exact: true });
  await aceptar.evaluate((el) => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(aceptar).toBeDisabled();
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi']]);
  await page.evaluate(() => { (window as unknown as Ventana).__c194.resolver?.(); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(fila(page, 'Luis')).toContainText('Pagado');
});

test('C194 A4 · Escape mientras guarda no cierra ni permite cancelar', async ({ page }) => {
  await preparar(page);
  await page.evaluate(() => { (window as unknown as Ventana).__c194.demorar = true; });
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi']]);
  await page.evaluate(() => { (window as unknown as Ventana).__c194.resolver?.(); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('C194 A6 · segunda confirmación y última transferencia a Cerrados', async ({ page }) => {
  await preparar(page);
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(fila(page, 'Luis')).toContainText('Pagado');
  await boton(page, 'Sofía').click();
  await confirmar(page);
  await expect(page).toHaveURL(new RegExp(`/viaje-cerrado/${VIAJE}$`));
  await expect(page.getByText('Monterrey fin de semana quedó cerrado. Todos pagaron y ya está en Cerrados.', { exact: true })).toBeVisible();
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi'], [VIAJE, await idFixture(page, 'sofia'), 'recibi']]);
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
  await confirmar(page);
  await expect(page.getByText('No pudimos guardarlo. Prueba de nuevo.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(boton(page, 'Luis')).toBeEnabled();
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi']]);
});

for (const y of [715, 730]) for (const demora of [100, 200]) {
  test(`C195 B1 · doble toque en y=${y} a +${demora} ms no confirma`, async ({ page }) => {
    await preparar(page);
    const origen = boton(page, 'Luis');
    await origen.evaluate((el, destino) => {
      const scroller = document.querySelector<HTMLElement>('.vj-scroll')!;
      const espacio = document.createElement('div');
      espacio.style.cssText = 'height:1000px;flex:none';
      scroller.prepend(espacio);
      const r = el.getBoundingClientRect();
      scroller.scrollTop += r.y + r.height / 2 - destino;
    }, y);
    const r = await origen.boundingBox();
    expect(r).not.toBeNull();
    const x = r!.x + r!.width / 2;
    expect(r!.y + r!.height / 2).toBeCloseTo(y, 0);
    await page.touchscreen.tap(x, y);
    await page.waitForTimeout(demora);
    await page.touchscreen.tap(x, y);
    expect(await llamadas(page)).toEqual([]);
    await expect(page.getByRole('dialog')).toBeVisible();
    await confirmar(page);
    await expect.poll(() => llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi']]);
  });
}

test('C195 M2 · Cancelar inmediatamente no espera 350 ms', async ({ page }) => {
  await preparar(page);
  await boton(page, 'Luis').evaluate((el) => (el as HTMLButtonElement).click());
  // Disparo DOM sin espera de estabilidad de Playwright: dentro de los 350 ms.
  await page.getByRole('button', { name: 'Cancelar', exact: true }).evaluate((el) => (el as HTMLButtonElement).click());
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(boton(page, 'Luis')).toBeFocused();
  expect(await llamadas(page)).toEqual([]);
});

test('C195 B2 · POST resuelto y GET colgado libera la app a 3,5 s', async ({ page }) => {
  await preparar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    api.getViaje = () => new Promise(() => {});
  });
  await boton(page, 'Luis').click();
  await confirmar(page);
  await page.waitForTimeout(3500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.app').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi']]);
  await expect(page.getByRole('heading', { name: 'Monterrey fin de semana', exact: true })).toBeFocused();
});

for (const fallo of [false, true]) {
  test(`C195 B3 · foco durante envío y tras ${fallo ? 'error' : 'éxito'} nunca body`, async ({ page }) => {
    await preparar(page);
    await page.evaluate((fallar) => { Object.assign((window as unknown as Ventana).__c194, { demorar: true, fallar }); }, fallo);
    await boton(page, 'Luis').click();
    await confirmar(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await page.evaluate(() => { (window as unknown as Ventana).__c194.resolver?.(); });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (fallo) await expect(boton(page, 'Luis')).toBeFocused();
    else await expect(page.getByRole('heading', { name: 'Monterrey fin de semana', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  });
}


test('C195D C1 · error devuelve foco y conserva Recibí en el orden de Tab', async ({ page }) => {
  await preparar(page);
  await page.evaluate(() => { (window as unknown as Ventana).__c194.fallar = true; });
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(boton(page, 'Luis')).toBeEnabled();
  await expect(boton(page, 'Luis')).toBeFocused();
  expect(await boton(page, 'Luis').getAttribute('tabindex')).toBeNull();
  await fila(page, 'Luis').getByRole('button', { name: 'No me llegó', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(boton(page, 'Luis')).toBeFocused();
});

test('C195D C2 · POST exitoso y GET colgado no traban Salir ni Escape', async ({ page }) => {
  await preparar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    api.getViaje = () => new Promise(() => {});
  });
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Monterrey fin de semana', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.app').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
});

test('C195D C3 · POST fallido y GET colgado cierran a 1 s con aviso y foco', async ({ page }) => {
  await preparar(page);
  await page.evaluate(async () => {
    (window as unknown as Ventana).__c194.fallar = true;
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    api.getViaje = () => new Promise(() => {});
  });
  await boton(page, 'Luis').click();
  await confirmar(page);
  await page.waitForTimeout(1000);
  expect(await page.getByRole('dialog').count()).toBe(0);
  expect(await page.locator('.app').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
  await expect(page.getByText('No pudimos guardarlo. Prueba de nuevo.', { exact: true })).toBeVisible();
  await expect(boton(page, 'Luis')).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
});
