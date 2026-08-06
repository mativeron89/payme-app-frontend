import { expect, test } from '@playwright/test';

/**
 * G-11 · EL CHECKBOX "GUARDAR ESTA TARJETA" NACE DESMARCADO (Mati, 2026-08-06).
 *
 * Un casillero marcado por defecto hace la promesa sin que la persona la
 * pida, y el backend hoy NO cumple `save_payment_method` en direct charges
 * (G-11, P0 de release). El recorrido es el del PAGADOR PRIMERIZO —cuenta
 * nueva, cero tarjetas, alcanzable desde el fix de la auditoría—, que es
 * exactamente donde el checkbox aparece.
 *
 * Se afirman las dos direcciones: nace desmarcado en LAS DOS superficies
 * (garantía y pago), y MARCARLO SIGUE FUNCIONANDO — un fix que desmarca puede
 * desmarcar de más, y sin la segunda mitad nadie se entera hasta que la
 * función desaparece de la demo.
 */

test('nace desmarcado en garantía y en pago, y marcarlo sigue guardando', async ({ page }) => {
  // Cuenta nueva: nace sin tarjetas (el camino primerizo real).
  await page.goto('/');
  await page.getByRole('button', { name: /Registrate/ }).click();
  await page.getByPlaceholder('Nombre').fill('Primeriza');
  await page.getByPlaceholder('Apellido').fill('SinTarjeta');
  await page.getByPlaceholder('Email').fill('primeriza-e2e@demo.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

  // Abrir mesa hasta la garantía. El stepper de §1.4 nace sin elegir: se
  // eligen 2 comensales a mano (ya no existe el 4 por defecto).
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  // SUPERFICIE 1 · garantía: el checkbox existe y NACE DESMARCADO.
  await expect(page.getByText('Garantizá la mesa')).toBeVisible();
  const checkGarantia = page.getByRole('checkbox');
  await expect(checkGarantia).toBeVisible();
  await expect(checkGarantia).not.toBeChecked();

  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await page.getByRole('button', { name: 'Confirmar autorización', exact: true }).click();
  await page.getByRole('button', { name: 'Ver mesa', exact: true }).click();

  // Tomar un ítem y llegar al pago.
  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();

  // SUPERFICIE 2 · pago: también nace desmarcado.
  const checkPago = page.getByRole('checkbox');
  await expect(checkPago).toBeVisible();
  await expect(checkPago).not.toBeChecked();

  // DIRECCIÓN CONTRARIA: marcarlo sigue funcionando — quien lo elige, guarda.
  await checkPago.check();
  const propinas = page.getByRole('radiogroup', { name: /propina/i });
  await propinas.getByRole('radio', { name: '0%', exact: true }).click();
  await page.getByRole('button', { name: /^Pagar \$/ }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();

  await page.goto('/#/tarjetas');
  await expect(page.getByText('Agregar tarjeta')).toBeVisible();
  // La cuenta nació con CERO: la única guardada es la que se ELIGIÓ guardar.
  await expect(page.getByText(/···· \d{4}/).first()).toBeVisible();
});
