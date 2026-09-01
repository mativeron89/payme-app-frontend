import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar, tokenDeLaUrl } from './_app';

const CORTE = 'CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02): el checkout del participante y el alta de tarjeta están cerrados en producción pública sin pagos; este recorrido vuelve cuando el corte se levante.';

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
  /**
   * 🔴 CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02) · el recorrido llegaba
   * hasta el comprobante; ahora TERMINA EN LA SELECCIÓN, y eso es lo que se
   * acredita: que ningún control lleve al pago, que el círculo cierre el flujo
   * hacia Inicio, y que nada se haya cobrado. La versión que pagaba vuelve tal
   * cual cuando el corte se levante; sus dos hermanas de abajo quedan salteadas
   * con ese motivo, no borradas.
   */
  test('escanear → dividir → garantizar → elegir: el flujo termina en la selección, SIN pago', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);

    // La mesa nació garantizada (A-1): la garantía del organizador NO es parte
    // de este corte y sigue en el camino.
    await expect(page.getByText(mesa.code, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const seleccion = page.locator('.mesa-selection-title');
    await expect(seleccion).toContainText(mesa.code);
    await expect(seleccion).toContainText('partes iguales');
    await expect(page.getByText('$840.00')).toBeVisible();

    // Marcar lo consumido sigue vivo y sigue sin mover un peso (H-14).
    await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
    await page.getByRole('radio', { name: '½', exact: true }).click();
    await expect(page.locator('.mi-frac-amt')).toHaveCount(0);
    const filaMiParte = page.getByText('Mi parte', { exact: true }).locator('..');
    await expect(filaMiParte).toContainText('$210.00');

    // 🔴 EL CORTE · acá había un «Continuar» → «Pagar mi parte». No existe: ni
    // el control, ni la pantalla, ni el selector de propina.
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: /propina/i })).toHaveCount(0);

    // El círculo cierra el flujo hacia Inicio.
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

    // Y nada se cobró: la mesa sigue en $0.00 de $840.00.
    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByText(/\$0\.00 de \$840\.00/)).toBeVisible();
  });

  /**
   * La propina es plata y se recalcula en vivo. Si el 0% no bajara el total a
   * la parte exacta, alguien estaría pagando una propina que decidió no dejar.
   */
  test('la propina se recalcula: 0% deja el total en la parte exacta', async ({ page }) => {
    test.skip(true, CORTE);
    await ingresar(page);
    await abrirMesaConLink(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();

    // La propina es un `radiogroup`, no botones sueltos: es una elección entre
    // opciones excluyentes y así la anuncia un lector de pantalla.
    await page.getByRole('radio', { name: '0%', exact: true }).click();
    await expect(page.getByText('$210.00', { exact: true }).first()).toBeVisible();

    await page.getByRole('radio', { name: '20%', exact: true }).click();
    // $210.00 + 20% = $252.00.
    await expect(page.getByText('$252.00', { exact: true }).first()).toBeVisible();
  });

  /**
   * ⭐ **El 0 % es una opción de primera clase, y esto es lo que lo prueba.**
   *
   * No alcanza con que exista la píldora: elegir 0 % tiene que *quedar
   * elegido* —mismo relleno que 15 o 20, el título deja de pedir nada— y
   * tiene que **pagar**. Si el obligatorio dejara pasar todo menos el 0 %,
   * sería una propina obligatoria disfrazada de elección obligatoria, que es
   * exactamente lo que el acta prohíbe.
   */
  test('elegir 0% es una elección: se marca, y paga', async ({ page }) => {
    test.skip(true, CORTE);
    await ingresar(page);
    await abrirMesaConLink(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();

    const propinas = page.getByRole('radiogroup', { name: /propina/i });
    await expect(propinas.getByRole('radio', { checked: true })).toHaveCount(0);

    await propinas.getByRole('radio', { name: '0%', exact: true }).click();

    // Quedó elegido: la sección deja de pedir y la píldora del 0 % es la única
    // marcada. Es el mismo estado que dejaría cualquier otro preset.
    await expect(propinas.getByRole('radio', { name: '0%', exact: true })).toBeChecked();
    await expect(propinas.getByRole('radio', { checked: true })).toHaveCount(1);
    await expect(page.getByText('Elige tu propina', { exact: true })).toHaveCount(0);

    // Y paga, sin pedir nada más.
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await expect(page.getByText('¡Listo!')).toBeVisible();
    // 🔴 CAMBIÓ CON LA TANDA 4 (2026-08-20) y el propósito del test NO: el
    // comprobante **ya no lista la propina cuando no hubo** —decisión
    // explícita del paquete—, así que afirmar «Propina (al mesero)» y «$0.00»
    // dejó de describir la pantalla. Lo que este test protege sigue siendo
    // «el 0 % es una elección que se respeta», y eso se acredita mejor:
    // la fila NO está, y el total pagado es EXACTAMENTE la parte, sin nada
    // agregado. Antes el $0.00 podía venir de una propina no elegida.
    const comprobante = await page.locator('body').innerText();
    expect(comprobante).not.toContain('Propina');
    expect(comprobante).toContain('Total pagado');
    expect(comprobante).toContain('$210.00');
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
