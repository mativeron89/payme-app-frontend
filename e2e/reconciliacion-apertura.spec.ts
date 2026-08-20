import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * El estado del mock, leído del `localStorage` de la página. Se mira acá y no
 * en la UI porque la afirmación que importa —**cuántas mesas existen**— no
 * está en ninguna pantalla: la de compartir muestra la mesa recién abierta y
 * se vería idéntica si hubiera dos.
 */
async function mesasDelMock(page: Page): Promise<{ total: number; ultimoCodigo: string | null }> {
  const datos = await page.evaluate(() => {
    const crudo = localStorage.getItem('payme_mock_state_v1');
    if (!crudo) return null;
    const mesas = (JSON.parse(crudo) as { mesas?: Array<{ code: string }> }).mesas ?? [];
    return { total: mesas.length, ultimoCodigo: mesas[0]?.code ?? null };
  });
  expect(datos, 'no se pudo leer el estado del mock').not.toBeNull();
  return datos!;
}

/**
 * ORDEN 2A · LA APERTURA QUE QUEDÓ COLGADA, RECORRIDA COMO LA VIVE UNA PERSONA.
 *
 * El escenario es el que la orden pidió acreditar —**respuesta perdida ·
 * recarga · replay**— y es el único que no se puede probar con funciones
 * puras, porque el defecto no vivía en una función: vivía en que el journal
 * sabía congelar y no sabía destrabar.
 *
 * Qué pasa acá: el organizador garantiza, el banco pide 3DS, y **la pestaña
 * muere antes de confirmar**. Al volver, el intento está congelado y sin
 * payload en memoria: la app no puede reenviarlo a ciegas ni abrir otra mesa
 * —sería un segundo hold por el total— y hasta esta orden tampoco tenía cómo
 * averiguar en qué quedó. Ahora pregunta por la clave de idempotencia.
 *
 * 🔴 **Lo que este spec fija, y es lo que importa:** que el estado congelado
 * tenga una SALIDA visible y que esa salida **no ofrezca desbloquear**. La
 * mesa existe con su hold sin autorizar: la única acción honesta es retomar
 * ESA garantía, nunca abrir otra.
 */

test('la apertura congelada por una recarga se diagnostica y ofrece retomar, no desbloquear', async ({ page }) => {
  await ingresar(page);

  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('button', { name: /Pagar el total/ })).toBeVisible();
  await page.getByRole('button', { name: /En partes iguales/ }).click();
  const masUno = page.getByRole('button', { name: 'Un comensal más' });
  await masUno.click();
  await masUno.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantía de la mesa' })).toBeVisible();

  // 🔴 SE ELIGE "otra tarjeta" EXPLÍCITAMENTE, y no es un detalle: sin esto el
  // spec usaba la guardada por default que `loadCards()` autoselecciona, o sea
  // que NO recorría el camino de tarjeta tipeada — que es el único donde el
  // `pm_` cambia en cada invocación y por lo tanto el único que necesitaba la
  // identidad económica alineada. (Lo declaré cubierto antes de que lo
  // estuviera; ver el mensaje del commit de esta corrección.)
  await page.getByRole('radio').filter({ hasText: 'Usar otra tarjeta' }).click();

  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  // Acá la mesa YA existe en `pending_auth` y el hold está puesto: el backend
  // contestó `requires_action` y el journal quedó congelado a propósito.
  await expect(page.getByRole('heading', { name: 'Confirma con tu banco' })).toBeVisible();

  // ⚡ La pestaña muere en el peor momento posible.
  await page.reload();

  // 🔴 La app vuelve al PASO 1: los ítems y la división viven en memoria y no
  // sobreviven. Este spec encontró que el aviso aparecía acá y su único botón
  // estaba tres pasos más adelante, en Garantía — o sea, había que volver a
  // escanear y dividir para encontrar la salida. Ahora viajan juntos.
  await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
  await expect(page.getByText('Hay una apertura de una sesión anterior.')).toBeVisible();

  // El diagnóstico: se pregunta por la clave, no se adivina por el listado.
  await page.getByRole('button', { name: 'Revisar cómo quedó esa apertura' }).click();

  // El veredicto dice la verdad completa: la mesa se creó, la garantía no.
  const aviso = page.getByText(/se creó, pero su garantía quedó sin confirmar/);
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(/PA-[A-Za-z0-9]+/);
  // 🔴 Y NO dice ninguna de las dos mentiras posibles.
  await expect(page.getByText(/desbloquear/i)).toHaveCount(0);
  await expect(page.getByText(/no llegó a crearse/i)).toHaveCount(0);
  await expect(page.getByText(/puedes reenviarla tal cual/)).toBeVisible();

  // Y la salida existe de verdad: rehecho el ticket, el CTA deja de decir
  // "Reconciliación necesaria" y pasa a ofrecer reenviar ESTE intento —con SU
  // clave, que es lo único que no puede duplicar la garantía—.
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('button', { name: /Pagar el total/ })).toBeVisible();
  await page.getByRole('button', { name: /En partes iguales/ }).click();
  const otroMas = page.getByRole('button', { name: 'Un comensal más' });
  await otroMas.click();
  await otroMas.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantía de la mesa' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconciliación necesaria/ })).toHaveCount(0);

  // ⭐ ORDEN 2-A · EL REENVÍO SE COMPLETA DE VERDAD, no se verifica que el
  // botón esté habilitado y listo. Acá es donde vivía la divergencia: tras el
  // reload el `pm_` de la tarjeta tipeada ya no está en memoria y el mock
  // materializa otro, exactamente como Stripe.js. Con el fingerprint viejo
  // —que cubría el request ENTERO— este click moría con
  // `monetary_payload_ambiguous` y el organizador quedaba sin salida.
  // ORDEN 1-B · ninguna tarjeta viene elegida —la app ya no se la atribuye a la
  // default— así que hay que elegir, y el CTA está muerto hasta entonces.
  await expect(page.getByRole('button', { name: /Reintentar esta apertura/ })).toBeDisabled();
  await page.getByRole('radio').filter({ hasText: 'Usar otra tarjeta' }).click();

  const antes = await mesasDelMock(page);
  await page.getByRole('button', { name: /Reintentar esta apertura/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirma con tu banco' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar autorización' }).click();
  await expect(page.getByRole('heading', { name: '¡Mesa garantizada!' })).toBeVisible();

  // 🔴 LA AFIRMACIÓN QUE IMPORTA: se reanudó LA MISMA apertura. Si el reenvío
  // hubiera rotado la clave, acá habría DOS mesas y dos holds por el total.
  const despues = await mesasDelMock(page);
  expect(despues.total, 'el reenvío creó una segunda mesa').toBe(antes.total);
  expect(despues.ultimoCodigo).toBe(antes.ultimoCodigo);
  await expect(page.getByText(despues.ultimoCodigo!, { exact: true })).toBeVisible();
});
