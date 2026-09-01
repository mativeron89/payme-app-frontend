/**
 * P2 DE LA TERCERA VUELTA · LA VENTANA, FORZADA Y CON INTERACCIÓN HUMANA.
 *
 * 🔴 Este spec existe porque mis tests anteriores **no probaban el cableado**.
 * Codex lo demostró con un experimento que no admite discusión: reintrodujo la
 * autoselección vieja en un clon y **mis 1.145 unitarios quedaron verdes**.
 * Llamaban a las funciones puras que el componente usa — no a los efectos, ni
 * al selector, ni al replay. *«Tests de componente» ≠ «tests de funciones que
 * el componente llama»*, y la distancia entre las dos cosas es exactamente
 * donde vivía el defecto.
 *
 * **Cómo se fuerza la ventana, de forma determinista y no por suerte:** el
 * journal calcula su índice con `crypto.subtle.digest`, y las tarjetas no.
 * Demorando el digest, las tarjetas resuelven PRIMERO — el orden que fallaba —
 * sin tocar una sola línea de producción.
 */
import { test, expect } from '@playwright/test';
import { ingresar, abrirMesaConLink } from './_app';
import { corteDePagosView } from '../src/api/releaseGates';

/**
 * CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-04) · los recorridos que
 * necesitan el checkout o el alta de tarjeta DUERMEN mientras el gate esté
 * activo, y leen el MISMO gate que la app: cuando `pagosCortados` pase a
 * `false`, vuelven solos, sin editar este archivo. Nunca un skip con `true`
 * fijo: eso es evidencia que no vuelve. `src/corteGuard.test.ts` censa cada
 * uno de estos skips y pone la suite roja ante uno nuevo o permanente.
 */
const CORTE = corteDePagosView();
const MOTIVO = 'CORTE DEL VIERNES: el checkout del participante y el alta de tarjeta están cerrados en producción pública sin pagos; este recorrido vuelve solo cuando corteDePagosView().pagosCortados sea false.';

/**
 * Demora todo digest: el journal se vuelve lento, las tarjetas no.
 *
 * ⚠️ Se instala **justo antes de entrar a Pagar**, no con `addInitScript`: el
 * armado de la mesa usa el journal en cada paso, y frenarlo desde el arranque
 * hacía fallar el recorrido entero por timeout — el arnés rompía el camino que
 * venía a medir.
 */
async function frenarJournal(page: import('@playwright/test').Page, ms: number) {
  await page.evaluate((espera) => {
    const real = crypto.subtle.digest.bind(crypto.subtle);
    // Se reemplaza a propósito, sólo en el arnés.
    (crypto.subtle as { digest: unknown }).digest = async (...args: unknown[]) => {
      await new Promise((listo) => setTimeout(listo, espera));
      return (real as (...a: unknown[]) => unknown)(...args);
    };
  }, ms);
}

test('🔴 con el journal pendiente NO se puede elegir tarjeta: la ventana se cierra', async ({ page }) => {
  test.skip(CORTE.pagosCortados, MOTIVO);
  await ingresar(page);
  await abrirMesaConLink(page);
  // 🔴 El freno entra ANTES de «Continuar», y ese detalle es el
  // hallazgo del arnés: `MesaScreen` **monta una sola vez** y después cambia
  // de vista, así que el journal se lee al ENTRAR A LA MESA, no al entrar a
  // Pagar. Poniéndolo más tarde la carrera ya había terminado y el test medía
  // una ventana cerrada — verde por la razón equivocada.
  await frenarJournal(page, 1_500);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();

  /**
   * 🔴 ORÁCULO DE CLASE (P23-AF-02). La versión anterior miraba **sólo el radio
   * principal**, así que quitar la guarda de las otras ocho superficies dejaba
   * el caso verde — e incluso impedir que las tarjetas se cargaran lo dejaba
   * verde. **Titulaba la clase y ejercitaba la instancia.**
   *
   * Ahora se enumeran TODAS las superficies de elección que la pantalla ofrece
   * en ese momento y **se exige que ninguna sea interactuable**, más un
   * control positivo de que hubo algo que mirar: si la lista viniera vacía, el
   * test pasaría en vacío, que es la forma en que este oráculo podría mentir.
   */
  //
  // ⚠️ **El campo de Stripe NO está en esta lista, y no por olvido:** sólo se
  // renderiza con `!IS_MOCK` y esta suite corre en mock, así que **no existe
  // acá**. Lo verifiqué plantando el mutante: quitarle el gate deja este E2E
  // verde 2/2. Su acreditación —más débil, y declarada como tal— vive en
  // `src/components/cardFieldVentana.test.ts`. Ponerlo en el selector daría
  // una falsa sensación de cobertura sobre algo que la suite no puede ver.
  const superficies = page.locator('.method-card, .method-card button, [role="radio"]');
  const cuantas = await superficies.count();
  expect(cuantas, 'no había ninguna superficie que mirar: el oráculo mediría en vacío')
    .toBeGreaterThan(2);

  /**
   * 🔴 P27-② · CONTROL POSITIVO REAL, no un conteo.
   *
   * Codex midió que este caso pasaba **sin tarjetas cargadas y con los guards
   * retirados**: con la lista vacía no hay nada que quede interactuable, así
   * que la ausencia de fallas no probaba que las guardas existieran. Ahora se
   * exige, ANTES de afirmar, que el escenario sea el que dice ser: **hay
   * tarjetas guardadas y la lista está desplegada** — o sea, hay superficies
   * que SIN la guarda estarían habilitadas.
   */
  // 🔴 §1.5 bis · el matcher cubre LOS DOS estados honestos de la fila. Antes
  // nombraba sólo «Tarjeta de crédito o débito», que es el rótulo del estado
  // ELEGIDO; con la fila «sin elegir» ese texto no existe y el ancla se caía
  // sin que hubiera defecto.
  const filaTarjeta = page.getByRole('radio', {
    name: /Tarjeta de crédito o débito|Elige tu método de pago/,
  });
  await expect(
    filaTarjeta,
    'el escenario no tiene la fila de tarjeta: el caso mediría otra cosa',
  ).toBeVisible();
  // ⚠️ La LISTA de guardadas no se puede exigir acá y el intento me lo enseñó:
  // sólo se despliega al tocar la fila, y durante la ventana eso está cerrado.
  // Lo que sí prueba que las tarjetas **se cargaron** —y por tanto que hay algo
  // que sin la guarda sería elegible— es `aria-expanded`, que la fila sólo
  // publica con `cards.length > 0`.
  //
  // 🔴 Antes el testigo era el glifo `▾`, y §1.5 bis lo retiró. **Se cambió el
  // testigo, no se aflojó el control:** `aria-expanded` es la MISMA condición
  // (`cards.length > 0`), leída de la semántica en vez de la decoración — que
  // es donde tendría que haber estado desde el principio.
  await expect(
    filaTarjeta,
    'las tarjetas no se cargaron: sin ellas el oráculo pasa aunque falten las guardas',
  ).toHaveAttribute('aria-expanded', /^(true|false)$/);

  /**
   * 🔴 §1.5 bis · Y ACÁ SE VE EL ESTADO HONESTO, que es lo único observable en
   * navegador de toda esta sección: con el journal pendiente **no hubo
   * atribución**, así que nadie eligió — y la fila NO nombra ninguna tarjeta.
   *
   * Es la ORDEN 1-B un nivel más adentro. Los cuatro dígitos son los del seed
   * del mock; si el seed cambia, esta aserción tiene que cambiar con él y no
   * al revés.
   */
  await expect(filaTarjeta).toContainText('Elige tu método de pago');
  await expect(
    filaTarjeta,
    'la fila nombra una tarjeta que nadie eligió: es el defecto que cerró la ORDEN 1-B',
  ).not.toContainText(/4532|8821|····/);
  for (let i = 0; i < cuantas; i++) {
    const s = superficies.nth(i);
    if (!(await s.isVisible())) continue;
    await expect(s, `la superficie ${i} quedó interactuable durante la ventana`).toBeDisabled();
  }

  // Y el CTA tampoco se ofrece: la puerta lo rechazaría (AF-04).
  await expect(page.getByRole('button', { name: 'Pagar', exact: true })).toBeDisabled();

  // Cuando el journal contesta, la pantalla vuelve a ofrecer todo.
  await expect(filaTarjeta).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Pagar', exact: true })).toBeEnabled();
});

/**
 * 🔴 P23-AF-03 · EL COMPROBANTE TRAS UN REMOUNT REAL, EN LAS TRES SUPERFICIES.
 *
 * La versión anterior **se titulaba «tras recargar» y no recargaba**: no
 * remontaba, no accionaba Compartir, no miraba destinatario y no comparaba el
 * importe entre las tres. Codex lo probó restaurando la procedencia pre-P20 y
 * **el E2E oficial quedaba verde**. Otra vez: **titular la clase y ejercitar la
 * instancia.**
 *
 * Acá el remount ES un remount (`reload()`), se capturan **las tres**
 * superficies —pantalla, texto compartido y archivo descargado— y se exige que
 * las tres digan **lo mismo**: porcentaje, destinatario e importe.
 */
test('🔴 tras un remount REAL, pantalla, compartir y descarga dicen lo mismo', async ({ page, context }) => {
  test.skip(CORTE.pagosCortados, MOTIVO);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ingresar(page);
  const mesa = await abrirMesaConLink(page);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  const propinas = page.getByRole('radiogroup', { name: /propina/i });
  await propinas.getByRole('radio', { name: '10%', exact: true }).click();
  // Destinatario elegido: es el dato que la versión anterior no miraba.
  const paraQuien = page.getByRole('group', { name: /Para quién/i });
  if (await paraQuien.count()) {
    await paraQuien.getByRole('button').first().click();
  }
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();

  // ① PANTALLA
  const pantalla = await page.locator('body').innerText();
  const conPct = pantalla.match(/Propina \((\d+(?:[.,]\d+)?)%[^)]*\)/);
  expect(conPct, 'la pantalla no muestra el porcentaje de propina').not.toBeNull();
  const importe = pantalla.match(/Total pagado\s*\$([\d,]+\.\d{2})/);
  expect(importe, 'la pantalla no muestra el total pagado').not.toBeNull();

  // ② COMPARTIR — el texto real que sale, leído del portapapeles.
  await page.getByRole('button', { name: /Enviar/ }).click();
  const compartido = await page.evaluate(() => navigator.clipboard.readText());

  // ③ DESCARGA
  const descarga = page.waitForEvent('download');
  await page.getByRole('button', { name: /Descargar/ }).click();
  const { readFileSync } = await import('node:fs');
  const archivo = readFileSync((await (await descarga).path())!, 'utf8');

  // Las TRES contra el MISMO hecho: porcentaje, destinatario e importe.
  for (const [nombre, texto] of [['compartido', compartido], ['descargado', archivo]] as const) {
    expect(texto, `el comprobante ${nombre} perdió el porcentaje`).toContain(conPct![0]);
    expect(texto, `el comprobante ${nombre} no coincide en el importe`).toContain(importe![1]);
    expect(texto, `el comprobante ${nombre} volvió al rótulo genérico`).not.toContain('Propina (al mesero)');
  }

  // 🔴 EL REMOUNT REAL: se recarga la página entera y el comprobante tiene que
  // seguir diciendo lo mismo — es el caso donde el estado visual nace vacío y
  // sólo el body persistido puede sostener el dato.
  await page.reload();
  // El remount tiene que DEJAR ALGO acreditado, no sólo ocurrir: la mesa
  // vuelve con el pago hecho — el ítem que pagué ya no está disponible para
  // nadie. Si la recarga no hubiera pasado, o el pago no hubiera quedado, esto
  // no se sostiene.
  await expect(page.getByText(mesa.code)).toBeVisible();
  // El progreso de la mesa vuelve con mi pago adentro: el remount ocurrió Y
  // el pago quedó del otro lado. Sin las dos cosas, esto no se sostiene — y
  // el número es el mismo que las tres superficies acaban de afirmar.
  await expect(page.getByText(/\$210\.00 de \$840\.00/)).toBeVisible();
});
