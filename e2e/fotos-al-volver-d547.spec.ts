import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camarasAbiertas, FOTO_DE_CAMARA, sacarFoto } from './_camara';

/**
 * D547 · la pantalla de PayMe al volver de la cámara nativa, en el mock con la capacidad de varias fotos encendida
 * (`payme.app.mock.ocr_pages.v1`, hasta 4).
 *
 * Mati: «que en automático la foto que se sacó se achique hacia abajo a la izquierda y que permita sacar otra foto
 * apareciendo un check abajo a la derecha (…) Una vez se selecciona el check se pasa a la edición de la foto para el
 * recuadro». Eligió «Pantalla al volver (Recomendada)»: la cámara sigue siendo la nativa.
 *
 * - La foto se achica a la fila de abajo a la izquierda (sin animación con «reducir movimiento»); «Sacar otra» abre la
 *   cámara nativa; el ✓ pasa al recuadro.
 * - Tocar una miniatura la muestra grande y deja quitarla.
 * - «Volver» con fotos pregunta antes de salir.
 * - Una sola foto se lee como siempre: la lectura de una imagen.
 * - En el recuadro de la tanda, «Volver a las fotos» vuelve con todas.
 *
 * Capturas para el catálogo (D542), con datos del mock, sólo con `PAYME_E2E_CAPTURAS`.
 */

const PAGINAS = 'payme.app.mock.ocr_pages.v1';

const alVolver = (page: Page) => page.locator('.fotos-al-volver');
const fila = (page: Page) => alVolver(page).getByRole('list', { name: /^(Fotos del ticket|Receipt photos)$/ });
const sacarOtra = (page: Page) => alVolver(page).getByRole('button', { name: /^(Sacar otra|Take another)$/ });
const listo = (page: Page) => alVolver(page).getByRole('button', { name: /^(Listo, ajustar el recuadro|Done, adjust the frame)$/ });
const marco = (page: Page) => page.getByRole('group', { name: /^(Marco del recorte|Crop frame)$/ });
const ticketListo = (page: Page) => page.getByRole('radiogroup', { name: '¿Cómo dividen?' });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  // La foto que se achica se va sola al terminar: la captura es la pantalla quieta.
  await expect(page.locator('.fotos-al-volver-recien')).toHaveCount(0, { timeout: 3_000 });
  await page.screenshot({ path: `${dir}/d547-${page.viewportSize()!.width}-${nombre}.png`, animations: 'disabled' });
}

async function conCapacidad(page: Page): Promise<void> {
  await page.addInitScript((k) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem(k, 'encendido');
  }, PAGINAS);
}

async function espiarOcr(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __lecturas: Array<{ lista: boolean; partes: number; tipos: string[] }> };
    w.__lecturas = [];
    const original = api.scanTicket!.bind(api);
    api.scanTicket = (...args: unknown[]) => {
      const lista = Array.isArray(args[0]);
      const fotos = lista ? args[0] as Blob[] : [args[0] as Blob];
      w.__lecturas.push({ lista, partes: fotos.length, tipos: fotos.map((f) => f.type) });
      return original(...args);
    };
  });
}

const lecturas = (page: Page) => page.evaluate(
  () => (window as unknown as { __lecturas: Array<{ lista: boolean; partes: number; tipos: string[] }> }).__lecturas,
);

async function abrirEscaneo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/scan$/);
}

/**
 * La capacidad de varias fotos llega con la config, que el mock carga con su demora: en el teléfono la cámara tarda
 * segundos y siempre llega antes, pero acá la foto «se saca» al instante. Sin esperarla, la foto llega sin la
 * capacidad y va directo al recuadro (lo de siempre).
 */
async function esperarCapacidad(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const ruta = '/src/api/ocrPaginas.ts';
    const m = await import(/* @vite-ignore */ ruta) as { capacidadOcrPaginas: () => unknown };
    return m.capacidadOcrPaginas() !== null;
  }), { message: 'la capacidad de varias fotos no llegó' }).toBe(true);
}

/** Saca `n` fotos más desde la pantalla al volver (la primera, con la cámara que ya está abierta). */
async function sacar(page: Page, n: number, desde = 0): Promise<void> {
  for (let i = desde + 1; i <= desde + n; i++) {
    if (i > 1) await sacarOtra(page).click();
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(fila(page).getByRole('listitem')).toHaveCount(i);
  }
}

test.describe('D547 · la pantalla al volver de la cámara', () => {
  test.beforeEach(async ({ page }) => {
    await conCapacidad(page);
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    await espiarOcr(page);
    await abrirEscaneo(page);
    await esperarCapacidad(page);
  });

  test('🔴 con la foto: la miniatura abajo a la izquierda, «Sacar otra» y el ✓ abajo a la derecha; el foco en el título', async ({ page }) => {
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(alVolver(page)).toBeVisible();
    // No va directo al recuadro.
    await expect(marco(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', level: 1 })).toBeFocused();
    await expect(alVolver(page).getByText('Sacaste 1 foto. Si el ticket es largo, saca otra parte. Si no, toca ✓.', { exact: true })).toBeVisible();
    await expect(fila(page).getByRole('button', { name: 'Ver la foto 1', exact: true })).toBeVisible();
    await expect(sacarOtra(page)).toBeEnabled();
    // Las posiciones: la fila abajo a la izquierda y el ✓ abajo a la derecha, en la misma franja.
    const vista = page.viewportSize()!;
    const mini = (await fila(page).getByRole('button').first().boundingBox())!;
    const check = (await listo(page).boundingBox())!;
    expect(mini.x + mini.width).toBeLessThan(vista.width / 2);
    expect(check.x).toBeGreaterThan(vista.width / 2);
    expect(mini.y).toBeGreaterThan(vista.height * 0.7);
    expect(check.y).toBeGreaterThan(vista.height * 0.7);
    await capturar(page, 'es-una-foto');
  });

  test('🔴 auditoría de PR108, punto 4 · la fila y la foto grande dibujan copias chicas, nunca el original', async ({ page }) => {
    // La foto de la cámara del harness mide 1400×1050: el original tendría ese tamaño natural.
    await sacar(page, 2);
    const minis = fila(page).locator('img');
    await expect(minis).toHaveCount(2);
    for (const img of await minis.all()) {
      await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const { ancho, alto } = await img.evaluate((el) => ({
        ancho: (el as HTMLImageElement).naturalWidth, alto: (el as HTMLImageElement).naturalHeight,
      }));
      expect(Math.max(ancho, alto)).toBe(240);
    }
    // Ninguna imagen de la pantalla es el original (ni la de la fila ni la grande): todas salen del lienzo.
    await fila(page).getByRole('button', { name: 'Ver la foto 1', exact: true }).click();
    const grande = page.getByRole('dialog').locator('img.fotos-al-volver-grande');
    await expect.poll(() => grande.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1024);
    expect(await grande.evaluate((el) => (el as HTMLImageElement).naturalHeight)).toBe(768);
    const tamanosDeLaPantalla = await alVolver(page).locator('img').evaluateAll((imgs) =>
      imgs.map((el) => Math.max((el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight)));
    for (const lado of tamanosDeLaPantalla) expect(lado).toBeLessThanOrEqual(1024);
    expect(tamanosDeLaPantalla).not.toContain(1400);
  });

  test('🔴 «Sacar otra» abre la cámara nativa en el toque y la foto se suma a la fila, numerada', async ({ page }) => {
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    const antes = camarasAbiertas(page);
    await sacarOtra(page).click();
    await expect.poll(() => camarasAbiertas(page)).toBe(antes + 1);
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(fila(page).getByRole('listitem')).toHaveCount(2);
    await expect(fila(page).locator('.fotos-al-volver-numero')).toHaveText(['1', '2']);
    await expect(alVolver(page).getByText('Sacaste 2 fotos. Si el ticket es largo, saca otra parte. Si no, toca ✓.', { exact: true })).toBeVisible();
    await sacar(page, 1, 2);
    await capturar(page, 'es-tres-fotos');
  });

  test('🔴 la foto recién sacada se achica (la animación); con «reducir movimiento», nada se anima', async ({ page }) => {
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(page.locator('.fotos-al-volver-recien')).toHaveCount(1);
    await expect(page.locator('.fotos-al-volver-recien')).toHaveCSS('animation-name', 'fotos-al-volver-achicar');
    // Se va sola al terminar.
    await expect(page.locator('.fotos-al-volver-recien')).toHaveCount(0, { timeout: 3_000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await sacarOtra(page).click();
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(fila(page).getByRole('listitem')).toHaveCount(2);
    await expect(page.locator('.fotos-al-volver-recien')).toHaveCount(0);
  });

  test('🔴 una sola foto: el ✓, el recuadro y «Usar foto», con la lectura de una imagen como siempre', async ({ page }) => {
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await listo(page).click();
    await expect(marco(page)).toBeVisible();
    await expect(page.getByText('Ajusta el marco para dejar sólo el ticket', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Volver a las fotos', exact: true })).toBeVisible();
    await capturar(page, 'es-recuadro-una-foto');
    await page.getByRole('button', { name: 'Usar foto', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    // Una imagen, no una lista de una: el pedido de siempre.
    expect(await lecturas(page)).toEqual([{ lista: false, partes: 1, tipos: ['image/jpeg'] }]);
  });

  test('🔴 tocar una miniatura la muestra grande y deja quitarla; las demás se renumeran', async ({ page }) => {
    await sacar(page, 3);
    await fila(page).getByRole('button', { name: 'Ver la foto 2', exact: true }).click();
    const vista = page.getByRole('dialog', { name: 'Foto 2', exact: true });
    await expect(vista).toBeVisible();
    await expect(vista.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();
    await capturar(page, 'es-foto-grande');
    await vista.getByRole('button', { name: 'Quitar esta foto', exact: true }).click();
    await expect(vista).toHaveCount(0);
    await expect(fila(page).getByRole('listitem')).toHaveCount(2);
    await expect(fila(page).locator('.fotos-al-volver-numero')).toHaveText(['1', '2']);
    // Cerrar sin quitar no cambia nada.
    await fila(page).getByRole('button', { name: 'Ver la foto 1', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(fila(page).getByRole('listitem')).toHaveCount(2);
  });

  test('🔴 con 4 fotos, «Sacar otra» se deshabilita y una línea lo explica', async ({ page }) => {
    await sacar(page, 4);
    await expect(sacarOtra(page)).toBeDisabled();
    await expect(alVolver(page).getByText('Ya tienes 4 fotos, el máximo por ticket.', { exact: true })).toBeVisible();
    await expect(alVolver(page).getByText('Sacaste 4 fotos. Toca ✓ para ajustar el recuadro.', { exact: true })).toBeVisible();
    await capturar(page, 'es-cuatro-fotos');
    // Quitando una, se puede sacar otra.
    await fila(page).getByRole('button', { name: 'Ver la foto 4', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Quitar esta foto', exact: true }).click();
    await expect(sacarOtra(page)).toBeEnabled();
  });

  test('🔴 «Volver» con fotos pregunta: «Seguir sacando» se queda, «Salir y perder las fotos» se va', async ({ page }) => {
    await sacar(page, 2);
    await alVolver(page).getByRole('button', { name: 'Volver', exact: true }).click();
    const pregunta = page.getByRole('alertdialog', { name: '¿Salir sin leer el ticket?' });
    await expect(pregunta).toBeVisible();
    await expect(pregunta).toContainText('Se pierden las 2 fotos que sacaste.');
    await expect(pregunta.getByRole('button', { name: 'Seguir sacando', exact: true })).toBeFocused();
    await capturar(page, 'es-salir');
    await pregunta.getByRole('button', { name: 'Seguir sacando', exact: true }).click();
    await expect(pregunta).toHaveCount(0);
    await expect(fila(page).getByRole('listitem')).toHaveCount(2);
    await expect(page).toHaveURL(/\/scan$/);
    await alVolver(page).getByRole('button', { name: 'Volver', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Salir y perder las fotos', exact: true }).click();
    await expect(page).not.toHaveURL(/\/scan$/);
    // Al volver a escanear, no queda ninguna foto de antes.
    await abrirEscaneo(page);
    await esperarCapacidad(page);
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(fila(page).getByRole('listitem')).toHaveCount(1);
  });

  test('🔴 en el recuadro de la tanda, «Volver a las fotos» (y «Volver» arriba) vuelven con todas y sin partes', async ({ page }) => {
    await sacar(page, 2);
    await listo(page).click();
    await expect(page.getByText('Parte 1: ajusta el marco para dejar sólo esa parte', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Siguiente foto', exact: true }).click();
    await expect(page.getByText('Parte 2: ajusta el marco para dejar sólo esa parte', { exact: true })).toBeVisible();
    await capturar(page, 'es-recuadro-parte-2');
    await page.getByRole('button', { name: 'Volver a las fotos', exact: true }).click();
    await expect(fila(page).getByRole('listitem')).toHaveCount(2);
    await expect(page.locator('.camara-partes')).toHaveCount(0);
    // La última foto no se vuelve a achicar al regresar.
    await expect(page.locator('.fotos-al-volver-recien')).toHaveCount(0);
    // De nuevo al recuadro: arranca en la primera, y «Volver» de arriba también vuelve a las fotos (no se va).
    await listo(page).click();
    await expect(page.getByText('Parte 1: ajusta el marco para dejar sólo esa parte', { exact: true })).toBeVisible();
    await page.locator('.camara-volver').click();
    await expect(fila(page).getByRole('listitem')).toHaveCount(2);
    await expect(page).toHaveURL(/\/scan$/);
    expect(await lecturas(page)).toEqual([]);
  });
});

test.describe('D547 · en inglés', () => {
  test('la pantalla, la vista grande y la pregunta de salida', async ({ page }) => {
    await conCapacidad(page);
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await page.getByRole('button', { name: 'Scan', exact: true }).click();
    await esperarCapacidad(page);
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(alVolver(page).getByText('You took 1 photo. If the receipt is long, take another part. If not, tap ✓.', { exact: true })).toBeVisible();
    await expect(sacarOtra(page)).toHaveText('Take another');
    await expect(fila(page).getByRole('button', { name: 'View photo 1', exact: true })).toBeVisible();
    await capturar(page, 'en-una-foto');
    await alVolver(page).getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('alertdialog', { name: 'Leave without reading the receipt?' })).toContainText('The photo you took will be lost.');
    await page.getByRole('button', { name: 'Keep going', exact: true }).click();
    await listo(page).click();
    await expect(page.getByRole('button', { name: 'Back to the photos', exact: true })).toBeVisible();
  });
});

test.describe('D547 · sin la capacidad de varias fotos', () => {
  test('🔴 la cámara va directo al recuadro, como siempre', async ({ page }) => {
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    await abrirEscaneo(page);
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(marco(page)).toBeVisible();
    await expect(alVolver(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sacar otra', exact: true })).toBeVisible();
  });
});
