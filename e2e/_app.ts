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
 */

/** Cualquier email entra en el mock; la contraseña no se valida. */
export async function ingresar(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('mati@payme.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva Mesa' })).toBeVisible();
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
  await page.getByRole('button', { name: 'Nueva Mesa' }).click();
  await expect(page.getByRole('heading', { name: 'Escanear ticket' })).toBeVisible();

  await page.getByRole('button', { name: 'Capturar' }).click();
  // El OCR mock tarda. Se espera al ticket, no a un número de milisegundos.
  await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();

  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /En partes iguales/ }).click();
  await expect(page.getByRole('button', { name: 'Un comensal más' })).toBeVisible();

  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantizá la mesa' })).toBeVisible();

  await page.getByRole('button', { name: /Garantizar .* y abrir mesa/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirmá con tu banco' })).toBeVisible();

  await page.getByRole('button', { name: 'Confirmar autorización' }).click();
  await expect(page.getByRole('heading', { name: 'Invitar a la mesa' })).toBeVisible();

  // El link se muestra UNA sola vez, en texto. Se lee de la pantalla y no de un
  // endpoint: lo que importa es lo que la persona puede copiar y mandar.
  const texto = await page.getByText(/#\/mesa\/PA-/).first().innerText();
  const link = texto.trim();
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
