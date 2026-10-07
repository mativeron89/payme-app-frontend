import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type FileChooser, type Page } from '@playwright/test';

/**
 * D212 · la cámara NATIVA simulada de la suite e2e.
 *
 * «Nueva» abre la cámara del teléfono: un `<input type="file" accept="image/*"
 * capture="environment">` al que la app le hace `click()` en el mismo toque. El
 * Chromium de la suite no tiene cámara: Playwright intercepta ese selector
 * (evento `filechooser`) y este registro guarda los de la cámara —los que
 * tienen `capture`— hasta que el test «saca la foto» con `sacarFoto(page)`, que
 * es lo que antes era tocar «Capturar»: el disparador y «Usar foto» de la
 * cámara del teléfono. D222 · después toca también «Usar foto» en el marco
 * de PayMe (`usarFoto`), salvo `{ usar: false }`.
 *
 * La foto por defecto es una foto real del repo (`landing/img/mesa-comida.jpg`,
 * 1400×1050): se decodifica y se vuelve a codificar como lo haría la de una
 * cámara, y supera el piso de 10 KB del mock.
 *
 * Los selectores de la GALERÍA (sin `capture`) no se tocan acá: los specs de
 * galería usan `setInputFiles` o su propio `waitForEvent('filechooser')`.
 */
interface Registro {
  /** Las abiertas que todavía no sacaron foto. */
  pendientes: FileChooser[];
  /** Todas las veces que se abrió. */
  abiertas: number;
}

const camaras = new WeakMap<Page, Registro>();

export const FOTO_DE_CAMARA = {
  name: 'image.jpg',
  mimeType: 'image/jpeg',
  buffer: readFileSync(resolve('landing/img/mesa-comida.jpg')),
};

export type ArchivoDeFoto = { name: string; mimeType: string; buffer: Buffer };

export async function camaraSimulada(page: Page): Promise<void> {
  if (camaras.has(page)) return;
  const registro: Registro = { pendientes: [], abiertas: 0 };
  camaras.set(page, registro);
  page.on('filechooser', (selector) => {
    void selector.element().getAttribute('capture').then(
      (capture) => {
        if (capture === null) return;
        registro.abiertas += 1;
        registro.pendientes.push(selector);
      },
      () => undefined,
    );
  });
}

/** Cuántas veces se abrió la cámara nativa desde que se instaló el registro. */
export function camarasAbiertas(page: Page): number {
  return camaras.get(page)?.abiertas ?? 0;
}

/**
 * D222 · la foto llega con el marco para recortarla: «Usar foto» la manda tal
 * cual (sin tocar el marco, la foto entera, como antes de D222). Espera el
 * marco antes de tocar: si la foto no se pudo abrir, no hay marco y falla acá.
 */
export async function usarFoto(page: Page): Promise<void> {
  await expect(page.getByRole('group', { name: 'Marco del recorte' })).toBeVisible();
  await page.getByRole('button', { name: 'Usar foto', exact: true }).click();
}

/**
 * Saca la foto con la cámara que se abrió último y, salvo `{ usar: false }`,
 * toca «Usar foto» en el marco (D222). Falla si la cámara nativa no se abrió:
 * eso es justo lo que este helper tiene que notar.
 */
export async function sacarFoto(
  page: Page,
  foto: ArchivoDeFoto = FOTO_DE_CAMARA,
  { usar = true }: { usar?: boolean } = {},
): Promise<void> {
  const registro = camaras.get(page);
  if (!registro) throw new Error('sacarFoto(): falta camaraSimulada(page) (la instala ingresar())');
  const { pendientes } = registro;
  await expect.poll(() => pendientes.length, { message: 'la cámara nativa no se abrió' }).toBeGreaterThan(0);
  const ultima = pendientes[pendientes.length - 1]!;
  pendientes.length = 0;
  await ultima.setFiles(foto);
  if (usar) await usarFoto(page);
}

/**
 * AF-D212-SEGUIMIENTO · una foto de verdad, pero CHICA: 64×64, armada en el
 * navegador. Se decodifica y se prepara (nada sin sanear se sube), y la
 * preparada pesa ~1 KB, debajo del piso de 10 KB del mock: es la que prueba
 * «La foto es demasiado pequeña». Antes se usaban bytes al azar, que ahora ni
 * se preparan.
 */
export async function fotoChica(page: Page, name = 'IMG_0500.jpg'): Promise<ArchivoDeFoto> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d9d4c7';
    ctx.fillRect(0, 0, 64, 64);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return { name, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/** Bytes que ningún navegador abre como imagen: no se pueden preparar. */
export const FOTO_QUE_NO_ABRE: ArchivoDeFoto = {
  name: 'IMG_0501.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.alloc(40 * 1024, 7),
};

/**
 * La misma foto con un EXIF mínimo de orientación, justo después del SOI: así
 * guarda el iPhone una foto vertical (los píxeles acostados y la marca de girar).
 * 6 = girar 90° a la derecha para verla.
 */
export function conOrientacion(foto: ArchivoDeFoto, orientacion: number): ArchivoDeFoto {
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
