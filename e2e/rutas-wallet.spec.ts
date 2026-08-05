import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * ORDEN 5 · recorrido 2 · CIERRA EL ANCLA DE 4C.
 *
 * ## Qué quedó sin probar en 4C
 *
 * La suite de vitest prueba las dos mitades por separado, y **no podía unirlas**:
 *
 *  - que el guard llame a `replaceRoute('home')` → probado, y muere con mutante;
 *  - que `App` no monte `TopupScreen` ni llame endpoints → probado montando el
 *    árbol con `renderToStaticMarkup`.
 *
 * Pero `renderToStaticMarkup` **no corre efectos**, así que la redirección
 * *ocurriendo dentro de la app montada* nunca se ejercitó. Las dos mitades
 * quedaban unidas sólo por un guardarraíl de fuente, que es el mutante que mata
 * un solo test. Esto lo cierra: en un navegador de verdad, escribir `#/cargar`
 * en la barra de direcciones termina en Inicio.
 *
 * ## Qué NO es este recorrido
 *
 * No prueba que el riel saldo esté apagado en el backend — eso lo hace el
 * emisor, con siete entrypoints devolviendo 410 desde v2.33.0. Esta capa
 * impide **ofrecer** lo que no existe. Las dos son necesarias y ninguna
 * sustituye a la otra.
 */

const RUTAS_DEL_RIEL = ['cargar', 'transferir'] as const;

/**
 * Vocabulario que sólo existe en la UI del riel saldo. Si alguna aparece,
 * algo de wallet se montó.
 */
const VOCABULARIO_WALLET = ['CLABE', 'Saldo PayMe', 'OXXO', 'Cargar saldo'];

test.describe('las rutas del riel saldo no son alcanzables', () => {
  for (const ruta of RUTAS_DEL_RIEL) {
    test(`#/${ruta} escrita a mano termina en Inicio`, async ({ page }) => {
      await ingresar(page);

      await page.goto(`/#/${ruta}`);

      // ⭐ La redirección, ocurriendo de verdad adentro de la app montada.
      await expect(page).toHaveURL(/#\/home$/);
      await expect(page.getByRole('button', { name: 'Nueva Mesa' })).toBeVisible();

      // Y no se montó nada del riel en el camino.
      const cuerpo = await page.locator('body').innerText();
      for (const palabra of VOCABULARIO_WALLET) {
        expect(cuerpo, `apareció "${palabra}" en #/${ruta}`).not.toContain(palabra);
      }
    });

    /**
     * ⭐ `replaceRoute` y no `navigate`: la ruta bloqueada **no queda viva en el
     * historial**. Si quedara, el botón Atrás la recuperaría y entraríamos por
     * la puerta de atrás a una ruta que no se puede alcanzar por la de adelante.
     * Es el mismo mecanismo que el token de invitación, y es lo que ningún test
     * sin navegador podía comprobar.
     */
    test(`Atrás no recupera #/${ruta}`, async ({ page }) => {
      await ingresar(page);
      await page.goto(`/#/${ruta}`);
      await expect(page).toHaveURL(/#\/home$/);

      await page.goBack();

      expect(page.url()).not.toContain(ruta);
    });
  }

  /**
   * Ningún endpoint del riel se llama. `TopupScreen` pide `GET /wallet/clabe`
   * y `TransferScreen` busca destinatarios apenas montan, así que si algo de
   * eso viaja por la red es porque la pantalla se montó — aunque después se
   * desmonte y no se vea nada.
   */
  test('no se llama a ningún endpoint del riel', async ({ page }) => {
    const llamadas: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/\/(wallet|topups?|transfers?|clabe|balance)\b/i.test(u)) llamadas.push(u);
    });

    await ingresar(page);
    for (const ruta of RUTAS_DEL_RIEL) {
      await page.goto(`/#/${ruta}`);
      await expect(page).toHaveURL(/#\/home$/);
    }

    expect(llamadas).toEqual([]);
  });

  /**
   * CONTROL POSITIVO, por la misma razón que en la suite de vitest: sin esto,
   * "no aparece CLABE" no distingue *"el gate funciona"* de *"la app no
   * renderiza nada en este entorno"*. Una ruta legítima tiene que renderizar.
   */
  test('control positivo · una ruta card-only sí se alcanza y muestra contenido', async ({ page }) => {
    await ingresar(page);

    await page.goto('/#/cuenta');

    await expect(page).toHaveURL(/#\/cuenta$/);
    const cuerpo = await page.locator('body').innerText();
    expect(cuerpo.length).toBeGreaterThan(100);
  });

  /**
   * Y lo que la ratificación manda CONSERVAR: apagar el riel saldo no puede
   * apagar el historial de pagos propio ni las tarjetas. Es el error de
   * `07f0ba2`, mirado desde el navegador en vez de desde una función.
   */
  test('las tarjetas y la actividad propia siguen visibles con el riel apagado', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/cuenta');
    await expect(page).toHaveURL(/#\/cuenta$/);

    // La actividad propia: `GET /account/history` + `stats`, que leen
    // `payment_attempts` y NO tablas de wallet. Es lo que `07f0ba2` escondió.
    await expect(page.getByText('MIS PAGOS')).toBeVisible();

    // Y las tarjetas, que viven en su pestaña.
    await page.getByRole('button', { name: 'Tarjetas' }).click();
    await expect(page.getByText(/····/).first()).toBeVisible();

    // Nada del riel saldo, en ninguna de las dos pestañas.
    const cuerpo = await page.locator('body').innerText();
    for (const palabra of VOCABULARIO_WALLET) {
      expect(cuerpo).not.toContain(palabra);
    }
  });
});
