import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * §1.9 · paso 2 · **la fila de tarjetas de Perfil llega a Mis tarjetas.**
 *
 * ## Por qué existe
 *
 * Esa fila era el **único `navigate('cuenta')` vivo del repo** y apuntaba a la
 * Cuenta vieja, que §1.9 retira. Ahora apunta a `#/tarjetas`.
 *
 * Y **ninguna prueba tocaba Perfil** — ni vitest ni Playwright—, así que
 * cambiarle el destino a esa fila no rompía nada que la suite pudiera ver, y
 * romperlo tampoco lo habría roto. Un acceso que nadie ejercita es un botón
 * declarado, no un botón que funciona; es la misma razón por la que §1.11
 * estrenó `inicio-accesos.spec.ts` y §1.8 estrenó el suyo.
 *
 * ## Qué NO prueba
 *
 * No prueba que la Cuenta vieja sea inalcanzable: **no lo es y no debe serlo
 * todavía**. `case 'cuenta'` sigue en pie porque hay ocho `navigate('cuenta')`
 * durmientes —riel saldo— preservados por ratificación, y sacarles el destino
 * dejaría la app en blanco si alguno se alcanzara. Eso lo cierra §1.9 cuando
 * reapunte la ruta, no este recorrido.
 */

test.describe('los accesos de Perfil', () => {
  test('la fila de tarjetas abre Mis tarjetas, no la Cuenta vieja', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/perfil');

    // El rótulo lo decide el backend (OLA 5C · c): con el riel saldo apagado
    // —que es el único estado posible hoy— dice "Mis tarjetas".
    //
    // Va anclado al principio y no `exact`: el nombre accesible de la fila es
    // "Mis tarjetas →", porque el chevron es texto y entra en el nombre. Con
    // `exact: true` no matchea nada y el test se cae por timeout, que es lo que
    // pasó al escribirlo.
    await page.getByRole('button', { name: /^Mis tarjetas/ }).click();

    await expect(page).toHaveURL(/#\/tarjetas$/);
    await expect(page.getByText('Mis tarjetas', { exact: true })).toBeVisible();

    // ⭐ Y NO pasó por la Cuenta vieja en el camino. Sin esta línea, un destino
    // que fuera a `cuenta` y de ahí rebotara pasaría igual.
    await expect(page.getByRole('heading', { name: 'Mi Cuenta', exact: true })).toHaveCount(0);
  });
});
