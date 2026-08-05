import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { PAGES, type PageId } from '../src/router';

/**
 * **Toda ruta declarada monta SU pantalla.** El segundo de los dos guards del
 * ruteo; el primero es el `never` del `default` de `src/App.tsx`.
 *
 * ## Por qué hacen falta los dos
 *
 * El `never` prueba que **toda página tiene `case`**, en tiempo de compilación.
 * Lo que no puede probar es que ese `case` monte **lo que corresponde**: un
 * `case` puede existir, apuntar a la pantalla equivocada, o montar una que
 * explota al primer render, y el compilador lo ve todo bien.
 *
 * ## 🔴 La trampa que este archivo tiene que esquivar
 *
 * El `default` de `App.tsx` devuelve `<HomeScreen />`. Entonces:
 *
 * > Un test que sólo asserte *"la página renderiza algo no vacío"* **PASA con el
 * > `case` faltante**. Inicio es algo. Es no vacío. El test queda verde y el
 * > defecto adentro.
 *
 * Es el mismo modo de falla del caso 14 del E2E contractual —que aceptaba un
 * 401 como éxito y nunca leía el dato—. **Un test que no puede distinguir el
 * éxito del fallback no mide nada.**
 *
 * Por eso cada ruta afirma **dos cosas**: que se ve su propio marcador, y que
 * **NO se ve el de Inicio**. La segunda es la que mata al fallback.
 *
 * ## Y por qué itera `PAGES` en vez de una lista propia
 *
 * `PAGES` es el array de runtime del router. Iterarlo significa que **una página
 * nueva entra sola a este recorrido**: si alguien la agrega y se olvida del
 * `case`, o le da un `case` que monta otra cosa, este archivo lo encuentra sin
 * que nadie se acuerde de venir a agregarla.
 *
 * `ESPERADO` sí es una lista escrita a mano —no hay forma de adivinar el
 * marcador de una pantalla— pero **no se puede quedar corta en silencio**: la
 * página sin entrada falla, no se saltea. Ver el test de completitud al final.
 */

/** Lo único que Inicio tiene y ninguna otra pantalla: su tercera pestaña. */
const MARCADOR_DE_INICIO = { rol: 'tab', nombre: 'Asociadas' } as const;

interface Marcador {
  /** `heading` para los `<h1>` de `TopBar`; `texto` para los que no son heading. */
  readonly rol: 'heading' | 'tab' | 'texto';
  readonly nombre: string;
}

type Esperado =
  | {
      readonly tipo: 'pantalla';
      readonly marcador: Marcador;
      /** El `/param` del hash, para las rutas que sin él montan otra cosa. */
      readonly param?: string;
    }
  | { readonly tipo: 'redirige'; readonly a: RegExp }
  /**
   * 🔴 **La ruta monta A PROPÓSITO la misma pantalla que otra.**
   *
   * Existe porque el caso apareció y la regla de este archivo es que **dos
   * páginas indistinguibles por su render se declaran, no se tapan con un
   * marcador débil para que el test cierre**. Acá la indistinguibilidad es la
   * decisión, no el accidente: `case 'cuenta'` cae a propósito en el mismo
   * `case` que `tarjetas`.
   */
  | { readonly tipo: 'alias'; readonly de: PageId; readonly porque: string };

/**
 * `Record<PageId, …>` a propósito: en el editor, agregar una página sin entrada
 * acá es error de tipo. **No alcanza como guard** —`tsconfig.json` sólo incluye
 * `src`, y Playwright transpila sin chequear— así que la red de verdad es el
 * test de completitud, que corre.
 */
const ESPERADO: Record<PageId, Esperado> = {
  home: { tipo: 'pantalla', marcador: MARCADOR_DE_INICIO },
  /**
   * §1.9 · paso 6 · `CuentaScreen` se retiró y **la ruta sobrevive**, montando
   * `TarjetasScreen`. No es cosmético: quedan **ocho `navigate('cuenta')`
   * durmientes** preservados por ratificación, y sin `case` cualquiera de ellos
   * dejaría la app en blanco. Este renglón es lo que impide que alguien lo
   * "limpie" viendo una ruta sin pantalla propia.
   */
  cuenta: {
    tipo: 'alias',
    de: 'tarjetas',
    porque: 'la pantalla se retiró en §1.9 y la ruta vive para los ocho navigate() durmientes',
  },
  tarjetas: { tipo: 'pantalla', marcador: { rol: 'texto', nombre: 'Mis tarjetas' } },
  pagos: { tipo: 'pantalla', marcador: { rol: 'texto', nombre: 'Mis pagos' } },
  estadisticas: { tipo: 'pantalla', marcador: { rol: 'texto', nombre: 'Mis estadísticas' } },

  /**
   * Las dos del riel saldo **no montan pantalla: redirigen**, y eso es lo
   * correcto. Están acá y no salteadas para que se lea que su comportamiento es
   * una decisión y no un olvido. El detalle de por qué —historial, endpoints,
   * vocabulario— lo cubre `rutas-wallet.spec.ts`.
   */
  cargar: { tipo: 'redirige', a: /#\/home$/ },
  transferir: { tipo: 'redirige', a: /#\/home$/ },

  amigos: { tipo: 'pantalla', marcador: { rol: 'heading', nombre: 'Amigos' } },
  grupos: { tipo: 'pantalla', marcador: { rol: 'heading', nombre: 'Grupos' } },
  mesas: { tipo: 'pantalla', marcador: { rol: 'heading', nombre: 'Mesas' } },
  scan: { tipo: 'pantalla', marcador: { rol: 'heading', nombre: 'Escaneá el ticket' } },
  mas: { tipo: 'pantalla', marcador: { rol: 'heading', nombre: 'Más' } },
  avisos: { tipo: 'pantalla', marcador: { rol: 'texto', nombre: 'Notificaciones' } },

  /**
   * 🔴 `#/mesa` **sin** código monta `MesasScreen` —lo dice su propio `case`— y
   * ahí sería indistinguible de `#/mesas`. Así que se le da un código.
   *
   * **El marcador es el código mismo**, y eso prueba de más: `PA-0000` sólo
   * puede llegar a la pantalla si el `case` además **cableó el `param`**. Un
   * `case 'mesa'` que montara `MesaScreen` sin pasarle el código pasaría
   * cualquier marcador fijo y fallaría éste.
   *
   * Un código inventado y no una mesa real: abrir una mesa de verdad son seis
   * pasos con 3DS incluido, y lo que este recorrido prueba es **cuál pantalla
   * monta el `case`**, no que la mesa cargue. Eso ya lo hacen `pago-completo` y
   * `compartir`, que abren mesas de verdad.
   *
   * ⚠️ Primero se probó con la copy de "no encontramos esta mesa" y **no llega
   * nunca**: el mock devuelve una mesa para CUALQUIER código, así que en el riel
   * de desarrollo el camino `notFound` de `MesaScreen` es inalcanzable. Queda
   * anotado —es la misma forma que el camino de falla del OCR, que tampoco
   * tiene e2e— y no se toca acá: arreglar el mock es otro trabajo.
   */
  mesa: {
    tipo: 'pantalla',
    param: 'PA-0000',
    marcador: { rol: 'texto', nombre: 'PA-0000' },
  },
};

function ubicar(page: Page, m: Marcador) {
  if (m.rol === 'heading') return page.getByRole('heading', { name: m.nombre, exact: true });
  if (m.rol === 'tab') return page.getByRole('tab', { name: m.nombre, exact: true });
  return page.getByText(m.nombre, { exact: false });
}

test.describe('cada ruta declarada monta su propia pantalla', () => {
  for (const pagina of PAGES) {
    test(`#/${pagina}`, async ({ page }) => {
      const esperado: Esperado | undefined = ESPERADO[pagina];
      expect(
        esperado,
        `«${pagina}» está en PAGES y no tiene expectativa en ESPERADO. ` +
          `Agregala: una página que nadie ejercita es una ruta declarada, no una ruta que funciona.`,
      ).toBeDefined();

      await ingresar(page);

      const sufijo = esperado!.tipo === 'pantalla' && esperado!.param ? `/${esperado!.param}` : '';
      await page.goto(`/#/${pagina}${sufijo}`);

      if (esperado!.tipo === 'redirige') {
        await expect(page).toHaveURL(esperado!.a);
        return;
      }

      /**
       * Alias: monta la pantalla de OTRA página, y eso es la decisión. Se
       * afirman las dos mitades, porque cada una sola miente:
       *
       *  - que se ve el marcador de la aliasada → la ruta monta algo real;
       *  - que la URL **no cambió** → llegó por el `case`, no por un redirect.
       *    Sin esto, un `replaceRoute('tarjetas')` pasaría igual, y no es lo
       *    mismo: un redirect deja la ruta vieja fuera del `case`, que es
       *    exactamente lo que los ocho durmientes no toleran.
       */
      if (esperado!.tipo === 'alias') {
        const aliasada = ESPERADO[esperado!.de];
        expect(aliasada?.tipo, `«${esperado!.de}» tiene que ser una pantalla`).toBe('pantalla');
        await expect(
          ubicar(page, (aliasada as { marcador: Marcador }).marcador),
        ).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`#/${pagina}$`));
        return;
      }

      // 1 · se ve LA SUYA.
      await expect(ubicar(page, esperado!.marcador)).toBeVisible();

      /**
       * 2 · ⭐ y NO se ve la de Inicio. Sin esta línea, borrar el `case` haría
       * caer la ruta en el `default` → `<HomeScreen />`, y el punto 1 seguiría
       * verde para cualquier marcador que Inicio también tenga.
       */
      if (pagina !== 'home') {
        await expect(ubicar(page, MARCADOR_DE_INICIO)).toHaveCount(0);
      }
    });
  }

  /**
   * El guard de la lista escrita a mano. Sin esto, agregar una página al router
   * y olvidarse de `ESPERADO` no rompería nada visible: el `for` de arriba
   * generaría su test, el `expect(...).toBeDefined()` lo haría fallar — pero
   * sólo si alguien lee cuál de los catorce falló. Este lo dice en una línea, y
   * no necesita navegador.
   */
  test('ESPERADO cubre todas las páginas del router', () => {
    const sinExpectativa = PAGES.filter((p) => ESPERADO[p] === undefined);
    expect(sinExpectativa, 'páginas del router sin expectativa declarada').toEqual([]);
  });
});
