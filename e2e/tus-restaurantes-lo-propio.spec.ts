import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-STATS-LO-PROPIO · lo que reportó Mati: «Dice o partes iguales o por consumo
 * pero no me dice qué consumi yo, esta el ticket entero».
 *
 * La causa: tocar una visita desplegaba lo propio Y abría el ticket completo en
 * el mismo toque, y el modal lo tapaba. Ahora el toque sólo despliega o repliega
 * lo propio, y el ticket completo tiene su botón, «Ver ticket completo».
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
const TICKET = 'Detalle digital del ticket';

test.describe('AF-STATS-LO-PROPIO · el toque muestra lo propio; el ticket completo va aparte', () => {
  test('tocar la visita despliega lo propio, sin modal; el botón abre el ticket completo', async ({ page }) => {
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

    // Lo propio, con la porción; y ningún modal encima.
    const propio = visita.locator('.rest-items');
    await expect(propio).toBeVisible();
    await expect(propio.locator('.rest-item')).toHaveCount(3);
    await expect(propio.locator('.rest-item').nth(1)).toHaveText(/^½Tiramisú\$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await capturar(page, 'lo-propio-01-visita-abierta');

    // El botón aparte sí anuncia el diálogo y abre el ticket completo.
    const boton = visita.getByRole('button', { name: 'Ver ticket completo', exact: true });
    await expect(boton).toHaveAttribute('aria-haspopup', 'dialog');
    await boton.click();
    const dialog = page.getByRole('dialog', { name: TICKET });
    await expect(dialog).toContainText('Total del ticket');
    await expect(dialog.locator('.ticket-digital-items li')).not.toHaveCount(0);
    await capturar(page, 'lo-propio-02-ticket-completo');
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(boton).toBeFocused();
    // Lo propio sigue desplegado al volver.
    await expect(propio).toBeVisible();

    // Un segundo toque en la fila repliega lo propio, y tampoco abre nada.
    await fila.click();
    await expect(fila).toHaveAttribute('aria-expanded', 'false');
    await expect(visita.locator('.rest-items')).toHaveCount(0);
    await expect(boton).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('abrir otra visita cierra la anterior: se abren de a una', async ({ page }) => {
    await preparar(page);
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visitas = parolaccia.locator('.rest-visita');
    await visitas.nth(0).locator('.rest-visita-fila').click();
    await expect(visitas.nth(0).locator('.rest-items')).toBeVisible();
    await visitas.nth(1).locator('.rest-visita-fila').click();
    await expect(visitas.nth(1).locator('.rest-items')).toBeVisible();
    await expect(visitas.nth(0).locator('.rest-items')).toHaveCount(0);
    await expect(parolaccia.getByRole('button', { name: 'Ver ticket completo', exact: true })).toHaveCount(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('en inglés el botón dice «See full ticket»', async ({ page }) => {
    await preparar(page, 'en');
    const parolaccia = tarjeta(page, 'La Parolaccia');
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    await parolaccia.locator('.rest-visita-fila').first().click();
    await expect(parolaccia.getByRole('button', { name: 'See full ticket', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
