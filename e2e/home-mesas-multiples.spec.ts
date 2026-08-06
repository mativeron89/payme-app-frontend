import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * §1.1 · VARIANTE B (corrección del 2026-08-05): CON VARIAS MESAS ABIERTAS,
 * NINGUNA DESAPARECE.
 *
 * El defecto que esto mata: `HomeScreen` leía `mesas[0]` sobre la premisa
 * caduca "nunca hay más de una" — G-28 la invalidó (participante también ve
 * su mesa) y, como §1.10 dejó a "Mesas" como historial de CERRADAS, la mesa
 * que no entraba en la tarjeta no existía en NINGUNA superficie.
 *
 * El seed trae dos abiertas con relojes distintos a propósito del criterio:
 * PA-3121 (Hanzo Sushi) vence en ~12 min y PA-2847 (La Parolaccia) en ~29.
 * La protagonista es la del reloj MÁS CORTO — antes de esta corrección la
 * tarjeta mostraba PA-2847 por orden de payload, que era el criterio
 * equivocado en silencio.
 */

test.describe('Inicio · varias mesas abiertas (§1.1 variante B)', () => {
  test('la protagonista es la que vence antes, y "+1 mesa abierta más" lleva a la otra', async ({ page }) => {
    await ingresar(page);

    // La tarjeta es la de vencimiento más próximo, no la primera del payload.
    const tarjeta = page.getByRole('button', { name: /Tu mesa abierta/ });
    await expect(tarjeta).toContainText('Hanzo Sushi');
    await expect(tarjeta).toContainText('Mesa PA-3121');

    // Badge de honestidad: describe a la mesa, no acusa a quien mira.
    await expect(tarjeta).toContainText('Pago en curso');
    await expect(page.getByText('Falta pagar')).toHaveCount(0);

    // La fila nueva, en singular: hay exactamente UNA más.
    const fila = page.getByRole('button', { name: '+1 mesa abierta más' });
    await expect(fila).toBeVisible();
    await fila.click();

    // La hoja lista a la otra con restaurante, código, progreso y reloj.
    const hoja = page.getByRole('dialog', { name: 'Mesas abiertas' });
    await expect(hoja).toBeVisible();
    const filaOtra = hoja.getByRole('button', { name: /La Parolaccia/ });
    await expect(filaOtra).toContainText('Mesa PA-2847');
    await expect(filaOtra).toContainText('Vence en');

    // Tocar la fila entra a ESA mesa.
    await filaOtra.click();
    await expect(page).toHaveURL(/#\/mesa\/PA-2847/);
    await expect(page.getByText('La Parolaccia')).toBeVisible();
  });

  test('con UNA sola abierta la fila no existe y la tarjeta queda como siempre', async ({ page }) => {
    await ingresar(page);

    // Se cierra PA-3121 en el estado del mock: queda una sola abierta.
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      st.mesas.find((m: { code: string }) => m.code === 'PA-3121').status = 'completed';
      localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
    });
    await page.reload();

    // Control positivo primero: la tarjeta clásica está, con la que quedó.
    const tarjeta = page.getByRole('button', { name: /Tu mesa abierta/ });
    await expect(tarjeta).toContainText('La Parolaccia');
    await expect(tarjeta).toContainText('Mesa PA-2847');

    // La condición de Diseño: con una sola mesa, cero cambio — la fila y la
    // hoja no existen. Se afirma la ausencia a propósito.
    await expect(page.getByRole('button', { name: /mesas? abiertas? más/ })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Mesas abiertas' })).toHaveCount(0);
  });
});
