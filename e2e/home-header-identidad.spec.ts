import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * Decisión directa de Mati · 2026-08-23.
 *
 * Inicio usa el `payme_id` de la sesión en la ranura de identidad. La ranura,
 * la campana y las pestañas ya existían: esta regresión protege que cambiar el
 * dato no altere esa composición ni vuelva a mostrar el nombre completo.
 */
for (const width of [320, 390, 480]) {
  test(`Home muestra payme_id sin solapar su header a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await ingresar(page);

    const header = page.locator('.hdr-row').first();
    const marca = header.locator('.hdr-mark');
    const identidad = header.locator('.hdr-user');
    const avisos = page.getByRole('button', { name: 'Avisos', exact: true });

    await expect(identidad).toHaveText('payme_mx_mati');
    await expect(identidad).not.toHaveText('Mati');
    await expect(avisos).toBeVisible();
    await expect(header.locator('.hdr-badge')).toHaveText('1');
    await expect(page.getByRole('tab', { name: 'Cuenta', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Estadísticas', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toBeVisible();

    const [headerBox, marcaBox, identidadBox, avisosBox] = await Promise.all([
      header.boundingBox(),
      marca.boundingBox(),
      identidad.boundingBox(),
      avisos.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(marcaBox).not.toBeNull();
    expect(identidadBox).not.toBeNull();
    expect(avisosBox).not.toBeNull();
    expect(identidadBox!.x).toBeGreaterThanOrEqual(marcaBox!.x + marcaBox!.width);
    expect(identidadBox!.x + identidadBox!.width).toBeLessThanOrEqual(avisosBox!.x);
    expect(avisosBox!.x + avisosBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width);

    await expect(identidad).toHaveCSS('overflow', 'hidden');
    await expect(identidad).toHaveCSS('text-overflow', 'ellipsis');
    await expect(identidad).toHaveCSS('white-space', 'nowrap');
  });
}
