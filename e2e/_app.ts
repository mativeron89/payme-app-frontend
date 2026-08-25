import { expect, type Page } from '@playwright/test';

/**
 * ORDEN 5 · lo que toda corrida de navegador necesita saber de la app.
 *
 * Vive separado de los specs para que cada recorrido diga **qué** prueba y no
 * **cómo se llega**. Cuando el rediseño visual mueva un texto, se arregla acá y
 * no en cuatro archivos.
 *
 * ## Reglas que estos helpers respetan, y no son opcionales
 *
 * - **Cero `waitForTimeout`.** Se espera a que algo **sea visible**, nunca a que
 *   pase el tiempo. Un `sleep` es una apuesta a la velocidad de la máquina, y
 *   la que corre en CI no es ésta.
 * - **Selectores por rol y por texto visible**, no por CSS. Un `.tk-row` se
 *   renombra en el próximo commit de diseño; "Pagar mi parte" es lo que la
 *   persona ve y lo que tiene que seguir estando.
 * - **Cero estado compartido entre tests.** Cada test abre su contexto y su
 *   mesa; el mock guarda en `localStorage`, así que contextos distintos son
 *   mundos distintos. Ningún test depende del orden.
 *
 * ## El botón de abrir mesa se llama "Nueva", no "Nueva Mesa"
 *
 * Con el rediseño de §1.1 el flotante `+ Nueva Mesa` de `HomeScreen` desapareció
 * y su lugar lo ocupa el círculo central de la barra de cinco posiciones, cuyo
 * `aria-label` es `Nueva` (`AppBottomBar`, `SISTEMA_DISENO.md` §5 bis · C).
 *
 * **Se cambió a propósito y en el mismo commit que la pantalla**, porque este
 * helper lo usan LOS CUATRO specs: con el nombre viejo caían los 24 recorridos
 * de una, incluidos los que no tocan Inicio, y quien lo viera sin este párrafo
 * pensaría que el rediseño rompió toda la app. Era el renombre esperado.
 *
 * **No alcanzaba con arreglarlo acá.** El aviso que llegó decía "`_app.ts`", y
 * al corregir sólo este archivo quedaron 3 recorridos rojos: `rutas-wallet` y
 * `invitacion-back` afirman por su cuenta *"terminé en Inicio"* usando el mismo
 * botón como prueba de que la pantalla es Inicio, sin pasar por el helper. Se
 * corrigieron los tres puntos; el `grep` es el que manda, no la memoria.
 *
 * Va con `exact: true`: sin él, `name: 'Nueva'` matchea por subcadena y
 * cualquier "Nueva tarjeta" futura entraría en el mismo selector.
 */

/** Cualquier email entra en el mock; la contraseña no se valida. */
export async function ingresar(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('mati@payme.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

export interface MesaAbierta {
  /** `PA-####`. Distinto en cada corrida: el mock lo genera. */
  readonly code: string;
  /** El link completo tal cual se le muestra a la persona. */
  readonly link: string;
  /** El `?t=` de ese link. */
  readonly token: string;
}

/**
 * El recorrido del organizador completo, hasta el link de invitación:
 * escanear → ticket → dividir en partes iguales → garantizar con tarjeta →
 * confirmar 3DS → "Invitar a la mesa".
 *
 * Va acá porque **tres de los cuatro recorridos necesitan una mesa abierta de
 * verdad**. Reproducirlo en cada spec sería copiar el punto exacto donde la app
 * cambia más seguido.
 *
 * La garantía es obligatoria (A-1): la mesa nace `pending_auth` y sólo pasa a
 * `open` cuando el hold se autoriza. Por eso el 3DS está en el camino y no es
 * un paso opcional que se pueda saltear.
 */
export async function abrirMesaConLink(page: Page): Promise<MesaAbierta> {
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  // §1.6 renombró el título al aplicar el rediseño: la cabecera navy de dos
  // filas no lleva título, y el <h1> pasó a la tarjeta de título `--teal-l`.
  await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();

  await page.getByRole('button', { name: 'Capturar' }).click();
  // 🔴 CAMBIÓ CON §1.3-bis (2026-08-20): Ticket y División son UNA pantalla, y
  // el ticket nace PLEGADO — «Modificar ítems» ya no está visible al llegar, y
  // esperar por él acá dejaba el helper colgado. Se espera la forma de dividir,
  // que es lo primero que la pantalla fusionada ofrece.
  //
  // El OCR mock tarda: se espera a la pantalla, no a un número de milisegundos.
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();

  await page.getByRole('radio', { name: /En partes iguales/ }).click();
  await expect(page.getByRole('button', { name: 'Un comensal más' })).toBeVisible();

  // §1.4 (2026-08-06): el stepper nace SIN ELEGIR y el N lo pone la persona —
  // murió el `useState(4)`. Este helper ELIGE 4 a mano (piso 2 + dos toques)
  // porque toda la aritmética anclada de los specs ($210.00 la parte, $241.50
  // con 15 %) es 840 ÷ 4: si esto cambia, cambian esos números, no el criterio.
  const masUno = page.getByRole('button', { name: 'Un comensal más' });
  await masUno.click();
  await masUno.click();
  await masUno.click();
  await expect(page.getByRole('group', { name: /¿Cuántos (pagan|son en la mesa)\?/ })).toContainText('4');

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();

  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  // §1.7 le puso el título del spec: la pantalla es el momento de triunfo del
  // organizador, no un formulario de invitación.
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

  // 🔴 CAMBIÓ CON A1 (2026-08-16): el link YA NO se imprime en pantalla, así
  // que dejó de haber texto de dónde leerlo. Se lee del `href` de WhatsApp, que
  // es la superficie que de verdad lo transporta al invitado.
  //
  // ⚠️ **Sigue siendo lo que la persona puede mandar, no un endpoint** — que era
  // el criterio del helper y no cambió. Lo que cambió es por dónde sale: antes
  // era texto copiable, ahora es el destino del botón. Leerlo de un endpoint
  // haría que el test pasara aunque la pantalla no ofreciera ninguna vía.
  const wa = page.getByRole('link', { name: 'WhatsApp', exact: true });
  const href = await wa.getAttribute('href');
  expect(href, 'la pantalla no ofrece ninguna vía para compartir el link').not.toBeNull();
  const link = decodeURIComponent(new URL(href!).searchParams.get('text') ?? '')
    .match(/https?:\/\/\S+/)?.[0] ?? '';
  const match = /#\/mesa\/(PA-[A-Za-z0-9]+)\?t=([^\s&]+)/.exec(link);
  expect(match, `no pude leer el link de invitación de: ${link}`).not.toBeNull();
  return { code: match![1]!, token: match![2]!, link };
}

/** El `?t=` de una URL, o `null`. Es lo que casi todos los tests miran. */
export function tokenDeLaUrl(url: string): string | null {
  const i = url.indexOf('#');
  if (i < 0) return null;
  const q = url.slice(i).indexOf('?');
  if (q < 0) return null;
  return new URLSearchParams(url.slice(i + q + 1)).get('t');
}
