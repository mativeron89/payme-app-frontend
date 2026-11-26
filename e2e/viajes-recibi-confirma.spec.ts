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
type Ventana = Window & { __confirmacionDeTransferencia: Instrumento };

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
    (window as unknown as Ventana).__confirmacionDeTransferencia = i;
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
    (window as unknown as Ventana).__confirmacionDeTransferencia.idsFixture = {
      luis: fixture.transferencias.find((tr) => tr.de === 'd4000000-0000-4000-8000-000000000045')!.id,
      sofia: fixture.transferencias.find((tr) => tr.de === 'd4000000-0000-4000-8000-000000000046')!.id,
    };
  });


}
const fila = (page: Page, nombre: string) => page.locator('.vjv-tr-item').filter({ has: page.locator('.vjv-tr-nombre', { hasText: nombre }) });
const boton = (page: Page, nombre: string) => fila(page, nombre).getByRole('button', { name: 'Recibí', exact: true });
const idFixture = (page: Page, nombre: 'luis' | 'sofia') => page.evaluate((n) => (window as unknown as Ventana).__confirmacionDeTransferencia.idsFixture[n], nombre);
const llamadas = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__confirmacionDeTransferencia.llamadas);

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
  if (!page.isClosed()) await page.evaluate(() => (window as unknown as Ventana).__confirmacionDeTransferencia?.restaurar());
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
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.demorar = true; });
  await boton(page, 'Luis').click();
  await comprobarHoja(page, 'Luis', '$750');
  await page.waitForTimeout(360);
  const aceptar = page.getByRole('button', { name: 'Sí, recibí', exact: true });
  await aceptar.evaluate((el) => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(aceptar).toBeDisabled();
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi']]);
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.resolver?.(); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(fila(page, 'Luis')).toContainText('Pagado');
});

test('C194 A4 · Escape mientras guarda no cierra ni permite cancelar', async ({ page }) => {
  await preparar(page);
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.demorar = true; });
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi']]);
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.resolver?.(); });
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
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.fallar = true; });
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
    await page.evaluate((fallar) => { Object.assign((window as unknown as Ventana).__confirmacionDeTransferencia, { demorar: true, fallar }); }, fallo);
    await boton(page, 'Luis').click();
    await confirmar(page);
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.resolver?.(); });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (fallo) await expect(boton(page, 'Luis')).toBeFocused();
    else await expect(page.getByRole('heading', { name: 'Monterrey fin de semana', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
  });
}


test('C195D C1 · error devuelve foco y conserva Recibí en el orden de Tab', async ({ page }) => {
  await preparar(page);
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.fallar = true; });
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
    (window as unknown as Ventana).__confirmacionDeTransferencia.fallar = true;
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

// El GET viejo se resuelve a mano mientras el segundo POST conserva su promesa pendiente.
type RefrescoRetenido = Window & { __c195e: { resolverGet: () => Promise<void>; salidas: number } };
async function retenerRefresco(page: Page, fallar: boolean) {
  await page.evaluate(async (fallo) => {
    (window as unknown as Ventana).__confirmacionDeTransferencia.fallar = fallo;
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const original = api.getViaje;
    let resolver: (v: Awaited<ReturnType<typeof original>>) => void = () => {};
    const pendiente = new Promise<Awaited<ReturnType<typeof original>>>((resolve) => { resolver = resolve; });
    api.getViaje = () => pendiente;
    (window as unknown as RefrescoRetenido).__c195e = {
      resolverGet: async () => { resolver(await original('d1000000-0000-4000-8000-000000000002')); },
      salidas: 0,
    };
  }, fallar);
}
async function soltarRefresco(page: Page) {
  await page.evaluate(() => (window as unknown as RefrescoRetenido).__c195e.resolverGet());
  // Dejar terminar la cadena del GET y ambos finally, sin resolver el segundo POST.
  await page.waitForTimeout(200);
}

test('C195E D1 · GET viejo no libera el segundo Recibí en vuelo ni permite un tercer POST', async ({ page }) => {
  await preparar(page);
  await retenerRefresco(page, true);
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.demorar = true; });
  await boton(page, 'Luis').click();
  await confirmar(page);
  const aceptar = page.getByRole('button', { name: 'Sí, recibí', exact: true });
  await expect(aceptar).toBeDisabled();
  await soltarRefresco(page);
  const deshabilitado = await aceptar.isDisabled();
  await aceptar.evaluate((el) => (el as HTMLButtonElement).click());
  const pedidos = await llamadas(page);
  console.log('D1', JSON.stringify({ deshabilitado, pedidos }));
  expect(deshabilitado).toBe(true);
  expect(pedidos).toEqual([[VIAJE, await idFixture(page, 'luis'), 'recibi'], [VIAJE, await idFixture(page, 'luis'), 'recibi']]);
});

test('C195E D2 · GET viejo no libera Salir en vuelo ni permite una segunda salida', async ({ page }) => {
  await preparar(page);
  await retenerRefresco(page, false);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    api.salirDeViaje = () => {
      (window as unknown as RefrescoRetenido).__c195e.salidas++;
      return new Promise(() => {});
    };
  });
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  const salir = page.getByRole('dialog').getByRole('button', { name: 'Salir del viaje', exact: true });
  await page.waitForTimeout(360);
  await salir.click();
  await expect(salir).toBeDisabled();
  await soltarRefresco(page);
  const deshabilitado = await salir.isDisabled();
  await salir.evaluate((el) => (el as HTMLButtonElement).click());
  const pedidos = await page.evaluate(() => (window as unknown as RefrescoRetenido).__c195e.salidas);
  console.log('D2', JSON.stringify({ deshabilitado, pedidos }));
  expect(deshabilitado).toBe(true);
  expect(pedidos).toBe(1);
});

test('C195E D3 · GET viejo no libera No me llegó de otra fila ni duplica su POST', async ({ page }) => {
  await preparar(page);
  await retenerRefresco(page, true);
  await boton(page, 'Sofía').click();
  await confirmar(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.demorar = true; });
  const noLlego = fila(page, 'Luis').getByRole('button', { name: 'No me llegó', exact: true });
  await noLlego.click();
  await page.waitForTimeout(360);
  await page.getByRole('dialog').getByRole('button', { name: 'Sí, no me llegó', exact: true }).click();
  await expect(noLlego).toBeDisabled();
  await soltarRefresco(page);
  const deshabilitado = await noLlego.isDisabled();
  await noLlego.evaluate((el) => (el as HTMLButtonElement).click());
  const pedidos = (await llamadas(page)).filter((p) => p[2] === 'no-llego');
  console.log('D3', JSON.stringify({ deshabilitado, pedidos }));
  expect(deshabilitado).toBe(true);
  expect(pedidos).toEqual([[VIAJE, await idFixture(page, 'luis'), 'no-llego']]);
});

test('C195E D4 · error con GET colgado permite Cancelar y Escape en Salir', async ({ page }) => {
  await preparar(page);
  await retenerRefresco(page, true);
  await boton(page, 'Luis').click();
  await confirmar(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.app').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
});

for (const idioma of ['es', 'en'] as const) test(`K2 navegador · No me llegó, ${idioma}, espera y confirma una vez`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await preparar(page, idioma);
  await fila(page, 'Luis').getByRole('button', { name: idioma === 'es' ? 'No me llegó' : "I didn't get it", exact: true }).click();
  const hoja = page.getByRole('dialog');
  await expect(hoja.getByRole('heading')).toHaveText(idioma === 'es' ? '¿No te llegaron $750 de Luis?' : "Didn't get $750 from Luis?");
  await expect(hoja.getByText(idioma === 'es' ? 'Le vamos a avisar a Luis y el aviso no se puede retirar.' : "We'll let Luis know, and the notice can't be taken back.", { exact: true })).toBeVisible();
  expect(await llamadas(page)).toEqual([]);
  if (process.env.PAYME_E2E_CAPTURAS) await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/no-me-llego-${idioma}.png` });
  await page.waitForTimeout(360);
  const confirmar = hoja.getByRole('button', { name: idioma === 'es' ? 'Sí, no me llegó' : "Yes, I didn't get it", exact: true });
  await confirmar.evaluate((el) => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(hoja).toHaveCount(0);
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'no-llego']]);
});
for (const idioma of ['es', 'en'] as const) test(`K3 navegador · aviso guardado ${idioma}`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await preparar(page, idioma);
  await fila(page, 'Luis').getByRole('button', { name: idioma === 'es' ? 'Recibí' : 'I got it', exact: true }).click();
  await page.waitForTimeout(360);
  await page.getByRole('dialog').getByRole('button', { name: idioma === 'es' ? 'Sí, recibí' : 'Yes, I received it', exact: true }).click();
  await expect(page.getByText(idioma === 'es' ? 'Listo, quedó guardado' : "Done, it's saved", { exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toHaveClass(/toast--sobre-barra/);
  if (process.env.PAYME_E2E_CAPTURAS) await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/listo-${idioma}.png` });
});

for (const idioma of ['es', 'en'] as const) test(`No me llegó devuelve el foco al cancelar o Escape · ${idioma}`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await preparar(page, idioma);
  const origen = fila(page, 'Luis').getByRole('button', { name: idioma === 'es' ? 'No me llegó' : "I didn't get it", exact: true });
  for (const cerrar of ['escape', 'cancelar', 'afuera'] as const) {
    await origen.click();
    const hoja = page.getByRole('dialog');
    await expect(hoja).toBeVisible();
    if (cerrar === 'escape') await page.keyboard.press('Escape');
    else if (cerrar === 'cancelar') await hoja.getByRole('button', { name: idioma === 'es' ? 'Cancelar' : 'Cancel', exact: true }).click();
    else await page.locator('.sheet-overlay').click({ position: { x: 5, y: 5 } });
    await expect(hoja).toHaveCount(0);
    await expect(origen).toBeFocused();
    expect(await llamadas(page)).toEqual([]);
  }
  if (process.env.PAYME_E2E_CAPTURAS) await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/foco-devuelto-${idioma}.png` });
});

for (const idioma of ['es', 'en'] as const) test(`No me llegó devuelve el foco tras error · ${idioma}`, async ({ page }) => {
  await preparar(page, idioma);
  await page.evaluate(() => { (window as unknown as Ventana).__confirmacionDeTransferencia.fallar = true; });
  const origen = fila(page, 'Luis').getByRole('button', { name: idioma === 'es' ? 'No me llegó' : "I didn't get it", exact: true });
  await origen.click();
  await page.waitForTimeout(360);
  await page.getByRole('dialog').getByRole('button', { name: idioma === 'es' ? 'Sí, no me llegó' : "Yes, I didn't get it", exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(origen).toBeFocused();
  expect(await llamadas(page)).toEqual([[VIAJE, await idFixture(page, 'luis'), 'no-llego']]);
});

test('No me llegó vuelve al botón y permite un segundo intento tras un conflicto', async ({ page }) => {
  await preparar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(ruta) as typeof import('../src/api');
    const mock = '/src/api/mock/mockApi.ts';
    const { MockApiError } = await import(mock) as typeof import('../src/api/mock/mockApi');
    api.marcarTransferenciaDeViaje = async (...args) => {
      (window as unknown as Ventana).__confirmacionDeTransferencia.llamadas.push(args);
      throw new MockApiError(409, 'viaje_not_waiting_payments');
    };
    api.getViaje = async () => { throw new Error('sin conexión'); };
  });
  const origen = fila(page, 'Luis').getByRole('button', { name: 'No me llegó', exact: true });
  for (const cantidad of [1, 2]) {
    await origen.click();
    await page.waitForTimeout(360);
    await page.getByRole('dialog').getByRole('button', { name: 'Sí, no me llegó', exact: true }).click();
    await expect(origen).toBeFocused();
    expect(await llamadas(page)).toHaveLength(cantidad);
  }
});
