import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * §1.8 · Avisos pasa a ser de PRIMER NIVEL, y eso **no es cosmética: es
 * navegación**.
 *
 * ## Por qué existe este recorrido
 *
 * El rediseño le saca la flecha de volver. La regla de `SISTEMA_DISENO.md`
 * §5 bis · A es dura —*"si una pantalla tiene el logo arriba, es de primer
 * nivel; no puede tener flecha de volver"*— pero el precio de aplicarla es que
 * **la única salida deliberada de la pantalla pasa a ser la barra inferior**.
 *
 * Si esa salida se rompe, la persona queda encerrada en Avisos: no hay flecha,
 * y en un teléfono el gesto de atrás es lo único que le queda. **Ningún test de
 * los que había tocaba esta pantalla**, así que sacar el `AppHeaderBack` no
 * rompía nada visible para la suite.
 *
 * Se prueba lo que la persona hace: entra por la campana, sale por la barra, y
 * el Atrás del navegador —que no es nuestro— sigue funcionando igual.
 */

test.describe('Avisos conserva salida explícita', () => {
  test('se entra por la campana y Volver regresa a Inicio sin duplicar la campana', async ({ page }) => {
    await ingresar(page);

    await page.getByRole('button', { name: 'Avisos', exact: true }).click();
    await expect(page).toHaveURL(/#\/avisos$/);

    // La campana de esta pantalla NO es un botón: ya estás adentro y no hay
    // adónde ir. Por eso se busca por rol de imagen y su nombre accesible, que
    // además es lo único que dice de qué pantalla se trata — no hay título.
    await expect(page.getByRole('img', { name: 'Estás en Avisos' })).toBeVisible();

    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/#\/avisos$/);
  });

  test('la barra inferior es la salida, y funciona', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Avisos', exact: true }).click();
    await expect(page).toHaveURL(/#\/avisos$/);

    await page.getByRole('button', { name: 'Inicio', exact: true }).click();

    // Por lo que se VE y no sólo por el hash: lo que importa es que Inicio esté
    // montado de verdad, no que la URL diga otra cosa.
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Cuenta', exact: true })).toBeVisible();
  });

  test('el Atrás del navegador sigue devolviendo a Inicio', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Avisos', exact: true }).click();
    await expect(page).toHaveURL(/#\/avisos$/);

    // El router es de hash y no se tocó, pero la afirmación vale igual: es el
    // gesto que la gente usa en el teléfono, y ahora es la única alternativa a
    // la barra.
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Cuenta', exact: true })).toBeVisible();
  });

  test('la invitación pendiente dice "Sumarme" y lleva a la mesa', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Avisos', exact: true }).click();

    // El verbo es el mismo que "Sumate a la mesa" de la entrada por link (§1.2).
    // Decía "Aceptar y ver la mesa →", que no es el verbo de ningún otro lado.
    await page.getByRole('button', { name: 'Sumarme', exact: true }).click();

    await expect(page).toHaveURL(/#\/mesa\/PA-/);
  });
});
