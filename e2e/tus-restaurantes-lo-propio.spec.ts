import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-STATS-LO-PROPIO · lo que reportó Mati: «Dice o partes iguales o por consumo
 * pero no me dice qué consumi yo, esta el ticket entero».
 *
 * El toque en la visita sólo despliega o repliega lo propio. D479/D482 · el
 * ticket completo ya no es un modal: «+ Ver todo el ticket» lo agrega dentro de
 * la misma tarjeta y «− Solo lo mío» lo saca (Claude Design 0.261, 1p).
 */

async function preparar(page: Page, idioma?: 'en'): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  // El idioma, después del ingreso: el login en inglés tiene otros rótulos.
  if (idioma) await page.evaluate((i) => localStorage.setItem('payme.app.idioma.v1', i), idioma);
  await page.goto('/restaurantes');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const tarjeta = (page: Page, nombre: string) => page.getByRole('region', { name: nombre, exact: true });

test.describe('AF-STATS-LO-PROPIO · el toque muestra lo propio; el ticket completo va aparte', () => {
  test('tocar la visita despliega lo propio, sin modal; «Ver todo el ticket» lo agrega en la tarjeta', async ({ page }) => {
    await preparar(page);
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    const fila = visita.locator('.rest-visita-fila');

    // La fila despliega: aria-expanded, y NO anuncia un diálogo.
    await expect(fila).toHaveAttribute('aria-expanded', 'false');
    await expect(fila).not.toHaveAttribute('aria-haspopup', /.*/);
    await fila.click();
    await expect(fila).toHaveAttribute('aria-expanded', 'true');

    // Lo propio, con la porción delante del nombre; y ningún modal encima.
    const propio = visita.locator('.est-consumo.mio');
    await expect(propio).toHaveCount(3);
    await expect(propio.nth(1)).toHaveText(/^½Tiramisú\$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await capturar(page, 'lo-propio-01-visita-abierta');

    // El botón despliega el ticket en la misma tarjeta: tampoco es un diálogo.
    const boton = visita.locator('.est-ticket-boton');
    await expect(boton).toHaveText('Ver todo el ticket');
    await expect(boton).not.toHaveAttribute('aria-haspopup', /.*/);
    await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
    await expect(boton).toHaveText('Solo lo mío');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(propio).toHaveCount(3);
    await capturar(page, 'lo-propio-02-ticket-completo');
    await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await expect(boton).toBeFocused();

    // Un segundo toque en la fila repliega lo propio, y tampoco abre nada.
    await fila.click();
    await expect(fila).toHaveAttribute('aria-expanded', 'false');
    await expect(visita.locator('.est-consumo')).toHaveCount(0);
    await expect(boton).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('abrir otra visita cierra la anterior: se abren de a una', async ({ page }) => {
    await preparar(page);
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visitas = parolaccia.locator('.rest-visita');
    await visitas.nth(0).locator('.rest-visita-fila').click();
    await expect(visitas.nth(0).locator('.est-consumo.mio').first()).toBeVisible();
    await visitas.nth(1).locator('.rest-visita-fila').click();
    await expect(visitas.nth(1).locator('.est-consumo.mio').first()).toBeVisible();
    await expect(visitas.nth(0).locator('.est-consumo')).toHaveCount(0);
    await expect(parolaccia.locator('.est-ticket-boton')).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  // D481 · en inglés «ticket» es siempre «receipt».
  test('en inglés el botón dice «See the full receipt»', async ({ page }) => {
    await preparar(page, 'en');
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    await parolaccia.locator('.rest-visita-fila').first().click();
    await expect(parolaccia.getByRole('button', { name: 'See the full receipt', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
