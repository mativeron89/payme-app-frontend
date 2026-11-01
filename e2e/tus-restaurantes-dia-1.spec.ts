import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * «Tus restaurantes» en las primeras horas del día 1, hora de México (00:30 de México = 06:30Z). Hasta 0.275.0 las
 * visitas del mes del mock se amontonaban al inicio del mes en el orden contrario y la más nueva dejaba de ser la
 * primera: `tus-restaurantes`, `-lo-propio` y `-burbuja-centrada` salían rojos las primeras horas de cada mes (medido
 * el 2026-11-01). Con el reloj fijo, el caso se reproduce a cualquier hora.
 */
for (const iso of ['2026-11-01T06:30:00Z', '2026-11-01T09:00:00Z']) {
  test(`🔴 ${iso} · la visita más nueva de La Parolaccia es la primera, con lo propio a medias`, async ({ page }) => {
    await page.clock.setFixedTime(new Date(iso));
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await page.goto('/restaurantes');
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia', exact: true });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.locator('.rest-visita-fila').click();
    await expect(visita.locator('.est-consumo.mio').nth(1)).toHaveText(/^½Tiramisú\$/);
  });
}
