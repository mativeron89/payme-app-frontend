import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D202 · H-03 de la auditoría Codex del 06/10: dos activaciones de Capturar
 * iniciaban dos lecturas. `disparar` miraba `scanning` antes de esperar el JPEG
 * del cuadro, y `scanning` recién se prendía al empezar la lectura: en ese hueco
 * pasaban las dos.
 *
 * El JPEG se retiene (`canvas.toBlob` encola su callback hasta soltarlo) y la
 * lectura se cuenta en la fachada sin OCR real ni red: `scanTicket` queda
 * colgada o se suelta a mano. La cámara es la simulada de `ingresar`.
 */

interface Ventana {
  __jpeg: Array<() => void>;
  __soltarJpeg: boolean;
  __lecturas: number;
  __resoluciones: number;
  __respondidas: number;
  __soltarLectura: (() => void) | null;
}

/** El JPEG del cuadro queda retenido hasta `soltarJpeg`; después pasa directo. */
async function retenerJpeg(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as Ventana;
    w.__jpeg = [];
    w.__soltarJpeg = false;
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback, ...resto: [string?, number?]) {
      original.call(this, (b) => {
        if (w.__soltarJpeg) cb(b);
        else w.__jpeg.push(() => cb(b));
      }, ...resto);
    };
  });
}
const jpegRetenidos = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__jpeg.length);
const soltarJpeg = (page: Page) => page.evaluate(() => {
  const w = window as unknown as Ventana;
  w.__soltarJpeg = true;
  w.__jpeg.splice(0).forEach((f) => f());
});

/**
 * Cuenta las lecturas y las resoluciones del restaurante. La lectura queda
 * colgada: con `responder`, la lectura de la fachada original contesta cuando
 * el test llama a `soltarLectura`.
 */
async function espiar(page: Page, responder: boolean): Promise<void> {
  await page.evaluate(async (conRespuesta) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const w = window as unknown as Ventana;
    w.__lecturas = 0;
    w.__resoluciones = 0;
    w.__respondidas = 0;
    w.__soltarLectura = null;
    const leer = api.scanTicket!.bind(api);
    api.scanTicket = (...args: unknown[]) => {
      w.__lecturas += 1;
      if (!conRespuesta) return new Promise(() => undefined);
      return new Promise((resolver) => {
        w.__soltarLectura = () => resolver(leer(...args).then((r) => { w.__respondidas += 1; return r; }));
      });
    };
    const resolver = api.resolveRestaurant!.bind(api);
    api.resolveRestaurant = (...args: unknown[]) => {
      w.__resoluciones += 1;
      return resolver(...args);
    };
  }, responder);
}
const lecturas = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__lecturas);
const resoluciones = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__resoluciones);

const disparador = (page: Page) => page.getByRole('button', { name: 'Capturar', exact: true });

/**
 * `sinRiel`: con el riel de dinero apagado el mock no trae un restaurante por
 * defecto y el restaurante se resuelve por el ticket (`resolveRestaurant`), el
 * efecto que una respuesta tardía no debe disparar.
 */
async function abrirCamara(page: Page, responder: boolean, sinRiel = false): Promise<void> {
  if (sinRiel) await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await retenerJpeg(page);
  await ingresar(page);
  await espiar(page, responder);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(disparador(page)).toBeEnabled();
}

async function salir(page: Page): Promise<void> {
  await page.locator('.camara-arriba').getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

test.describe('D202 · H-03 · Capturar, una sola lectura por intento', () => {
  test('🔴 dos toques en el mismo instante: una captura y una lectura', async ({ page }) => {
    await abrirCamara(page, false);
    // Los dos en el mismo tick, antes de que React vuelva a dibujar el botón:
    // la reserva tiene que ser síncrona, no un `disabled` que llega después.
    await disparador(page).evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
    await expect.poll(() => jpegRetenidos(page)).toBeGreaterThan(0);
    await expect(disparador(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Elegir una foto de la galería', exact: true })).toBeDisabled();
    expect(await jpegRetenidos(page)).toBe(1);
    await soltarJpeg(page);
    await expect.poll(() => lecturas(page)).toBe(1);
    await page.waitForTimeout(400);
    expect(await lecturas(page)).toBe(1);
  });

  test('🔴 salir con el JPEG pendiente: no se lee', async ({ page }) => {
    await abrirCamara(page, false);
    await disparador(page).click();
    await expect.poll(() => jpegRetenidos(page)).toBe(1);
    await salir(page);
    await soltarJpeg(page);
    await page.waitForTimeout(400);
    expect(await lecturas(page)).toBe(0);
    // Control positivo dentro del caso: el JPEG retenido sí se entregó.
    expect(await jpegRetenidos(page)).toBe(0);
  });

  test('control · sin salir, la respuesta resuelve el restaurante y abre el ticket', async ({ page }) => {
    await abrirCamara(page, true, true);
    await disparador(page).click();
    await expect.poll(() => jpegRetenidos(page)).toBe(1);
    await soltarJpeg(page);
    await expect.poll(() => lecturas(page)).toBe(1);
    const antes = await resoluciones(page);
    await page.evaluate(() => (window as unknown as Ventana).__soltarLectura?.());
    await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?' })).toBeVisible();
    await expect.poll(() => resoluciones(page)).toBeGreaterThan(antes);
  });

  test('🔴 salir con la lectura en curso: la respuesta tardía no resuelve el restaurante ni abre el ticket', async ({ page }) => {
    await abrirCamara(page, true, true);
    await disparador(page).click();
    await expect.poll(() => jpegRetenidos(page)).toBe(1);
    await soltarJpeg(page);
    await expect.poll(() => lecturas(page)).toBe(1);
    const antes = await resoluciones(page);
    await salir(page);
    await page.evaluate(() => (window as unknown as Ventana).__soltarLectura?.());
    // Control positivo: la lectura contestó (la fachada original resolvió).
    await expect.poll(() => page.evaluate(() => (window as unknown as Ventana).__respondidas)).toBe(1);
    await page.waitForTimeout(600);
    expect(await resoluciones(page)).toBe(antes);
    await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  });
});
