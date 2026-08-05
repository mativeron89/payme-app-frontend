import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * §1.11 · **la pestaña lanza, no muestra** — y esto prueba que llega.
 *
 * ## Por qué existe este recorrido
 *
 * Las tres pantallas destino son rutas de PRIMER NIVEL: `#/tarjetas`, `#/pagos`
 * y `#/estadisticas`, cada una con su `case` en el switch de `src/App.tsx`.
 * Sin este spec, borrar cualquiera de esos tres `case` **no rompía nada**: el
 * switch no tiene `default`, así que la pantalla simplemente no se monta y la
 * app queda en blanco sin que ningún test se entere. Un `case` que nadie
 * ejercita es una ruta declarada, no una ruta que funciona.
 *
 * Cubre además el otro extremo del cable: que el acceso de la pestaña de Inicio
 * **navegue de verdad**. Los dos lados fallan igual de silenciosos.
 *
 * Se prueba por rol y por texto visible, no por CSS, y sin un solo
 * `waitForTimeout`.
 */

/** El acceso tal cual lo toca la persona → la pantalla a la que tiene que caer. */
const ACCESOS = [
  { pestana: 'Cuenta', acceso: 'Ver tarjetas', hash: '#/tarjetas', titulo: 'Mis tarjetas' },
  { pestana: 'Cuenta', acceso: 'Ver pagos', hash: '#/pagos', titulo: 'Mis pagos' },
  {
    pestana: 'Estadísticas',
    acceso: 'Ver mis estadísticas',
    hash: '#/estadisticas',
    titulo: 'Mis estadísticas',
  },
] as const;

test.describe('los accesos de las pestañas de Inicio llegan a su pantalla', () => {
  for (const { pestana, acceso, hash, titulo } of ACCESOS) {
    test(`"${acceso}" abre ${titulo}`, async ({ page }) => {
      await ingresar(page);

      await page.getByRole('tab', { name: pestana, exact: true }).click();
      await page.getByRole('button', { name: acceso, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`${hash.replace('#/', '#\\/')}$`));
      await expect(page.getByText(titulo, { exact: true })).toBeVisible();

      /**
       * Y la vuelta: "Volver" devuelve a Inicio, no a una pantalla intermedia.
       *
       * Se afirma por lo que se VE y no por el hash, a propósito: `goBack`
       * camina el historial real del navegador, y la entrada anterior es la
       * que dejó `page.goto('/')` — o sea la URL **sin** hash, que el router
       * resuelve a Inicio por default. Pedir `#/home` acá haría fallar un
       * regreso que es correcto.
       */
      await page.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Cuenta', exact: true })).toBeVisible();
    });
  }

  /**
   * La pestaña Asociadas **existe y no tiene interior**, a propósito: hijos es
   * Cuentas Junior y pareja es un instrumento de pago compartido, las dos stop
   * conditions del gobierno. Lo único permitido es un estado honesto.
   *
   * El test afirma la AUSENCIA de accesos, que es lo que hay que defender: el
   * día que alguien le agregue una fila, este recorrido lo dice.
   */
  test('Asociadas muestra un estado honesto y ningún acceso', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('tab', { name: 'Asociadas', exact: true }).click();

    await expect(page.getByText('Todavía no está disponible', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Ver / })).toHaveCount(0);
  });
});
