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

  /** La marca en EN («As usual · between N») la fija `src/api/sugerencias.test.ts`: el ayudante de la cámara es en español. */
  test('EN · las filas traducidas', async ({ page }) => {
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

/** Cuenta los pedidos a la fachada de los permisos opcionales y de la sugerencia, en la página ya cargada. */
async function espiar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __n420: Record<string, number> };
    w.__n420 = { getConsentimientosOpcionales: 0, getConsentimiento: 0, grantConsentimiento: 0, revokeConsentimiento: 0, getSugerenciaDividir: 0 };
    for (const m of Object.keys(w.__n420)) {
      const original = api[m]!.bind(api);
      api[m] = async (...a: unknown[]) => { w.__n420[m] += 1; return original(...a); };
    }
  });
}
const pedidos = (page: Page) => page.evaluate(() => (window as unknown as { __n420: Record<string, number> }).__n420);
/** La capacidad en memoria ANTES de montar Configuración: el caso en que StrictMode, en desarrollo, corre el efecto dos veces. */
const conConfigCargada = (page: Page) => page.evaluate(async () => {
  const ruta = '/src/api/index.ts';
  const { api } = await import(/* @vite-ignore */ ruta) as { api: { getConfig(): Promise<unknown> } };
  await api.getConfig();
});

/**
 * O1/O2 · auditoría de PR102. «Apagado» con la forma de producción de hoy (`{supported: true, enabled: false}`).
 * Para saber si hay algo que revocar, Configuración lee la lista `GET /api/account/consents` UNA vez (auditoría de
 * PR103, punto 4 b).
 *
 * 🔴 Exactamente uno, también en el servidor de desarrollo: la app privada monta en `StrictMode`, que en desarrollo corre
 * cada efecto dos veces si la capacidad ya está en memoria al montar (el CI de PR103, run 40452967722, lo encontró con
 * los GET por finalidad). La lectura va con single-flight por cuenta (`leerUnaVez`), y el caso se fuerza: el `/config`
 * se carga antes de entrar a Configuración.
 */
test.describe('O1/O2 · capacidad anunciada y apagada (la forma de producción)', () => {
  test('🔴 O2 · sin el permiso: ninguna fila; Configuración pide la lista UNA vez, y «¿Cómo dividen?» no pide nada', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await conCosturas(page, { sugerencias: 'apagado', sugerencia_dividir: 'igual-4' });
    await ingresar(page);
    await conConfigCargada(page);
    await espiar(page);
    await ir(page, '#/mas');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
    await expect.poll(async () => (await pedidos(page)).getConsentimientosOpcionales).toBe(1);
    await expect(page.getByText('Sugerencias para dividir')).toHaveCount(0);
    await expect(page.getByText('Análisis interno de PayMe')).toHaveCount(0);
    await aComoDividen(page);
    await expect(opcion(page, /En partes iguales/)).toContainText('El total dividido entre todos');
    await expect(page.getByText(/Como siempre/)).toHaveCount(0);
    expect(await pedidos(page)).toEqual({ getConsentimientosOpcionales: 1, getConsentimiento: 0, grantConsentimiento: 0, revokeConsentimiento: 0, getSugerenciaDividir: 0 });
  });

  test('🔴 sin la capacidad anunciada (el mock por defecto): Configuración no pide nada', async ({ page }) => {
    await ingresar(page);
    await conConfigCargada(page);
    await espiar(page);
    await ir(page, '#/mas');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
    expect(await pedidos(page)).toEqual({ getConsentimientosOpcionales: 0, getConsentimiento: 0, grantConsentimiento: 0, revokeConsentimiento: 0, getSugerenciaDividir: 0 });
  });

  /**
   * 🔴 O2 · la puerta de la capacidad en «¿Cómo dividen?», sin pasar antes por Configuración (que deja el permiso en
   * memoria) y con el permiso otorgado: si el hook no mirara la capacidad, acá pediría el permiso y la sugerencia.
   */
  test('🔴 O2 · apagada y con el permiso otorgado, «¿Cómo dividen?» no pide nada', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await conCosturas(page, { sugerencias: 'apagado', consentimientos_otorgados: 'sugerencias', sugerencia_dividir: 'igual-4' });
    await ingresar(page);
    await espiar(page);
    await aComoDividen(page);
    await expect(opcion(page, /En partes iguales/)).toContainText('El total dividido entre todos');
    await expect(page.getByText(/Como siempre/)).toHaveCount(0);
    expect(await pedidos(page)).toEqual({ getConsentimientosOpcionales: 0, getConsentimiento: 0, grantConsentimiento: 0, revokeConsentimiento: 0, getSugerenciaDividir: 0 });
  });

  test('🔴 O1 · con los dos permisos otorgados: las filas aparecen sólo para revocar, y no se pueden volver a activar', async ({ page }) => {
    await conCosturas(page, { sugerencias: 'apagado', consentimientos_otorgados: 'sugerencias,analisis_interno' });
    await ingresar(page);
    await conConfigCargada(page);
    await espiar(page);
    await ir(page, '#/mas');
    for (const nombre of ['Sugerencias para dividir', 'Análisis interno de PayMe']) {
      await expect(fila(page, nombre)).toBeChecked();
      await expect(fila(page, nombre)).toBeEnabled();
      await fila(page, nombre).click();
      await expect(fila(page, nombre)).not.toBeChecked();
      // Sigue a la vista, apagada: con la capacidad apagada no se otorga.
      await expect(fila(page, nombre)).toBeDisabled();
    }
    expect(await pedidos(page)).toMatchObject({ getConsentimientosOpcionales: 1, getConsentimiento: 0, revokeConsentimiento: 2, grantConsentimiento: 0 });
  });

  test('O1 · otorgado sólo uno: sólo esa fila', async ({ page }) => {
    await conCosturas(page, { sugerencias: 'apagado', consentimientos_otorgados: 'analisis_interno' });
    await ingresar(page);
    await ir(page, '#/mas');
    await expect(fila(page, 'Análisis interno de PayMe')).toBeChecked();
    await expect(page.getByText('Sugerencias para dividir')).toHaveCount(0);
  });

  test('control · encendida y otorgado: la fila normal, que se apaga y se vuelve a activar', async ({ page }) => {
    await conCosturas(page, { sugerencias: 'encendido', consentimientos_otorgados: 'sugerencias' });
    await ingresar(page);
    await ir(page, '#/mas');
    await expect(fila(page, 'Sugerencias para dividir')).toBeChecked();
    await fila(page, 'Sugerencias para dividir').click();
    await expect(fila(page, 'Sugerencias para dividir')).not.toBeChecked();
    await expect(fila(page, 'Sugerencias para dividir')).toBeEnabled();
    await fila(page, 'Sugerencias para dividir').click();
    await expect(fila(page, 'Sugerencias para dividir')).toBeChecked();
  });
});
