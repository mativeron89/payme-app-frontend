import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * **`Más`** — la quinta posición de la barra, ya no "provisoriamente".
 *
 * ## Qué cambió, y por qué el archivo se llama distinto
 *
 * Era `perfil-accesos.spec.ts`. §1.9 resolvió que **`Más` ES Perfil, no la
 * contiene**, así que la ruta se renombró de `perfil` a `mas` —limpia, sin
 * alias: a diferencia de `cuenta`, esta ruta **no tenía un solo
 * `navigate('perfil')` durmiente**, su único call site era la barra— y con ella
 * el archivo.
 *
 * ## Por qué existe
 *
 * **Ninguna prueba tocaba esta pantalla** —ni vitest ni Playwright— hasta el
 * paso 2. O sea que cambiarle el destino a su fila de tarjetas no rompía nada
 * que la suite pudiera ver, y romperlo tampoco. Un acceso que nadie ejercita es
 * un botón declarado, no un botón que funciona.
 *
 * ## Qué NO prueba
 *
 * No prueba que la Cuenta vieja sea inalcanzable: **no lo es, a propósito.**
 * `CuentaScreen` se retiró en el paso 6 pero `case 'cuenta'` sobrevive apuntando
 * a `TarjetasScreen`, porque quedan ocho `navigate('cuenta')` durmientes
 * preservados por ratificación. Eso se afirma en `rutas-montan-pantalla`.
 */

test.describe('los accesos de Más', () => {
  test('la fila de tarjetas abre Mis tarjetas, no la Cuenta vieja', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');

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

  /**
   * §1.9 · paso 3 · **la barra nueva, y una sola.**
   *
   * Montar `AppBottomBar` y salir de la lista de la barra vieja van juntas;
   * hacer una sola **deja las dos barras conviviendo**, y eso es peor que no
   * haber empezado.
   *
   * Y afirma la salida, que es lo que de verdad importa: la barra vieja era la
   * ÚNICA vuelta a Inicio desde acá. Si la nueva no navegara, la persona
   * quedaría encerrada — el mismo modo de falla que §1.8 cubrió cuando Avisos
   * perdió su flecha de volver.
   */
  test('Más monta la barra de cinco y sale a Inicio, sin dos barras', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');

    const barra = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(barra).toHaveCount(1);

    await expect(barra.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(barra.getByRole('button', { name: 'Más', exact: true })).toBeVisible();

    await barra.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toBeVisible();
  });

  /**
   * ⭐ **La quinta posición lleva a `Más`, y la posición se marca.**
   *
   * Se afirman las dos mitades en el mismo test porque el cambio fue atómico: el
   * destino de la posición **y** la ruta de la pantalla. Mientras el destino
   * decía `perfil` "provisoriamente", tocar Más llegaba igual a algo — así que
   * sólo mirar que "llega a una pantalla" no habría distinguido el antes del
   * después.
   */
  test('la quinta posición de la barra abre `#/mas` y queda marcada', async ({ page }) => {
    await ingresar(page);

    const barra = page.getByRole('navigation', { name: 'Navegación principal' });
    await barra.getByRole('button', { name: 'Más', exact: true }).click();

    await expect(page).toHaveURL(/#\/mas$/);
    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    await expect(barra.getByRole('button', { name: 'Más', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  /**
   * 🔴 **Las dos filas que §1.9 SACÓ, afirmadas como ausencia.**
   *
   * Amigos y Grupos ya son **posiciones de la barra** —Grupos como pestaña
   * dentro de Amigos—, así que estas filas eran **un segundo camino al mismo
   * lugar**. Un acceso duplicado no es redundancia inofensiva: es navegación que
   * hay que mantener coherente en dos lados y que se desincroniza sola.
   *
   * Es exactamente el tipo de ausencia que rompe alguien **completando la
   * pantalla de buena fe** — "a Más le falta Amigos"— dentro de seis meses. Por
   * eso se afirma y no se deja implícita.
   *
   * Y con control positivo: se exige que "Mis tarjetas" SÍ esté. Sin eso, "no
   * hay fila Amigos" no distingue *"se sacó"* de *"la pantalla no cargó"*.
   */
  test('Amigos y Grupos ya no son filas de Más; Mis tarjetas sí', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');

    // Control positivo primero: la pantalla cargó y su fila card-only está.
    await expect(page.getByRole('button', { name: /^Mis tarjetas/ })).toBeVisible();

    /**
     * ⚠️ La primera versión de este test buscaba **cero** botones "Amigos" en la
     * página y falló — **por la razón exacta que justifica el cambio**: la barra
     * inferior tiene su propia posición Amigos. Que la fila y la posición
     * chocaran en el mismo selector *es* el duplicado que §1.9 sacó, visto dos
     * veces.
     *
     * Así que se afirma la ausencia **con precisión y sin tocar CSS**: en toda
     * la página hay exactamente UN "Amigos", y está **dentro de la barra**.
     * Ambas líneas juntas dicen que afuera de la barra no queda ninguno — si
     * alguien devuelve la fila, la primera pasa a 2.
     */
    const barra = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(page.getByRole('button', { name: /^Amigos/ })).toHaveCount(1);
    await expect(barra.getByRole('button', { name: 'Amigos', exact: true })).toHaveCount(1);

    // Grupos no tiene posición propia —vive como pestaña dentro de Amigos—, así
    // que acá el cero es cero en toda la página.
    await expect(page.getByRole('button', { name: /^Grupos/ })).toHaveCount(0);
  });
});
