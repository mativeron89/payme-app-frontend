import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * AF-VIAJE-EN-INICIO-Y-PESTANA-VIAJES-20261010 (0.237.1), a 375, con el mock de App Backend 2.177.0:
 * - D265 · cada viaje abierto, en la pantalla principal de Inicio, como una mesa abierta; las pestañas en negrita;
 * - D267 · la burbuja con la foto o la inicial, el nombre y el balance, con su color;
 * - D266 · la pestaña Viajes con «Crear viaje» y «Cerrados» (en `viajes.spec.ts`, 1a).
 *
 * D275 (0.238.1) rediseñó la burbuja con Claude Design: sólo la foto o la inicial, el nombre y el monto, con «−» si
 * debes, y esperando pagos igual que abierto. Lo demás, en `d275-burbuja-del-viaje.spec.ts`.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';

async function conViajes(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  // D276-1 · el día de la corrida no decide a dónde va «Nueva» (`_app.ts`).
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const burbuja = (page: Page, nombre: string) => page.locator('.viaje-burbuja').filter({ hasText: nombre });
const balance = (page: Page, nombre: string) => burbuja(page, nombre).locator('.viaje-burbuja-monto');

test.describe('🔴 D265 · D267 · el viaje abierto en Inicio', () => {
  test('una burbuja por viaje abierto: la inicial, el nombre y el monto con su color; esperando pagos, igual (D275)', async ({ page }) => {
    await conViajes(page);
    // En la pestaña de siempre (Cuenta): Cancún abierto y Monterrey esperando pagos. Los cerrados no.
    await expect(page.getByRole('tab', { name: 'Cuenta', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.viaje-burbuja .viaje-burbuja-nombre')).toHaveText(['Cancún 2026', 'Monterrey fin de semana']);
    await expect(page.locator('.viaje-burbuja').filter({ hasText: 'Oaxaca puente' })).toHaveCount(0);
    await expect(burbuja(page, 'Cancún 2026')).toHaveText('CCancún 2026\u2212$542');
    await expect(balance(page, 'Cancún 2026')).toHaveCSS('color', 'rgb(180, 35, 24)');
    // D275 · esperando pagos se ve igual que abierto, con su monto.
    await expect(balance(page, 'Monterrey fin de semana')).toHaveText('$1,050');
    await expect(balance(page, 'Monterrey fin de semana')).toHaveCSS('color', 'rgb(4, 120, 87)');
    // El color del balance no tiñe la tarjeta, que es blanca como la de una mesa.
    await expect(burbuja(page, 'Cancún 2026')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.getByText(/saldo/i)).toHaveCount(0);
    await burbuja(page, 'Cancún 2026').scrollIntoViewIfNeeded();
    await capturar(page, 'd265-01-inicio-con-viajes');
    // También con las otras pestañas.
    await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
    await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
    // Tocarla abre el viaje.
    await burbuja(page, 'Cancún 2026').click();
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  });

  test('te deben, en verde: después de cargar un gasto que pagué yo', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill('Hotel');
    await page.getByLabel('Monto', { exact: true }).fill('5000');
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Cargaste el gasto.', { exact: true })).toBeVisible();
    await ir(page, '/');
    // −$542 + $5,000 − $1,250 = $3,208 a favor.
    await expect(balance(page, 'Cancún 2026')).toHaveText('$3,208');
    await expect(burbuja(page, 'Cancún 2026')).toHaveAttribute('aria-label', 'Cancún 2026, te deben $3,208');
    await expect(balance(page, 'Cancún 2026')).toHaveCSS('color', 'rgb(4, 120, 87)');
  });

  test('en cero: un viaje recién creado aparece en Inicio (lo guardado se olvidó al crearlo)', async ({ page }) => {
    await conViajes(page);
    await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
    await ir(page, '/viaje-nuevo');
    await page.getByLabel('Nombre del viaje').fill('Puebla 2026');
    await page.getByPlaceholder('Busca en Amigos o escribe @usuario').fill('sof');
    await page.getByRole('button', { name: 'Agregar', exact: true }).first().click();
    await page.getByRole('button', { name: 'Crear viaje', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Puebla 2026' })).toBeVisible();
    await ir(page, '/');
    await expect(balance(page, 'Puebla 2026')).toHaveText('$0');
    await expect(burbuja(page, 'Puebla 2026')).toHaveAttribute('aria-label', 'Puebla 2026, estás al día');
    await expect(balance(page, 'Puebla 2026')).toHaveCSS('color', 'rgb(16, 30, 59)');
    await expect(burbuja(page, 'Puebla 2026').locator('.vj-insignia')).toHaveText('P');
  });

  test('🔴 las pestañas de Inicio en negrita, la elegida también; las de Amigos, como siempre', async ({ page }) => {
    await conViajes(page);
    const pesos = (selector: string) => page.locator(selector).evaluateAll((xs) => xs.map((x) => getComputedStyle(x).fontWeight));
    await expect.poll(() => pesos('.btabs .btab')).toEqual(['700', '700', '700']);
    await ir(page, '/amigos');
    await expect(page.locator('.btabs .btab').first()).toBeVisible();
    expect(new Set(await pesos('.btabs .btab'))).toEqual(new Set(['500']));
  });
});
