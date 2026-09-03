import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * §1.4 (2026-08-06) · EL STEPPER SE PREGUNTA SIEMPRE, Y EL 4 INVENTADO MURIÓ.
 *
 * Antes: en "cada uno lo suyo" nadie preguntaba cuántos son y viajaba
 * `expected_participants: 4` — el default de un `useState` que el usuario
 * jamás vio. Ese 4 era además lo único que separaba a la persona del borde
 * ÷1: base de propina = LA CUENTA ENTERA (medido: 20% = $168 sobre $60 de
 * consumo). El número correcto no existe; por eso se pregunta.
 *
 * La condición de la orden: **que ya no exista camino por el que se mande un
 * N que el usuario no eligió.** Por eso el test no mira sólo la pantalla:
 * lee el estado del mock y afirma el N exacto que viajó en POST /mesas.
 */

/**
 * F2-03 (R105) · **el corte se declara ANTES del tramo que lo prueba.**
 *
 * El recorrido abre una mesa con garantía —riel VIVO— y recién después afirma el
 * corte. Desde F2 las dos mitades salen de la misma capability, así que el modo
 * se declara en el medio, con recarga, en vez de recortar el recorrido.
 *
 * ⚠️ **Es lo que evita borrar aserciones.** Con `disabled` desde el arranque no
 * habría paso de garantía y las aserciones que ya existían se caerían con él. La
 * adenda autoriza declarar el modo, no achicar lo que el spec prueba.
 */
async function declararCorteYRecargar(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await page.reload();
}

test.describe('el stepper de comensales (§1.4)', () => {
  test('consumo: sin elegir frena con toast; elegido, viaja EXACTAMENTE ese N', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar' }).click();
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await expect(page.getByText('¿Cómo dividen?')).toBeVisible();

    // Nace sin elegir: sin número. En consumo N cuenta personas en la mesa,
    // no pagadores; visible y nombre accesible dicen lo mismo.
    await expect(page.getByText('¿Cuántos son en la mesa?')).toBeVisible();
    await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?' })).toContainText('—');

    // Continuar NUNCA está deshabilitado: frena explicando, como la propina.
    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    await expect(continuar).toBeEnabled();
    await continuar.click();
    await expect(page.getByText('Elige cuántos son')).toBeVisible();
    await expect(page.getByText('¿Cómo dividen?')).toBeVisible();

    // Elegir 3: piso 1 + dos toques. La vista en vivo es la MISMA cuenta que
    // §1.5 bis va a mostrar: 840 ÷ 3 = $280.00.
    const mas = page.getByRole('button', { name: 'Un comensal más' });
    await mas.click();
    await mas.click();
    await mas.click();
    await expect(page.getByText('$280.00')).toBeVisible();
    await expect(page.getByText('base de propina · c/u')).toBeVisible();

    await continuar.click();
    await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();
    await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

    // LA CONDICIÓN: el N que viajó es el elegido — ni 4, ni 1, ni un default.
    // La mesa se busca POR EL CÓDIGO que muestra la pantalla: el mock
    // unshiftea las nuevas y "la última del array" es una del seed (con 4 —
    // exactamente el número fantasma que este test existe para matar).
    // 🔴 Se lee del CÓDIGO en pantalla, no del link impreso: A1 (2026-08-16)
    // retiró el link como texto. Este test nunca necesitó el link —sólo el
    // código— así que apuntarlo al código es además lo que siempre quiso decir.
    const codigo = (await page.locator('.share-code-txt').innerText()).trim();
    const enviado = await page.evaluate((code) => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      return st.mesas.find((m: { code: string }) => m.code === code).expected_participants;
    }, codigo);
    expect(enviado).toBe(3);

    // CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02) · la base de §1.5 bis
    // vivía en la pantalla de pago, que está cerrada: el recorrido termina en
    // Mis ítems, con la selección viva y sin «Continuar» hacia el pago.
    //
    // El stepper y el N que viajó se midieron arriba con el riel VIVO, que es
    // donde el organizador pasa por la garantía; ninguna de esas aserciones se
    // tocó.
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByText('Elige lo que consumiste', { exact: true })).toBeVisible();

    // 🔴 **F2-03 · el modo se declara sobre la MESA YA ABIERTA, y la primera
    // versión de esto estaba mal.**
    //
    // Lo puse antes, apenas volvía `abrirMesaConLink`, y el recorrido moría con
    // timeout en el `click` de «Continuar». La causa es que ahí todavía se está
    // DENTRO del alta, que es un flujo efímero: la recarga que el seam necesita
    // lo devuelve a «Escanea el ticket» y la pantalla que este test necesita
    // deja de existir. La mesa ya creada sí sobrevive a la recarga.
    //
    // ⚠️ Lo cazó el navegador, no la suite: `typecheck` y los unitarios pasaban
    // con la versión rota adentro.
    await declararCorteYRecargar(page);
    await expect(page.getByText('Elige lo que consumiste', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
  });

  test('partes iguales con N=3: viaja el 3 elegido y la parte es $280.00 — no el 4 fantasma (2-A.3)', async ({ page }) => {
    // El hueco que Codex midió: el caso de iguales sólo probaba el reset a
    // '—', nunca CREABA una mesa con N distinto de 4 — "un mutante que
    // reponga 4 sólo para division='igual' podría sobrevivir". Acá se elige
    // 3 en IGUAL, se abre la mesa, y se afirman las dos consecuencias: el N
    // que viajó y la parte por persona (840÷3 = $280.00 — con el 4 fantasma
    // sería $210.00).
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar' }).click();
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();

    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    const mas = page.getByRole('button', { name: 'Un comensal más' });
    await mas.click(); // — → 2 (piso de iguales, del contrato)
    await mas.click(); // 2 → 3
    await expect(page.getByRole('group', { name: /¿Cuántos (pagan|son en la mesa)\?/ })).toContainText('3');
    await expect(page.getByText('$280.00')).toBeVisible();

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

    // 🔴 Se lee del CÓDIGO en pantalla, no del link impreso: A1 (2026-08-16)
    // retiró el link como texto. Este test nunca necesitó el link —sólo el
    // código— así que apuntarlo al código es además lo que siempre quiso decir.
    const codigo = (await page.locator('.share-code-txt').innerText()).trim();
    const mesa = await page.evaluate((code) => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      const m = st.mesas.find((x: { code: string }) => x.code === code);
      return { n: m.expected_participants, slots: m.slots?.length, primera: m.slots?.[0]?.amount_cents };
    }, codigo);
    expect(mesa.n).toBe(3);
    expect(mesa.slots).toBe(3);
    expect(mesa.primera).toBe(28000);
  });

  test('pasar a partes iguales con N=1 elegido vuelve a preguntar: el piso es 2, del contrato', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar' }).click();
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();

    // En consumo el piso es 1: un toque lo elige.
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await expect(page.getByRole('group', { name: /¿Cuántos (pagan|son en la mesa)\?/ })).toContainText('1');

    // Al pasar a iguales, 1 viola el piso del contrato (>= 2): se vuelve a
    // preguntar — no se "corrige" solo a un número que nadie eligió.
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await expect(page.getByText('¿Cuántos pagan?')).toBeVisible();
    await expect(page.getByRole('group', { name: /¿Cuántos (pagan|son en la mesa)\?/ })).toContainText('—');
  });
});
