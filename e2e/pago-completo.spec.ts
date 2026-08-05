import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar, tokenDeLaUrl } from './_app';

/**
 * ORDEN 5 · recorrido 3 · EL CAMINO DE PAGO, DE PUNTA A PUNTA.
 *
 * **Nunca se había probado entero.** Cada pieza tenía sus tests, pero el
 * recorrido completo —escanear, dividir, garantizar, sumarse, elegir, pagar— no
 * lo recorría nadie. Y es donde una falla significa que alguien con la tarjeta
 * en la mano, sentado a la mesa, no puede terminar.
 *
 * Corre contra el **modo mock**: no toca dinero real ni necesita backend
 * levantado. Lo que valida es que el flujo de la app cierra y que **la
 * aritmética que se le muestra a la persona cierra con ella**.
 *
 * ## 🔴 UN LÍMITE QUE HAY QUE DECLARAR, PORQUE NO ES OBVIO
 *
 * El invitado se prueba **en el mismo navegador**. No es pereza: el mock guarda
 * su mundo en `localStorage`, así que un segundo contexto de navegador —que es
 * lo que sería otro teléfono— **no ve la mesa que abrió el primero** y el token
 * daría 403. El cruce entre dispositivos exige que el backend ligue la
 * inscripción al `user_id`, y eso ya está anotado como pendiente del emisor.
 *
 * Así que lo que este spec acredita del canje es la mecánica de la pantalla y
 * la custodia del token, **no** que dos personas distintas en dos teléfonos
 * distintos lleguen a la misma mesa.
 */

test.describe('el camino de pago completo', () => {
  /**
   * El recorrido del organizador entero, y la plata mirada en cada pantalla.
   *
   * Ticket $840.00 ÷ 4 partes iguales = $210.00. Propina 15% = $31.50.
   * Total $241.50. Son centavos enteros: ningún redondeo raro en el medio.
   */
  test('escanear → dividir → garantizar → elegir → pagar, con la plata cuadrando', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);

    // La mesa nació garantizada (A-1): sin hold autorizado no hay mesa abierta.
    // §1.7 movió ese hecho del badge "Garantizada ✓" al título de la pantalla,
    // y le sumó el código de mesa como protagonista: si el hold no se hubiera
    // autorizado, no habría ni pantalla ni código que copiar.
    await expect(page.getByText(mesa.code, { exact: true })).toBeVisible();

    // §1.7 · el CTA es el círculo con casa, que cierra el flujo. El atajo a la
    // mesa —donde el organizador elige lo suyo— es "Volver": la mesa YA existe
    // y está garantizada, así que retroceder a División está prohibido (B-06).
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByText(new RegExp(`Mesa ${mesa.code}`))).toBeVisible();
    await expect(page.getByText('$840.00')).toBeVisible();

    // Marcar lo consumido: en partes iguales es informativo para el
    // restaurante y NO cambia lo que se paga. Esa promesa está en pantalla.
    await expect(page.getByText('no cambia lo que pagás')).toBeVisible();
    // Antes de elegir, la fila de la barra pide elegir y no muestra monto.
    await expect(page.getByText('Marcá lo que consumiste')).toBeVisible();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();

    // §1.5 · el monto vive en su fila propia ARRIBA de la barra, no en la
    // etiqueta del nav item — que dice "Continuar" y no cambia según el estado.
    // Se ancla en el texto "Mi parte" y se mira SU fila: `$210.00` suelto
    // aparece dos veces en la pantalla (acá y en la nota de partes iguales), y
    // afirmarlo suelto pasaría aunque esta fila no existiera.
    const filaMiParte = page.getByText('Mi parte', { exact: true }).locator('..');
    await expect(filaMiParte).toContainText('$210.00');

    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();

    // La parte, la propina y el total, antes de tocar nada.
    await expect(page.getByText('Tu parte $210.00 + propina $31.50')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pagar $241.50' })).toBeVisible();

    await page.getByRole('button', { name: 'Pagar $241.50' }).click();

    // El comprobante, que es lo último que ve la persona y lo que le queda.
    await expect(page.getByText('¡Listo!')).toBeVisible();
    const comprobante = await page.locator('body').innerText();
    expect(comprobante).toContain(mesa.code);
    expect(comprobante).toContain('$210.00');
    expect(comprobante).toContain('$31.50');
    expect(comprobante).toContain('$241.50');
    // Y la mesa sigue abierta para el resto: pagar tu parte no la cierra.
    expect(comprobante).toContain('La mesa sigue abierta para los demás');
  });

  /**
   * La propina es plata y se recalcula en vivo. Si el 0% no bajara el total a
   * la parte exacta, alguien estaría pagando una propina que decidió no dejar.
   */
  test('la propina se recalcula: 0% deja el total en la parte exacta', async ({ page }) => {
    await ingresar(page);
    await abrirMesaConLink(page);
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();

    // La propina es un `radiogroup`, no botones sueltos: es una elección entre
    // opciones excluyentes y así la anuncia un lector de pantalla.
    await page.getByRole('radio', { name: '0%', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pagar $210.00' })).toBeVisible();

    await page.getByRole('radio', { name: '20%', exact: true }).click();
    // $210.00 + 20% = $252.00.
    await expect(page.getByRole('button', { name: 'Pagar $252.00' })).toBeVisible();
  });

  /**
   * El canje del link: el momento en que alguien "se suma a la mesa". Acá lo
   * que se acredita, además de la pantalla, es la **custodia del token en el
   * caso exitoso** — el complemento del terminal que prueba
   * `invitacion-back.spec.ts`.
   */
  test('sumarse por el link: canje, token soltado y salida a Mis ítems', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);

    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);

    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();
    // §1.2-C es el único momento con permiso de nombrar el restaurante: a esta
    // altura quien mira ya es un participante inscripto.
    await expect(page.getByText('La Parolaccia')).toBeVisible();

    // ⭐ La credencial se soltó de las DOS custodias apenas cerró el canje.
    expect(tokenDeLaUrl(page.url())).toBeNull();
    expect(
      await page.evaluate(() => window.sessionStorage.getItem('payme_pending_invitation_link')),
    ).toBeNull();

    // La salida existe y está a un toque.
    await expect(page.getByRole('button', { name: 'Ver mis ítems' })).toBeVisible();
  });

  /**
   * ⭐ EL DEFECTO QUE ESTE RECORRIDO ENCONTRÓ, y que ahora acredita arreglado.
   *
   * Estuvo un rato como `fixme`: **"Ver mis ítems" no hacía nada y la persona
   * quedaba encerrada en la pantalla de felicitación.** Al cerrar el canje la
   * custodia retira el token, así que la URL queda en `#/mesa/PA-XXXX` — que es
   * exactamente el destino del botón, porque el link ES la ruta de la mesa.
   * Asignar el hash que ya está no dispara `hashchange`, el router no se entera
   * y `JoinMesaScreen` seguía montada.
   *
   * No era un caso raro: es el camino normal de cualquiera que llega por
   * WhatsApp, y §1.2-C no tiene barra inferior, así que ese círculo era el único
   * control de la pantalla.
   *
   * Este test es lo que impide que vuelva. Verificado con mutante: revertido el
   * arreglo, se pone rojo.
   */
  test('sumarse por el link: la salida a Mis ítems funciona', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
    await expect(page.getByText('¡Te sumaste a la mesa!')).toBeVisible();

    await page.getByRole('button', { name: 'Ver mis ítems' }).click();

    // Se llegó a Mis ítems: los ítems del ticket son botones de esta pantalla y
    // de ninguna otra del recorrido.
    await expect(page.getByRole('button', { name: 'Tagliatelle Bolognese' })).toBeVisible();
    // Y la felicitación se fue: no quedó montada abajo ni al lado.
    await expect(page.getByText('¡Te sumaste a la mesa!')).toHaveCount(0);
  });
});
