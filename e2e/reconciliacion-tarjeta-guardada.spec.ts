import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * ⭐ ORDEN 1-B · LA GARANTÍA NO SE LE ATRIBUYE A UNA TARJETA QUE NADIE ELIGIÓ.
 *
 * El hallazgo de Codex, y por qué se nos había pasado: yo argumenté que
 * `is_default` no viaja en el request y por lo tanto **no puede cambiar la
 * identidad económica**. Cierto — y era la pregunta equivocada. **El caso no
 * era sobre el hash: era sobre qué tarjeta se le MUESTRA a la persona.** Los
 * dos razonamos sobre el hash y ninguno miró la pantalla.
 *
 * El mecanismo, que este spec recorre entero: el organizador garantiza con la
 * tarjeta guardada **NO-default** (BBVA ···· 8821), el banco pide confirmar, y
 * la pestaña muere. Al volver, `loadCards()` autoselecciona la **DEFAULT**
 * (Santander ···· 4532) y la pantalla la muestra elegida, con los botones
 * deshabilitados: la app afirmaba que la garantía estaba respaldada por una
 * tarjeta que la persona no usó, y no la dejaba corregirlo.
 *
 * 🔴 **Y hay un caso donde no es sólo visual:** si el diagnóstico da
 * `not_found` —la creación nunca ocurrió— el reenvío CREA por primera vez y la
 * fuente que se manda ES la que respalda la garantía.
 *
 * El backend guarda la fuente original (`auth_source_payment_method_id`) pero
 * **no la publica en ninguna respuesta** (auditado; G-38), así que no se puede
 * restaurar. Lo honesto es no afirmar nada — que es lo que esto verifica.
 */

const DEFAULT_SEED = /Santander ···· 4532/;
const NO_DEFAULT_SEED = /BBVA ···· 8821/;

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

test('garantía con guardada NO-default: tras el reload la UI no se la atribuye a la default', async ({ page }) => {
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

  // El seed trae dos guardadas. Se elige EXPLÍCITAMENTE la que NO es la
  // principal: ahí es donde la default puede mentir después.
  const noDefault = page.getByRole('radio').filter({ hasText: NO_DEFAULT_SEED });
  await noDefault.click();
  await expect(noDefault).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('radio').filter({ hasText: DEFAULT_SEED }))
    .toHaveAttribute('aria-checked', 'false');

  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirmá con tu banco' })).toBeVisible();

  // ⚡ Muere la pestaña con el hold ya puesto sobre la NO-default.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Escaneá el ticket' })).toBeVisible();
  await page.getByRole('button', { name: 'Revisar cómo quedó esa apertura' }).click();
  await expect(page.getByText(/se creó, pero su garantía quedó sin confirmar/)).toBeVisible();

  // Se rehace el ticket para llegar a la pantalla de garantía.
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /En partes iguales/ }).click();
  const otroMas = page.getByRole('button', { name: 'Un comensal más' });
  await otroMas.click();
  await otroMas.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantizá la mesa' })).toBeVisible();

  // 🔴 LA AFIRMACIÓN CENTRAL: NINGUNA tarjeta aparece elegida — y menos la
  // default. Antes de este arreglo, Santander ···· 4532 estaba marcada.
  for (const radio of await page.getByRole('radio').all()) {
    await expect(radio).toHaveAttribute('aria-checked', 'false');
  }
  await expect(page.getByText('No podemos mostrarte con qué tarjeta se garantizó esta mesa.')).toBeVisible();
  // Y dice la verdad completa: la original es la que respalda el hold.
  await expect(page.getByText(/sigue respaldada por la tarjeta original/)).toBeVisible();

  // Sin elección, no se reenvía: el silencio no se resuelve con la default.
  await expect(page.getByRole('button', { name: /Reintentar esta apertura/ })).toBeDisabled();

  // Con elección explícita sí, y sigue sin haber una segunda mesa.
  const antes = await mesasDelMock(page);
  await page.getByRole('radio').filter({ hasText: NO_DEFAULT_SEED }).click();
  const cta = page.getByRole('button', { name: /Reintentar esta apertura/ });
  await expect(cta).toBeEnabled();
  await cta.click();
  await expect(page.getByRole('heading', { name: 'Confirmá con tu banco' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar autorización' }).click();
  await expect(page.getByRole('heading', { name: '¡Mesa garantizada!' })).toBeVisible();

  const despues = await mesasDelMock(page);
  expect(despues.total, 'el reenvío creó una segunda mesa').toBe(antes.total);
  expect(despues.ultimoCodigo).toBe(antes.ultimoCodigo);
});
