import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-24 · «Tus mesas» en Historial (`GET /api/mesas/mine`, variante A del plan
 * AF-23, elegida por Mati).
 *
 * Con los pagos apagados, el historial de PAGOS queda vacío aunque la persona
 * haya estado en varias mesas. «Tus mesas» las muestra, y el vacío «Todavía no
 * cerraste ninguna mesa» sólo aparece si de verdad no hay ninguna.
 *
 * El mock se controla con el seam `payme.app.mock.mis_mesas.v1`, que el build
 * real no consulta.
 */

async function seam(page: Page, valor: string | null): Promise<void> {
  await page.addInitScript((v) => {
    if (v === null) localStorage.removeItem('payme.app.mock.mis_mesas.v1');
    else localStorage.setItem('payme.app.mock.mis_mesas.v1', v);
  }, valor);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

/**
 * Deja el historial de PAGOS vacío, como con los pagos apagados. Recarga: el
 * mock tiene su estado en memoria, y un cambio de hash no lo vuelve a leer.
 */
async function sinPagos(page: Page): Promise<void> {
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
    st.history = [];
    localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
  });
  await page.reload();
}

/** Testigo de que el historial de PAGOS de verdad quedó vacío. */
async function esperarSinPagos(page: Page): Promise<void> {
  await expect(page.locator('.hist-item:not(.tu-mesa)')).toHaveCount(0);
}

const seccion = (page: Page) => page.getByRole('region', { name: 'Tus mesas' });

test('las mesas cerradas sin cobro aparecen con lo que elegiste y cómo terminaron', async ({ page }) => {
  await seam(page, 'sin_cobro');
  await ingresar(page);
  await page.goto('/#/mesas');
  await expect(seccion(page)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tus mesas', exact: true })).toHaveCount(0);

  const guero = seccion(page).locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' });
  await expect(guero).toContainText('Cerró sin cobro');
  await expect(guero).toContainText('Elegiste 3 ítems · $450.00');
  await guero.getByRole('button').click();
  await expect(guero.getByText('Tacos al pastor × 2')).toBeVisible();
  await expect(guero).toContainText('$200.00');
  // En `igual` se eligen PARTES.
  await expect(seccion(page).locator('.tu-mesa').filter({ hasText: 'Café Tacuba' }))
    .toContainText('Elegiste 1 parte · $180.00');
  // La mesa propia ya cobrada del seed (PA-1099, La Parolaccia, completada).
  await expect(seccion(page).locator('.tu-mesa').filter({ hasText: 'Pagada' })).toHaveCount(1);
  // 🔴 Las mesas EN CURSO no se repiten acá: ya están en Inicio. Se cuentan
  // FILAS, no nombres: PA-2847 (en curso) también es La Parolaccia.
  await expect(seccion(page).locator('.tu-mesa')).toHaveCount(3);
  await expect(seccion(page)).not.toContainText('Hanzo Sushi');
  await capturar(page, '01-tus-mesas');
});

test('🔴 sin pagos pero CON mesas: no dice «Todavía no cerraste ninguna mesa»', async ({ page }) => {
  await seam(page, 'sin_cobro');
  await ingresar(page);
  await sinPagos(page);
  await page.goto('/#/mesas');
  await expect(seccion(page)).toBeVisible();
  await esperarSinPagos(page);
  await expect(seccion(page).locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' })).toBeVisible();
  await expect(page.getByText('Todavía no cerraste ninguna mesa.')).toHaveCount(0);
  await capturar(page, '02-sin-pagos-con-mesas');
});

test('vacío REAL: sin mesas y sin pagos, recién ahí el vacío', async ({ page }) => {
  await seam(page, 'vacio');
  await ingresar(page);
  await sinPagos(page);
  await page.goto('/#/mesas');
  await expect(page.getByText('Todavía no cerraste ninguna mesa.')).toBeVisible();
  await esperarSinPagos(page);
  await expect(seccion(page)).toHaveCount(0);
  await capturar(page, '03-vacio-real');
});

test('error de «Tus mesas»: su propio cartel con reintento, y los pagos siguen', async ({ page }) => {
  await seam(page, 'error');
  await ingresar(page);
  await page.goto('/#/mesas');
  await expect(page.getByText('No pudimos cargar tus mesas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' }).first()).toBeVisible();
  // Testigo: el historial de pagos del seed sigue ahí.
  await expect(page.locator('.hist-item').first()).toBeVisible();
  await expect(page.getByText('Todavía no cerraste ninguna mesa.')).toHaveCount(0);
  await capturar(page, '04-error');
});

test('paginación: «Ver más mesas» trae la página siguiente con el cursor del dueño', async ({ page }) => {
  await seam(page, 'muchas');
  await ingresar(page);
  await page.goto('/#/mesas');
  await expect(seccion(page).locator('.tu-mesa')).toHaveCount(20);
  await seccion(page).getByRole('button', { name: 'Ver más mesas' }).click();
  await expect(seccion(page).locator('.tu-mesa')).toHaveCount(23);
  await expect(seccion(page).getByRole('button', { name: 'Ver más mesas' })).toHaveCount(0);
});
