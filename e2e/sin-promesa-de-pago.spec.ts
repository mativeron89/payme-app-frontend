import { expect, test, type Page } from '@playwright/test';
import { EN } from '../src/i18n/en';
import { abrirMesaConLink, ingresar } from './_app';

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
 *
 * D622 · AF-3 (M1 de E06 sobre AF-2): la guarda también caza «cobrar» y
 * «tarjeta», y todo corre además en inglés («pay», «charge», «card»).
 *
 * D622 · AF-5: también el link con la vista previa del dueño (D629: «{nombre} te
 * invitó a su mesa en {restaurante}») y su tarjeta del alta.
 */

type Idioma = 'es' | 'en';

/**
 * Las promesas de pago, como palabra entera:
 * - «pagar» y toda su familia por la RAÍZ (`p[aá]g` y lo que siga: «pago», «pagues», «pagarás», «pagamos»,
 *   «págalo», …), salvo «página(s)» (AF-4, m3 de E06 sobre AF-3: la lista cerrada dejaba pasar el futuro, la
 *   primera del plural y los enclíticos);
 * - «cobrar» y toda su familia también por la RAÍZ (`c[oó]br` y lo que siga: «cobro», «cobrarás», «cobraría»,
 *   «cóbralo», «cobrándote», …). AF-6, m1 de E06 sobre AF-4: la lista cerrada dejaba pasar el futuro, el
 *   condicional y los enclíticos, la misma clase que m3 en «pagar». «recobrar» sigue afuera (va pegada a una letra);
 * - «tarjeta» y «tarjetas».
 */
const PROMESA_DE_PAGO = new RegExp([
  '(?<!\\p{L})(?:',
  'p[aá]g(?!in[ao]s?(?!\\p{L}))\\p{L}*',
  '|c[oó]br\\p{L}*',
  '|tarjetas?',
  ')(?!\\p{L})',
].join(''), 'iu');

/**
 * Lo mismo en inglés: «pay», «paid», «payment», «charge», «charged», «card», … («PayMe» no: sigue una letra). AF-4
 * (m3): también «billed», «billing», «checkout» y «payout». «bill» sola NO: es «la cuenta» («Split the bill»).
 */
const PROMESA_DE_PAGO_EN = /(?<!\p{L})(?:pay|pays|paid|paying|payment|payments|charge|charges|charged|charging|card|cards|billed|billing|checkouts?|payouts?)(?!\p{L})/iu;

const PROMESA: Record<Idioma, RegExp> = { es: PROMESA_DE_PAGO, en: PROMESA_DE_PAGO_EN };

/** El texto en el idioma de la corrida (las claves de `en.ts` son el español). */
const tr = (idioma: Idioma, es: string): string => (idioma === 'en' ? EN[es] ?? es : es);

/** Riel de dinero apagado e idioma desde la primera carga (para el link sin sesión). */
async function preparar(page: Page, idioma: Idioma): Promise<void> {
  await page.addInitScript((i) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    localStorage.setItem('payme.app.idioma.v1', i);
  }, idioma);
}

/** Con sesión: se entra en español (los rótulos de `ingresar`) y el idioma se cambia antes de ir a la mesa. */
async function entrarEn(page: Page, idioma: Idioma): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await page.evaluate((i) => localStorage.setItem('payme.app.idioma.v1', i), idioma);
  // El idioma se lee al cargar la app: se recarga (la sesión del mock sobrevive).
  await page.reload();
  await expect(page.locator('.screen').first()).toBeVisible();
}

/** Abre un desplegable de «Tu mesa» por el nombre de su región, si está cerrado. */
async function abrirRegion(page: Page, nombre: string): Promise<void> {
  const cabecera = page.getByRole('region', { name: nombre, exact: true }).locator('.desplegable-cabecera');
  if ((await cabecera.count()) === 0) return;
  if ((await cabecera.getAttribute('aria-expanded')) !== 'true') await cabecera.click();
  await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
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

/**
 * D622 · AF-6 · la banda «Demo · datos de ejemplo, no se cobra dinero real» existe SÓLO en el riel mock
 * (`LoginScreen.tsx`, `IS_MOCK`): en el build real ese nodo no se renderiza, así que no es algo que la persona vea.
 * Para medir el formulario de alta como se ve en producción se la saca de la lectura, y sólo a ella.
 */
async function sinLaBandaDelMock(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll<HTMLElement>('.ingreso-demo')) el.style.display = 'none';
  });
}

async function sinPromesa(page: Page, idioma: Idioma, donde: string, raiz = 'body'): Promise<void> {
  const texto = await loQueSeLee(page, raiz);
  expect(texto.length, `${donde}: se leyó la pantalla`).toBeGreaterThan(20);
  const m = texto.match(PROMESA[idioma]);
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

for (const idioma of ['es', 'en'] as const) {
  const T = (es: string) => tr(idioma, es);
  test.describe(`D622 · AF-2 · AF-3 · con los pagos apagados nada promete un pago (${idioma})`, () => {
    test('🔴 el link sin sesión (A1) y la tarjeta del alta con link', async ({ page }) => {
      await preparar(page, idioma);
      await page.goto('/#/mesa/PA-0001?t=tok-cualquiera-largo&signup_invitation=signup-token-link-mesa-aaaaaaaa');
      // Testigo por el título y el botón (no por el texto que se vigila: si volviera «pagar», que lo cace la guarda).
      await expect(page.getByRole('heading', { name: T('Te invitaron a una mesa'), exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: T('Crear cuenta gratis'), exact: true })).toBeVisible();
      await sinPromesa(page, idioma, 'A1');
      await page.getByRole('button', { name: T('Crear cuenta gratis'), exact: true }).click();
      await expect(page.locator('.title-card')).toBeVisible();
      await sinPromesa(page, idioma, 'alta con link · la tarjeta del link', '.title-card');
      // AF-6 · D673: también el formulario de alta de debajo, con su lema (antes «Divide y paga la cuenta…»).
      await expect(page.getByLabel(T('Nombre'), { exact: true })).toBeVisible();
      await sinLaBandaDelMock(page);
      await sinPromesa(page, idioma, 'alta con link · el formulario');
    });

    test('🔴 AF-6 · el formulario de alta pública («Crea tu cuenta»), con su lema', async ({ page }) => {
      await preparar(page, idioma);
      await page.addInitScript(() => localStorage.setItem('payme.app.mock.public_signup.v1', 'true'));
      await page.goto('/');
      // Testigo de que el config ya llegó (el botón de Google sólo se dibuja con la capability leída): sin él, el
      // lema del estado inicial —el cerrado— pasaría la guarda antes de que el dueño conteste.
      await expect(page.getByRole('group', { name: T('Continuar con Google') })).toBeVisible();
      await page.getByRole('button', { name: T('Crea tu cuenta'), exact: true }).click();
      await expect(page.getByLabel(T('Nombre'), { exact: true })).toBeVisible();
      await expect(page.getByLabel(T('Apellido'), { exact: true })).toBeVisible();
      await sinLaBandaDelMock(page);
      await sinPromesa(page, idioma, 'alta pública');
      // Y la pantalla de «Entrar», que comparte el lema.
      await page.getByRole('button', { name: T('Ya tengo cuenta → entrar'), exact: true }).click();
      await expect(page.getByLabel(T('Contraseña'), { exact: true })).toBeVisible();
      await sinLaBandaDelMock(page);
      await sinPromesa(page, idioma, 'Entrar');
    });

    test('🔴 AF-5 · el link sin sesión con la vista previa (quién invita y dónde) y su alta', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
        localStorage.setItem('payme.app.mock.link_preview.v1', 'encendido');
      });
      await ingresar(page);
      const mesa = await abrirMesaConLink(page, { sinGarantia: true });
      await page.evaluate((i) => {
        localStorage.removeItem('payme_app_session__mock');
        localStorage.setItem('payme.app.idioma.v1', i);
      }, idioma);
      await page.reload();
      await page.goto(`/${mesa.link.slice(mesa.link.indexOf('#'))}&signup_invitation=signup-token-link-mesa-aaaaaaaa`);
      // Testigo: el título de la vista previa (sin él, la guarda leería la pantalla de siempre, que ya cubre A1).
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(idioma === 'en' ? /invited you to their table at/ : /te invitó a su mesa en/);
      await sinPromesa(page, idioma, 'A1 con vista previa');
      await page.getByRole('button', { name: T('Crear cuenta gratis'), exact: true }).click();
      await expect(page.getByLabel(T('Nombre'), { exact: true })).toBeVisible();
      await sinPromesa(page, idioma, 'alta con vista previa · la tarjeta del link', '.title-card');
    });

    test('🔴 el link sin sesión sin alta pública (A2)', async ({ page }) => {
      await preparar(page, idioma);
      await page.goto('/#/mesa/PA-0001?t=tok-cualquiera-largo');
      await expect(page.getByRole('button', { name: T('Ya tengo cuenta · Entrar'), exact: true })).toBeVisible();
      await sinPromesa(page, idioma, 'A2');
    });

    test('🔴 «Tu mesa» por consumo, con todo abierto y un plato elegido', async ({ page }) => {
      await entrarEn(page, idioma);
      await sembrar(page, true);
      await page.goto(`/#/mesa/${CODE}`);
      await expect(page.getByRole('heading', { name: T('Tu mesa'), exact: true })).toBeVisible();
      await abrirRegion(page, T('Quiénes están en la mesa'));
      await abrirRegion(page, T('Tus consumos'));
      // Testigo: el plato que eligió otra cuenta se ve como tal (AF-4: con las iniciales de «los demás» del mock).
      await expect(page.getByText(idioma === 'en' ? 'AM picked it' : 'Lo eligió AM', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Consumo de 540', exact: true }).click();
      await sinPromesa(page, idioma, 'Tu mesa');
      await page.getByRole('button', { name: T('Configuración de la mesa'), exact: true }).click();
      await expect(page.getByRole('dialog', { name: T('Configuración de la mesa') })).toBeVisible();
      // AF-3 · con el QR ya dibujado: su nombre accesible también se lee.
      await expect(page.locator('.codigo-qr')).toBeVisible();
      await sinPromesa(page, idioma, 'Configuración de la mesa');
    });

    test('🔴 «¿Qué consumiste?» de quien no organiza, con un plato elegido', async ({ page }) => {
      await entrarEn(page, idioma);
      await sembrar(page, false);
      await page.goto(`/#/mesa/${CODE}`);
      await expect(page.getByRole('heading', { name: T('¿Qué consumiste?'), exact: true })).toBeVisible();
      await expect(page.getByText(idioma === 'en' ? 'AM picked it' : 'Lo eligió AM', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Consumo de 540', exact: true }).click();
      await sinPromesa(page, idioma, '¿Qué consumiste?');
    });
  });
}

test.describe('D622 · AF-2 · AF-3 · la expresión de la guarda', () => {
  test('SONDA · caza la familia de «pagar», «cobrar» y «tarjeta» y no confunde otras palabras', () => {
    for (const si of ['Para pagar tu parte', 'Pago sin confirmar', 'No queda nada que pagues', 'Pagado', 'Ya lo pagaste', 'Lo pagó otro',
      'Cuando se elija todo, se te cobra tu parte.', 'Te cobramos al final', 'Cobro pendiente', 'Ya te cobraron', 'Quedó cobrado', 'Ya lo pagaron',
      'revisa que todos hayan cargado su tarjeta.', 'Tarjetas guardadas',
      // D622 · AF-4 · m3 de E06 sobre AF-3: las conjugaciones que la lista cerrada dejaba pasar.
      'Pagarás tu parte', 'Se pagará al final', 'Pagaré después', 'Pagamos entre todos', 'Para pagarte', 'Págalo aquí',
      'Que lo paguemos', 'Pagarían',
      // D622 · AF-6 · m1 de E06 sobre AF-4: «cobrar» por la raíz, como «pagar».
      'Te lo cobrarás', 'Se cobraría al final', 'Cóbralo aquí', 'Cobrándote tu parte', 'Cóbrate', 'COBRAREMOS']) {
      expect(PROMESA_DE_PAGO.test(si), si).toBe(true);
    }
    for (const no of ['Pagina', 'Página', 'páginas', 'paginas', 'apagado', 'Propagar', 'empaque', 'Elige tus platos', 'recobrar', 'Tarjetero']) {
      expect(PROMESA_DE_PAGO.test(no), no).toBe(false);
    }
  });

  test('SONDA · en inglés caza «pay», «charge» y «card» y no confunde «PayMe» ni otras palabras', () => {
    for (const si of ['Pay your share', 'You paid', 'Payment pending', 'We will charge you', 'Charged to the card', 'Saved cards',
      // D622 · AF-4 · m3 de E06 sobre AF-3.
      'You will be billed', 'Billing details', 'Go to checkout', 'Checkout', 'Payout pending', 'Payouts']) {
      expect(PROMESA_DE_PAGO_EN.test(si), si).toBe(true);
    }
    // «bill» sola es «la cuenta» («Split the bill»), un texto legítimo de la app: no es promesa de pago.
    for (const no of ['PayMe', 'Create a PayMe account', 'repay', 'discharge', 'cardinal', 'scorecard', 'Pick your dishes',
      'Split the bill', 'the whole bill', 'billboard']) {
      expect(PROMESA_DE_PAGO_EN.test(no), no).toBe(false);
    }
  });
});
