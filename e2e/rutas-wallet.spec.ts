import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * 🔴 **Este recorrido prueba el CORTE, así que lo declara** (Q6). El default del
 * mock es `sandbox` —describe el flujo completo—, y cada spec que ejercita el
 * corte fija su modo antes del render.
 */
async function conRielApagado(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

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
      // El corte lo declara este recorrido, que es el que lo prueba.
      await conRielApagado(page);
      await ingresar(page);

      await page.goto(`/#/${ruta}`);

      // ⭐ La redirección, ocurriendo de verdad adentro de la app montada.
      await expect(page).toHaveURL(/#\/home$/);
      await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

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
      await conRielApagado(page);
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
   *
   * Usaba `#/cuenta` a propósito —la ruta que §1.9 dejó viva para los diez
   * call sites durmientes—. Desde el CORTE DEL VIERNES
   * (APP-FE-FRIDAY-NO-PAY-GUARD-02) esa ruta redirige a Inicio y ya no puede
   * acreditar que la app renderice: el control positivo pasa a `#/pagos`, la
   * superficie card-only que el corte CONSERVA.
   */
  test('control positivo · una ruta card-only sí se alcanza y muestra contenido', async ({ page }) => {
    await ingresar(page);

    await page.goto('/#/pagos');

    await expect(page).toHaveURL(/#\/pagos$/);
    await expect(page.getByRole('heading', { name: 'Mis pagos', exact: true })).toBeVisible();
  });

  /**
   * ⭐ **Lo que la ratificación manda CONSERVAR**: apagar el riel saldo no puede
   * apagar el historial de pagos propio ni las tarjetas. Es el error de
   * `07f0ba2`, mirado desde el navegador en vez de desde una función.
   *
   * 🔴 **§1.9 · paso 6 le movió el piso a este test y NO se lo aflojó.** Vivía
   * sobre `#/cuenta`, donde las dos superficies convivían en pestañas de
   * `CuentaScreen`. Esa pantalla se retiró, así que ahora se afirman **donde
   * viven de verdad**: `#/pagos` y `#/tarjetas`, las dos de primer nivel que
   * estrenó §1.11.
   *
   * Es la misma exigencia sobre dos rutas en vez de sobre dos pestañas — y
   * queda **más fuerte**, no más débil: antes bastaba con que `CuentaScreen`
   * montara; ahora cada superficie tiene que estar en su propia pantalla, y el
   * barrido de vocabulario corre sobre las dos por separado.
   */
  /**
   * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02) · `tarjetas` salió de
   * esta lista: el alta de tarjeta está cerrada en producción pública sin pagos
   * y `#/tarjetas` redirige a Inicio (ver el describe de abajo). Lo que este
   * bloque sigue defendiendo es lo mismo —apagar el riel saldo no apaga la
   * actividad de cuenta—, sobre la única superficie card-only que hoy se ve.
   */
  const CARD_ONLY = [
    {
      ruta: 'pagos',
      que: 'la actividad propia',
      // `GET /account/history` + `stats`, que leen `payment_attempts` y NO
      // tablas de wallet. Es exactamente lo que `07f0ba2` escondió.
      ver: (page: Page) => page.getByText('Mis pagos', { exact: true }),
    },
  ] as const;

  for (const { ruta, que, ver } of CARD_ONLY) {
    test(`${que} sigue visible con el riel apagado · #/${ruta}`, async ({ page }) => {
      await ingresar(page);
      await page.goto(`/#/${ruta}`);
      await expect(page).toHaveURL(new RegExp(`#/${ruta}$`));

      await expect(ver(page)).toBeVisible();

      // Y nada del riel saldo en el camino.
      const cuerpo = await page.locator('body').innerText();
      for (const palabra of VOCABULARIO_WALLET) {
        expect(cuerpo, `apareció "${palabra}" en #/${ruta}`).not.toContain(palabra);
      }
    });
  }
});

/**
 * CORTE DEL VIERNES · orden `APP-FE-FRIDAY-NO-PAY-GUARD-02-CLAUDE` (2026-09-01).
 *
 * El alta de tarjeta está cerrada en producción pública sin pagos: `#/tarjetas`
 * y su alias `#/cuenta` redirigen a Inicio con el MISMO mecanismo que el riel
 * saldo (`corteGuard.ts`, molde de `walletRouteGuard.ts`), y por eso se prueba
 * acá, al lado, con las mismas tres afirmaciones: termina en Inicio, Atrás no
 * la recupera, y no se montó nada de tarjetas en el camino.
 *
 * `#/pagos` se conserva: es el control positivo de arriba.
 */
const RUTAS_DEL_CORTE = ['tarjetas', 'cuenta'] as const;
const VOCABULARIO_TARJETAS = ['Mis tarjetas', 'Agregar tarjeta', 'Guardar tarjeta'];

test.describe('corte del viernes · las rutas de tarjetas no son alcanzables', () => {
  for (const ruta of RUTAS_DEL_CORTE) {
    test(`#/${ruta} escrita a mano termina en Inicio`, async ({ page }) => {
      // El corte lo declara este recorrido, que es el que lo prueba.
      await conRielApagado(page);
      await ingresar(page);

      await page.goto(`/#/${ruta}`);

      await expect(page).toHaveURL(/#\/home$/);
      await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

      const cuerpo = await page.locator('body').innerText();
      for (const palabra of VOCABULARIO_TARJETAS) {
        expect(cuerpo, `apareció "${palabra}" en #/${ruta}`).not.toContain(palabra);
      }
    });

    test(`Atrás no recupera #/${ruta}`, async ({ page }) => {
      await conRielApagado(page);
      await ingresar(page);
      await page.goto(`/#/${ruta}`);
      await expect(page).toHaveURL(/#\/home$/);

      await page.goBack();

      expect(page.url()).not.toContain(ruta);
    });
  }
});
