import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

interface SyntheticClaim {
  who: 'user' | 'other';
  fraction_bps: number;
  amount_cents: number | null;
  status: 'locked' | 'paid';
}

interface SyntheticItem {
  id: string;
  name: string;
  price_cents: number;
  quantity?: number;
  claims?: SyntheticClaim[];
}

interface SyntheticMesa {
  code: string;
  total_cents: number;
  paid_amount_cents?: number;
  division_mode?: 'consumo' | 'igual';
  status?: 'open' | 'expired';
  guarantee_mode?: boolean;
  closure_reason?: string | null;
  items: SyntheticItem[];
}

async function preparar(page: Page, mode: 'disabled' | 'sandbox' = 'disabled'): Promise<void> {
  await page.addInitScript((moneyMode) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', moneyMode);
  }, mode);
  await ingresar(page);
}

async function sembrarMesa(page: Page, spec: SyntheticMesa): Promise<void> {
  await page.evaluate(async (s) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<Record<string, unknown>> };
      persist: () => void;
    };
    const mutable = state as unknown as { mesas: Array<Record<string, unknown>> };
    const template = mutable.mesas[0] as { restaurant: unknown; active_staff: unknown };
    mutable.mesas = mutable.mesas.filter((mesa) => mesa.code !== s.code);
    mutable.mesas.unshift({
      id: `${s.code.replace(/\D/g, '').padStart(8, '0')}-0000-4000-8000-000000000000`,
      code: s.code,
      restaurant: structuredClone(template.restaurant),
      total_cents: s.total_cents,
      paid_amount_cents: s.paid_amount_cents ?? 0,
      tip_amount_cents: 0,
      division_mode: s.division_mode ?? 'consumo',
      expected_participants: 2,
      status: s.status ?? 'open',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      items: s.items.map((item) => {
        const claims = structuredClone(item.claims ?? []);
        const fullyPaid = claims.reduce((sum, claim) => sum + (claim.status === 'paid' ? claim.fraction_bps : 0), 0) >= 10000;
        return {
          id: item.id,
          name: item.name,
          category: 'other',
          price_cents: item.price_cents,
          quantity: item.quantity ?? 1,
          status: fullyPaid ? 'paid' : claims.length > 0 ? 'locked' : 'available',
          lockedBy: null,
          lock_expires_at: null,
          claims,
        };
      }),
      slots: s.division_mode === 'igual'
        ? [
            { slot_index: 0, amount_cents: Math.ceil(s.total_cents / 2), status: 'available', claimedBy: null },
            { slot_index: 1, amount_cents: Math.floor(s.total_cents / 2), status: 'available', claimedBy: null },
          ]
        : null,
      active_staff: structuredClone(template.active_staff),
      openedByUser: true,
      captured_shortfall_cents: 0,
      guarantee_method: s.guarantee_mode === false ? 'none' : 'card',
      guarantee_mode: s.guarantee_mode ?? true,
      closure_reason: s.closure_reason ?? null,
    });
    persist();
  }, spec);
}

async function abrir(page: Page, code: string): Promise<void> {
  await page.goto(`/#/mesa/${code}`);
  await expect(page.getByText(code, { exact: false }).first()).toBeVisible();
}

const items840: SyntheticItem[] = [
  { id: '30000000-0000-4000-8000-000000000000', name: 'Consumo de 300', price_cents: 30000 },
  { id: '54000000-0000-4000-8000-000000000000', name: 'Consumo de 540', price_cents: 54000 },
];

test.describe('RM190 · barra por ítems asignados sin pago', () => {
  test('provisional no cuenta; confirmación, doble toque, recarga y release siguen la fuente real', async ({ page }) => {
    await preparar(page);
    await sembrarMesa(page, { code: 'PA-8401', total_cents: 84000, items: items840 });
    await abrir(page, 'PA-8401');

    await expect(page.getByRole('progressbar', { name: 'Asignado 0% de la mesa' })).toBeVisible();
    await expect(page.getByText('$0.00 asignados · $840.00 por asignar (0%)')).toBeVisible();

    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await expect(page.locator('.mi-parte-amt')).toHaveText('$300.00');
    await expect(page.getByRole('progressbar', { name: 'Asignado 0% de la mesa' })).toBeVisible();

    // Dos eventos no duplican el claim: el owner reemplaza el lock propio.
    await page.getByRole('button', { name: 'Listo', exact: true }).dblclick();
    await expect(page.getByRole('button', { name: 'Soltar Consumo de 300' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Asignado 36% de la mesa' })).toBeVisible();
    await expect(page.getByText('$300.00 asignados · $540.00 por asignar (36%)')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const storePath = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; items: Array<{ claims: unknown[] }> }> };
      };
      const item = state.mesas.find((mesa) => mesa.code === 'PA-8401')?.items[0];
      return item?.claims.length ?? -1;
    })).toBe(1);

    await page.reload();
    await expect(page.getByRole('progressbar', { name: 'Asignado 36% de la mesa' })).toBeVisible();
    await expect(page.getByText('$300.00 asignados · $540.00 por asignar (36%)')).toBeVisible();

    await page.getByRole('button', { name: 'Soltar Consumo de 300' }).dblclick();
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Asignado 0% de la mesa' })).toBeVisible();
    await expect(page.getByText('$0.00 asignados · $840.00 por asignar (0%)')).toBeVisible();
  });

  test('un 409 concurrente descarta lo provisional y refleja sólo la media asignada por otro actor', async ({ page }) => {
    await preparar(page);
    await sembrarMesa(page, { code: 'PA-8402', total_cents: 84000, items: items840 });
    await abrir(page, 'PA-8402');

    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await page.evaluate(async () => {
      const storePath = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ storePath) as {
        state: {
          mesas: Array<{
            code: string;
            items: Array<{ status: string; claims: SyntheticClaim[] }>;
          }>;
        };
        persist: () => void;
      };
      const item = state.mesas.find((mesa) => mesa.code === 'PA-8402')!.items[0]!;
      item.status = 'locked';
      item.claims = [{ who: 'other', fraction_bps: 5000, amount_cents: null, status: 'locked' }];
      persist();
    });
    await page.getByRole('button', { name: 'Listo', exact: true }).click();

    await expect(page.getByText('De ese plato queda solo ½')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Asignado 18% de la mesa' })).toBeVisible();
    await expect(page.getByText('$150.00 asignados · $690.00 por asignar (18%)')).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
      const storePath = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; items: Array<{ claims: SyntheticClaim[] }> }> };
      };
      return state.mesas.find((mesa) => mesa.code === 'PA-8402')?.items[0]?.claims;
    })).toEqual([{ who: 'other', fraction_bps: 5000, amount_cents: null, status: 'locked' }]);

    // El mock no adjunta item_id al 409; el owner real sí. Una recarga completa
    // descarta igualmente la intención local y conserva sólo el agregado real.
    await page.reload();
    await expect(page.getByRole('button', { name: /^Consumo de 300/ })).toContainText('Queda ½');
    await expect(page.getByRole('button', { name: 'Soltar Consumo de 300' })).toHaveCount(0);
  });

  test('100% se ve en mesa activa y en el cierre existente, con pagado separado', async ({ page }) => {
    await preparar(page);
    const completos = items840.map((item) => ({
      ...item,
      claims: [{ who: 'other' as const, fraction_bps: 10000, amount_cents: null, status: 'locked' as const }],
    }));
    await sembrarMesa(page, { code: 'PA-8403', total_cents: 84000, items: completos });
    await abrir(page, 'PA-8403');
    await expect(page.getByRole('progressbar', { name: 'Asignado 100% de la mesa' })).toBeVisible();
    await expect(page.getByText('$840.00 asignados · $0.00 por asignar (100%)')).toBeVisible();

    await sembrarMesa(page, {
      code: 'PA-8404', total_cents: 84000, items: completos,
      status: 'expired', guarantee_mode: false, closure_reason: 'all_items_selected',
    });
    await abrir(page, 'PA-8404');
    await expect(page.getByText('Esta mesa cerró sin cobros')).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Asignado 100% de la mesa' })).toBeVisible();
    await expect(page.getByText('Asignado', { exact: true }).locator('..')).toContainText('$840.00');
    await expect(page.getByText('Por asignar', { exact: true }).locator('..')).toContainText('$0.00');
    await expect(page.getByText('Pagado por los comensales').locator('..')).toContainText('$0.00');
  });

  test('pagos habilitados conservan la barra anterior', async ({ page }) => {
    await preparar(page, 'sandbox');
    await sembrarMesa(page, {
      code: 'PA-8405', total_cents: 84000, paid_amount_cents: 30000,
      items: [{ ...items840[0]!, claims: [{ who: 'other', fraction_bps: 10000, amount_cents: 30000, status: 'paid' }] }, items840[1]!],
    });
    await abrir(page, 'PA-8405');
    await expect(page.getByRole('progressbar', { name: 'Pagado 36% de la mesa' })).toBeVisible();
    await expect(page.getByText('$300.00 de $840.00 (36%)')).toBeVisible();
    await expect(page.getByText(/asignados/)).toHaveCount(0);
  });

  test('partes iguales sin pagos conserva su semántica informativa anterior', async ({ page }) => {
    await preparar(page);
    await sembrarMesa(page, {
      code: 'PA-8406', total_cents: 84000, division_mode: 'igual', items: items840,
    });
    await abrir(page, 'PA-8406');
    await expect(page.getByRole('progressbar', { name: 'Pagado 0% de la mesa' })).toBeVisible();
    await expect(page.getByText('$0.00 de $840.00 (0%)')).toBeVisible();
    await expect(page.getByText(/asignados/)).toHaveCount(0);
  });
});
