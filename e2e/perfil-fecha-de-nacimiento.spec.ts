import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * n219 · M03 · el guardado de la fecha de nacimiento en «Más», recorrido por la
 * FACHADA del mock (`api.declareBirthDate` → `mockDeclareBirthDate`).
 *
 * Por qué e2e y no sólo unidad: en 75fdcff la fachada mock pasaba la respuesta
 * por el decodificador estricto del perfil, y el usuario de la demo trae claves
 * de más. En el navegador el guardado fallaba con «No pudimos guardar…»; la
 * suite unitaria llamaba al mock directo y no lo vio. Este spec recorre el
 * camino que usa la persona: campo → «Guardar fecha» → fachada → mock.
 */

async function fechaEnElMock(page: Page): Promise<{ birth_date: unknown; birth_date_set: unknown }> {
  return page.evaluate(async () => {
    const p = '/src/api/mock/store.ts';
    const s = await import(/* @vite-ignore */ p) as { state: { user: Record<string, unknown> } };
    return { birth_date: s.state.user.birth_date ?? null, birth_date_set: s.state.user.birth_date_set ?? null };
  });
}

test.describe('n219 · «Fecha de nacimiento» en el perfil, una sola vez', () => {
  test('se guarda por la fachada, el campo desaparece y no vuelve al recargar', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    const campo = page.getByLabel('Fecha de nacimiento');
    await expect(campo).toBeVisible();
    expect((await fechaEnElMock(page)).birth_date).toBeNull();

    await campo.fill('1990-05-10');
    await page.getByRole('button', { name: 'Guardar fecha', exact: true }).click();

    // 🔴 El testigo del defecto de 75fdcff: el aviso de éxito, NO el de error.
    await expect(page.getByText('Fecha de nacimiento guardada ✓')).toBeVisible();
    await expect(page.getByText('No pudimos guardar tu fecha de nacimiento.')).toHaveCount(0);
    expect(await fechaEnElMock(page)).toEqual({ birth_date: '1990-05-10', birth_date_set: true });

    // Write-once: el campo se va, y nunca se muestra la fecha ni una edad.
    await expect(page.getByLabel('Fecha de nacimiento')).toHaveCount(0);
    await expect(page.getByText('1990')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    await expect(page.getByText('payme_mx_mati')).toBeVisible();
    await expect(page.getByLabel('Fecha de nacimiento')).toHaveCount(0);
  });

  test('sin elegir fecha no manda nada y lo dice', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    await page.getByRole('button', { name: 'Guardar fecha', exact: true }).click();
    await expect(page.getByText('Elige tu fecha de nacimiento.')).toBeVisible();
    await expect(page.getByLabel('Fecha de nacimiento')).toBeVisible();
    expect((await fechaEnElMock(page)).birth_date).toBeNull();
  });
});
