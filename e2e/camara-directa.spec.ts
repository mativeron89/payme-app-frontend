import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { camaraSimulada, pistasVivas, registroDeCamara } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * D177 · decisión 177 de Mati: «hay que eliminar ese paso y que abra
 * directamente la cámara, luego, que abajo a la izquierda haya un ícono para el
 * carrete».
 *
 * La cámara se simula (`e2e/_camara.ts`): un `MediaStream` real sacado de un
 * canvas, o `NotAllowedError`, `NotFoundError` o sin `mediaDevices`. Se cuentan
 * los pedidos y las pistas vivas: una pista viva es la luz de la cámara
 * encendida. La prueba en el iPhone es de Mati.
 */

/** Lo que la fachada recibe para leer: tipo y tamaño de cada imagen. */
async function espiarOcr(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const w = window as unknown as { __ocr: Array<{ tipo: string; bytes: number } | null> };
    w.__ocr = [];
    const original = api.scanTicket!.bind(api);
    api.scanTicket = (...args: unknown[]) => {
      const img = args[0] as Blob | undefined;
      w.__ocr.push(img ? { tipo: img.type, bytes: img.size } : null);
      return original(...args);
    };
  });
}
const lecturas = (page: Page) => page.evaluate(
  () => (window as unknown as { __ocr: Array<{ tipo: string; bytes: number } | null> }).__ocr,
);

const disparador = (page: Page) => page.getByRole('button', { name: 'Capturar', exact: true });
const galeria = (page: Page) => page.getByRole('button', { name: 'Elegir una foto de la galería', exact: true });
const avisoSinCamara = (page: Page) => page.getByRole('alert').filter({ hasText: 'No pudimos abrir la cámara. Elige una foto.' });
const ticketListo = (page: Page) => page.getByRole('radiogroup', { name: '¿Cómo dividen?' });

const FOTO = {
  name: 'ticket.jpg',
  mimeType: 'image/jpeg',
  // Más que el piso de 10 KB del mock.
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40 * 1024, 7)]),
};

async function elegirDeLaGaleria(page: Page, boton = galeria(page)): Promise<void> {
  const [selector] = await Promise.all([page.waitForEvent('filechooser'), boton.click()]);
  expect(selector.isMultiple()).toBe(false);
  await selector.setFiles(FOTO);
}

test.describe('D177 · «Nueva» abre la cámara directo', () => {
  test('🔴 sin pantalla intermedia: la cámara trasera en vivo y el disparador listos', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    await expect(disparador(page)).toBeEnabled();
    expect(await pistasVivas(page)).toBe(1);
    const r = await registroDeCamara(page);
    expect(r.restricciones.at(-1)).toMatchObject({ audio: false, video: { facingMode: { ideal: 'environment' } } });
    // El video está en vivo, en línea y sin sonido (iOS).
    const video = await page.locator('.camara-video').evaluate((v: HTMLVideoElement) => ({
      enVivo: v.srcObject instanceof MediaStream,
      playsInline: v.playsInline,
      muted: v.muted,
      ancho: v.videoWidth,
    }));
    expect(video).toEqual({ enVivo: true, playsInline: true, muted: true, ancho: 640 });
    // La galería abajo a la izquierda, el disparador al centro.
    const [g, d] = await Promise.all([galeria(page).boundingBox(), disparador(page).boundingBox()]);
    expect(g!.x).toBeLessThan(d!.x);
  });

  test('🔴 disparar: el cuadro va como JPEG al OCR, la luz se apaga y sigue el ticket', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await disparador(page).click();
    await expect(ticketListo(page)).toBeVisible();
    const [lectura] = await lecturas(page);
    expect(lectura?.tipo).toBe('image/jpeg');
    expect(lectura!.bytes).toBeGreaterThan(10 * 1024);
    expect(lectura!.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(await pistasVivas(page)).toBe(0);
  });

  test('🔴 salir con «Volver» apaga la cámara', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await expect(disparador(page)).toBeEnabled();
    expect(await pistasVivas(page)).toBe(1);
    await page.locator('.camara-arriba').getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect.poll(() => pistasVivas(page)).toBe(0);
  });

  test('🔴 en segundo plano se apaga; al volver al frente se vuelve a abrir', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await expect(disparador(page)).toBeEnabled();
    const antes = (await registroDeCamara(page)).pedidos;
    const visibilidad = (estado: 'hidden' | 'visible') => page.evaluate((e) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => e });
      document.dispatchEvent(new Event('visibilitychange'));
    }, estado);
    await visibilidad('hidden');
    await expect.poll(() => pistasVivas(page)).toBe(0);
    await expect(disparador(page)).toBeDisabled();
    await visibilidad('visible');
    await expect.poll(async () => (await registroDeCamara(page)).pedidos).toBeGreaterThan(antes);
    await expect(disparador(page)).toBeEnabled();
    expect(await pistasVivas(page)).toBe(1);
  });

  test('la galería funciona con la cámara abierta: elige una foto y sigue el ticket', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await expect(disparador(page)).toBeEnabled();
    await expect(page.locator('input[type="file"]')).not.toHaveAttribute('capture', /.*/);
    await elegirDeLaGaleria(page);
    await expect(ticketListo(page)).toBeVisible();
    expect((await lecturas(page))[0]?.bytes).toBe(FOTO.buffer.length);
    await expect.poll(() => pistasVivas(page)).toBe(0);
  });

  test('«Sacar otra foto» vuelve a la cámara en vivo, sin la foto anterior', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_items' });
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await disparador(page).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'No pudimos leer el ticket' });
    await expect(aviso).toBeVisible();
    await expect(page.locator('.camara-captura')).toHaveCount(1);
    expect(await pistasVivas(page)).toBe(0);
    const antes = (await registroDeCamara(page)).pedidos;
    await aviso.getByRole('button', { name: 'Reintentar', exact: true }).click();
    await expect(page.locator('.camara-captura')).toHaveCount(0);
    await expect(aviso).toHaveCount(0);
    await expect(disparador(page)).toBeEnabled();
    expect((await registroDeCamara(page)).pedidos).toBeGreaterThan(antes);
  });

  for (const [modo, que] of [
    ['negada', 'permiso negado (NotAllowedError)'],
    ['sin_camara', 'sin cámara (NotFoundError)'],
    ['sin_soporte', 'sin soporte (sin mediaDevices)'],
  ] as const) {
    test(`🔴 ${que}: el aviso corto y la galería, nunca una pantalla muerta`, async ({ page }) => {
      await camaraSimulada(page, modo);
      await ingresar(page);
      await page.getByRole('button', { name: 'Nueva', exact: true }).click();
      await expect(avisoSinCamara(page)).toBeVisible();
      await expect(disparador(page)).toBeDisabled();
      await expect(galeria(page)).toBeEnabled();
      expect(await pistasVivas(page)).toBe(0);
      if (modo === 'sin_soporte') expect((await registroDeCamara(page)).pedidos).toBe(0);
      // El botón del aviso abre la misma galería, y la foto sigue al ticket.
      await elegirDeLaGaleria(page, avisoSinCamara(page).getByRole('button', { name: 'Elegir una foto', exact: true }));
      await expect(ticketListo(page)).toBeVisible();
    });
  }
});
