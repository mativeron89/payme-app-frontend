import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * LA COMA ×100, EN EL INPUT REAL (ORDEN 2-A.3).
 *
 * El fix de v0.51.0 vive en `sanearMontoPropio` y sus tests unitarios anclan
 * el monto — pero Codex midió el hueco exacto de esa cobertura: *"desconectar
 * el saneador de la UI podría dejar Vitest verde"*. El unit test prueba la
 * función; nadie probaba que EL INPUT la llame. Este spec tipea la coma en el
 * campo de verdad y observa los centavos de verdad: si alguien cambia el
 * `onChange` por un saneo propio (que es exactamente cómo nació el bug), esto
 * cobra $1,429.00 y cae.
 */
test('tipear "12,34" en el input real deja 1234 centavos, no 123400', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/mesa/PA-2847');

  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagas SOLO tu parte' })).toBeVisible();

  const propinas = page.getByRole('radiogroup', { name: /propina/i });
  await propinas.getByRole('radio', { name: 'Otro', exact: true }).click();

  const input = page.getByLabel('Monto de propina a mano');
  // pressSequentially, no fill: la coma tiene que pasar POR el onChange,
  // tecla a tecla, como la tipea una persona.
  await input.pressSequentially('12,34');

  // El input muestra la normalización y el CTA cobra $195 + $12.34.
  await expect(input).toHaveValue('12.34');
  await expect(page.getByText('$207.34', { exact: true }).first()).toBeVisible();
  // La afirmación directa del defecto viejo: el ×100 no existe en pantalla.
  await expect(page.getByText('$1,429.00', { exact: true })).toHaveCount(0);

  // Y la plata cuadra hasta el comprobante.
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();
  await expect(page.getByText('$12.34')).toBeVisible();
  await expect(page.getByText('$207.34')).toBeVisible();
});
