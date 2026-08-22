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
  await expect(page.getByText('Total del ticket')).toBeVisible();

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

  // Plegado: el total se ve, el detalle no.
  await expect(page.getByText('Total del ticket')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toHaveCount(0);

  await page.getByRole('button', { name: /Total del ticket/ }).click();
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
  await expect(page.getByRole('heading', { name: 'Garantía de la mesa' })).toBeVisible();
  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar autorización' }).click();
  await expect(page.getByRole('heading', { name: '¡Mesa garantizada!' })).toBeVisible();

  await page.getByRole('button', { name: /Elegir mis ítems/ }).click();
  // 840 ÷ 2 = 420: el total repartido entre los DOS que cubren. Con `consumo`
  // no existiría este casillero, existiría la lista de platos.
  await expect(page.getByText('$420.00').first()).toBeVisible();
});

test('🔴 P3-01 · reescanear no hereda el acordeón abierto del ticket anterior', async ({ page }) => {
  await hastaLaPantallaFusionada(page);
  await page.getByRole('button', { name: /Total del ticket/ }).click();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();

  // Volver y escanear OTRO ticket: el acordeón no puede recordar el anterior.
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
 * ③ · «Esperando a tu banco» SÓLO durante la espera real.
 *
 * Este test existe por el freno: el cartel llegó pedido como elemento
 * permanente y la pantalla **no espera nada** hasta que se toca Confirmar.
 * Afirmar una espera inexistente es lo que `SISTEMA_DISENO.md §5` prohíbe, y
 * sin esta guarda nada impide que alguien lo vuelva a poner fijo «porque en
 * el diseño se ve así».
 *
 * Se afirma la AUSENCIA además de la presencia: lo que el spec saca a
 * propósito se rompe con la mejor intención.
 */
test('🔴 el cartel de espera del 3DS no existe antes de la espera', async ({ page }) => {
  await hastaLaPantallaFusionada(page);
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantía de la mesa' })).toBeVisible();
  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();

  // Llegamos al 3DS y NO se está esperando nada: el banco todavía no fue
  // consultado. El cartel no puede estar.
  await expect(page.getByText('Esperando a tu banco')).toHaveCount(0);
  await expect(page.getByText(/No cierres la app/)).toHaveCount(0);
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
  await expect(page.getByRole('heading', { name: 'Garantía de la mesa' })).toBeVisible();
  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar autorización' }).click();
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
