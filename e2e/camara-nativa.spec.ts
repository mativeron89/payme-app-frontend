import { expect, test, type FileChooser, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { camarasAbiertas, sacarFoto, type ArchivoDeFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * D212 · decisión 212 de Mati, «Cámara del iPhone (Recomendada)»: «Nueva» abre
 * la cámara NATIVA del teléfono en el mismo toque y la foto sale con la máxima
 * definición que entra en los 8 MiB del dueño. Reemplaza la cámara en vivo de
 * D177 (`camara-directa.spec.ts`), que mandaba un cuadro de video de 1920×1080.
 *
 * El Chromium de la suite no tiene cámara: Playwright intercepta el selector
 * (`filechooser`) y el test le entrega una foto sintética, armada en el propio
 * navegador con las medidas que haga falta. Lo que se sube se lee en la fachada
 * (`api.scanTicket`): tipo, bytes, medidas, si trae EXIF y el color de dos
 * puntos. La prueba en el iPhone es de Mati.
 */

interface Subida {
  tipo: string;
  bytes: number;
  ancho: number;
  alto: number;
  exif: boolean;
  arriba: [number, number, number];
  abajo: [number, number, number];
}

/** Guarda cada imagen que la fachada recibe para leer. */
async function espiarOcr(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const w = window as unknown as { __subidas: Blob[] };
    w.__subidas = [];
    const original = api.scanTicket!.bind(api);
    api.scanTicket = (...args: unknown[]) => {
      if (args[0] instanceof Blob) w.__subidas.push(args[0]);
      return original(...args);
    };
  });
}

const cantidadDeSubidas = (page: Page) => page.evaluate(
  () => (window as unknown as { __subidas: Blob[] }).__subidas.length,
);

/** Lee la subida `i`: medidas tal como se ven, EXIF y el color arriba y abajo al centro. */
async function subida(page: Page, i = 0): Promise<Subida> {
  await expect.poll(() => cantidadDeSubidas(page)).toBeGreaterThan(i);
  return page.evaluate(async (n) => {
    const blob = (window as unknown as { __subidas: Blob[] }).__subidas[n]!;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // «Exif\0\0», la firma del segmento APP1 de EXIF.
    const firma = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    let exif = false;
    for (let k = 0; k + firma.length <= bytes.length && !exif; k += 1) {
      exif = firma.every((b, j) => bytes[k + j] === b);
    }
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const color = (x: number, y: number) => {
      const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      return [d[0]!, d[1]!, d[2]!] as [number, number, number];
    };
    return {
      tipo: blob.type,
      bytes: blob.size,
      ancho: bmp.width,
      alto: bmp.height,
      exif,
      arriba: color(bmp.width / 2, bmp.height * 0.15),
      abajo: color(bmp.width / 2, bmp.height * 0.85),
    };
  }, i);
}

/**
 * Una foto JPEG armada en el navegador: mitad izquierda roja y derecha azul,
 * con renglones de «ticket» para que tenga detalle (sin ellos en las de
 * orientación, donde se mide el color).
 */
async function fotoSintetica(
  page: Page,
  ancho: number,
  alto: number,
  nombre = 'image.jpg',
  renglones = true,
): Promise<ArchivoDeFoto> {
  const b64 = await page.evaluate(async ([w, h, conRenglones]) => {
    const c = document.createElement('canvas');
    c.width = w!;
    c.height = h!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, w! / 2, h!);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(w! / 2, 0, w! / 2, h!);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.max(10, Math.round(h! / 60))}px monospace`;
    if (conRenglones) {
      for (let y = 30; y < h!; y += Math.max(12, Math.round(h! / 40))) ctx.fillText('2 x TACOS AL PASTOR  $180.00', 10, y);
    }
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, [ancho, alto, renglones] as const);
  return { name: nombre, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/**
 * La misma foto con un EXIF mínimo de orientación, justo después del SOI: así
 * guarda el iPhone una foto vertical (los píxeles acostados y la marca de girar).
 * 6 = girar 90° a la derecha para verla.
 */
function conOrientacion(foto: ArchivoDeFoto, orientacion: number): ArchivoDeFoto {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // «MM», 42, IFD0 en 8
    0x00, 0x01, // una entrada
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientacion, 0x00, 0x00, // Orientation, SHORT, 1
    0x00, 0x00, 0x00, 0x00, // sin IFD siguiente
  ]);
  const cuerpo = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, cuerpo.length + 2]), cuerpo]);
  expect(foto.buffer.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  return { ...foto, buffer: Buffer.concat([foto.buffer.subarray(0, 2), app1, foto.buffer.subarray(2)]) };
}

const atributo = (selector: FileChooser, nombre: string) => selector.element().getAttribute(nombre);

/** «Nueva», con el selector que abre ese mismo toque. */
async function tocarNueva(page: Page): Promise<FileChooser> {
  const [selector] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Nueva', exact: true }).click(),
  ]);
  return selector;
}

const ROJO = (c: [number, number, number]) => c[0] > 200 && c[1] < 60 && c[2] < 60;
const AZUL = (c: [number, number, number]) => c[0] < 60 && c[1] < 60 && c[2] > 200;
const ticketListo = (page: Page) => page.getByRole('radiogroup', { name: '¿Cómo dividen?' });
const sacarFotoBoton = (page: Page) => page.getByRole('button', { name: 'Sacar foto', exact: true });
const galeria = (page: Page) => page.getByRole('button', { name: 'Elegir una foto de la galería', exact: true });

test.describe('D212 · «Nueva» abre la cámara nativa', () => {
  test('🔴 en el mismo toque: la cámara trasera del teléfono, y «Escanea el ticket» debajo', async ({ page }) => {
    await ingresar(page);
    const selector = await tocarNueva(page);
    expect(await atributo(selector, 'capture')).toBe('environment');
    expect(await atributo(selector, 'accept')).toBe('image/*');
    expect(selector.isMultiple()).toBe(false);
    // Debajo, la pantalla del paso 1: la ayuda corta, sin marco ni video.
    await expect(page).toHaveURL(/:\d+\/scan$/);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    await expect(page.locator('.camara-sub')).toHaveText('Saca la foto del ticket completo, de cerca y con luz');
    await expect(page.getByText('Encuadra el ticket dentro del marco')).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
    await expect(page.locator('.camara-marco, .scan-corner')).toHaveCount(0);
    // Sin `getUserMedia`: no hay permiso de cámara de la web que pedir.
    await expect(sacarFotoBoton(page)).toBeEnabled();
    await expect(galeria(page)).toBeEnabled();
  });

  test('🔴 una foto de 12 MP (4032×3024) se sube entera, en JPEG y en menos de 8 MiB', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    const foto = await fotoSintetica(page, 4032, 3024);
    const selector = await tocarNueva(page);
    await selector.setFiles(foto);
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    expect(s.tipo).toBe('image/jpeg');
    expect([s.ancho, s.alto]).toEqual([4032, 3024]);
    expect(s.bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(s.exif).toBe(false);
  });

  test('🔴 una foto más grande baja a 4096 de lado largo (6000×4500 → 4096×3072)', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    const foto = await fotoSintetica(page, 6000, 4500);
    const selector = await tocarNueva(page);
    await selector.setFiles(foto);
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    expect([s.ancho, s.alto]).toEqual([4096, 3072]);
    expect(s.tipo).toBe('image/jpeg');
  });

  test('🔴 la orientación EXIF del iPhone: una foto vertical sale derecha y sin EXIF', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    // Los píxeles acostados (400×200, rojo a la izquierda) y la marca 6.
    const foto = conOrientacion(await fotoSintetica(page, 400, 200, 'image.jpg', false), 6);
    const selector = await tocarNueva(page);
    await selector.setFiles(foto);
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    // Girada 90° a la derecha: vertical, con el rojo arriba.
    expect([s.ancho, s.alto]).toEqual([200, 400]);
    expect(ROJO(s.arriba), `arriba: ${s.arriba}`).toBe(true);
    expect(AZUL(s.abajo), `abajo: ${s.abajo}`).toBe(true);
    expect(s.exif).toBe(false);
  });

  test('control · la misma foto con orientación 1 queda acostada: lo que la giró fue el EXIF', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    const foto = conOrientacion(await fotoSintetica(page, 400, 200, 'image.jpg', false), 1);
    const selector = await tocarNueva(page);
    await selector.setFiles(foto);
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    expect([s.ancho, s.alto]).toEqual([400, 200]);
    expect(s.exif).toBe(false);
  });

  test('🔴 cancelar la cámara: quedan «Sacar foto», que la vuelve a abrir, y la galería', async ({ page }) => {
    await ingresar(page);
    await tocarNueva(page);
    // La persona toca «Cancelar»: no llega ninguna foto.
    await expect(sacarFotoBoton(page)).toBeEnabled();
    await expect(galeria(page)).toBeEnabled();
    const [otra] = await Promise.all([page.waitForEvent('filechooser'), sacarFotoBoton(page).click()]);
    expect(await atributo(otra, 'capture')).toBe('environment');
    await otra.setFiles(await fotoSintetica(page, 1600, 1200));
    await expect(ticketListo(page)).toBeVisible();
  });

  test('🔴 la galería sigue sin `capture` y su foto también se prepara', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    await tocarNueva(page);
    const [selector] = await Promise.all([page.waitForEvent('filechooser'), galeria(page).click()]);
    expect(await atributo(selector, 'capture')).toBeNull();
    await selector.setFiles(await fotoSintetica(page, 6000, 4500, 'IMG_0421.jpg'));
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    expect([s.ancho, s.alto]).toEqual([4096, 3072]);
    expect(s.tipo).toBe('image/jpeg');
  });

  test('un PNG con transparencia sale JPEG con papel blanco, no negro', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    await tocarNueva(page);
    // Arriba transparente, abajo azul: una captura de pantalla de un ticket digital.
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 600;
      c.height = 800;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#0000ff';
      ctx.fillRect(0, 400, 600, 400);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      for (let x = 0; x < 600; x += 7) ctx.fillRect(x, 700, 3, 3);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return btoa(s);
    });
    await page.locator('.camara-controles input[type="file"]').setInputFiles({
      name: 'ticket.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64'),
    });
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    expect(s.tipo).toBe('image/jpeg');
    expect(s.arriba.every((v) => v > 240), `arriba: ${s.arriba}`).toBe(true);
    expect(AZUL(s.abajo), `abajo: ${s.abajo}`).toBe(true);
  });

  test('🔴 lo que el navegador no puede abrir (un HEIC en Chrome) se manda como antes', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    await tocarNueva(page);
    const heic = { name: 'IMG_0500.HEIC', mimeType: 'image/heic', buffer: Buffer.alloc(40 * 1024, 3) };
    await page.locator('.camara-controles input[type="file"]').setInputFiles(heic);
    await expect(ticketListo(page)).toBeVisible();
    const s = await page.evaluate(() => {
      const b = (window as unknown as { __subidas: Blob[] }).__subidas[0]!;
      return { tipo: b.type, bytes: b.size };
    });
    expect(s).toEqual({ tipo: 'image/heic', bytes: 40 * 1024 });
  });

  test('🔴 «Reintentar» abre la cámara en el mismo toque y, si se cancela, el aviso sigue', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_items' });
    await ingresar(page);
    await tocarNueva(page);
    await sacarFoto(page);
    const aviso = page.getByRole('alert').filter({ hasText: 'No pudimos leer el ticket' });
    await expect(aviso).toBeVisible();
    const [selector] = await Promise.all([
      page.waitForEvent('filechooser'),
      aviso.getByRole('button', { name: 'Reintentar', exact: true }).click(),
    ]);
    expect(await atributo(selector, 'capture')).toBe('environment');
    // Cancelada: el motivo por el que falló sigue en pantalla.
    await expect(aviso).toBeVisible();
  });

  test('«Volver» desde el ticket deja «Escanea el ticket» sin abrir la cámara solo', async ({ page }) => {
    await ingresar(page);
    await tocarNueva(page);
    await sacarFoto(page);
    await expect(ticketListo(page)).toBeVisible();
    const antes = camarasAbiertas(page);
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    await expect(page.locator('.camara-captura')).toHaveCount(0);
    await expect(sacarFotoBoton(page)).toBeEnabled();
    await page.waitForTimeout(400);
    expect(camarasAbiertas(page)).toBe(antes);
  });
});
