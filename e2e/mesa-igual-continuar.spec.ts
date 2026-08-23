import { expect, test } from '@playwright/test';
import { ingresar } from './_app';
import { espiarScroll, leerScrolls } from './_senales';

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

    await expect(page.getByRole('heading', { name: 'Pagas solo tu parte' })).toBeVisible();
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
   * 🔴 **CORREGIDO TRAS EL BLOCK DEL P62 — la descripción de arriba atribuía al
   * mutante un alcance que NO tiene, y la corrección es el punto 3 del cierre
   * mínimo de Codex.**
   *
   * El mutante `if (false && faltaElegirConsumos)` **no reproduce la pérdida
   * del no-avance**: `MesaScreen.goToPay` conserva un corte duro propio
   * —`selected.size === 0 → return`, `MesaScreen.tsx:569`— así que la vista
   * puede llamar al owner y el owner igual frena. Este test queda rojo con ese
   * mutante **porque desaparece el TOAST**, no porque se pierda la semántica.
   *
   * **Lo que el mutante acredita es la rama de FEEDBACK.** El no-avance está
   * defendido por dos capas y la de abajo no depende de ésta — que es una buena
   * noticia de diseño y una mala noticia para quien quiera usar este mutante
   * como prueba de la semántica. Se dice acá para que nadie vuelva a leerlo
   * como lo leí yo.
   *
   * ## Las TRES señales se afirman por separado
   *
   * §5 bis · E exige toast + scroll + pulso JUNTOS. Codex mató tres mutantes
   * individuales contra la versión anterior de este test —borrar el scroll,
   * borrar el pulso, borrar el `return`— y quedó **verde en los tres**: miraba
   * sólo el toast. Ahora cada señal tiene su aserción, con los espías de
   * `_senales.ts` (el scroll no deja rastro en el DOM y el pulso se apaga solo).
   */
  test('consumo: sin elegir NO se avanza y se explica con las TRES señales', async ({ page }) => {
    await espiarScroll(page);
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');

    await expect(page.getByText('Tagliatelle Bolognese')).toBeVisible();
    await expect(page.getByText('Elige lo que consumiste').first()).toBeVisible();

    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    // El círculo ya no nace apagado: §5 bis · E.
    await expect(continuar).toBeEnabled();
    await continuar.click();

    // ① señal 2 de 3 · se mide en cuanto responde el click, antes de que
    // `animationend` retire deliberadamente esta clase transitoria.
    await expect(page.locator('.tk-fold--pending')).toHaveClass(/tk-fold--pulse/);

    // ② no llegó al pago
    await expect(page.getByRole('heading', { name: 'Pagas solo tu parte' })).toHaveCount(0);
    // ③ señal 1 de 3 · el toast
    await expect(page.getByText('Elige lo que consumiste para continuar')).toBeVisible();

    // ④ señal 3 de 3 · el scroll, que no deja rastro y por eso lleva espía
    const vistas = await leerScrolls(page);
    expect(
      vistas.scrolls.some((c) => c.includes('tk-fold--pending')),
      `no se scrolleó a la lista de consumos · scrolls vistos: ${vistas.scrolls.join(' · ')}`,
    ).toBe(true);

    // ⑤ con un consumo elegido, el mismo control sí avanza.
    await page.getByText('Tagliatelle Bolognese').click();
    await continuar.click();
    await expect(page.getByRole('heading', { name: 'Pagas solo tu parte' })).toBeVisible();
  });
});
