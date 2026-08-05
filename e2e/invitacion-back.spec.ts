import { expect, test } from '@playwright/test';
import { ingresar, tokenDeLaUrl } from './_app';

/**
 * ORDEN 5 · recorrido 1 · CIERRA EL ANCLA DE 4B.
 *
 * ## Qué quedó sin probar en 4B, exactamente
 *
 * La suite de vitest fija que la limpieza usa `replaceState` y nunca
 * `pushState`, que el hash resultante no trae `t`, y que resolver el token
 * desde cero después de un terminal da `null`. Lo que **no podía** afirmar,
 * y quedó escrito como ancla:
 *
 *   > qué pasa con entradas de historial **anteriores** a que la pantalla se
 *   > montara. `replaceState` no las alcanza, y ningún test de esa suite las ve.
 *
 * Eso necesita un navegador con historial de verdad. Es esto.
 *
 * ## Por qué importa que Back no reviva el token
 *
 * El token dejó de ser autorización y es una **credencial**. Si el botón Atrás
 * recupera una entrada con `?t=`, `useRoute` la parsea y la app vuelve a
 * custodiar una credencial que ya se había soltado — y en el caso terminal, una
 * que el emisor **ya declaró inservible**. Queda en la barra de direcciones de
 * un teléfono que se pasa alrededor de la mesa.
 *
 * ## Por qué el token de estos tests es inválido, y no es una limitación
 *
 * El 403 es **el** caso del ancla: es cuando la app suelta la credencial. Un
 * token válido no la suelta hasta después del canje, así que probaría otra cosa.
 * El canje exitoso está cubierto en `pago-completo.spec.ts`.
 */

/** 8..200 caracteres: pasa la validación de forma y muere en el 403 del emisor. */
const TOKEN_MUERTO = 'tok-que-no-existe-en-ninguna-mesa';

test.describe('el token de un link terminal no revive por historial', () => {
  test('abrir el link directo: la URL queda limpia y Atrás no lo trae de vuelta', async ({ page }) => {
    await ingresar(page);

    // Se entra por el link, que es como llega la gente: desde WhatsApp.
    await page.goto(`/#/mesa/PA-9999?t=${TOKEN_MUERTO}`);

    // El 403 ciego. Los cuatro motivos comparten esta pantalla a propósito.
    await expect(page.getByText('Este link ya no funciona')).toBeVisible();

    // ⭐ Lo primero: la credencial muerta salió de la URL.
    expect(tokenDeLaUrl(page.url())).toBeNull();

    // ⭐ Y lo que vitest no podía ver: apretar Atrás de verdad.
    await page.goBack();
    expect(tokenDeLaUrl(page.url())).toBeNull();
  });

  /**
   * El caso que el ancla nombraba: **historial previo al montaje**. Acá la
   * entrada con `?t=` no es la primera —hay una pantalla antes— así que si
   * `replaceState` no la alcanzara, Atrás la recuperaría.
   */
  test('con una pantalla previa, Atrás vuelve a ella y no al link con token', async ({ page }) => {
    await ingresar(page);
    await expect(page).toHaveURL(/#\/home|:\d+\/$/);

    // Navegación DENTRO de la app, que es la que crea entrada de historial.
    await page.evaluate((t) => {
      window.location.hash = `#/mesa/PA-9999?t=${t}`;
    }, TOKEN_MUERTO);

    await expect(page.getByText('Este link ya no funciona')).toBeVisible();
    expect(tokenDeLaUrl(page.url())).toBeNull();

    await page.goBack();

    // Volvió a la app, no a una URL con la credencial adentro.
    expect(tokenDeLaUrl(page.url())).toBeNull();
    await expect(page.getByRole('button', { name: 'Nueva Mesa' })).toBeVisible();
  });

  /**
   * Recargar es lo más natural que hace alguien cuando algo no funciona. Si el
   * token sobreviviera en `sessionStorage` o en la URL, la mesa quedaría
   * capturada por un link inválido: entrás, canjea solo, falla, y no hay salida.
   */
  test('recargar después del terminal no vuelve a intentar con el token', async ({ page }) => {
    await ingresar(page);
    await page.goto(`/#/mesa/PA-9999?t=${TOKEN_MUERTO}`);
    await expect(page.getByText('Este link ya no funciona')).toBeVisible();

    await page.reload();

    expect(tokenDeLaUrl(page.url())).toBeNull();
    // Sin token no hay canje: la app muestra la mesa (que no existe) o el hub,
    // pero NUNCA vuelve a la pantalla del link. Lo que no puede pasar es que
    // reaparezca el rechazo, porque eso significaría que reintentó.
    await expect(page.getByText('Este link ya no funciona')).toHaveCount(0);
  });

  /**
   * Y el respaldo tampoco sobrevive. `sessionStorage` es la otra custodia: si
   * el terminal limpia la URL pero deja la fila, cualquier visita futura a esa
   * mesa la levanta y vuelve a canjear un token muerto.
   */
  test('el respaldo en sessionStorage también queda vacío', async ({ page }) => {
    await ingresar(page);
    await page.goto(`/#/mesa/PA-9999?t=${TOKEN_MUERTO}`);
    await expect(page.getByText('Este link ya no funciona')).toBeVisible();

    const guardado = await page.evaluate(() =>
      window.sessionStorage.getItem('payme_pending_invitation_link'),
    );
    expect(guardado).toBeNull();
  });
});
