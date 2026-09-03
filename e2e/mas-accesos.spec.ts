import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * 🔴 **Método adjudicado por Codex (ACK R98) para las aserciones negativas que
 * NO tienen testigo UI en esta pantalla.**
 *
 * El requisito general es que toda ausencia sobre superficie gateada lleve antes
 * un testigo positivo de la misma capability. **En Inicio y en Más no existe**,
 * y está medido: con el riel apagado el corte esconde lo suyo, así que `pending`
 * y `authoritative + disabled` producen exactamente la misma pantalla; y los
 * testigos a mano —«Ver pagos», «Volver», «Idioma»— cuelgan de otras
 * capabilities, una de ellas fail-OPEN.
 *
 * Tampoco vale esperar la respuesta HTTP: **en modo mock no hay red**, el mock
 * resuelve `getConfig()` en JS. Se probó y da timeout.
 *
 * Lo que sí se hace, y es lo adjudicado: **fijar el seam del mock en `disabled`
 * antes del render**, para que la ausencia se afirme sobre un estado declarado y
 * no sobre uno que todavía viaja. La app y el censo leen el MISMO origen
 * (`MODO_MONETARIO_MOCK_POR_DEFECTO` en `src/api/mock/store.ts`), así que fijar
 * la clave no crea una segunda autoridad: reafirma la que ya rige.
 *
 * ⚠️ **Esta evidencia es más débil que la de Mesa Detail**, donde el aviso «Los
 * pagos llegan pronto» sólo existe con el riel autoritativo y sirve de testigo
 * de verdad. Acá lo que acredita la vigilancia es el **mutante**: con el riel
 * abierto, esta aserción se pone roja.
 */
async function conRielApagado(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

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
  /**
   * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02) · la fila de tarjetas
   * NO existe: el alta de tarjeta está cerrada en producción pública sin pagos,
   * y `#/tarjetas` redirige a Inicio (`rutas-wallet.spec.ts`). Se afirma la
   * ausencia con control positivo —la pantalla cargó: su fila de idioma está—.
   * El recorrido que abría «Mis tarjetas» vuelve cuando el corte se levante.
   */
  /**
   * 🔴 **La otra mitad de D-R23, y faltaba: con los pagos VIVOS la línea no va.**
   *
   * Un mutante lo destapó — quitar `!puedeCargarTarjeta` de la condición dejaba
   * la línea visible siempre y **ningún test se ponía rojo**, porque el
   * recorrido de arriba fija `disabled`, donde los dos términos dan lo mismo.
   * Prometer «los pagos llegan pronto» mientras el cobro funciona sería
   * exactamente al revés.
   */
  test('con los pagos VIVOS no hay línea de corte, y la fila de tarjetas vuelve', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('payme.app.mock.money_rail.v1', 'sandbox');
    });
    await ingresar(page);
    await page.goto('/#/mas');

    // Testigo positivo de la MISMA capability, en su otra dirección: la fila de
    // tarjetas sólo existe con el riel vivo.
    await expect(page.getByRole('button', { name: /^Mis tarjetas/ })).toBeVisible();
    await expect(page.getByText('Los pagos llegan pronto', { exact: true })).toHaveCount(0);
  });

  test('la fila de tarjetas NO existe bajo el corte del viernes', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    await page.goto('/#/mas');
    await expect(page.getByRole('button', { name: 'Volver', exact: true })).toBeVisible();

    /**
     * 🔴 **D-R23 · EL TESTIGO POSITIVO, y ahora sí es de la misma capability.**
     *
     * Esta línea existe **sólo** cuando `money_rail` es autoritativo y declara
     * los pagos apagados: con `pending` no aparece, con `sandbox` tampoco. Por
     * eso esperarla acredita que el config se aplicó, y recién entonces la
     * ausencia de abajo significa algo.
     *
     * Antes acá no había testigo posible —«Idioma» y «Volver» aparecen sin
     * config— y la evidencia era sólo el mutante. Con la línea que Mati ratificó
     * («Sí, una línea discreta en «Más»»), este recorrido queda al mismo nivel
     * que los de Mesa Detail.
     */
    await expect(page.getByText('Los pagos llegan pronto', { exact: true })).toBeVisible();

    await expect(page.getByRole('button', { name: /^Mis tarjetas/ })).toHaveCount(0);
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
   * Y con control positivo: se exige que la fila «Idioma» SÍ esté. Sin eso, "no
   * hay fila Amigos" no distingue *"se sacó"* de *"la pantalla no cargó"*. (Era
   * «Mis tarjetas», que salió con el corte del viernes.)
   */
  test('Amigos y Grupos ya no son filas de Más; Idioma sí', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');

    // Control positivo primero: la pantalla cargó y su fila de idioma está.
    await expect(page.getByText('Idioma', { exact: true })).toBeVisible();

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
