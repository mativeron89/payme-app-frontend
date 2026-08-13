import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * §1.7 · Compartir — lo que el rediseño **saca**, que es lo que hay que
 * defender.
 *
 * ## Por qué existe este recorrido
 *
 * La pantalla llegó recortada por dos bloqueos ajenos al diseño —el QR espera
 * una orden de dependencia, "Ya se sumaron" un acta de privacidad (G-30)— y el
 * spec pide explícitamente que **no se dibuje la superficie** de ninguno de los
 * dos: ni deshabilitados, ni con copy de "próximamente", ni con un selector de
 * una sola pestaña.
 *
 * Una ausencia no la rompe nadie por accidente: la rompe alguien que "completa"
 * la pantalla de buena fe. Por eso se afirma, y no se deja implícita.
 *
 * Lo mismo con **"Invitar a todos"**: existía, funcionaba, y el spec lo saca a
 * propósito — *"es un atajo para encontrar gente, no un envío masivo"*. Un
 * envío masivo desde un botón chico, en una mesa, con gente esperando, es
 * exactamente lo que nadie revisa antes de tocar.
 */

test.describe('Compartir · lo que la pantalla NO tiene, a propósito', () => {
  test('no hay pestañas: una sola sección no es un selector', async ({ page }) => {
    await ingresar(page);
    await abrirMesaConLink(page);

    // §5 bis · B no aplica acá. Con "Ya se sumaron" afuera quedaría una burbuja
    // sola, que no selecciona nada.
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Ya se sumaron/ })).toHaveCount(0);
  });

  test('no hay QR ni promesa de QR', async ({ page }) => {
    await ingresar(page);
    await abrirMesaConLink(page);

    // Ni el toggle, ni un botón apagado, ni un "próximamente". Cuando exista la
    // orden de dependencia vuelve el toggle ya especificado — no una promesa.
    await expect(page.getByText(/QR/i)).toHaveCount(0);
  });

  test('invitar a un grupo es de a uno, no un envío masivo', async ({ page }) => {
    await ingresar(page);
    await abrirMesaConLink(page);

    await expect(page.getByRole('button', { name: /Invitar a todos/ })).toHaveCount(0);

    // Tocar el grupo lo EXPANDE y muestra a sus integrantes, cada uno con su
    // propio botón. Antes de abrirlo, sus integrantes no están en pantalla.
    const grupo = page.getByRole('button', { name: /Familia/ });
    await expect(grupo).toHaveAttribute('aria-expanded', 'false');
    await grupo.click();
    await expect(grupo).toHaveAttribute('aria-expanded', 'true');

    // Sofía aparece dos veces con el grupo abierto —en contactos y adentro de
    // Familia— y las dos filas tienen su propio Invitar. Eso es lo que se
    // afirma: que el grupo trajo filas propias, no un botón único.
    await expect(page.getByRole('button', { name: 'Invitar', exact: true })).not.toHaveCount(0);
    await expect(page.getByText('Leo Paz')).not.toHaveCount(0);
  });

  test('WhatsApp comparte el LINK, no el código suelto', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);

    /**
     * El código solo **no sirve para entrar**: desde el backend v2.32.0 las tres
     * rutas de mesa exigen sesión y participación, y la credencial es el `?t=`.
     * Si alguien "simplifica" el mensaje al código, el link deja de llegar y el
     * invitado no tiene con qué canjear.
     */
    const wa = page.getByRole('link', { name: /Compartir por WhatsApp/ });
    const href = await wa.getAttribute('href');
    expect(href, 'el botón de WhatsApp no tiene href').not.toBeNull();
    const texto = decodeURIComponent(new URL(href!).searchParams.get('text') ?? '');
    expect(texto).toContain(mesa.code);
    expect(texto).toContain(mesa.token);
  });

  /**
   * La cuarta ausencia, y la última que llegó (Diseño, 2026-08-04).
   *
   * El control de la cabecera **no retrocede**, y no puede: volver a División
   * abriría una segunda mesa con un segundo hold por el total (B-06). Mientras
   * se llamó "Volver" fue una etiqueta que mentía.
   *
   * 🔴 **ACTUALIZADO 2026-08-13.** Este comentario decía que la cabecera lleva
   * a la mesa y se llama "Ver mesa". **Ya no**: los dos destinos se
   * intercambiaron por decisión de Mati, porque el control GRANDE expulsaba al
   * organizador a Inicio y el que cierra su ciclo era el chico. Ahora la
   * cabecera es la **salida secundaria a Inicio** —que Mati quiso conservar— y
   * el círculo del pie lleva a Mis ítems.
   *
   * Se afirman las dos mitades. Sólo pedir "Ir a Inicio" dejaría pasar que
   * conviviera con un "Volver" —el modo en que estas cosas se "arreglan" de
   * buena fe: agregando, no cambiando— y sólo pedir la ausencia de "Volver"
   * pasaría si no hubiera ningún control. Se agrega la ausencia de "Ver mesa"
   * en la cabecera: si volviera ahí, el destino quedaría duplicado y la salida
   * a Inicio desaparecería sin que nada más se pusiera rojo.
   *
   * Y **el contador de paso se retira**: ninguno de los dos controles navega el
   * asistente, así que "Paso 5 de 5" al lado suyo ya no significa nada. Es una
   * ausencia igual que las otras tres, y se rompe igual de fácil — copiando la
   * cabecera de cualquiera de los otros cuatro pasos, que sí lo llevan.
   */
  test('la cabecera es la salida secundaria a Inicio, y no queda contador de paso', async ({ page }) => {
    await ingresar(page);
    await abrirMesaConLink(page);

    await expect(page.getByRole('button', { name: 'Ir a Inicio', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Volver', exact: true })).toHaveCount(0);

    // Y NO duplica el destino del CTA principal: si la cabecera también fuera a
    // la mesa, la salida a Inicio que Mati quiso conservar no existiría.
    await expect(page.getByRole('button', { name: 'Ver mesa', exact: true })).toHaveCount(0);

    await expect(page.getByText(/Paso \d+ de \d+/)).toHaveCount(0);
  });

  /**
   * 🔴 EL DESTINO, no la existencia del control (2026-08-13).
   *
   * Hasta hoy el círculo del pie —el control MÁS grande de la pantalla—
   * expulsaba al organizador a Inicio, y el camino que cierra su ciclo vivía en
   * la flecha chica de la cabecera. Mati lo dijo así: *«el último paso, en vez
   * de ser seleccionar lo que consumió, lo manda al Home para que luego busque
   * la mesa»*.
   *
   * **Se afirma el destino y no el rótulo** porque el rótulo ya se había
   * arreglado una vez —"Volver" → "Ver mesa", 2026-08-04— **sin mover el
   * control**: quedó bien nombrado y escondido igual. Un test que sólo pidiera
   * el nombre habría pasado en verde todo ese tiempo.
   *
   * Las dos mitades: que el principal LLEVA a la mesa, y que la salida a Inicio
   * sigue existiendo. Sólo la primera dejaría pasar que se perdiera la salida
   * que Mati quiso conservar.
   */
  test('el CTA principal lleva a Mis ítems, y la salida a Inicio sigue disponible', async ({ page }) => {
    await ingresar(page);
    await abrirMesaConLink(page);

    const principal = page.getByRole('button', { name: 'Elegir mis ítems', exact: true });
    await expect(principal).toBeVisible();
    await principal.click();
    await expect(page).toHaveURL(/#\/mesa\/PA-/);

    // La salida a Inicio se conserva: se vuelve a compartir y se toma la otra.
    await page.goBack();
    await page.getByRole('button', { name: 'Ir a Inicio', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/);
  });
});
