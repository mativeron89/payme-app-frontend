import { expect, test } from '@playwright/test';

const SIGNUP_GUARDADA = 'signup-token-guardar-tarjeta-aaaa';
const SIGNUP_SIN_GUARDAR = 'signup-token-no-guardar-bbbbbbb';

/**
 * G-11 · EL CHECKBOX NACE DESMARCADO (Mati, 2026-08-06) — Y DESDE EL CIERRE
 * DE G-11 (backend v2.46.0, `7e45db0`, 2026-08-06), MARCARLO GUARDA DE
 * VERDAD también bajo direct charge.
 *
 * La decisión del default sobrevive al cierre: un casillero marcado por
 * defecto hace la promesa sin que la persona la pida — eso era cierto cuando
 * el riel la incumplía y sigue siéndolo ahora que la cumple. El recorrido es
 * el del PAGADOR PRIMERIZO —cuenta nueva, cero tarjetas—, que es exactamente
 * donde el checkbox aparece.
 *
 * Tres direcciones afirmadas: nace desmarcado en LAS DOS superficies;
 * MARCARLO guarda (la tarjeta aparece en Mis tarjetas — opt-in que deja de
 * mentir); y SIN MARCAR no aparece — la que convierte el default en una
 * decisión real y no en una decoración.
 */

test('nace desmarcado en garantía y en pago, y marcarlo sigue guardando', async ({ page }) => {
  // Cuenta nueva invitada: nace sin tarjetas (el camino primerizo F&F real).
  await page.goto(`/#/home?signup_invitation=${SIGNUP_GUARDADA}`);
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
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
  await expect(page.getByText('Garantía de la mesa')).toBeVisible();
  const checkGarantia = page.getByRole('checkbox');
  await expect(checkGarantia).toBeVisible();
  await expect(checkGarantia).not.toBeChecked();

  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await page.getByRole('button', { name: 'Confirmar autorización', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir mis ítems', exact: true }).click();

  // Tomar un ítem y llegar al pago.
  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagas SOLO tu parte' })).toBeVisible();

  // SUPERFICIE 2 · pago: también nace desmarcado.
  const checkPago = page.getByRole('checkbox');
  await expect(checkPago).toBeVisible();
  await expect(checkPago).not.toBeChecked();

  // DIRECCIÓN CONTRARIA: marcarlo sigue funcionando — quien lo elige, guarda.
  await checkPago.check();
  const propinas = page.getByRole('radiogroup', { name: /propina/i });
  await propinas.getByRole('radio', { name: '0%', exact: true }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();

  await page.goto('/#/tarjetas');
  await expect(page.getByText('Agregar tarjeta')).toBeVisible();
  // La cuenta nació con CERO: la única guardada es la que se ELIGIÓ guardar.
  await expect(page.getByText(/···· \d{4}/).first()).toBeVisible();
});

test('sin marcar, la tarjeta NO aparece: el default es una decisión, no una decoración', async ({ page }) => {
  // Mismo recorrido primerizo invitado, checkbox intacto en las dos superficies.
  await page.goto(`/#/home?signup_invitation=${SIGNUP_SIN_GUARDAR}`);
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Nombre').fill('Primeriza');
  await page.getByPlaceholder('Apellido').fill('SinGuardar');
  await page.getByPlaceholder('Email').fill('primeriza-negativa@demo.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await page.getByRole('button', { name: 'Confirmar autorización', exact: true }).click();
  await page.getByRole('button', { name: 'Elegir mis ítems', exact: true }).click();

  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagas SOLO tu parte' })).toBeVisible();

  // Sin tocar el checkbox: paga y listo.
  const propinas = page.getByRole('radiogroup', { name: /propina/i });
  await propinas.getByRole('radio', { name: '0%', exact: true }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();

  // Mis tarjetas: VACÍO. Ni la garantía ni el pago guardaron lo no pedido.
  await page.goto('/#/tarjetas');
  await expect(page.getByText('Agregar tarjeta')).toBeVisible();
  await expect(page.getByText(/···· \d{4}/)).toHaveCount(0);
});
