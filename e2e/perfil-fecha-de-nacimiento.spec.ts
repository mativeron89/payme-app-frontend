import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * n219 dejó el campo «Fecha de nacimiento» en el perfil, una sola vez.
 * LEGAL-3.0.0 (AF2, decisión 39) lo RETIRA: la mayoría de edad se declara al
 * aceptar el paquete legal y el dueño deja de leer la fecha. Esta prueba afirma
 * la ausencia —que el campo no vuelva por un merge— y que nada escribe la fecha.
 */
async function fechaEnElMock(page: Page): Promise<{ birth_date: unknown; birth_date_set: unknown }> {
  return page.evaluate(async () => {
    const p = '/src/api/mock/store.ts';
    const s = await import(/* @vite-ignore */ p) as { state: { user: Record<string, unknown> } };
    return { birth_date: s.state.user.birth_date ?? null, birth_date_set: s.state.user.birth_date_set ?? null };
  });
}

test.describe('M03 · sin «Fecha de nacimiento» en el perfil (LEGAL-3.0.0)', () => {
  test('el perfil no ofrece el campo ni la nota de menor, y la fecha del mock no se toca', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    await expect(page.getByLabel('Fecha de nacimiento')).toHaveCount(0);
    await expect(page.getByText('Guardar fecha', { exact: true })).toHaveCount(0);
    await expect(page.getByText('no mostramos tu foto a nadie más')).toHaveCount(0);
    expect((await fechaEnElMock(page)).birth_date).toBeNull();
    await page.reload();
    await expect(page.getByLabel('Fecha de nacimiento')).toHaveCount(0);
    expect((await fechaEnElMock(page)).birth_date).toBeNull();
  });
});
