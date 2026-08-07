import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

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
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /En partes iguales/ }).click();
  const masUno = page.getByRole('button', { name: 'Un comensal más' });
  await masUno.click();
  await masUno.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantizá la mesa' })).toBeVisible();

  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  // Acá la mesa YA existe en `pending_auth` y el hold está puesto: el backend
  // contestó `requires_action` y el journal quedó congelado a propósito.
  await expect(page.getByRole('heading', { name: 'Confirmá con tu banco' })).toBeVisible();

  // ⚡ La pestaña muere en el peor momento posible.
  await page.reload();

  // 🔴 La app vuelve al PASO 1: los ítems y la división viven en memoria y no
  // sobreviven. Este spec encontró que el aviso aparecía acá y su único botón
  // estaba tres pasos más adelante, en Garantía — o sea, había que volver a
  // escanear y dividir para encontrar la salida. Ahora viajan juntos.
  await expect(page.getByRole('heading', { name: 'Escaneá el ticket' })).toBeVisible();
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
  await expect(page.getByText(/podés reenviarla tal cual/)).toBeVisible();

  // Y la salida existe de verdad: rehecho el ticket, el CTA deja de decir
  // "Reconciliación necesaria" y pasa a ofrecer reenviar ESTE intento —con SU
  // clave, que es lo único que no puede duplicar la garantía—.
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /En partes iguales/ }).click();
  const otroMas = page.getByRole('button', { name: 'Un comensal más' });
  await otroMas.click();
  await otroMas.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantizá la mesa' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Reconciliación necesaria/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Reintentar esta apertura/ })).toBeEnabled();
});
