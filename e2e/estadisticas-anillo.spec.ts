import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-26 · «Mis estadísticas» etapa 1 · inicio con anillo (diseño 2a).
 *
 * `consumption_month` es OPCIONAL: ausente o inválido ⇒ la pantalla de siempre.
 * Costura del mock `payme.app.mock.stats.v1`: `una`, `cuatro`, `siete`, `vacio`,
 * `ausente`, `raro`. El dinero del mock decide la base, como `dineroHabilitado()`
 * en el dueño: apagado ⇒ «consumo»; encendido (default `sandbox`) ⇒ «gasto».
 */

async function preparar(page: Page, opciones: { costura?: string; sinDinero?: boolean }): Promise<void> {
  await page.addInitScript(({ costura, sinDinero }) => {
    if (costura) localStorage.setItem('payme.app.mock.stats.v1', costura);
    if (sinDinero) localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  }, opciones);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const tarjeta = (page: Page) => page.getByRole('region', { name: /^Tu (consumo|gasto) del mes$/ });
const filas = (page: Page) => tarjeta(page).getByRole('listitem');

test.describe('AF-26 · Mis estadísticas · inicio con anillo', () => {
  test('con los pagos apagados es «consumo»: burbuja, anillo y lista con porcentajes que suman 100', async ({ page }) => {
    await preparar(page, { costura: 'cuatro', sinDinero: true });
    await expect(tarjeta(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tu consumo del mes', exact: true })).toBeVisible();
    await expect(page.getByText('Lo que elegiste en tus mesas', { exact: true })).toBeVisible();
    // Burbuja: «Este mes» sin selector, el total y debajo visitas y promedio.
    const burbuja = page.locator('.stat-burbuja');
    await expect(burbuja).toContainText('Este mes');
    await expect(burbuja).toContainText('$770.00');
    await expect(burbuja).toContainText('10 visitas · $77.00 promedio');
    await expect(burbuja.locator('svg')).toHaveCount(0);
    // Lista: nombre, visitas, monto y porcentaje — nunca el color solo.
    await expect(filas(page)).toHaveCount(4);
    await expect(filas(page).nth(0)).toHaveText(/Italiana.*3 visitas.*\$310\.00.*40%/);
    await expect(filas(page).nth(3)).toHaveText(/Mexicana.*1 visita.*\$86\.50.*11%/);
    await expect(page.getByRole('img', { name: 'Consumo por tipo de cocina: Italiana 40%, Japonesa 32%, Café 17%, Mexicana 11%' })).toBeVisible();
    await expect(tarjeta(page).locator('circle')).toHaveCount(4);
    // Se retiró el cartel, y las secciones de siempre siguen debajo.
    await expect(page.getByText('Todavía no existe en el contrato')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Tus restaurantes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mis estadísticas', exact: true })).toBeAttached();
    await capturar(page, 'estadisticas-02-cuatro-cocinas');
  });

  test('con pagos es «gasto»', async ({ page }) => {
    await preparar(page, {});
    await expect(page.getByRole('heading', { name: 'Tu gasto del mes', exact: true })).toBeVisible();
    await expect(page.getByText('Lo que pagaste, descontando reembolsos', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tu consumo del mes' })).toHaveCount(0);
  });

  test('una sola cocina: anillo entero y 100 %', async ({ page }) => {
    await preparar(page, { costura: 'una', sinDinero: true });
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page).first()).toHaveText(/Italiana.*100%/);
    await expect(tarjeta(page).locator('circle')).toHaveCount(1);
    await capturar(page, 'estadisticas-01-una-cocina');
  });

  test('siete cocinas: el anillo junta de la quinta en adelante, la lista las muestra todas', async ({ page }) => {
    await preparar(page, { costura: 'siete', sinDinero: true });
    await expect(filas(page)).toHaveCount(7);
    await expect(tarjeta(page).locator('circle')).toHaveCount(5);
    // Dos cocinas que el front no conoce se rotulan igual, sin romper.
    await expect(tarjeta(page).getByText('Otra cocina', { exact: true })).toHaveCount(2);
    await expect(filas(page).last()).toHaveText(/Otros/);
    await capturar(page, 'estadisticas-03-siete-cocinas');
  });

  test('mes vacío: el vacío de siempre, sin anillo', async ({ page }) => {
    await preparar(page, { costura: 'vacio', sinDinero: true });
    await expect(page.getByText('Todavía no registramos consumos este mes.')).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
    await capturar(page, 'estadisticas-04-vacio');
  });

  for (const costura of ['ausente', 'raro'] as const) {
    test(`campo ${costura === 'ausente' ? 'ausente (backend anterior)' : 'inválido'}: la pantalla de siempre`, async ({ page }) => {
      await preparar(page, { costura, sinDinero: true });
      // Testigo positivo: la pantalla de siempre, con su ancla.
      await expect(page.getByText('Promedio por visita', { exact: true })).toBeVisible();
      await expect(tarjeta(page)).toHaveCount(0);
      await expect(page.locator('.stat-burbuja')).toHaveCount(0);
    });
  }
});
