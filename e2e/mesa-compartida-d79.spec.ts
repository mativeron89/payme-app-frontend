import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

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

const fila = (page: Page, nombre: string) => page.locator('.mi-item').filter({ hasText: nombre });
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
    await expect(tarjeta.locator('.mesa-money')).toContainText('$150.00');
    await expect(tarjeta.locator('.mesa-money')).toContainText('$840.00');

    // Decisión 79 · adentro: cuánto queda del plato, sin nombres, y la barra de
    // lo elegido con el formato de la decisión 77.
    await page.goto(`/#/mesa/${CODIGO}`);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    await expect(fila(page, 'Pizza para compartir')).toContainText('Queda ½');
    await expect(barra(page)).toHaveText('$150.00 / $840.00 (18%)');
    await expect(page.locator('main, .screen').first()).not.toContainText(OTRA_CUENTA);

    // No se puede elegir más de lo que queda: nace en ½ y «Entero» no se ofrece.
    await page.getByRole('button', { name: /^Pizza para compartir/ }).click();
    const porcion = fila(page, 'Pizza para compartir').getByRole('radiogroup');
    await expect(porcion.getByRole('radio', { name: '1/2', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(porcion.getByRole('radio', { name: 'Entero', exact: true })).toHaveCount(0);

    // F-1 · la otra cuenta sube a la pizza entera y, al volver a la app, la
    // mesa se relee sola: la barra cambia sin recargar la página.
    await otraCuentaDeclara(page, [[PIZZA, 10000]]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(barra(page)).toHaveText('$300.00 / $840.00 (36%)');

    // El borrador de ½ quedó viejo: el dueño rechaza con 409 y se dice claro.
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Ese plato ya está completo')).toBeVisible();
    await expect(fila(page, 'Pizza para compartir')).toContainText('Lo eligió otro');
    await expect(page.getByRole('button', { name: /^Pizza para compartir/ })).toBeDisabled();

    // Se completa la mesa con la parrillada: cierre con pantalla (F-2).
    await page.getByRole('button', { name: /^Parrillada/ }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('La mesa se cerró', { exact: true })).toBeVisible();
    await expect(page.getByText(RESTAURANTE, { exact: true })).toBeVisible();
    await expect(page.getByText('Se eligieron todos los consumos.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#/mesa/${CODIGO}$`));

    // F-3 · el Historial cuenta desde la selección informativa.
    await page.goto('/#/mesas');
    const enHistorial = page.getByRole('region', { name: 'Tus mesas' }).locator('.tu-mesa').filter({ hasText: RESTAURANTE });
    await expect(enHistorial).toContainText('Cerró sin cobro');
    await expect(enHistorial).toContainText('Elegiste 1 ítem');
    await expect(enHistorial).not.toContainText('No elegiste ítems');
  });

  test('F-1 · sin tocar nada, la mesa se relee cada 10 s', async ({ page }) => {
    await page.clock.install();
    await preparar(page);
    await sembrarMesaIgual(page);
    await page.goto(`/#/mesa/${CODIGO}`);
    await expect(barra(page)).toHaveText('$0.00 / $840.00 (0%)');
    await otraCuentaDeclara(page, [[PARRILLADA, 5000]]);
    await page.clock.fastForward(4_000);
    await expect(barra(page)).toHaveText('$0.00 / $840.00 (0%)');
    await page.clock.fastForward(7_000);
    await expect(barra(page)).toHaveText('$270.00 / $840.00 (32%)');
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
    await expect(tarjeta.locator('.mesa-money')).toContainText('$0.00');
    await expect(tarjeta.locator('.mesa-money')).not.toContainText('$150.00');
  });
});
