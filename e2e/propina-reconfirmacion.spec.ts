import { expect, test } from '@playwright/test';
import { ingresar, CORTE } from './_app';

/**
 * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-04) · los recorridos que
 * necesitan el checkout o el alta de tarjeta DUERMEN mientras el gate esté
 * activo, y leen el MISMO gate que la app: el `CORTE` de `_app.ts` sale del
 * decoder de produccion sobre la fuente que el mock sirve, asi que cuando el
 * dueno habilite los pagos vuelven solos, sin editar este archivo. Nunca un skip con `true`
 * fijo: eso es evidencia que no vuelve. `src/corteGuard.test.ts` censa cada
 * uno de estos skips y pone la suite roja ante uno nuevo o permanente.
 */
const MOTIVO = 'CORTE DEL VIERNES: el checkout del participante y el alta de tarjeta están cerrados en producción pública sin pagos; este recorrido vuelve solo cuando el dueño publique los pagos habilitados en money_rail.';

/**
 * §1.5 bis (2026-08-06) · PROPINA > 3× LA BASE: SE RECONFIRMA, NUNCA SE BLOQUEA.
 *
 * El umbral es RELATIVO (3× el `tip_base_cents` que el emisor ya publica) y el
 * diálogo muestra el monto exacto + la comparación — nunca un "¿estás seguro?"
 * genérico. Dos salidas, y las dos se afirman:
 * - "Volver a editar": foco al selector y el VALOR TIPEADO INTACTO — un fix
 *   que limpia el input le hace re-tipear la cifra a quien quizá la quería.
 * - "Sí, pagar": la salida hacia adelante que el acta exige. Si alguien
 *   quiere dejar una propina enorme a propósito, puede.
 *
 * La mesa es PA-2847 del seed (consumo, $840 ÷ 4 → base $210): el umbral es
 * $630. Se paga con $700 — desmedida — y de paso queda afirmado que 3× exacto
 * NO dispara (unit test del view; acá el borde vivo es el flujo).
 */

test('la propina desmedida pide reconfirmar: editar conserva el valor, y "Sí, pagar" paga', async ({ page }) => {
  test.skip(CORTE.pagosCortados, MOTIVO);
  await ingresar(page);
  await page.goto('/#/mesa/PA-2847');

  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();

  // Propina a mano: $700 > 3 × $210 = $630.
  const propinas = page.getByRole('radiogroup', { name: /propina/i });
  await propinas.getByRole('radio', { name: 'Otro', exact: true }).click();
  await page.getByLabel('Monto de propina a mano').fill('700');
  await expect(page.getByText('$895.00', { exact: true }).first()).toBeVisible();

  // Pagar → NO paga: reconfirma con el monto exacto y la comparación.
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  const dialogo = page.getByRole('alertdialog', { name: 'Confirmar propina' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo).toContainText('Tu propina: $700.00');
  await expect(dialogo).toContainText('3 veces la base de $210.00');

  // Salida 1: volver a editar — el diálogo se va y el valor sigue ahí.
  await dialogo.getByRole('button', { name: 'Volver a editar' }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByLabel('Monto de propina a mano')).toHaveValue('700');

  // Pagar de nuevo → reconfirma de nuevo (editar no fue un "sí").
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(dialogo).toBeVisible();

  // Salida 2: "Sí, pagar" — la salida hacia adelante. Paga de una, sin
  // tercer toque.
  await dialogo.getByRole('button', { name: 'Sí, pagar' }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();
  await expect(page.getByText('$700.00')).toBeVisible();
  await expect(page.getByText('Total pagado')).toBeVisible();
});
