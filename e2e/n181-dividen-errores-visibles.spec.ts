import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { completarDivision, configurarTicketSinQr, estadoN179 } from './fixtures/ticket-sin-qr';

/**
 * n181 · «¿Cómo dividen?» no puede fallar en silencio · los casos que la matriz
 * de seis (`n181-clases-pendientes.spec.ts`) no cubre y la orden
 * AF-ROBUSTEZ-TESTS-CLAUDE-20260922 nombra: sin restaurante, un error definitivo
 * de `createMesa` y la recuperación después de ese error. La respuesta perdida
 * (error ambiguo) ya la cubre `ticket-sin-qr.spec.ts`.
 *
 * Todo corre con los pagos APAGADOS (`money_rail: disabled`, la capability de
 * tarjeta en falso): es el modo en el que la mesa se abre DESDE este paso, y por
 * eso el único en el que un error mudo acá deja a la persona sin salida.
 *
 * 🔴 **Sin tocar producto:** los fallos se provocan reemplazando, dentro de la
 * página y sólo durante el test, un método del objeto `api` del mock (que es un
 * objeto común). La pantalla llama al método en el momento de usarlo, así que
 * recibe el reemplazo; el resto de la app sigue con el mock de siempre.
 */

async function abrirDividen(page: Page): Promise<void> {
  await configurarTicketSinQr(page);
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
  await completarDivision(page);
}

/** Reemplaza `api[metodo]` por uno que rechaza con el error del mock dado. */
async function fallar(page: Page, metodo: 'createMesa' | 'resolveRestaurant', status: number, code: string): Promise<void> {
  await page.evaluate(async ({ metodo: m, status: s, code: c }) => {
    const apiPath = '/src/api/index.ts';
    const mockPath = '/src/api/mock/mockApi.ts';
    const { api } = await import(/* @vite-ignore */ apiPath) as { api: Record<string, unknown> };
    const { MockApiError } = await import(/* @vite-ignore */ mockPath) as {
      MockApiError: new (status: number, error: string) => Error;
    };
    const w = window as unknown as { __n181Original?: Record<string, unknown>; __n181Llamadas?: number };
    w.__n181Original ??= {};
    w.__n181Original[m] ??= api[m];
    w.__n181Llamadas = 0;
    api[m] = async () => {
      w.__n181Llamadas = (w.__n181Llamadas ?? 0) + 1;
      throw new MockApiError(s, c);
    };
  }, { metodo, status, code });
}

async function restaurar(page: Page, metodo: 'createMesa' | 'resolveRestaurant'): Promise<void> {
  await page.evaluate(async (m) => {
    const apiPath = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ apiPath) as { api: Record<string, unknown> };
    const w = window as unknown as { __n181Original?: Record<string, unknown> };
    if (!w.__n181Original?.[m]) throw new Error('n181_sin_original');
    api[m] = w.__n181Original[m];
  }, metodo);
}

const llamadas = (page: Page) => page.evaluate(() => (window as unknown as { __n181Llamadas?: number }).__n181Llamadas ?? 0);
const continuar = (page: Page) => page.getByRole('button', { name: 'Continuar', exact: true });

test.describe('n181 · «¿Cómo dividen?» dice por qué no abre la mesa', () => {
  test('sin restaurante: el aviso se ve en este paso, no se abre la mesa y se puede reintentar', async ({ page }) => {
    await configurarTicketSinQr(page);
    await ingresar(page);
    // El restaurante del ticket se resuelve al llegar a este paso o al tocar
    // «Continuar»: el reemplazo va antes de escanear, así ninguna resolución gana.
    await fallar(page, 'resolveRestaurant', 404, 'restaurant_not_found');
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar', exact: true }).click();
    await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
    await completarDivision(page);

    await continuar(page).click();
    await expect(page.getByRole('alert')).toContainText('Este QR no corresponde a un restaurante disponible.');
    await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toHaveCount(0);
    await expect(continuar(page)).toBeEnabled();
    expect(await llamadas(page)).toBeGreaterThan(0);
    const estado = await estadoN179(page);
    expect(estado.mesas).toHaveLength(0);
    expect(estado.mesaLedgerKeys).toHaveLength(0);
  });

  test('error definitivo de createMesa (4xx): lo dice en este paso y no crea nada', async ({ page }) => {
    await abrirDividen(page);
    await fallar(page, 'createMesa', 422, 'validation_error');

    await continuar(page).click();
    await expect(page.getByRole('alert')).toContainText('No pudimos abrir la mesa. Revisa el ticket y prueba de nuevo.');
    await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toHaveCount(0);
    await expect(continuar(page)).toBeEnabled();
    expect(await llamadas(page)).toBe(1);
    expect((await estadoN179(page)).mesas).toHaveLength(0);
  });

  test('🔴 recuperación: después del error, el mismo «Continuar» abre la mesa y el aviso se va', async ({ page }) => {
    await abrirDividen(page);
    await fallar(page, 'createMesa', 422, 'validation_error');
    await continuar(page).click();
    await expect(page.getByRole('alert')).toContainText('No pudimos abrir la mesa.');

    await restaurar(page, 'createMesa');
    await continuar(page).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
    await expect(page.getByText('No pudimos abrir la mesa.', { exact: false })).toHaveCount(0);
    const estado = await estadoN179(page);
    expect(estado.mesas).toHaveLength(1);
    // Un error definitivo rota el intento: la mesa nueva no reusa una clave muerta.
    expect(estado.mesaLedgerKeys).toHaveLength(1);
  });
});
