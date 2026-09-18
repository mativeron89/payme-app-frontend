import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-18 · los campos aditivos del dueño v2.93.0 en Inicio y en Avisos.
 *
 * - G-27 · «Mesa PA-3121 · 4 personas» (`participants_count`).
 * - G-34 · decisión de Mati, «Según lo que eligió cada uno»: «Ya pagaste,
 *   faltan otros» / «Te falta pagar» con `my_status`, y «Pagaste $…» con
 *   `my_paid_cents`, sólo del propio usuario.
 * - G-31 · el ícono de la invitación sale de `restaurant_category`.
 *
 * El mock publica los campos por defecto (como v2.93.0) y los controla con
 * seams de `localStorage`, que el build real no consulta. Sin los campos
 * (`mesas_sin_campos_aditivos`), todo es como en 0.168.0.
 */

async function seams(page: Page, valores: Record<string, string>): Promise<void> {
  await page.addInitScript((v: Record<string, string>) => {
    for (const [clave, valor] of Object.entries(v)) localStorage.setItem(clave, valor);
  }, valores);
}

const MI_ESTADO = 'payme.app.mock.mesa_mi_estado.v1';
const SIN_CAMPOS = 'payme.app.mock.mesas_sin_campos_aditivos.v1';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const tarjeta = (page: Page) => page.getByRole('button', { name: /Tu mesa abierta/ });

test('G-27 · la burbuja dice cuánta gente hay; sin estado propio, la etiqueta genérica de siempre', async ({ page }) => {
  await ingresar(page);
  await expect(tarjeta(page)).toContainText('Mesa PA-3121 · 4 personas');
  await expect(tarjeta(page)).toContainText('Pago en curso');
  await expect(tarjeta(page)).not.toContainText('Pagaste');
  await capturar(page, '01-burbuja-con-conteo');
});

test('G-34 · paid ⇒ «Ya pagaste, faltan otros» y lo que pagó ESTA cuenta', async ({ page }) => {
  await seams(page, { [MI_ESTADO]: 'paid' });
  await ingresar(page);
  await expect(tarjeta(page)).toContainText('Ya pagaste, faltan otros');
  await expect(tarjeta(page)).not.toContainText('Pago en curso');
  await expect(tarjeta(page)).toContainText(/Pagaste \$[\d,]+\.\d{2}/);
  await capturar(page, '02-ya-pagaste');

  // La hoja de «+N mesas» usa la MISMA decisión.
  await page.getByRole('button', { name: '+1 mesa abierta más' }).click();
  const hoja = page.getByRole('dialog', { name: 'Mesas abiertas' });
  await expect(hoja.getByRole('button', { name: /La Parolaccia/ })).toContainText('Ya pagaste, faltan otros');
  await expect(hoja.getByRole('button', { name: /La Parolaccia/ })).toContainText('Mesa PA-2847 · 4 personas');
});

test('G-34 · pending ⇒ «Te falta pagar»', async ({ page }) => {
  await seams(page, { [MI_ESTADO]: 'pending' });
  await ingresar(page);
  await expect(tarjeta(page)).toContainText('Te falta pagar');
  await expect(tarjeta(page)).not.toContainText('Pago en curso');
  // El mock publica my_paid_cents = 0 con pending: no se dibuja «Pagaste $0.00».
  await expect(tarjeta(page)).not.toContainText('Pagaste');
  await capturar(page, '03-te-falta-pagar');
});

test('🔴 G-34 · not_applicable o un estado desconocido NO personalizan', async ({ page }) => {
  for (const estado of ['not_applicable', 'refunded']) {
    await seams(page, { [MI_ESTADO]: estado });
    await ingresar(page);
    await expect(tarjeta(page)).toContainText('Pago en curso');
    await expect(tarjeta(page)).not.toContainText('Ya pagaste');
    await expect(tarjeta(page)).not.toContainText('Te falta pagar');
    await expect(tarjeta(page)).not.toContainText('Pagaste');
    await page.evaluate(() => localStorage.clear());
  }
});

test('🔴 backend 2.92.0 (sin los campos): la burbuja es la de 0.168.0', async ({ page }) => {
  await seams(page, { [SIN_CAMPOS]: 'true', [MI_ESTADO]: 'paid' });
  await ingresar(page);
  // Testigo positivo: la tarjeta cargó con sus datos.
  await expect(tarjeta(page)).toContainText('Hanzo Sushi');
  const meta = tarjeta(page).locator('.mesa-meta');
  await expect(meta).toHaveText('Mesa PA-3121');
  await expect(tarjeta(page)).toContainText('Pago en curso');
  await expect(tarjeta(page)).not.toContainText('Ya pagaste');
});

test('G-31 · la invitación muestra el ícono de la cocina del restaurante', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/avisos');
  const invitacion = page.locator('.inv-card').filter({ hasText: 'Hanzo Sushi' });
  await expect(invitacion).toBeVisible();
  await expect(invitacion.locator('[data-icono]')).toHaveAttribute('data-icono', 'sushi');
  await capturar(page, '04-invitacion-con-icono');
});

test('🔴 G-31 · sin restaurant_category el ícono es «store», aunque el nombre diga «Sushi»', async ({ page }) => {
  await seams(page, { [SIN_CAMPOS]: 'true' });
  await ingresar(page);
  await page.goto('/#/avisos');
  const invitacion = page.locator('.inv-card').filter({ hasText: 'Hanzo Sushi' });
  await expect(invitacion).toBeVisible();
  await expect(invitacion.locator('[data-icono]')).toHaveAttribute('data-icono', 'store');
});
