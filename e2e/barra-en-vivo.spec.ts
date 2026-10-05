import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-BARRA-EN-VIVO · decisión 107, punto 3 (n190), «Sí, en vivo»: en «¿Qué
 * consumiste?» la barra suma lo registrado por la mesa MÁS el borrador propio,
 * antes de «Listo», sin contar lo propio dos veces y sin llegar a 100 por el
 * borrador.
 *
 * La siembra de mesas es la de `barra-items-sin-pago.spec.ts` (consumo) y la de
 * `mesa-compartida-d79.spec.ts` (igual): el mock tiene UNA sola sesión y «la
 * otra cuenta» se escribe en el store donde el dueño la guardaría.
 */

const CONSUMO = 'PA-8601';
const IGUAL = 'PA-8602';
const OTRA_CUENTA = 'e0000000-0000-4000-8000-00000000b107';
const C300 = '30000000-0000-4000-8000-000000008601';
const C540 = '54000000-0000-4000-8000-000000008601';
const PIZZA = 'a0000000-0000-4000-8000-000000008602';
const PARRILLADA = 'b0000000-0000-4000-8000-000000008602';

async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
}

/** Una mesa de $840 ($300 + $540), abierta por esta cuenta, sin garantía. */
async function sembrar(page: Page, modo: 'consumo' | 'igual'): Promise<void> {
  await page.evaluate(async ({ modo, consumo, igual, c300, c540, pizza, parrillada }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<Record<string, unknown>> };
      persist: () => void;
    };
    const template = state.mesas[0] as { restaurant: unknown; active_staff: unknown };
    const code = modo === 'consumo' ? consumo : igual;
    const item = (id: string, name: string, price: number) => ({
      id, name, category: 'other', price_cents: price, quantity: 1,
      status: 'available', lockedBy: null, lock_expires_at: null, claims: [],
    });
    state.mesas = state.mesas.filter((m) => m.code !== code);
    state.mesas.unshift({
      id: modo === 'consumo' ? '00008601-0000-4000-8000-000000000000' : '00008602-0000-4000-8000-000000000000',
      code,
      restaurant: structuredClone(template.restaurant),
      total_cents: 84000,
      paid_amount_cents: 0,
      tip_amount_cents: 0,
      division_mode: modo,
      expected_participants: 2,
      original_participants: modo === 'igual' ? 2 : null,
      status: 'open',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      items: modo === 'consumo'
        ? [item(c300, 'Consumo de 300', 30000), item(c540, 'Consumo de 540', 54000)]
        : [item(pizza, 'Pizza para compartir', 30000), item(parrillada, 'Parrillada', 54000)],
      slots: modo === 'igual'
        ? [
            { slot_index: 0, amount_cents: 42000, status: 'available', claimedBy: null },
            { slot_index: 1, amount_cents: 42000, status: 'available', claimedBy: null },
          ]
        : null,
      active_staff: structuredClone(template.active_staff),
      openedByUser: true,
      captured_shortfall_cents: 0,
      guarantee_method: 'none',
      guarantee_mode: false,
      closure_reason: null,
    });
    persist();
  }, { modo, consumo: CONSUMO, igual: IGUAL, c300: C300, c540: C540, pizza: PIZZA, parrillada: PARRILLADA });
}

/** Consumo: un claim en el store, de esta cuenta o de otra, como lo guardaría el dueño. */
async function claim(page: Page, itemId: string, who: 'user' | 'other', bps: number): Promise<void> {
  await page.evaluate(async ({ code, itemId, who, bps }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; items: Array<{ id: string; status: string; claims: unknown[] }> }> };
      persist: () => void;
    };
    const item = state.mesas.find((m) => m.code === code)!.items.find((i) => i.id === itemId)!;
    item.status = 'locked';
    item.claims = [...item.claims, { who, fraction_bps: bps, amount_cents: null, status: 'locked' }];
    persist();
  }, { code: CONSUMO, itemId, who, bps });
}

/** Igual: una declaración informativa guardada, de esta cuenta o de otra. */
async function declara(page: Page, quien: 'yo' | 'otra', pares: Array<[string, number]>): Promise<void> {
  await page.evaluate(async ({ code, otra, quien, pares }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: {
        user: { id: string };
        mesas: Array<{ id: string; code: string }>;
        informativeSelections: Record<string, { items: Array<{ item_id: string; declared_fraction_bps: number }>; updated_at: string | null }>;
      };
      persist: () => void;
    };
    const mesa = state.mesas.find((m) => m.code === code)!;
    state.informativeSelections[`${mesa.id}:${quien === 'yo' ? state.user.id : otra}`] = {
      items: pares.map(([item_id, declared_fraction_bps]) => ({ item_id, declared_fraction_bps }))
        .sort((a, b) => a.item_id.localeCompare(b.item_id)),
      updated_at: new Date().toISOString(),
    };
    persist();
  }, { code: IGUAL, otra: OTRA_CUENTA, quien, pares });
}

const claimsDe = (page: Page, itemId: string) => page.evaluate(async ({ code, itemId }) => {
  const storePath = '/src/api/mock/store.ts';
  const { state } = await import(/* @vite-ignore */ storePath) as {
    state: { mesas: Array<{ code: string; items: Array<{ id: string; claims: unknown[] }> }> };
  };
  return state.mesas.find((m) => m.code === code)!.items.find((i) => i.id === itemId)!.claims;
}, { code: CONSUMO, itemId });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

const barra = (page: Page) => page.locator('.mi-meta-amt');
const renglon = (page: Page, nombre: string) => page.locator(`.qc-renglon[data-plato="${nombre}"]`);
const abrir = async (page: Page, code: string) => {
  await page.goto(`/#/mesa/${code}`);
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
};

test.describe('AF-BARRA-EN-VIVO · cada uno lo suyo', () => {
  test('elegir un plato mueve la barra antes de «Listo», y el borrador no sale al dueño', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'consumo');
    await abrir(page, CONSUMO);
    await expect(barra(page)).toHaveText('$0 / $840 (0%)');

    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');
    await expect(page.getByRole('progressbar', { name: 'Asignado 36% de la mesa' })).toBeVisible();
    await expect(page.locator('.mi-progress-fill')).toHaveAttribute('style', /width: 36%/);
    expect(await claimsDe(page, C300)).toEqual([]);
    expect(page.viewportSize()?.width).toBe(390);
    await capturar(page, 'barra-en-vivo-01-consumo');
  });

  test('soltarlo y volver a elegirlo', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'consumo');
    await abrir(page, CONSUMO);
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');
    await renglon(page, 'Consumo de 300').getByRole('button', { name: 'Soltar', exact: true }).click();
    await expect(barra(page)).toHaveText('$0 / $840 (0%)');
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');
  });

  test('cambiar la porción cambia la barra', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'consumo');
    await abrir(page, CONSUMO);
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    const fila = renglon(page, 'Consumo de 300');
    await fila.getByRole('radio', { name: '½' }).click();
    await expect(barra(page)).toHaveText('$150 / $840 (18%)');
    await fila.getByRole('button', { name: /^Cambiar la porción de Consumo de 300/ }).click();
    await fila.getByRole('radio', { name: '¼' }).click();
    await expect(barra(page)).toHaveText('$75 / $840 (9%)');
  });

  test('🔴 otra cuenta elige y llega el refresco: suma las dos, y el borrador no la lleva a 100 (tope 99)', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'consumo');
    await abrir(page, CONSUMO);
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');
    await claim(page, C540, 'other', 10000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(barra(page)).toHaveText('$840 / $840 (99%)');
    await expect(page.getByRole('progressbar', { name: 'Asignado 99% de la mesa' })).toBeVisible();
  });

  test('🔴 nunca doble conteo: con lo propio registrado, el borrador suma sólo lo nuevo', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'consumo');
    await abrir(page, CONSUMO);
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await abrir(page, CONSUMO);
    await expect(page.getByRole('button', { name: 'Soltar Consumo de 300' })).toBeVisible();
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');
    await page.getByRole('button', { name: 'Consumo de 540', exact: true }).click();
    await expect(barra(page)).toHaveText('$840 / $840 (99%)');
  });

  test('🔴 nunca doble conteo mientras «Listo» viaja: un refresco que ya trae lo registrado no lo suma otra vez', async ({ page }) => {
    await page.clock.install();
    await preparar(page);
    await sembrar(page, 'consumo');
    const t0 = await page.evaluate(() => Date.now() + 5_000);
    await page.clock.pauseAt(t0);
    await page.goto(`/#/mesa/${CONSUMO}`);
    await page.clock.runFor(1_500);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await renglon(page, 'Consumo de 300').getByRole('radio', { name: '½' }).click();
    await expect(barra(page)).toHaveText('$150 / $840 (18%)');

    // Como el dueño real: la lectura del refresco llega DESPUÉS de que quedó
    // registrada la media. Sale antes de «Listo» y aterriza mientras viaja.
    await claim(page, C300, 'user', 5000);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.clock.runFor(100);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.clock.runFor(300);
    // El refresco ya aterrizó (350 ms) y «Listo» todavía viaja (hasta los 450).
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeVisible();
    await expect(barra(page)).toHaveText('$150 / $840 (18%)');
    await page.clock.runFor(200);
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
  });
});

test.describe('AF-BARRA-EN-VIVO · partes iguales', () => {
  test('🔴 lo guardado y el borrador cuentan UNA vez; cambiar la porción y soltar mueven la barra', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'igual');
    await declara(page, 'yo', [[PIZZA, 5000]]);
    await abrir(page, IGUAL);
    // El borrador nace con lo guardado (½ pizza): la barra es lo registrado.
    await expect(renglon(page, 'Pizza para compartir').locator('[data-estado="mio"] .qc-pildora')).toHaveText('½');
    await expect(barra(page)).toHaveText('$150 / $840 (18%)');

    const pizza = renglon(page, 'Pizza para compartir');
    await pizza.getByRole('button', { name: /^Cambiar la porción de Pizza para compartir/ }).click();
    await pizza.getByRole('radio', { name: 'Entero' }).click();
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');
    await capturar(page, 'barra-en-vivo-02-igual');

    await pizza.getByRole('button', { name: /^Cambiar la porción de Pizza para compartir/ }).click();
    await pizza.getByRole('button', { name: 'Soltar', exact: true }).click();
    await expect(barra(page)).toHaveText('$0 / $840 (0%)');
  });

  test('otra cuenta declara y llega el refresco: suma lo de la otra y mi borrador', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'igual');
    await abrir(page, IGUAL);
    await page.getByRole('button', { name: /^Parrillada/ }).click();
    await renglon(page, 'Parrillada').getByRole('radio', { name: '½' }).click();
    await expect(barra(page)).toHaveText('$270 / $840 (32%)');
    await declara(page, 'otra', [[PIZZA, 10000]]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(barra(page)).toHaveText('$570 / $840 (68%)');
  });

  test('🔴 el borrador que completa la mesa no la lleva a 100 si lo registrado no está completo', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'igual');
    await declara(page, 'otra', [[PIZZA, 10000]]);
    await abrir(page, IGUAL);
    await expect(barra(page)).toHaveText('$300 / $840 (36%)');
    await page.getByRole('button', { name: /^Parrillada/ }).click();
    await expect(barra(page)).toHaveText('$840 / $840 (99%)');
  });
});
