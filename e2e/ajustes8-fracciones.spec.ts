import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { abrirTusConsumos } from './_mesa';

const ITEM_ID = '70000000-0000-4000-8000-000000000007';

async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await ingresar(page);
}

async function sembrar(page: Page, code: string, original: number | null): Promise<void> {
  await page.evaluate(async ({ mesaCode, originalParticipants, itemId }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<Record<string, unknown>> };
      persist: () => void;
    };
    const template = state.mesas[0] as { restaurant: unknown; active_staff: unknown };
    state.mesas = state.mesas.filter((mesa) => mesa.code !== mesaCode);
    state.mesas.unshift({
      id: `${mesaCode.replace(/\D/g, '').padStart(8, '0')}-0000-4000-8000-000000000000`,
      code: mesaCode,
      restaurant: structuredClone(template.restaurant),
      total_cents: 70000,
      paid_amount_cents: 0,
      tip_amount_cents: 0,
      division_mode: 'consumo',
      expected_participants: originalParticipants ?? 7,
      ...(originalParticipants === null ? {} : { original_participants: originalParticipants }),
      status: 'open',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      items: [{
        id: itemId,
        name: 'Pizza para compartir',
        category: 'other',
        price_cents: 70000,
        quantity: 1,
        status: 'available',
        lockedBy: null,
        lock_expires_at: null,
        claims: [],
      }],
      slots: null,
      active_staff: structuredClone(template.active_staff),
      openedByUser: true,
      captured_shortfall_cents: 0,
      guarantee_method: 'none',
      guarantee_mode: false,
      closure_reason: null,
    });
    persist();
  }, { mesaCode: code, originalParticipants: original, itemId: ITEM_ID });
  await page.goto(`/#/mesa/${code}`);
  await abrirTusConsumos(page);
  // Decisión 77: el encabezado ya no muestra el código; el testigo es la URL
  // y el consumo que esta spec sembró.
  await expect(page).toHaveURL(new RegExp(`:\\d+/mesa/${code}$`));
  await expect(page.getByRole('button', { name: 'Pizza para compartir', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pizza para compartir', exact: true }).click();
}

/** Graba lo que la pantalla le manda a `lockItems`, sin sustituir la respuesta. */
async function grabarLocks(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __locks: unknown[] };
    w.__locks = [];
    const original = api.lockItems.bind(api);
    api.lockItems = async (...a: unknown[]) => { w.__locks.push(a[1]); return original(...a); };
  });
}

async function fraccionGuardada(page: Page, code: string): Promise<number | null> {
  return page.evaluate(async ({ mesaCode, itemId }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; items: Array<{ id: string; claims: Array<{ who: string; fraction_bps: number }> }> }> };
    };
    return state.mesas.find((mesa) => mesa.code === mesaCode)
      ?.items.find((item) => item.id === itemId)
      ?.claims.find((claim) => claim.who === 'user')?.fraction_bps ?? null;
  }, { mesaCode: code, itemId: ITEM_ID });
}

const porciones = (page: Page) => page
  .getByRole('radiogroup', { name: 'Porción de Pizza para compartir' })
  .getByRole('radio');

/**
 * 🔴 **La decisión 90 de Mati (2026-09-26) cambió lo que V04 ofrecía.** El
 * selector natural daba Entero, ½, ⅓, ¼ y «Otro» con un denominador a mano
 * hasta N; las mesas históricas mostraban además ⅔ y ¾ con un aviso. Ahora son
 * **Entero, ½, ⅓ y ¼** para todas, limitadas por las personas (n204) y por lo
 * que queda. Lo que V04 cuidaba y sigue vivo: N limita, la mesa con N viaja por
 * denominador (el dueño fija los bps) y la histórica no infiere N y viaja por bps.
 */
test.describe('Ajustes 8 · V04 fracciones naturales (con la decisión 90)', () => {
  test('N=2 ofrece únicamente entero y mitad, sin Otro', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'PA-9202', 2);

    await expect(porciones(page)).toHaveText(['Entero', '½']);
    await expect(page.getByRole('radio', { name: '⅓' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Otro' })).toHaveCount(0);
  });

  test('N=7 ofrece Entero · ½ · ⅓ · ¼ sin Otro, y envía el denominador; el dueño fija 3333 bps', async ({ page }, testInfo) => {
    await preparar(page);
    await sembrar(page, 'PA-9207', 7);

    await expect(porciones(page)).toHaveText(['Entero', '½', '⅓', '¼']);
    await expect(page.getByRole('radio', { name: 'Otro' })).toHaveCount(0);
    await page.getByRole('radio', { name: '⅓' }).click();
    await page.screenshot({ path: testInfo.outputPath('v04-fraccion-un-tercio.png'), fullPage: true });

    await grabarLocks(page);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => fraccionGuardada(page, 'PA-9207')).toBe(3333);
    expect(await page.evaluate(() => (window as unknown as { __locks: unknown[] }).__locks))
      .toEqual([[{ item_id: ITEM_ID, fraction_denominator: 3 }]]);
  });

  test('una mesa histórica no infiere N: mismas cuatro porciones, y viaja por bps', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'PA-9299', null);

    await expect(porciones(page)).toHaveText(['Entero', '½', '⅓', '¼']);
    await expect(page.getByRole('radio', { name: 'Otro' })).toHaveCount(0);
    await page.getByRole('radio', { name: '¼' }).click();
    await grabarLocks(page);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => fraccionGuardada(page, 'PA-9299')).toBe(2500);
    const locks = await page.evaluate(() => (window as unknown as { __locks: Array<Array<Record<string, unknown>>> }).__locks);
    expect(locks).toHaveLength(1);
    expect(locks[0]).toEqual([expect.objectContaining({ item_id: ITEM_ID, fraction_bps: 2500 })]);
    expect(locks[0]![0]).not.toHaveProperty('fraction_denominator');
  });
});
