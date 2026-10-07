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
 * cámara del teléfono.
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
 * Saca la foto con la cámara que se abrió último. Falla si la cámara nativa no
 * se abrió: eso es justo lo que este helper tiene que notar.
 */
export async function sacarFoto(page: Page, foto: ArchivoDeFoto = FOTO_DE_CAMARA): Promise<void> {
  const registro = camaras.get(page);
  if (!registro) throw new Error('sacarFoto(): falta camaraSimulada(page) (la instala ingresar())');
  const { pendientes } = registro;
  await expect.poll(() => pendientes.length, { message: 'la cámara nativa no se abrió' }).toBeGreaterThan(0);
  const ultima = pendientes[pendientes.length - 1]!;
  pendientes.length = 0;
  await ultima.setFiles(foto);
}
