import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * §1.9 · **la sección social monta la barra de cinco, y una sola.**
 *
 * ## Qué cambió en el paso 4, y qué NO se aflojó
 *
 * Amigos, Grupos y Solicitudes dejaron de ser rutas separadas: son **tres
 * pestañas de una sola pantalla**. Así que la tabla que recorría `#/amigos` y
 * `#/grupos` se cayó sola — `#/grupos` ya no existe.
 *
 * Lo que ese recorrido protegía **no se cayó con él**:
 *
 *  - que haya **una sola barra** se sigue afirmando contando el landmark;
 *  - que se pueda **salir a Inicio** se sigue afirmando, y sigue importando por
 *    lo mismo: la barra es la única vuelta desde acá;
 *  - que el **detalle de un grupo** también la lleve, ahora llegando por la
 *    pestaña en vez de por URL;
 *  - y el bug del CTA tapado, que **cambió de forma y por eso cambió de
 *    assert** — ver abajo.
 *
 * ## ⭐ El bug del CTA tapado, y por qué el test es otro
 *
 * El original medía que el botón de `.action-bar` no quedara debajo de la
 * barra: es el bug que reportó el hermano de Mati el 2026-07-24 —*"la
 * navegación está tapando el botón para agregar amigo"*—.
 *
 * **Ese `.action-bar` ya no existe**: §1.9 lo reemplazó por el tile "Nuevo
 * amigo", que vive arriba de todo y no lo puede tapar nada. Adaptar el assert
 * viejo habría sido afirmar sobre un elemento retirado: verde y vacío.
 *
 * Pero el modo de falla **no se fue, se mudó**: ahora lo que puede quedar
 * enterrado abajo de la barra es **la última fila del listado**. El mecanismo
 * que lo evita es `padding-bottom` en `.has-appbar .scroll`, y lo rompe una
 * sola cosa concreta: un `style={{ padding: N }}` inline, que es shorthand y
 * **pisa el longhand del stylesheet**. Por eso se afirma el mecanismo —el
 * padding real, comparado contra el alto real de la barra— en vez de mirar una
 * caja que en un listado corto daría verde sin probar nada.
 */

const BARRA = 'Navegación principal';

test.describe('§1.9 · la barra de cinco en la sección social', () => {
  test('#/amigos monta la barra nueva, y UNA sola', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/amigos');
    await expect(page.getByRole('tab', { name: /Solicitudes/ })).toBeVisible();

    /**
     * ⭐ **Las dos barras llevan el mismo landmark**, así que contarlo dice
     * directamente si hay dos. No depende de qué posición tenga cada una ni de
     * una clase de CSS.
     */
    const barra = page.getByRole('navigation', { name: BARRA });
    await expect(barra).toHaveCount(1);

    // Y es la de cinco: su círculo central y su posición propia. Todo scopeado
    // a la barra — "Amigos" también es una pestaña, y sin scope el selector
    // matchea dos elementos y el test se cae por ambigüedad.
    await expect(barra.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(barra.getByRole('button', { name: 'Amigos', exact: true })).toBeVisible();
    /**
     * La posición "Cuenta" existe en la barra VIEJA y no en la de cinco (Cuenta
     * se fusionó dentro de las pestañas de Inicio en §1.11). Es lo que
     * distingue una barra de la otra sin mirar una clase de CSS.
     */
    await expect(barra.getByRole('button', { name: 'Cuenta', exact: true })).toHaveCount(0);
  });

  test('#/amigos sale a Inicio por la barra', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/amigos');

    const barra = page.getByRole('navigation', { name: BARRA });
    await barra.getByRole('button', { name: 'Inicio', exact: true }).click();

    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toBeVisible();
  });

  /**
   * Las tres pestañas encienden **Amigos** en la barra, no una posición cada
   * una: son una sección sola. Cambiar de pestaña no puede cambiar dónde creés
   * que estás.
   */
  for (const pestania of ['Amigos', 'Grupos', 'Solicitudes']) {
    test(`la pestaña ${pestania} deja Amigos encendida en la barra`, async ({ page }) => {
      await ingresar(page);
      await page.goto('/#/amigos');

      await page.getByRole('tab', { name: new RegExp(`^${pestania}`) }).click();
      await expect(page.getByRole('tab', { name: new RegExp(`^${pestania}`) }))
        .toHaveAttribute('aria-selected', 'true');

      const barra = page.getByRole('navigation', { name: BARRA });
      await expect(barra).toHaveCount(1);
      // `aria-current="page"` es lo que marca la posición activa de la barra.
      await expect(barra.getByRole('button', { name: 'Amigos', exact: true }))
        .toHaveAttribute('aria-current', 'page');
    });
  }

  /**
   * ⭐ **El listado no queda debajo de la barra.** Sucesor del bug del CTA
   * tapado; ver el encabezado de este archivo para por qué el assert es otro.
   *
   * Se mide el mecanismo y no una caja: con pocos amigos el listado no llega
   * abajo, así que un `boundingBox` daría verde con el padding roto.
   */
  test('el scroll de la sección social deja aire para la barra', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/amigos');
    await expect(page.getByRole('tab', { name: /Solicitudes/ })).toBeVisible();

    const scroll = page.locator('.screen.has-appbar > .scroll');
    const padding = await scroll.evaluate(
      (el) => parseFloat(getComputedStyle(el).paddingBottom),
    );
    const caja = await page.locator('.appbar-block').boundingBox();
    expect(caja, 'no encontré la barra').not.toBeNull();

    expect(
      padding,
      `el scroll deja ${padding}px abajo y la barra mide ${caja!.height}px: ` +
        'la última fila del listado queda enterrada. Suele ser un `style={{ padding: N }}` ' +
        'inline, que es shorthand y pisa el longhand de `.has-appbar .scroll`.',
    ).toBeGreaterThanOrEqual(caja!.height);
  });

  /**
   * El **detalle** de un grupo lleva flecha de volver, y por eso mismo va sin
   * logo (§5 bis · A). Sin barra quedaría con una sola salida —la flecha, que
   * vuelve a la lista— y **ninguna que saque de la sección**.
   *
   * Ya no se llega por URL: hay que entrar por la pestaña Grupos.
   */
  test('el detalle de un grupo también lleva la barra, y sale a Inicio', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/amigos');

    await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
    await page.getByRole('button', { name: /Familia/ }).click();
    await expect(page.getByText(/^Miembros \(/)).toBeVisible();

    const barra = page.getByRole('navigation', { name: BARRA });
    await expect(barra).toHaveCount(1);

    await barra.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/);
  });
});
