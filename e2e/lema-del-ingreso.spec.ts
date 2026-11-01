import { expect, test, type Page } from '@playwright/test';

/**
 * D673 · el lema de la pantalla de ingreso, con los pagos apagados y encendidos.
 *
 * Mientras los pagos estén apagados dice «Divide la cuenta con tus amigos, desde
 * donde quieras»; cuando se enciendan, vuelve «Divide y paga la cuenta desde donde
 * quieras». Lo decide `features.money_rail` de `GET /api/config` (el mock lo sirve
 * según `payme.app.mock.money_rail.v1`), por el mismo corte que apaga los pagos.
 *
 * Capturas a 390×844 (proyecto `movil`) sólo con `PAYME_E2E_CAPTURAS` (D542).
 */

type Modo = 'disabled' | 'sandbox' | 'live';
type Idioma = 'es' | 'en';

async function preparar(page: Page, modo: Modo, idioma: Idioma): Promise<void> {
  await page.addInitScript(({ modo, idioma }) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', modo);
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.idioma.v1', idioma);
  }, { modo, idioma });
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

const LEMA = {
  sinPagos: { es: 'Divide la cuenta con tus amigos, desde donde quieras', en: 'Split the bill with your friends, from wherever you are' },
  conPagos: { es: 'Divide y paga la cuenta desde donde quieras', en: 'Split and pay the bill from wherever you are' },
} as const;

/**
 * Testigo de que el config ya llegó y se aplicó: el botón de Google se dibuja sólo con la capability social leída.
 * Sin esto, el lema «sin pagos» (el del estado inicial, que es el cerrado) se vería antes de que conteste el dueño y
 * el caso «encendido» no probaría nada.
 */
async function conElConfigAplicado(page: Page, idioma: Idioma): Promise<void> {
  await expect(page.getByRole('group', { name: idioma === 'en' ? 'Continue with Google' : 'Continuar con Google' })).toBeVisible();
}

for (const idioma of ['es', 'en'] as const) {
  test.describe(`D673 · el lema del ingreso (${idioma})`, () => {
    test('🔴 con los pagos apagados, sin «paga», en «Entrar» y en «Crea tu cuenta»', async ({ page }) => {
      await preparar(page, 'disabled', idioma);
      await page.goto('/');
      await conElConfigAplicado(page, idioma);
      const lema = page.locator('.ingreso-sub');
      await expect(lema).toHaveText(LEMA.sinPagos[idioma], { useInnerText: true });
      if (idioma === 'es') await capturar(page, 'movil-ingreso-lema-sin-pagos');
      await page.getByRole('button', { name: idioma === 'en' ? 'Create your account' : 'Crea tu cuenta', exact: true }).click();
      await expect(page.locator('.ingreso-burbuja-titulo')).toHaveText(idioma === 'en' ? 'Create your account' : 'Crea tu cuenta');
      await expect(lema).toHaveText(LEMA.sinPagos[idioma], { useInnerText: true });
      if (idioma === 'es') await capturar(page, 'movil-alta-lema-sin-pagos');
    });

    for (const modo of ['sandbox', 'live'] as const) {
      test(`🔴 con los pagos encendidos (${modo}), el lema de siempre`, async ({ page }) => {
        await preparar(page, modo, idioma);
        await page.goto('/');
        await conElConfigAplicado(page, idioma);
        await expect(page.locator('.ingreso-sub')).toHaveText(LEMA.conPagos[idioma], { useInnerText: true });
      });
    }
  });
}
