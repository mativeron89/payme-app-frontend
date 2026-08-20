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
  await expect(page.getByRole('button', { name: /Pagar el total/ })).toBeVisible();
}

test('las tres formas y el ticket viven en UNA pantalla, en el paso 2 de 4', async ({ page }) => {
  await hastaLaPantallaFusionada(page);

  await expect(page.getByText('¿Cómo dividen?')).toBeVisible();
  for (const forma of ['Por lo que pidió cada uno', 'En partes iguales', 'Pagar el total']) {
    await expect(page.getByRole('button', { name: new RegExp(forma) })).toBeVisible();
  }
  // El ticket está en la MISMA pantalla, y su total también.
  await expect(page.getByText('Total del ticket')).toBeVisible();
  await expect(page.getByText('Paso 2 de 4')).toBeVisible();
  // Y ya no existe el paso suelto que la fusión absorbió.
  await expect(page.getByText('Paso 3 de 5')).toHaveCount(0);
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

  await page.getByRole('button', { name: /Pagar el total/ }).click();
  // Comparte título con partes iguales: DOS títulos para TRES formas.
  await expect(page.getByText('¿Cuántos pagan?')).toBeVisible();

  // Piso 2, heredado del contrato: el primer toque no puede dejar un 1.
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await expect(page.getByRole('group', { name: 'Cantidad de comensales' })).toContainText('2');

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantía de la mesa' })).toBeVisible();
  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirma con tu banco' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar autorización' }).click();
  await expect(page.getByRole('heading', { name: '¡Mesa garantizada!' })).toBeVisible();

  await page.getByRole('button', { name: /Elegir mis ítems/ }).click();
  // 840 ÷ 2 = 420: el total repartido entre los DOS que cubren. Con `consumo`
  // no existiría este casillero, existiría la lista de platos.
  await expect(page.getByText('$420.00').first()).toBeVisible();
});
