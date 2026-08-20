import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * H-14 (auditoría 2026-08-06): EN PARTES IGUALES, MARCAR ES INFORMATIVO — Y EL
 * GATE LO DECÍA OBLIGATORIO.
 *
 * La pantalla de la mesa igual dice "Marcalo para el restaurante — no cambia
 * lo que pagás", y el gate viejo exigía seleccionar igual: copy y gate se
 * contradecían. El seed agravaba: PA-3121 tenía `items: []` —un estado
 * IMPOSIBLE en producción, `POST /mesas` exige `.min(1)`— y el Continuar
 * quedaba apagado PARA SIEMPRE: la persona no podía pagar su parte de $155.
 *
 * Las dos mitades se afirman a propósito, porque el fix tenía alcance exacto:
 * en `igual` el gate NO exige selección; en `consumo` la selección SÍ
 * determina el monto y el gate NO se toca. Si la segunda mitad cae, el fix se
 * pasó de alcance.
 */

test.describe('Continuar en la mesa (H-14)', () => {
  test('partes iguales: sin marcar nada se llega al pago y se paga la parte', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-3121');

    // La mesa igual del seed ahora tiene ítems reales (el contrato los exige).
    await expect(page.getByText('Omakase para dos')).toBeVisible();

    // Sin tocar ningún ítem: la fila ya dice "Mi parte" con el casillero.
    await expect(page.getByText('Mi parte')).toBeVisible();
    await expect(page.getByText('$155.00').first()).toBeVisible();

    // Continuar habilitado SIN selección — el gate viejo lo apagaba.
    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    await expect(continuar).toBeEnabled();
    await continuar.click();

    await expect(page.getByRole('heading', { name: 'Pagas SOLO tu parte' })).toBeVisible();
    const propinas = page.getByRole('radiogroup', { name: /propina/i });
    await propinas.getByRole('radio', { name: '0%', exact: true }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await expect(page.getByText('¡Listo!')).toBeVisible();
  });

  test('consumo: sin elegir, Continuar sigue deshabilitado — ahí la selección ES el monto', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');

    await expect(page.getByText('Tagliatelle Bolognese')).toBeVisible();
    await expect(page.getByText('Elige lo que consumiste').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
  });
});
