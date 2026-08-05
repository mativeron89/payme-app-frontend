import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * §1.9 · paso 3 · **las pantallas de la sección social montan la barra de cinco,
 * y una sola.**
 *
 * ## Las dos mitades, y por qué se afirman juntas
 *
 * Convertir una pantalla es montar `AppBottomBar` **y** sacarla de `showNav` en
 * `App.tsx`. Hacer una sola mitad **deja las dos barras conviviendo,
 * superpuestas** — el modo de falla por el que "media §1.9 es peor que
 * ninguna". Ninguna de las dos mitades se rompe con un error: se rompe con una
 * pantalla que se ve mal, y eso no lo ve ningún test que no mire.
 *
 * ## Lo que de verdad importa acá es la SALIDA
 *
 * `BottomNav` era la **única vuelta a Inicio** desde estas pantallas. Si la
 * barra nueva no navegara, la persona queda **encerrada** — el mismo modo de
 * falla que §1.8 cubrió cuando Avisos perdió su flecha de volver.
 *
 * Perfil no está en esta tabla: se convirtió primero y su recorrido vive en
 * `perfil-accesos.spec.ts`, junto con el acceso a Mis tarjetas que cambió en el
 * mismo paso.
 */

/** Rutas ya convertidas, con la posición que les corresponde encendida. */
const CONVERTIDAS = [
  { ruta: 'amigos', posicion: 'Amigos', titulo: 'Amigos' },
  /**
   * Grupos enciende **Amigos**, no una posición propia: vive DENTRO de esa
   * sección y comparten pestañas internas. Es el criterio que ya usaba
   * `BottomNav`, no uno nuevo.
   */
  { ruta: 'grupos', posicion: 'Amigos', titulo: 'Grupos' },
] as const;

/**
 * La posición "Cuenta" existe en `BottomNav` y **no** en la barra de cinco
 * (Cuenta se fusionó dentro de las pestañas de Inicio en §1.11). Es lo que
 * distingue una barra de la otra sin mirar una clase de CSS.
 */
const SOLO_EN_LA_BARRA_VIEJA = 'Cuenta';

async function noTapadoPor(page: Page, cta: string, barra: string) {
  const a = await page.locator(cta).boundingBox();
  const b = await page.locator(barra).boundingBox();
  expect(a, `no encontré ${cta}`).not.toBeNull();
  expect(b, `no encontré ${barra}`).not.toBeNull();
  return { fondoDelCta: a!.y + a!.height, techoDeLaBarra: b!.y };
}

test.describe('§1.9 · la barra de cinco en la sección social', () => {
  for (const { ruta, posicion, titulo } of CONVERTIDAS) {
    test(`#/${ruta} monta la barra nueva, y UNA sola`, async ({ page }) => {
      await ingresar(page);
      await page.goto(`/#/${ruta}`);
      await expect(page.getByRole('heading', { name: titulo, exact: true })).toBeVisible();

      /**
       * ⭐ **Las dos barras llevan el mismo landmark**, así que contarlo dice
       * directamente si hay dos. Es mejor que cualquier proxy: no depende de
       * qué posición tenga cada una ni de una clase de CSS.
       */
      const barra = page.getByRole('navigation', { name: 'Navegación principal' });
      await expect(barra).toHaveCount(1);

      // Y es la de cinco: su círculo central y su posición propia. Todo scopeado
      // a la barra — "Amigos" también es una pestaña de `SocialTabs`, y sin
      // scope el selector matchea dos elementos y el test se cae por ambigüedad.
      await expect(barra.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
      await expect(barra.getByRole('button', { name: posicion, exact: true })).toBeVisible();
      await expect(
        barra.getByRole('button', { name: SOLO_EN_LA_BARRA_VIEJA, exact: true }),
      ).toHaveCount(0);
    });

    test(`#/${ruta} sale a Inicio por la barra`, async ({ page }) => {
      await ingresar(page);
      await page.goto(`/#/${ruta}`);

      const barra = page.getByRole('navigation', { name: 'Navegación principal' });
      await barra.getByRole('button', { name: 'Inicio', exact: true }).click();

      await expect(page).toHaveURL(/#\/home$/);
      await expect(page.getByRole('tab', { name: 'Asociadas', exact: true })).toBeVisible();
    });
  }

  /**
   * ⭐ El CTA de Amigos **no queda debajo de la barra**.
   *
   * `.action-bar` no es fijo y la barra sí, así que sin aire por debajo la barra
   * se le monta encima. **Es literalmente el bug que reportó el hermano de Mati
   * el 2026-07-24** —*"la navegación está tapando el botón para agregar
   * amigo"*—, que `.has-nav .action-bar` había cerrado y que la conversión a la
   * barra nueva reabre si nadie escribe su gemelo.
   *
   * Se mide con cajas y no con `toBeVisible()`: **un elemento tapado por otro
   * sigue siendo "visible" para Playwright**, así que ese assert habría pasado
   * con el botón enterrado abajo de la barra.
   */
  test('el CTA de Amigos queda por encima de la barra, no debajo', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/amigos');

    const cta = page.getByRole('button', { name: '+ Agregar amigo' });
    await expect(cta).toBeVisible();
    await cta.scrollIntoViewIfNeeded();

    const { fondoDelCta, techoDeLaBarra } = await noTapadoPor(
      page,
      '.action-bar button',
      '.appbar-block',
    );
    expect(
      fondoDelCta,
      `el CTA termina en ${fondoDelCta} y la barra empieza en ${techoDeLaBarra}: está tapado`,
    ).toBeLessThanOrEqual(techoDeLaBarra);
  });

  /**
   * El **detalle** de un grupo es la otra vista de la misma ruta, y hoy también
   * dibujaba `BottomNav`. Sin barra quedaría con una sola salida —la flecha, que
   * vuelve a la lista— y **ninguna que saque de la sección**.
   *
   * Va aparte de la tabla porque no se llega por URL: hay que abrir un grupo.
   */
  test('el detalle de un grupo también lleva la barra, y sale a Inicio', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/grupos');

    await page.getByRole('button', { name: /Familia/ }).click();
    await expect(page.getByText(/^Miembros \(/)).toBeVisible();

    const barra = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(barra).toHaveCount(1);

    await barra.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/);
  });

  /**
   * **Cuenta ya no tiene recorrido acá, y es correcto que no lo tenga.**
   *
   * En el paso 3 tuvo uno: montaba la barra sin encender ninguna posición.
   * **El paso 6 retiró `CuentaScreen` entera**, así que ese test dejó de
   * describir algo que existe — y un test que afirma sobre una pantalla
   * retirada es de la misma familia que un guard que corre donde su mecanismo
   * no existe: verde y vacío.
   *
   * Lo que sí sobrevive de esa ruta —que `#/cuenta` monta algo real, porque
   * ocho `navigate('cuenta')` durmientes dependen de eso— se afirma en
   * `rutas-montan-pantalla.spec.ts`, como alias declarado, y en el control
   * positivo de `rutas-wallet.spec.ts`. **No se perdió cobertura: se mudó a
   * donde el hecho vive ahora.**
   */
});
