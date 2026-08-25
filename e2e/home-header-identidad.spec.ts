import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * Decisión directa de Mati · 2026-08-23.
 *
 * Inicio usa el nombre completo editable de la sesión en la ranura de
 * identidad. La ranura, la campana y las pestañas ya existían: esta regresión
 * protege que cambiar el dato no altere esa composición ni vuelva a mostrar
 * el `payme_id` propio.
 */
for (const width of [320, 390, 480]) {
  test(`Home muestra nombre completo sin solapar su header a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await ingresar(page);
    // El helper entra con un email libre y el mock sólo deriva el nombre de
    // pila. Esta fixture completa la misma sesión persistida para acreditar el
    // contrato visual (nombre + apellido) y el camino de reload, sin cambiar
    // la semántica general del mock.
    await page.evaluate(() => {
      const key = 'payme_app_session__mock';
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error('sesión mock ausente');
      const session = JSON.parse(raw) as { user?: { first_name?: string; last_name?: string } };
      if (!session.user) throw new Error('usuario mock ausente');
      session.user.first_name = 'Mati';
      session.user.last_name = 'Verón';
      localStorage.setItem(key, JSON.stringify(session));
    });
    await page.reload();

    const header = page.locator('.hdr-row').first();
    const marca = header.locator('.hdr-mark');
    const identidad = header.locator('.hdr-user');
    const avisos = page.getByRole('button', { name: 'Avisos', exact: true });

    await expect(identidad).toHaveText('Mati Verón');
    await expect(identidad).not.toContainText('payme_mx_mati');
    await expect(header.locator('.hdr-id')).toHaveCount(0);
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
