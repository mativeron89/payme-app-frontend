import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * n420 · «dividir como siempre» (D411–D415, D426), publicado APAGADO.
 *
 * El mock por defecto es el backend de hoy: no anuncia `features.sugerencias` ni `features.analisis_interno`. Con eso
 * no hay filas en Configuración › Privacidad y «¿Cómo dividen?» queda como siempre. La costura
 * `payme.app.mock.sugerencias.v1 = encendido` las anuncia (el control positivo de cada caso), y
 * `payme.app.mock.sugerencia_dividir.v1` dice qué sugeriría el dueño con el permiso otorgado.
 *
 * Los permisos del mock viven en la memoria de la página: se cambia de pantalla con el hash, sin recargar.
 */

async function conCosturas(page: Page, costuras: Readonly<Record<string, string>>): Promise<void> {
  await page.addInitScript((c) => {
    for (const [k, v] of Object.entries(c)) localStorage.setItem(`payme.app.mock.${k}.v1`, v);
  }, costuras);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((r) => { location.hash = r; }, ruta);
}

async function aComoDividen(page: Page): Promise<void> {
  await ir(page, '#/inicio');
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

const opcion = (page: Page, nombre: RegExp) => page.getByRole('radio', { name: nombre });
const fila = (page: Page, nombre: string) => page.getByRole('switch', { name: nombre, exact: true });

test.describe('n420 · apagado (hoy)', () => {
  test('🔴 sin capacidad: ni filas en Configuración ni marca en «¿Cómo dividen?»', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await ingresar(page);
    await ir(page, '#/mas');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
    await expect(page.getByText('Sugerencias para dividir')).toHaveCount(0);
    await expect(page.getByText('Análisis interno de PayMe')).toHaveCount(0);
    await aComoDividen(page);
    await expect(opcion(page, /En partes iguales/)).toContainText('El total dividido entre todos');
    await expect(opcion(page, /Por lo que pidió cada uno/)).toContainText('Cada uno elige sus platos');
    await expect(page.getByText(/Como siempre/)).toHaveCount(0);
  });
});

test.describe('n420 · encendido en el mock (control positivo)', () => {
  test('🔴 las dos filas con los textos aprobados; activar enciende el interruptor sólo con la respuesta', async ({ page }) => {
    await conCosturas(page, { sugerencias: 'encendido' });
    await ingresar(page);
    await ir(page, '#/mas');
    const seccion = page.getByRole('region', { name: 'Privacidad', exact: true });
    await expect(seccion).toBeVisible();
    await expect(seccion).toContainText('PayMe te sugiere cómo dividir según las mesas que abriste. Sólo lo ves tú.');
    await expect(seccion).toContainText('Opcional. PayMe analiza, sin tu nombre, cómo se consume en las mesas. No llega a restaurantes ni a otros usuarios. Puedes apagarlo.');
    await expect(seccion.getByRole('link', { name: 'Más en el Aviso de Privacidad.' })).toHaveCount(2);
    for (const nombre of ['Sugerencias para dividir', 'Análisis interno de PayMe']) {
      await expect(fila(page, nombre)).not.toBeChecked();
      await fila(page, nombre).click();
      await expect(fila(page, nombre)).toBeChecked();
      await fila(page, nombre).click();
      await expect(fila(page, nombre)).not.toBeChecked();
    }
  });

  test('🔴 con el permiso y «partes iguales entre 4»: la opción dice «Como siempre · entre 4» y el contador sigue sin elegir (D412)', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await conCosturas(page, { sugerencias: 'encendido', sugerencia_dividir: 'igual-4' });
    await ingresar(page);
    await ir(page, '#/mas');
    await fila(page, 'Sugerencias para dividir').click();
    await expect(fila(page, 'Sugerencias para dividir')).toBeChecked();
    await aComoDividen(page);
    await expect(opcion(page, /En partes iguales/)).toContainText('Como siempre · entre 4');
    await expect(opcion(page, /En partes iguales/)).not.toContainText('El total dividido entre todos');
    await expect(opcion(page, /Por lo que pidió cada uno/)).toContainText('Cada uno elige sus platos');
    // D412 · elegirla no completa el número de personas: el contador nace sin elegir.
    await expect(page.locator('.division-stepper')).toHaveClass(/division-stepper--pending/);
    await opcion(page, /En partes iguales/).click();
    await expect(page.locator('.division-stepper')).toHaveClass(/division-stepper--pending/);
  });

  test('«por lo que pidió cada uno»: «Como siempre», sin número', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await conCosturas(page, { sugerencias: 'encendido', sugerencia_dividir: 'consumo' });
    await ingresar(page);
    await ir(page, '#/mas');
    await fila(page, 'Sugerencias para dividir').click();
    await expect(fila(page, 'Sugerencias para dividir')).toBeChecked();
    await aComoDividen(page);
    await expect(opcion(page, /Por lo que pidió cada uno/)).toContainText('Como siempre');
    await expect(opcion(page, /Por lo que pidió cada uno/)).not.toContainText('entre');
    await expect(opcion(page, /En partes iguales/)).toContainText('El total dividido entre todos');
  });

  test('🔴 encendida pero SIN el permiso: ninguna marca', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await conCosturas(page, { sugerencias: 'encendido', sugerencia_dividir: 'igual-4' });
    await ingresar(page);
    await aComoDividen(page);
    await expect(page.getByText(/Como siempre/)).toHaveCount(0);
  });

  test('🔴 D405 · con el permiso y sin historial suficiente: nada', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await conCosturas(page, { sugerencias: 'encendido' });
    await ingresar(page);
    await ir(page, '#/mas');
    await fila(page, 'Sugerencias para dividir').click();
    await expect(fila(page, 'Sugerencias para dividir')).toBeChecked();
    await aComoDividen(page);
    await expect(page.getByText(/Como siempre/)).toHaveCount(0);
    await expect(opcion(page, /En partes iguales/)).toContainText('El total dividido entre todos');
  });

  /** La marca en inglés («As usual · between N») la fija `src/api/sugerencias.test.ts`: el ayudante de la cámara es en español. */
  test('EN · las filas en inglés', async ({ page }) => {
    await conCosturas(page, { sugerencias: 'encendido' });
    await ingresar(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await ir(page, '#/mas');
    const seccion = page.getByRole('region', { name: 'Privacy', exact: true });
    await expect(seccion).toContainText('PayMe suggests how to split based on the tables you opened. Only you see it.');
    await expect(seccion).toContainText('PayMe internal analysis');
    await expect(seccion.getByRole('link', { name: 'More in the Privacy Notice.' })).toHaveCount(2);
    await fila(page, 'Split suggestions').click();
    await expect(fila(page, 'Split suggestions')).toBeChecked();
  });
});
