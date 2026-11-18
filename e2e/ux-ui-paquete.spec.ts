import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { abrirTusConsumos } from './_mesa';
import { sacarFoto } from './_camara';
declare global { interface Window { pagoMedido: number } }

async function enPago(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'sandbox'));
  await ingresar(page); await page.goto('/#/mesa/PA-2847'); await abrirTusConsumos(page);
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await page.getByRole('button', { name: /^(Continuar|Listo)$/, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte', exact: true })).toBeVisible();
}
async function captura(page: Page, nombre: string): Promise<void> {
  if (!process.env.PAYME_E2E_CAPTURAS) return;
  // El perfil proviene sólo del seed local; se sustituye por un nombre inventado en las capturas.
  await page.locator('.hdr-user').evaluateAll((els) => els.forEach((el) => { el.textContent = 'Demo'; }));
  await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/${nombre}.png`, animations: 'disabled' });
}

test('K9 · propina neutra, cero al mismo nivel y elección explícita', async ({ page }) => {
  await enPago(page);
  await expect(page.locator('.tip-block')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.tip-block')).not.toHaveClass(/tip-block--pending/);
  await expect(page.locator('.tip-block-title svg')).toHaveCount(0);
  const opciones = page.locator('.tip-choices [role=radio]');
  await expect(opciones).toHaveCount(6);
  for (let i = 0; i < 6; i += 1) await expect(opciones.nth(i)).toHaveAttribute('aria-checked', 'false');
  expect(await opciones.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await opciones.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor));
  await captura(page, '07-propina');
});

test('K10 · total de 40 px y desglose correcto', async ({ page }) => {
  await enPago(page); await page.getByRole('radio', { name: '10%', exact: true }).click();
  await expect(page.locator('.pay-total-card > strong')).toHaveCSS('font-size', '40px');
  await expect(page.locator('.pay-total-card > strong')).toHaveText('$216');
  await expect(page.locator('.pay-total-desglose')).toHaveText('Consumos propios$195Propina$21');
  await captura(page, '08-total-a-pagar');
});

test('K11 · pagar ancho con el monto, mismo handler y cámara en Inicio', async ({ page }) => {
  await enPago(page); await page.getByRole('radio', { name: '10%', exact: true }).click();
  const pagar = page.getByRole('button', { name: 'Pagar $216', exact: true });
  expect((await pagar.boundingBox())!.width).toBeGreaterThan(340);
  await expect(page.locator('.appbar-center')).toHaveCount(0);
  await captura(page, '09-pago-boton-ancho');
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const original = api.payMesa; const w = window; w.pagoMedido = 0;
    api.payMesa = (...args) => { w.pagoMedido += 1; return original(...args); };
  });
  await pagar.click();
  await expect.poll(() => page.evaluate(() => window.pagoMedido)).toBe(1);
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await expect(page.locator('.appbar-center')).toHaveAccessibleName('Escanear');
});

test('K12 · pagado en neutro con candado', async ({ page }) => {
  await ingresar(page); await page.goto('/#/mesa/PA-2847'); await abrirTusConsumos(page);
  const pagado = page.locator('.qc-otro').filter({ hasText: 'Pagado' }).first();
  await expect(pagado).toBeVisible();
  await expect(pagado).toHaveCSS('background-color', 'rgb(248, 250, 252)');
  await expect(pagado.locator('svg').first()).toBeVisible();
  await captura(page, '10-filas-pagado');
});

test('K13 · primera vez: invitación sola y la guía espera a una mesa guardada', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' }));
  await ingresar(page);
  await expect(page.getByRole('region', { name: 'Te invitaron', exact: true })).toBeVisible();
  await expect(page.locator('.friend-avatar-notice')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Agrega PayMe a tu inicio' })).toHaveCount(0);
  await captura(page, '11-inicio-primera-vez');
});

test('K14 · idioma, entendido y contador en navy', async ({ page }) => {
  await ingresar(page); await page.goto('/#/mas');
  await expect(page.locator('.lang-btn-on')).toHaveCSS('background-color', 'rgb(16, 30, 59)');
  await page.goto('/#/amigos');
  await expect(page.locator('.btab-badge').first()).toHaveCSS('background-color', 'rgb(16, 30, 59)');
  const entendido = page.getByRole('button', { name: 'Entendido', exact: true });
  await expect(entendido).toHaveCSS('background-color', 'rgb(16, 30, 59)');
  await captura(page, '12-naranja-solo-principal');
});

test('K15 · lectura del ticket con su propio texto', async ({ page }) => {
  await ingresar(page);
  await page.evaluate(() => localStorage.setItem('payme.app.mock.latencia.v1', '5000'));
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByText('Leyendo el ticket…', { exact: true })).toBeVisible();
  await captura(page, '13-escanear-leyendo');
});
