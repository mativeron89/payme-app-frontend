/**
 * ORDEN A · «seguí con tu autorización», desde donde la persona VUELVE.
 *
 * Lo medido antes de escribir el código: la referencia de retome **ya se
 * guardaba durable** (`localStorage`) y **ya existía** la salida que retoma la
 * garantía. El hueco era otro: **esa salida sólo se veía dentro del flujo de
 * crear mesa**. Quien abandonaba el 3DS y volvía a abrir la app aterrizaba en
 * Inicio, donde nada se lo decía — y para enterarse tenía que entrar a
 * «Nueva», la puerta equivocada: no quiere abrir otra mesa, quiere terminar
 * la que dejó.
 *
 * Este spec recorre exactamente eso: abandonar en 3DS, volver a Inicio, y
 * exigir que el aviso esté y lleve al retome.
 */
import { test, expect } from '@playwright/test';
import { ingresar } from './_app';

test('🔴 abandonar el 3DS y volver a Inicio: la app ofrece retomar', async ({ page }) => {
  await ingresar(page);

  // Inicio limpio: sin aperturas colgadas, el aviso NO existe. Sin esta
  // mitad, el test pasaría igual con un aviso pegado siempre.
  await expect(page.getByText(/Dejaste una autorización sin confirmar/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('radio', { name: /En partes iguales/ })).toBeVisible();
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();

  // Y acá la persona se va: cierra la app en pleno 3DS, sin confirmar.
  await page.goto('/');

  const aviso = page.getByText(/Dejaste una autorización sin confirmar/);
  await expect(aviso, 'Inicio no dice nada de la autorización que quedó colgada').toBeVisible();
  // El texto no puede invitar a abrir otra: sería un segundo hold por el total.
  await expect(page.getByText(/no abras otra mesa/)).toBeVisible();

  await aviso.click();
  // Lleva al flujo que sabe retomar esa garantía, no a una mesa nueva vacía.
  await expect(page.getByText(/apertura/i).first()).toBeVisible();
});
