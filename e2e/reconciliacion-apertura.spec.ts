import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * El estado del mock, leído del `localStorage` de la página. Se mira acá y no
 * en la UI porque la afirmación que importa —**cuántas mesas existen**— no
 * está en ninguna pantalla: la de compartir muestra la mesa recién abierta y
 * se vería idéntica si hubiera dos.
 */
/**
 * Fila del store mock tal como la persiste `payme_mock_state_v1`. Los campos de
 * garantía se tipan `unknown` A PROPÓSITO: el test afirma su presencia con
 * `toHaveProperty` y su valor exacto después; un `?? null` los taparía.
 */
interface FilaMesaMock {
  readonly code: string;
  readonly status?: unknown;
  readonly guarantee_method?: unknown;
  readonly guarantee_saved_payment_method_id?: unknown;
}

async function mesasDelMock(page: Page): Promise<{
  total: number;
  ultimoCodigo: string | null;
  codigos: string[];
  mesas: FilaMesaMock[];
}> {
  const datos = await page.evaluate(() => {
    const crudo = localStorage.getItem('payme_mock_state_v1');
    if (!crudo) return null;
    const mesas = (JSON.parse(crudo) as { mesas?: Array<{ code: string }> }).mesas ?? [];
    return {
      total: mesas.length,
      ultimoCodigo: mesas[0]?.code ?? null,
      codigos: mesas.map((m) => m.code),
      mesas,
    };
  });
  expect(datos, 'no se pudo leer el estado del mock').not.toBeNull();
  return datos!;
}

async function expectCampanaBloqueada(page: Page): Promise<void> {
  const url = page.url();
  await page.getByRole('button', { name: 'Avisos', exact: true }).click();
  await expect(page.locator('.toast')).toHaveText('Termina este paso para abrir tus avisos.');
  expect(page.url()).toBe(url);
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
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  const masUno = page.getByRole('button', { name: 'Un comensal más' });
  await masUno.click();
  await masUno.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();

  // 🔴 SE ELIGE "otra tarjeta" EXPLÍCITAMENTE, y no es un detalle: sin esto el
  // spec usaba la guardada por default que `loadCards()` autoselecciona, o sea
  // que NO recorría el camino de tarjeta tipeada — que es el único donde el
  // `pm_` cambia en cada invocación y por lo tanto el único que necesitaba la
  // identidad económica alineada. (Lo declaré cubierto antes de que lo
  // estuviera; ver el mensaje del commit de esta corrección.)
  // 🔴 RECON-SETUP-02 · LA PRECONDICIÓN SE OBSERVA, NO SE SUPONE. La traza de
  // la corrida del 2026-09-05 mostró a Santander marcada pese al click en
  // "nueva": el click llegaba antes de que `loadCards()` terminara y su
  // autoselección de la default pisaba la elección. Exigir el grupo COMPLETO
  // con la default marcada acredita que esa carga ya pasó; recién entonces
  // elegir "nueva" es una elección y no una carrera. Esto fija el escenario
  // del test; NO declara corregida la autoselección tardía del componente.
  const grupo = page.getByRole('radiogroup', { name: 'Tarjeta para garantizar' });
  const radios = grupo.getByRole('radio');
  const santander = grupo.getByRole('radio', { name: /Santander ···· 4532/ });
  const bbva = grupo.getByRole('radio', { name: /BBVA ···· 8821/ });
  const nueva = grupo.getByRole('radio').filter({ hasText: 'Agregar nueva tarjeta' });
  await expect(radios).toHaveCount(3);
  await expect(santander).toBeVisible();
  await expect(santander).toBeEnabled();
  await expect(bbva).toBeVisible();
  await expect(bbva).toBeEnabled();
  await expect(santander).toBeChecked();
  await expect(bbva).not.toBeChecked();
  await expect(nueva).not.toBeChecked();

  await nueva.click();
  await expect(nueva).toBeChecked();
  await expect(grupo.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(santander).not.toBeChecked();
  await expect(bbva).not.toBeChecked();

  // Antes del primer Garantizar: qué mesas existen, para exigir UNA nueva después.
  const antesDelPrimerGarantizar = await mesasDelMock(page);
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  // Acá la mesa YA existe en `pending_auth` y el hold está puesto: el backend
  // contestó `requires_action` y el journal quedó congelado a propósito.
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();

  // 🔴 La fila nueva, por DIFERENCIA de códigos y no "la primera": con tarjeta
  // tipeada la fuente guardada es NULL en el payload real. Si la propiedad
  // faltara, el test falla en vez de leer `undefined` como "sin fuente".
  const trasElPrimerGarantizar = await mesasDelMock(page);
  const filasNuevas = trasElPrimerGarantizar.mesas.filter(
    (m) => !antesDelPrimerGarantizar.codigos.includes(m.code),
  );
  expect(filasNuevas, 'el primer Garantizar debe crear exactamente UNA mesa').toHaveLength(1);
  const filaCongelada = filasNuevas[0];
  const codigoCongelado = filaCongelada.code;
  expect(filaCongelada.guarantee_method).toBe('card');
  expect(filaCongelada.status).toBe('pending_auth');
  expect(filaCongelada, 'la fila debe declarar guarantee_saved_payment_method_id')
    .toHaveProperty('guarantee_saved_payment_method_id');
  expect(filaCongelada.guarantee_saved_payment_method_id).toBeNull();

  // ⚡ La pestaña muere en el peor momento posible.
  await page.reload();

  // 🔴 La app vuelve al PASO 1: los ítems y la división viven en memoria y no
  // sobreviven. Este spec encontró que el aviso aparecía acá y su único botón
  // estaba tres pasos más adelante, en Garantía — o sea, había que volver a
  // escanear y dividir para encontrar la salida. Ahora viajan juntos.
  await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
  await expect(page.getByText('Hay una apertura de una sesión anterior.')).toBeVisible();
  await expectCampanaBloqueada(page);

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
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  await expectCampanaBloqueada(page);
  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  const otroMas = page.getByRole('button', { name: 'Un comensal más' });
  await otroMas.click();
  await otroMas.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconciliación necesaria/ })).toHaveCount(0);

  // 🔴 RECON-SETUP-02 · antes del replay, el grupo está COMPLETO y sin ninguna
  // tarjeta marcada: tras el reload no hay autoselección que respalde la
  // garantía, y la fila congelada sigue siendo la misma, con fuente NULL.
  await expect(radios).toHaveCount(3);
  await expect(santander).toBeVisible();
  await expect(santander).toBeEnabled();
  await expect(bbva).toBeVisible();
  await expect(bbva).toBeEnabled();
  await expect(nueva).toBeVisible();
  await expect(nueva).toBeEnabled();
  await expect(grupo.getByRole('radio', { checked: true })).toHaveCount(0);
  const enReconstruccion = await mesasDelMock(page);
  const mismaFila = enReconstruccion.mesas.find((m) => m.code === codigoCongelado);
  expect(mismaFila, 'la mesa congelada debe seguir en el mock').toBeDefined();
  expect(mismaFila!.guarantee_method).toBe('card');
  expect(mismaFila!.status).toBe('pending_auth');
  expect(mismaFila!, 'la fila debe declarar guarantee_saved_payment_method_id')
    .toHaveProperty('guarantee_saved_payment_method_id');
  expect(mismaFila!.guarantee_saved_payment_method_id).toBeNull();

  // ⭐ ORDEN 2-A · EL REENVÍO SE COMPLETA DE VERDAD, no se verifica que el
  // botón esté habilitado y listo. Acá es donde vivía la divergencia: tras el
  // reload el `pm_` de la tarjeta tipeada ya no está en memoria y el mock
  // materializa otro, exactamente como Stripe.js. Con el fingerprint viejo
  // —que cubría el request ENTERO— este click moría con
  // `monetary_payload_ambiguous` y el organizador quedaba sin salida.
  // Ninguna tarjeta viene elegida. El CTA permanece táctil por la precisión
  // visual vigente, pero frena antes de mutar y explica qué falta.
  const reintentarSinTarjeta = page.getByRole('button', { name: /Reintentar esta apertura/ });
  await expect(reintentarSinTarjeta).toBeEnabled();
  const antesSinTarjeta = await mesasDelMock(page);
  await reintentarSinTarjeta.click();
  await expect(page.locator('.toast')).toHaveText('Elige con qué tarjeta garantizar');
  expect((await mesasDelMock(page)).total).toBe(antesSinTarjeta.total);
  // 🔴 GAR-NOTE-03 · la nota al pie ocupa su altura real en el flujo: el
  // scroller termina por encima de ella y ella queda por encima del CTA
  // circular. Así ningún radio del grupo puede quedar debajo de una capa.
  // Geometría MEDIDA; sin scroll programático ni `force`.
  const [scrollerBox, notaBox, fabBox] = await Promise.all([
    page.locator('.gar-flow-scroll').boundingBox(),
    page.locator('.gar-note-fixed').boundingBox(),
    page.locator('.appbar-fab').boundingBox(),
  ]);
  expect(scrollerBox, 'el scroller de Garantía debe estar en pantalla').not.toBeNull();
  expect(notaBox, 'la nota al pie debe estar en pantalla').not.toBeNull();
  expect(fabBox, 'el CTA circular debe estar en pantalla').not.toBeNull();
  expect(scrollerBox!.height).toBeGreaterThan(0);
  expect(scrollerBox!.y + scrollerBox!.height).toBeLessThanOrEqual(notaBox!.y);
  expect(notaBox!.y + notaBox!.height).toBeLessThan(fabBox!.y);
  await page.getByRole('radio').filter({ hasText: 'Agregar nueva tarjeta' }).click();
  await expect(nueva).toBeChecked();
  await expect(grupo.getByRole('radio', { checked: true })).toHaveCount(1);

  const antes = await mesasDelMock(page);
  await page.getByRole('button', { name: /Reintentar esta apertura/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

  // 🔴 LA AFIRMACIÓN QUE IMPORTA: se reanudó LA MISMA apertura. Si el reenvío
  // hubiera rotado la clave, acá habría DOS mesas y dos holds por el total.
  const despues = await mesasDelMock(page);
  expect(despues.total, 'el reenvío creó una segunda mesa').toBe(antes.total);
  expect(despues.ultimoCodigo).toBe(antes.ultimoCodigo);
  await expect(page.getByText(despues.ultimoCodigo!, { exact: true })).toBeVisible();
});
