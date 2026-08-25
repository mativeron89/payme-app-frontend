/**
 * §1.3-bis · Ticket y División fusionadas, ratificada por Mati el 2026-08-20.
 *
 * Lo que se prueba acá es lo que NO se puede probar sin navegador: que las tres
 * formas conviven en una pantalla, que el ticket nace plegado y se abre, y que
 * «Pagar el total» **viaja como `igual`** — el mapeo al contrato medido contra
 * el request real, no contra el estado de React.
 */
import { test, expect } from '@playwright/test';
import { ingresar } from './_app';

async function hastaLaPantallaFusionada(page: import('@playwright/test').Page) {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

test('las tres formas y el ticket viven en UNA pantalla, SIN contador de paso', async ({ page }) => {
  await hastaLaPantallaFusionada(page);

  await expect(page.getByText('¿Cómo dividen?')).toBeVisible();
  for (const forma of ['Por lo que pidió cada uno', 'En partes iguales', 'Pagar el total']) {
    await expect(page.getByRole('radio', { name: new RegExp(forma) })).toBeVisible();
  }
  // El ticket está en la MISMA pantalla, y su total también.
  await expect(page.getByText('La Parolaccia · Roma Norte, CDMX')).toBeVisible();

  /**
   * 🔴 ESTE TEST EXIGÍA VER «Paso 2 de 4», Y AHORA EXIGE LO CONTRARIO.
   * SISTEMA_DISENO.md §5 bis · E (2026-08-21) elimina los contadores de toda la
   * app: el motivo escrito es que el conteo ya se había desincronizado a mano
   * con la fusión que este mismo archivo prueba, y que mantenerlo no vale la
   * pena. No se afloja la afirmación a `toHaveCount(0)` sobre un texto puntual:
   * se barre CUALQUIER «Paso N de M», que es lo que impide que vuelva con otro
   * número — que es exactamente cómo se rompió la primera vez.
   */
  await expect(page.getByText(/Paso \d+ de \d+/)).toHaveCount(0);
});

test('🔴 el ticket nace PLEGADO y se abre con sus consumos', async ({ page }) => {
  await hastaLaPantallaFusionada(page);

  /**
   * 🔴 «EL TICKET SUBE» (§1.3-bis, 2026-08-21) partió esto en dos lugares, y el
   * test tiene que mirar los dos o deja de probar lo que dice el título.
   *
   * El TOTAL ya no vive en el bloque plegado: subió a la tarjeta de título. El
   * bloque de abajo es ahora el ACCESO —«Ver el ticket»— con el conteo de
   * consumos como subtítulo. §5 bis · F lo pide así: *un dato, un lugar*.
   */
  // Plegado: el total se ve ARRIBA, el acceso abajo, el detalle no.
  await expect(page.getByText('La Parolaccia · Roma Norte, CDMX')).toBeVisible();
  await expect(page.getByText(/\d+ consumos, uno por uno/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toHaveCount(0);

  // Y el monto NO se repite: aparece una sola vez en toda la pantalla.
  await expect(page.getByText('$840.00')).toHaveCount(1);

  await page.getByRole('button', { name: /Ver el ticket/ }).click();
  // Abierto: vuelve el contenido íntegro de §1.3, no una versión reducida.
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();
  // Y la verificación que §1.3 exige EN PANTALLA vuelve con él: plegado, esa
  // observación no estaba a la vista.
  await expect(page.getByText(/Checa que el total coincida/)).toBeVisible();
});

/**
 * 🔴 El mapeo NO se mide espiando el request: en modo mock no hay red que
 * espiar —el adaptador intercepta arriba del HTTP— y un `waitForRequest` se
 * queda colgado 30 s dando una falsa sensación de rigor. Se mide por la
 * CONDUCTA que el modo produce: `igual` hace que el backend arme casilleros de
 * `total/N` (`routes/mesas.js:504`), y esos casilleros son lo que la persona
 * ve. Si «Pagar el total» viajara como `consumo`, no habría casillero ninguno.
 */
test('🔴 «Pagar el total» reparte el total entre los que cubren, como igual', async ({ page }) => {
  await hastaLaPantallaFusionada(page);

  await page.getByRole('radio', { name: /Pagar el total/ }).click();
  // Comparte título con partes iguales: DOS títulos para TRES formas.
  await expect(page.getByText('¿Cuántos pagan?')).toBeVisible();

  // 🔴 CAMBIÓ CON «Una persona puede» (2026-08-19): el piso de esta forma es
  // 1, así que llegar a DOS ahora son dos toques. El test sigue probando lo
  // mismo —el total repartido entre los que cubren— con N=2.
  const masUno = page.getByRole('button', { name: 'Un comensal más' });
  await masUno.click();
  await masUno.click();
  await expect(page.getByRole('group', { name: /¿Cuántos (pagan|son en la mesa)\?/ })).toContainText('2');

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¡Mesa garantizada!' })).toBeVisible();

  await page.getByRole('button', { name: /Elegir mis ítems/ }).click();
  // 840 ÷ 2 = 420: el total repartido entre los DOS que cubren. Con `consumo`
  // no existiría este casillero, existiría la lista de platos.
  await expect(page.getByText('$420.00').first()).toBeVisible();
});

test('🔴 P3-01 · reescanear no hereda el acordeón abierto del ticket anterior', async ({ page }) => {
  await hastaLaPantallaFusionada(page);
  // El acceso al ticket dejó de llamarse por su total (§1.3-bis, 2026-08-21).
  await page.getByRole('button', { name: /Ver el ticket/ }).click();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();

  // El ticket ahora es un diálogo modal: primero se cierra por su control
  // accesible y recién entonces se vuelve al fondo.
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();

  // Volver y escanear OTRO ticket: la hoja no puede recordar el anterior.
  await page.getByRole('button', { name: /Volver/ }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toHaveCount(0);
});

test('🔴 P3-02 · la selección tiene semántica, no sólo una clase CSS', async ({ page }) => {
  await hastaLaPantallaFusionada(page);
  const grupo = page.getByRole('radiogroup', { name: '¿Cómo dividen?' });
  await expect(grupo).toBeVisible();

  const consumo = page.getByRole('radio', { name: /Por lo que pidió cada uno/ });
  const total = page.getByRole('radio', { name: /Pagar el total/ });
  await expect(consumo).toHaveAttribute('aria-checked', 'true');
  await expect(total).toHaveAttribute('aria-checked', 'false');

  await total.click();
  await expect(total).toHaveAttribute('aria-checked', 'true');
  await expect(consumo).toHaveAttribute('aria-checked', 'false');
  // Y el nombre accesible del stepper sigue a la pregunta de la pantalla.
  await expect(page.getByRole('group', { name: '¿Cuántos pagan?' })).toBeVisible();
});

/**
 * ③ · La maqueta final fija la tarjeta que explica la transición al banco.
 *
 * La composición se ve antes de abrirlo; `aria-busy` sigue siendo la señal
 * semántica de que la confirmación ya está en curso. El copy no acredita un
 * resultado monetario ni altera la máquina 3DS.
 */
test('la tarjeta de estado del 3DS explica la transición antes de abrir el banco', async ({ page }) => {
  await hastaLaPantallaFusionada(page);
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();

  await expect(page.getByText('Esperando a tu banco')).toBeVisible();
  await expect(page.getByText('No cierres la app: la confirmación se abre en un momento.')).toBeVisible();
});

/**
 * 🔴 EL CASO QUE MATI HABILITÓ: una persona sola cubre toda la cuenta.
 *
 * Va en la dirección CONTRARIA al que habría escrito con la otra rama de la
 * decisión — y por eso importa: hasta el 2026-08-19 la app hacía este caso
 * imposible, y la spec ya prometía «Uno o varios cubren toda la cuenta».
 */
test('🔴 UNA persona puede pagar el total: el stepper llega a 1 y la mesa se abre', async ({ page }) => {
  await hastaLaPantallaFusionada(page);
  await page.getByRole('radio', { name: /Pagar el total/ }).click();

  const grupo = page.getByRole('group', { name: '¿Cuántos pagan?' });
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await expect(grupo).toContainText('1');
  // Y no puede bajar de 1: no existe media persona pagando.
  await page.getByRole('button', { name: 'Un comensal menos' }).click();
  await expect(grupo).toContainText('1');

  // El caso llega hasta el final: si el backend rechazara el 1, la mesa no abriría.
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¡Mesa garantizada!' })).toBeVisible();
});

/**
 * 🔴 Y LA DIRECCIÓN OPUESTA, que protege una decisión y no un límite técnico:
 * el contrato admite 1 para `igual`, pero Mati dijo textual *«"En partes
 * iguales" tiene un mínimo de dos»*. Quien lea el contrato nuevo va a querer
 * «corregir» esta pantalla; esto se lo impide.
 */
test('🔴 «En partes iguales» no baja de 2, aunque el contrato lo admita', async ({ page }) => {
  await hastaLaPantallaFusionada(page);
  await page.getByRole('radio', { name: /En partes iguales/ }).click();

  const grupo = page.getByRole('group', { name: '¿Cuántos pagan?' });
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await expect(grupo).toContainText('2');
  await page.getByRole('button', { name: 'Un comensal menos' }).click();
  await expect(grupo, 'partes iguales no puede bajar de 2: lo ratificó Mati').toContainText('2');
});

/**
 * 🔴 CENTINELA DE LA RAMA «TICKET INCOMPLETO» — nace del BLOCK del P62.
 *
 * El cambio 6 retiró el `disabled` del círculo también acá, y puso la rama de
 * feedback en `CreateMesaFlow.tsx:1539-1544`. **Ninguna prueba oficial la
 * tocaba**: los ocho E2E de este archivo usan un ticket VÁLIDO, así que Codex
 * plantó `if (false && !ticketValid)` —que borra la rama entera y deja llegar a
 * Garantía con un ticket incompleto— y **los ocho quedaron verdes**.
 *
 * Un bypass invisible al gate es peor que un defecto: el defecto se encuentra,
 * el bypass se hereda. Este test cubre las señales que §5 bis · E exige
 * en esta pantalla, cada una por separado, más la que nadie declara y es la que
 * de verdad importa: **que no se llegue a Garantía**.
 *
 * ⚠️ La hoja modal se CIERRA antes de tocar Continuar a propósito: la rama la
 * abre y lleva allí el foco. Si el test la dejara abierta, no podría distinguir
 * «la abrió el feedback» de «ya estaba abierta».
 */
test('🔴 ticket incompleto: el círculo NO se apaga, frena y explica con todas sus señales', async ({
  page,
}) => {
  await hastaLaPantallaFusionada(page);

  // El stepper primero: si no, el CTA frena por ÉL y nunca llega a mirar el
  // ticket. Dos gates en la misma pantalla, y este test es del segundo.
  await page.getByRole('button', { name: 'Un comensal más' }).click();

  // Se rompe el ticket por la UI, no por el estado: «Agregar consumo» crea una
  // fila sin nombre ni precio, que es exactamente un ticket incompleto real.
  await page.getByRole('button', { name: /Ver el ticket/ }).click();
  await page.getByRole('button', { name: 'Modificar ítems' }).click();
  await page.getByRole('button', { name: 'Agregar consumo' }).click();
  await expect(page.getByText('Completa nombre y precio (mayor a cero) de cada consumo.')).toBeVisible();

  // Se cierra la edición y luego la hoja por su control modal para poder
  // afirmar que la rama de Continuar la ABRE de nuevo.
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toHaveCount(0);

  // ① el círculo NO nace apagado (§5 bis · E)
  const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
  await expect(continuar).toBeEnabled();
  await continuar.click();

  // ② el pulso se mide antes de que `animationend` retire su clase
  // transitoria; esperar al resto del feedback vuelve la aserción flakey.
  await expect(page.locator('.ticket-title-fold')).toHaveClass(/tk-fold--pulse/);

  // ③ NO se llegó a Garantía — la afirmación que el bypass rompe
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toHaveCount(0);
  /**
   * ④ el toast · 🔴 SE AFIRMA DENTRO DEL `.toast`, NO POR EL TEXTO SUELTO.
   *
   * Ese mismo texto vive TAMBIÉN en el aviso permanente de la barra
   * (`tk-invalid`, visible mientras el ticket sea inválido). Un
   * `getByText(...)` lo matchea ahí y **pasa aunque el toast no exista**:
   * borrar `toast(ticketInvalidReason)` dejaba este test VERDE. Lo cacé
   * plantando ese mutante, no leyéndolo — es el mismo falso verde que el P62
   * vino a corregir, cometido de nuevo dentro del test que lo corrige.
   */
  const toast = page.locator('.toast:not(.toast-hidden)');
  await expect(toast).toBeVisible();
  await expect(toast).toHaveText('Completa nombre y precio (mayor a cero) de cada consumo.');
  // ⑤ la hoja quedó abierta: el aviso lleva a donde se resuelve
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();

  // ⑥ el foco entra a la hoja modal que acaba de abrirse. Antes el acordeón
  // hacía scroll en el documento; con un diálogo, mover el fondo sería un bug.
  await expect(page.getByRole('dialog', { name: /Ticket/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar hoja del ticket' })).toBeFocused();
});
