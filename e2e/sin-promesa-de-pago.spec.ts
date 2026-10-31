import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { abrirConfiguracionDeLaMesa, abrirQuienes, abrirTusConsumos } from './_mesa';

/**
 * D622 · AF-2 · la guarda que dejó pendiente AF-1 (GREEN del PR #112): mientras
 * los pagos estén apagados (D499 b1), ni la mesa por consumo ni el link sin
 * sesión prometen un pago. AF-1 cambió «pagar tu parte» por «elegir tus platos»;
 * esto impide que la palabra vuelva a aparecer.
 *
 * Se mide lo que la persona VE y lo que oye un lector de pantalla (el texto
 * visible más `aria-label`, `title` y `alt`), con el riel de dinero del mock
 * apagado. No es un censo de las fuentes: `MesaScreen` y `MesaDetailView` tienen
 * textos de pago legítimos en ramas que con los pagos apagados no se montan, y
 * lo que importa es lo que se monta.
 */

/** «pagar» y su familia («pago», «pagues», «pagado», «pagaste», «pagó», …), como palabra entera. */
const PROMESA_DE_PAGO = /(?<!\p{L})pag(?:ar|o|os|a|as|an|ue|ues|uen|ad[oa]s?|aste|ó|ando|arla|arlo)(?!\p{L})/iu;

async function preparar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
}

/** Lo que se ve y lo que se anuncia dentro de `raiz` (la página entera si no se dice), sin lo oculto con `display: none`. */
async function loQueSeLee(page: Page, raiz: string): Promise<string> {
  return page.evaluate((selector) => {
    const base = document.querySelector<HTMLElement>(selector);
    if (!base) return '';
    const atributos = [...base.querySelectorAll<HTMLElement>('[aria-label], [title], [alt]')]
      .filter((el) => el.getClientRects().length > 0)
      .flatMap((el) => [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('alt')])
      .filter((v): v is string => !!v);
    return [base.innerText, ...atributos].join('\n');
  }, raiz);
}

async function sinPromesa(page: Page, donde: string, raiz = 'body'): Promise<void> {
  const texto = await loQueSeLee(page, raiz);
  expect(texto.length, `${donde}: se leyó la pantalla`).toBeGreaterThan(20);
  const m = texto.match(PROMESA_DE_PAGO);
  expect(m ? texto.slice(Math.max(0, (m.index ?? 0) - 80), (m.index ?? 0) + 80) : null, `${donde}: promete un pago`).toBeNull();
}

const CODE = 'PA-8623';
const C300 = '30000000-0000-4000-8000-000000008623';
const C540 = '54000000-0000-4000-8000-000000008623';

/** Una mesa por consumo de $840, sin garantía, con un plato que ya eligió otra cuenta. */
async function sembrar(page: Page, organizo: boolean): Promise<void> {
  await page.evaluate(async ({ code, c300, c540, organizo }) => {
    const storePath = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<Record<string, unknown>> };
      persist: () => void;
    };
    const template = state.mesas[0] as { restaurant: unknown; active_staff: unknown };
    const item = (id: string, name: string, price: number, otro: boolean) => ({
      id, name, category: 'other', price_cents: price, quantity: 1,
      status: otro ? 'locked' : 'available', lockedBy: null, lock_expires_at: null,
      claims: otro ? [{ who: 'other', fraction_bps: 10000, amount_cents: null, status: 'locked' }] : [],
    });
    state.mesas = state.mesas.filter((m) => m.code !== code);
    state.mesas.unshift({
      id: '00008623-0000-4000-8000-000000000000',
      code,
      restaurant: structuredClone(template.restaurant),
      total_cents: 84000,
      paid_amount_cents: 0,
      tip_amount_cents: 0,
      division_mode: 'consumo',
      expected_participants: 3,
      original_participants: 3,
      status: 'open',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      items: [item(c300, 'Consumo de 300', 30000, true), item(c540, 'Consumo de 540', 54000, false)],
      slots: null,
      active_staff: structuredClone(template.active_staff),
      openedByUser: organizo,
      captured_shortfall_cents: 0,
      guarantee_method: 'none',
      guarantee_mode: false,
      closure_reason: null,
    });
    persist();
  }, { code: CODE, c300: C300, c540: C540, organizo });
}

test.describe('D622 · AF-2 · con los pagos apagados nada promete un pago', () => {
  test('🔴 el link sin sesión (A1) y la tarjeta del alta con link', async ({ page }) => {
    await preparar(page);
    await page.goto('/#/mesa/PA-0001?t=tok-cualquiera-largo&signup_invitation=signup-token-link-mesa-aaaaaaaa');
    // Testigo por el título y el botón (no por el texto que se vigila: si volviera «pagar», que lo cace la guarda).
    await expect(page.getByRole('heading', { name: 'Te invitaron a una mesa', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear cuenta gratis', exact: true })).toBeVisible();
    await sinPromesa(page, 'A1');
    await page.getByRole('button', { name: 'Crear cuenta gratis', exact: true }).click();
    await expect(page.locator('.title-card')).toBeVisible();
    // Sólo la tarjeta del link: debajo va el formulario de alta de siempre, que no es de la mesa (su lema,
    // «Divide y paga la cuenta…», queda anotado para Mati: no es de esta orden).
    await sinPromesa(page, 'alta con link', '.title-card');
  });

  test('🔴 el link sin sesión sin alta pública (A2)', async ({ page }) => {
    await preparar(page);
    await page.goto('/#/mesa/PA-0001?t=tok-cualquiera-largo');
    await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true })).toBeVisible();
    await sinPromesa(page, 'A2');
  });

  test('🔴 «Tu mesa» por consumo, con todo abierto y un plato elegido', async ({ page }) => {
    await preparar(page);
    await ingresar(page);
    await sembrar(page, true);
    await page.goto(`/#/mesa/${CODE}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await abrirQuienes(page);
    await abrirTusConsumos(page);
    // Testigo: el plato que eligió otra cuenta se ve como tal.
    await expect(page.getByText('Lo eligió otro', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Consumo de 540', exact: true }).click();
    await sinPromesa(page, 'Tu mesa');
    await abrirConfiguracionDeLaMesa(page);
    await sinPromesa(page, 'Configuración de la mesa');
  });

  test('🔴 «¿Qué consumiste?» de quien no organiza, con un plato elegido', async ({ page }) => {
    await preparar(page);
    await ingresar(page);
    await sembrar(page, false);
    await page.goto(`/#/mesa/${CODE}`);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    await expect(page.getByText('Lo eligió otro', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Consumo de 540', exact: true }).click();
    await sinPromesa(page, '¿Qué consumiste?');
  });

  test('SONDA · la expresión caza la familia de «pagar» y no confunde otras palabras', () => {
    for (const si of ['Para pagar tu parte', 'Pago sin confirmar', 'No queda nada que pagues', 'Pagado', 'Ya lo pagaste', 'Lo pagó otro']) {
      expect(PROMESA_DE_PAGO.test(si), si).toBe(true);
    }
    for (const no of ['Pagina', 'apagado', 'Propagar', 'empaque', 'Elige tus platos']) {
      expect(PROMESA_DE_PAGO.test(no), no).toBe(false);
    }
  });
});
