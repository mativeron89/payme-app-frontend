import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { enTuMesaConLaLista } from './_mesa';

/**
 * D622 · AF-2 · mejora 2 (§2 de la especificación), sin el conteo de personas:
 * la tarjeta con el estado de la mesa. Sale de lo REGISTRADO por la mesa (el
 * `remaining_bps` del dueño), no del borrador de quien mira; sin identidad ni
 * montos por persona; «Se sumaron N de M» espera AB-1 (AF-4).
 *
 * La siembra es la de `barra-en-vivo.spec.ts`: el mock tiene UNA sesión y «la
 * otra cuenta» se escribe en el store donde el dueño la guardaría.
 */
const CODE = 'PA-8622';
const C300 = '30000000-0000-4000-8000-000000008622';
const C540 = '54000000-0000-4000-8000-000000008622';
const C0 = '00000000-0000-4000-8000-000000008622';

async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
}

/** Una mesa de $840 ($300 + $540, y un agua de $0), sin garantía; organizada por esta cuenta salvo que se diga. */
async function sembrar(page: Page, over: { modo?: 'consumo' | 'igual'; organizo?: boolean; garantia?: boolean } = {}): Promise<void> {
  await page.evaluate(async ({ code, c300, c540, c0, modo, organizo, garantia }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<Record<string, unknown>> };
      persist: () => void;
    };
    const template = state.mesas[0] as { restaurant: unknown; active_staff: unknown };
    const item = (id: string, name: string, price: number) => ({
      id, name, category: 'other', price_cents: price, quantity: 1,
      status: 'available', lockedBy: null, lock_expires_at: null, claims: [],
    });
    state.mesas = state.mesas.filter((m) => m.code !== code);
    state.mesas.unshift({
      id: '00008622-0000-4000-8000-000000000000',
      code,
      restaurant: structuredClone(template.restaurant),
      total_cents: 84000,
      paid_amount_cents: 0,
      tip_amount_cents: 0,
      division_mode: modo,
      expected_participants: 2,
      original_participants: 2,
      status: 'open',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      items: [item(c300, 'Consumo de 300', 30000), item(c540, 'Consumo de 540', 54000), item(c0, 'Agua de la casa', 0)],
      slots: modo === 'igual'
        ? [
            { slot_index: 0, amount_cents: 42000, status: 'available', claimedBy: null },
            { slot_index: 1, amount_cents: 42000, status: 'available', claimedBy: null },
          ]
        : null,
      active_staff: structuredClone(template.active_staff),
      openedByUser: organizo,
      captured_shortfall_cents: 0,
      guarantee_method: garantia ? 'card' : 'none',
      guarantee_mode: garantia,
      closure_reason: null,
    });
    persist();
  }, { code: CODE, c300: C300, c540: C540, c0: C0, modo: over.modo ?? 'consumo', organizo: over.organizo ?? true, garantia: over.garantia ?? false });
}

/** Lo que eligió OTRA cuenta, registrado en el store como lo guardaría el dueño. */
async function eligioOtro(page: Page, itemId: string, bps: number): Promise<void> {
  await page.evaluate(async ({ code, itemId, bps }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; items: Array<{ id: string; status: string; claims: unknown[] }> }> };
      persist: () => void;
    };
    const item = state.mesas.find((m) => m.code === code)!.items.find((i) => i.id === itemId)!;
    item.status = 'locked';
    item.claims = [...item.claims, { who: 'other', fraction_bps: bps, amount_cents: null, status: 'locked' }];
    persist();
  }, { code: CODE, itemId, bps });
}

const refrescar = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const tarjeta = (page: Page) => page.locator('.estado-mesa');
const titular = (page: Page) => tarjeta(page).locator('.estado-mesa-titular');
const platos = (page: Page) => tarjeta(page).locator('.estado-mesa-platos');
const consejo = (page: Page) => tarjeta(page).locator('.estado-mesa-consejo');

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

test.describe('D622 · AF-2 · la tarjeta con el estado de la mesa', () => {
  test('🔴 organizador, nadie eligió: la frase y su consejo, antes de «Quiénes están en la mesa»', async ({ page }) => {
    await preparar(page);
    await sembrar(page);
    await page.goto(`/#/mesa/${CODE}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await expect(titular(page)).toHaveText('Todavía no eligió nadie');
    await expect(titular(page)).toHaveAttribute('role', 'status');
    await expect(platos(page)).toHaveCount(0);
    await expect(consejo(page)).toHaveText('Antes de cerrar la mesa, revisa que todos hayan elegido lo suyo.');
    // Va antes de «Quiénes están en la mesa» y después de la cabecera con la barra.
    const orden = await page.evaluate(() => {
      const t = document.querySelector('.estado-mesa')!;
      const q = document.querySelector('.desplegable.quienes')!;
      const barra = document.querySelector('.mi-progress')!;
      return {
        antesDeQuienes: !!(t.compareDocumentPosition(q) & Node.DOCUMENT_POSITION_FOLLOWING),
        despuesDeLaBarra: !!(barra.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    });
    expect(orden).toEqual({ antesDeQuienes: true, despuesDeLaBarra: true });
    // La barra de la cabecera no cambia (D77): sigue con «monto / total (porcentaje)».
    await expect(page.locator('.mi-meta-amt')).toHaveText('$0 / $840 (0%)');
    await capturar(page, 'estado-mesa-01-nadie');
  });

  test('🔴 otra cuenta elige: cuánto falta y cuántos platos sin dueño (el agua de $0 no cuenta); a medias, aparte', async ({ page }) => {
    await preparar(page);
    await sembrar(page);
    await page.goto(`/#/mesa/${CODE}`);
    await expect(titular(page)).toHaveText('Todavía no eligió nadie');
    await eligioOtro(page, C300, 10000);
    await refrescar(page);
    await expect(titular(page)).toHaveText('Falta elegir $540 de $840');
    await expect(platos(page)).toHaveText('Queda 1 plato sin dueño.');
    await capturar(page, 'estado-mesa-02-en-curso');
    await eligioOtro(page, C540, 5000);
    await refrescar(page);
    await expect(titular(page)).toHaveText('Falta elegir $270 de $840');
    // Sin platos sin dueño (el agua de $0 ya cuenta como cubierta, D389) no hay «0 sin dueño».
    await expect(platos(page)).toHaveCount(0);
    // Nunca nombra a nadie ni cuenta personas.
    await expect(tarjeta(page)).not.toContainText(/sumaron|Otra|@/);
  });

  test('🔴 el borrador propio no mueve la tarjeta (sí la barra): es lo registrado por la mesa', async ({ page }) => {
    await preparar(page);
    await sembrar(page);
    await page.goto(`/#/mesa/${CODE}`);
    await enTuMesaConLaLista(page);
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    await expect(page.locator('.mi-meta-amt')).toHaveText('$300 / $840 (36%)');
    await expect(titular(page)).toHaveText('Todavía no eligió nadie');
  });

  test('🔴 quien no organiza: la tarjeta con el consejo de que la mesa se cierra sola', async ({ page }) => {
    await preparar(page);
    await sembrar(page, { organizo: false });
    await page.goto(`/#/mesa/${CODE}`);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    await eligioOtro(page, C300, 5000);
    await refrescar(page);
    await expect(titular(page)).toHaveText('Falta elegir $690 de $840');
    await expect(platos(page)).toHaveText('Queda 1 plato sin dueño y 1 a medias.');
    await expect(consejo(page)).toHaveText('Cuando se elija todo, la mesa se cierra sola.');
    // Arriba de la lista de platos.
    const arriba = await page.evaluate(() => {
      const t = document.querySelector('.estado-mesa')!;
      const lista = document.querySelector('.qc-renglon')!;
      return !!(t.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(arriba).toBe(true);
    await capturar(page, 'estado-mesa-03-participante');
  });

  test('en partes iguales no hay tarjeta (testigo: la mesa cargó)', async ({ page }) => {
    await preparar(page);
    await sembrar(page, { modo: 'igual' });
    await page.goto(`/#/mesa/${CODE}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await expect(page.locator('.mi-meta-amt')).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
  });

  test('con garantía no hay tarjeta (no se cierra sola por selección)', async ({ page }) => {
    await preparar(page);
    await sembrar(page, { garantia: true });
    await page.goto(`/#/mesa/${CODE}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await expect(page.locator('.mi-meta-amt')).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
  });
});
