import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { abrirTusConsumos, enTuMesaConLaLista } from './_mesa';

/**
 * AF-MESA-D79 · decisiones 76 y 79 a 81 de Mati, con el mock que replica al
 * dueño App Backend v2.134.0 (`docs/MESA_COMPARTIDA_D79_WIRE.md`).
 *
 * El escenario es el de Mati en «partes iguales»: el invitado elige, el
 * organizador ve lo que queda sin recargar, intenta duplicar y el dueño lo
 * rechaza con un mensaje claro, completa la mesa, ve «La mesa se cerró» y el
 * Historial dice lo que eligió.
 *
 * ⚠️ El mock tiene UNA sola sesión. «La otra cuenta» es una declaración escrita
 * en el store con otro `user_id`, exactamente donde el dueño la guardaría
 * (`mesa_informative_selections`); la pantalla la ve sólo a través de lo que
 * publica el dueño: el restante por plato, sin nombres.
 */

const CODIGO = 'PA-8479';
const RESTAURANTE = 'Trattoria Mesa Compartida';
const OTRA_CUENTA = 'e0000000-0000-4000-8000-00000000d079';
const PIZZA = 'a0000000-0000-4000-8000-000000000001';
const PARRILLADA = 'a0000000-0000-4000-8000-000000000002';

async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
}

/** Mesa «igual», sin garantía, abierta por esta cuenta, N=2, $840. */
async function sembrarMesaIgual(page: Page): Promise<void> {
  await page.evaluate(async ({ code, restaurante, pizza, parrillada }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<Record<string, unknown>>; informativeSelections: Record<string, unknown> };
      persist: () => void;
    };
    const template = state.mesas[0] as { restaurant: Record<string, unknown>; active_staff: unknown };
    state.mesas = state.mesas.filter((mesa) => mesa.code !== code);
    const item = (id: string, name: string, price: number) => ({
      id, name, category: 'other', price_cents: price, quantity: 1,
      status: 'available', lockedBy: null, lock_expires_at: null, claims: [],
    });
    state.mesas.unshift({
      id: '00008479-0000-4000-8000-000000000000',
      code,
      restaurant: { ...structuredClone(template.restaurant), name: restaurante },
      total_cents: 84000,
      paid_amount_cents: 0,
      tip_amount_cents: 0,
      division_mode: 'igual',
      expected_participants: 2,
      original_participants: 2,
      status: 'open',
      // La más urgente, para que el Inicio la muestre en la tarjeta principal
      // (ordena por vencimiento; la del mock vence en 11 min).
      expires_at: new Date(Date.now() + 6 * 60_000).toISOString(),
      items: [item(pizza, 'Pizza para compartir', 30000), item(parrillada, 'Parrillada', 54000)],
      slots: [
        { slot_index: 0, amount_cents: 42000, status: 'available', claimedBy: null },
        { slot_index: 1, amount_cents: 42000, status: 'available', claimedBy: null },
      ],
      active_staff: structuredClone(template.active_staff),
      openedByUser: true,
      captured_shortfall_cents: 0,
      guarantee_method: 'none',
      guarantee_mode: false,
      closure_reason: null,
    });
    persist();
  }, { code: CODIGO, restaurante: RESTAURANTE, pizza: PIZZA, parrillada: PARRILLADA });
}

/** Lo que declara la OTRA cuenta, donde el dueño lo guardaría. */
async function otraCuentaDeclara(page: Page, items: Array<[string, number]>): Promise<void> {
  await page.evaluate(async ({ code, otra, pares }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: {
        mesas: Array<{ id: string; code: string }>;
        informativeSelections: Record<string, { items: Array<{ item_id: string; declared_fraction_bps: number }>; updated_at: string | null }>;
      };
      persist: () => void;
    };
    const mesa = state.mesas.find((m) => m.code === code);
    if (!mesa) throw new Error(`${code} ausente`);
    state.informativeSelections[`${mesa.id}:${otra}`] = {
      items: pares.map(([item_id, declared_fraction_bps]) => ({ item_id, declared_fraction_bps }))
        .sort((a, b) => a.item_id.localeCompare(b.item_id)),
      updated_at: new Date().toISOString(),
    };
    persist();
  }, { code: CODIGO, otra: OTRA_CUENTA, pares: items });
}

/** Captura opcional para el juicio visual de Mati; sin la variable, nada. */
async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png`, fullPage: true });
}

// AF-QUE-CONSUMISTE · decisión 90 · el renglón del plato se ancla en su nombre.
const fila = (page: Page, nombre: string) => page.locator(`.qc-renglon[data-plato="${nombre}"]`);
const barra = (page: Page) => page.locator('.mi-meta-amt');

test.describe('AF-MESA-D79 · mesa compartida en «partes iguales»', () => {
  test('el escenario de Mati: ver lo que queda, no duplicar, cierre con pantalla e Historial', async ({ page }) => {
    await preparar(page);
    await sembrarMesaIgual(page);
    await otraCuentaDeclara(page, [[PIZZA, 5000]]);

    // Decisión 76 · el Inicio muestra lo ELEGIDO ($150 de la media pizza).
    // Se recarga: Inicio ya había leído sus mesas antes de sembrar.
    await page.goto('/#/home');
    await page.reload();
    const tarjeta = page.locator('.mesa-card').filter({ hasText: RESTAURANTE });
    await expect(tarjeta.locator('.mesa-money')).toContainText('$150');
    await expect(tarjeta.locator('.mesa-money')).toContainText('$840');
    await capturar(page, 'd79-01-inicio-lo-elegido');

    // Decisión 79 · adentro: cuánto queda del plato, sin nombres, y la barra de
    // lo elegido con el formato de la decisión 77.
    await page.goto(`/#/mesa/${CODIGO}`);
    await enTuMesaConLaLista(page);
    await expect(fila(page, 'Pizza para compartir')).toContainText('Queda ½');
    await expect(barra(page)).toHaveText('$150 / $840 (18%)');
    await expect(page.locator('main, .screen').first()).not.toContainText(OTRA_CUENTA);
    await capturar(page, 'd79-02-queda-medio');

    // No se puede elegir más de lo que queda: nace en ½ y «Entero» no se ofrece.
    // Con N=2 y «Queda ½» la única porción que cabe es ½, así que la regla 4 del
    // diseño la marca directo, sin abrir selector ni ofrecer cambiarla.
    await page.getByRole('button', { name: /^Pizza para compartir/ }).click();
    const pizza = fila(page, 'Pizza para compartir');
    await expect(pizza.locator('[data-estado="mio"] .qc-pildora')).toHaveText('½');
    await expect(pizza.getByRole('radiogroup')).toHaveCount(0);
    await expect(pizza.getByRole('button', { name: /^Cambiar la porción/ })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Entero', exact: true })).toHaveCount(0);

    // F-1 · la otra cuenta sube a la pizza entera y, al volver a la app, la
    // mesa se relee sola: la barra cambia sin recargar la página.
    await otraCuentaDeclara(page, [[PIZZA, 10000]]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');

    // El borrador de ½ quedó viejo: el dueño rechaza con 409 y se dice claro.
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Ese plato ya está completo')).toBeVisible();
    await expect(fila(page, 'Pizza para compartir')).toContainText('Lo eligió otro');
    // Bloqueado: el renglón «Lo eligió otro» no tiene nada tocable.
    await expect(fila(page, 'Pizza para compartir').locator('[data-estado="tomado"]')).toBeVisible();
    await expect(fila(page, 'Pizza para compartir').getByRole('button')).toHaveCount(0);
    await capturar(page, 'd79-03-409-completo');

    // Se completa la mesa con la parrillada: cierre con pantalla (F-2).
    await page.getByRole('button', { name: /^Parrillada/ }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    // D240 punto 8 · antes de guardar lo que cierra la mesa, la hoja para revisar.
    await page.getByRole('dialog', { name: 'Con esto se cierra la mesa' })
      .getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
    await expect(page.getByText('La mesa se cerró', { exact: true })).toBeVisible();
    await expect(page.getByText(RESTAURANTE, { exact: true })).toBeVisible();
    await expect(page.getByText('Se eligieron todos los consumos.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`:\\d+/mesa/${CODIGO}$`));
    await capturar(page, 'd79-04-la-mesa-se-cerro');

    // F-3 · el Historial cuenta desde la selección informativa.
    await page.goto('/#/mesas');
    const enHistorial = page.getByRole('region', { name: 'Tus mesas' }).locator('.tu-mesa').filter({ hasText: RESTAURANTE });
    await expect(enHistorial).toContainText('Cerró sin cobro');
    await expect(enHistorial).toContainText('Elegiste 1 ítem');
    await expect(enHistorial).not.toContainText('No elegiste ítems');
    await capturar(page, 'd79-05-historial');
  });

  test('F-1 · sin tocar nada, la mesa se relee cada 10 s', async ({ page }) => {
    await page.clock.install();
    await preparar(page);
    await sembrarMesaIgual(page);
    // AF-HIGIENE-2 · hasta 0.200.0 el reloj falso corría con el real, y el primer
    // salto de 4 s daba «todavía no» sólo si montar, cargar y declarar tardaba
    // menos de 6 s REALES. Ahora el reloj se PAUSA antes de montar la mesa: el
    // intervalo de 10 s nace en T0 y todo lo que sigue corre en tiempo falso,
    // incluida la latencia del mock (350 ms por pedido). Ya no depende de la
    // máquina.
    // `pauseAt` no acepta el pasado: 5 s adelante cubre la ida y vuelta aun con
    // la máquina lenta. El salto ocurre ANTES de montar la mesa (sólo corre
    // timers del Inicio); el intervalo nace después, en el instante pausado.
    const t0 = await page.evaluate(() => Date.now() + 5_000);
    await page.clock.pauseAt(t0);
    await page.goto(`/#/mesa/${CODIGO}`);
    await abrirTusConsumos(page);
    await page.clock.runFor(3_000);
    await expect(barra(page)).toHaveText('$0 / $840 (0%)');
    await otraCuentaDeclara(page, [[PARRILLADA, 5000]]);
    // T0 + 8 s: el primer tick no puede haber pasado (nace en T0 o después).
    await page.clock.runFor(5_000);
    await expect(barra(page)).toHaveText('$0 / $840 (0%)');
    // T0 + 14 s: pasó el tick de los 10 s y su lectura, con margen por si el
    // intervalo se reinició durante la carga (hasta T0 + 3 s); el segundo tick
    // no llega antes de T0 + 20 s.
    await page.clock.runFor(6_000);
    await expect(barra(page)).toHaveText('$270 / $840 (32%)');
    await expect(fila(page, 'Parrillada')).toContainText('Queda ½');
  });

  test('decisión 76 · sin los campos del dueño, el Inicio muestra lo pagado como antes', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.mesas_sin_campos_aditivos.v1', 'true'));
    await preparar(page);
    await sembrarMesaIgual(page);
    await otraCuentaDeclara(page, [[PIZZA, 5000]]);
    await page.goto('/#/home');
    await page.reload();
    const tarjeta = page.locator('.mesa-card').filter({ hasText: RESTAURANTE });
    await expect(tarjeta.locator('.mesa-money')).toContainText('$0');
    await expect(tarjeta.locator('.mesa-money')).not.toContainText('$150');
  });
});
