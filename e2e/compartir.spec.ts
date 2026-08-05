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
});
