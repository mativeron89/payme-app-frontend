import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

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
  // Decisión 77: el encabezado ya no muestra el código; el testigo es la URL
  // y el consumo que esta spec sembró.
  await expect(page).toHaveURL(new RegExp(`#/mesa/${code}$`));
  await expect(page.getByRole('button', { name: 'Pizza para compartir', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pizza para compartir', exact: true }).click();
}

test.describe('Ajustes 8 · V04 fracciones naturales', () => {
  test('N=2 ofrece únicamente entero y mitad, sin Otro', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'PA-9202', 2);

    await expect(page.getByRole('radio', { name: 'Entero' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '1/2' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '1/3' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Otro' })).toHaveCount(0);
  });

  test('N=7 valida Otro y envía el denominador; el dueño fija 1428 bps', async ({ page }, testInfo) => {
    await preparar(page);
    await sembrar(page, 'PA-9207', 7);

    await expect(page.getByRole('radio', { name: '1/4' })).toBeVisible();
    await page.getByRole('radio', { name: 'Otro' }).click();
    const input = page.getByLabel('¿Entre cuántas personas compartieron este plato?');
    await input.fill('8');
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect(page.getByRole('alert')).toHaveText('El máximo para esta mesa es 7.');
    await input.fill('2.5');
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect(page.getByRole('alert')).toHaveText('Escribe un número entero positivo.');
    await input.fill('7');
    await page.getByRole('button', { name: 'Aplicar' }).click();
    await expect(page.getByRole('radio', { name: 'Otro' })).toHaveAttribute('aria-checked', 'true');
    await page.screenshot({ path: testInfo.outputPath('v04-fraccion-uno-sobre-siete.png'), fullPage: true });

    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(async ({ mesaCode, itemId }) => {
      const storePath = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; items: Array<{ id: string; claims: Array<{ who: string; fraction_bps: number }> }> }> };
      };
      return state.mesas.find((mesa) => mesa.code === mesaCode)
        ?.items.find((item) => item.id === itemId)
        ?.claims.find((claim) => claim.who === 'user')?.fraction_bps ?? null;
    }, { mesaCode: 'PA-9207', itemId: ITEM_ID })).toBe(1428);
  });

  test('una mesa histórica no infiere N y conserva el selector legacy', async ({ page }) => {
    await preparar(page);
    await sembrar(page, 'PA-9299', null);

    await expect(page.getByText('Esta mesa es anterior y no guardó el número original de personas. Mostramos las porciones disponibles de siempre.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Otro' })).toHaveCount(0);
    await expect(page.getByRole('radio', { name: '¼' })).toBeVisible();
    await page.getByRole('radio', { name: '¼' }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(async ({ mesaCode, itemId }) => {
      const storePath = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; items: Array<{ id: string; claims: Array<{ who: string; fraction_bps: number }> }> }> };
      };
      return state.mesas.find((mesa) => mesa.code === mesaCode)
        ?.items.find((item) => item.id === itemId)
        ?.claims.find((claim) => claim.who === 'user')?.fraction_bps ?? null;
    }, { mesaCode: 'PA-9299', itemId: ITEM_ID })).toBe(2500);
  });
});
