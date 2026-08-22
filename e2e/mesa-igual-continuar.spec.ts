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

  /**
   * 🔴 ESTE TEST AFIRMABA `toBeDisabled()` Y AHORA AFIRMA ALGO MÁS FUERTE.
   * Se cambia el MECANISMO, no la semántica que H-14 vino a proteger.
   *
   * `SISTEMA_DISENO.md` §5 bis · E (2026-08-21, adjudicado en `diseno@0206d44`)
   * retira el apagado del círculo **cuando lo que falta es un dato**, y lo
   * reemplaza por toast + scroll + pulso. Es el patrón que §1.4 (stepper) y
   * §1.5 bis (propina) ya ratificaban: *"no se envía nada"* con el botón
   * visualmente activo.
   *
   * ⚠️ LA MITAD QUE H-14 CUIDA NO SE MOVIÓ, y por eso este test se refuerza en
   * vez de aflojarse: en `consumo` la selección SIGUE determinando el monto y
   * SIGUE sin poderse avanzar sin ella. Lo que cambió es cómo se comunica.
   * `toBeDisabled()` probaba el mecanismo viejo; estas tres afirmaciones
   * prueban la CONDUCTA, que es lo que la auditoría quería fijar:
   *
   *   ① tocar sin elegir NO lleva al pago
   *   ② y explica por qué, en vez de no hacer nada
   *   ③ con un ítem elegido, sí lleva
   *
   * Si alguien "se pasa de alcance" y deja avanzar sin selección, ① cae — que
   * es exactamente lo que el centinela original detectaba.
   */
  test('consumo: sin elegir NO se avanza y se explica — ahí la selección ES el monto', async ({
    page,
  }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');

    await expect(page.getByText('Tagliatelle Bolognese')).toBeVisible();
    await expect(page.getByText('Elige lo que consumiste').first()).toBeVisible();

    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    // El círculo ya no nace apagado: §5 bis · E.
    await expect(continuar).toBeEnabled();
    await continuar.click();

    // ① no llegó al pago  ② lo dijo
    await expect(page.getByRole('heading', { name: 'Pagas SOLO tu parte' })).toHaveCount(0);
    await expect(page.getByText('Elige lo que consumiste para continuar')).toBeVisible();

    // ③ con un consumo elegido, el mismo control sí avanza.
    await page.getByText('Tagliatelle Bolognese').click();
    await continuar.click();
    await expect(page.getByRole('heading', { name: 'Pagas SOLO tu parte' })).toBeVisible();
  });
});
