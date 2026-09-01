import { expect, test } from '@playwright/test';
import { corteDePagosView } from '../src/api/releaseGates';

/**
 * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-04) · los recorridos que
 * necesitan el checkout o el alta de tarjeta DUERMEN mientras el gate esté
 * activo, y leen el MISMO gate que la app: cuando `pagosCortados` pase a
 * `false`, vuelven solos, sin editar este archivo. Nunca un skip con `true`
 * fijo: eso es evidencia que no vuelve. `src/corteGuard.test.ts` censa cada
 * uno de estos skips y pone la suite roja ante uno nuevo o permanente.
 */
const CORTE = corteDePagosView();
const MOTIVO = 'CORTE DEL VIERNES: el checkout del participante y el alta de tarjeta están cerrados en producción pública sin pagos; este recorrido vuelve solo cuando corteDePagosView().pagosCortados sea false.';

const SIGNUP_GUARDADA = 'signup-token-guardar-tarjeta-aaaa';
const SIGNUP_GARANTIA = 'signup-token-garantia-viva-ccccccc';
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

/**
 * 🔴 CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-04) · LA GARANTÍA SIGUE VIVA
 * y por eso su afirmación NO puede dormir con las de pago. Los dos recorridos
 * de abajo cubrían la superficie 1 (garantía) y la 2 (pago) en un solo test, y
 * al dormirlos por el corte se dormía también lo que el corte NO retira. Este
 * recorrido es la superficie 1 sola, ACTIVA: llega a «Garantiza la mesa» por
 * el camino primerizo y afirma que el checkbox existe y nace desmarcado. No
 * garantiza, no paga, no toca tarjetas guardadas.
 */
test('la garantía de #/scan sigue viva bajo el corte: el checkbox existe y nace desmarcado', async ({ page }) => {
  await page.goto(`/#/home?signup_invitation=${SIGNUP_GARANTIA}`);
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
  await page.getByPlaceholder('Nombre').fill('Primeriza');
  await page.getByPlaceholder('Apellido').fill('Garantia');
  await page.getByPlaceholder('Email').fill('primeriza-garantia@demo.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await expect(page.getByText('Garantiza la mesa')).toBeVisible();
  const checkGarantia = page.getByRole('checkbox');
  await expect(checkGarantia).toBeVisible();
  await expect(checkGarantia).not.toBeChecked();
});

test('nace desmarcado en garantía y en pago, y marcarlo sigue guardando', async ({ page }) => {
  test.skip(CORTE.pagosCortados, MOTIVO);
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
  await expect(page.getByText('Garantiza la mesa')).toBeVisible();
  const checkGarantia = page.getByRole('checkbox');
  await expect(checkGarantia).toBeVisible();
  await expect(checkGarantia).not.toBeChecked();

  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

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
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();

  await page.goto('/#/tarjetas');
  await expect(page.getByText('Agregar tarjeta')).toBeVisible();
  // La cuenta nació con CERO: la única guardada es la que se ELIGIÓ guardar.
  await expect(page.getByText(/···· \d{4}/).first()).toBeVisible();
});

test('sin marcar, la tarjeta NO aparece: el default es una decisión, no una decoración', async ({ page }) => {
  test.skip(CORTE.pagosCortados, MOTIVO);
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
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();

  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();

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
