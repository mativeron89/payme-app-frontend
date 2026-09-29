import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-VERSION-NUEVA · una pestaña vieja se actualiza sola en el ingreso.
 *
 * La versión que corre va embebida en el bundle; la publicada es
 * `/version.json` (el servidor de desarrollo sirve la misma que el bundle). Acá
 * se «publica una más nueva» interceptando esa ruta, a mitad del test cuando
 * hace falta: así la marca de «ya recargué por esta versión» no hace pasar a un
 * test por la razón equivocada.
 *
 * Testigos, en cada test: cuántos DOCUMENTOS cargó la pestaña (un contador en
 * `sessionStorage` que sobrevive a la recarga) y cuántas veces se pidió
 * `/version.json`. «No recarga» se afirma con la revisión HECHA (el pedido
 * existió) o con cero pedidos donde la revisión no tiene que existir.
 */

const NUEVA = '99.0.0';
const MARCA = 'payme.app.recarga_por_version.v1';

interface Publicacion {
  /** `null`: la del servidor (la misma del bundle). Si no, la que se sirve. */
  version: string | null;
  pedidos: number;
}

async function preparar(page: Page): Promise<Publicacion> {
  const pub: Publicacion = { version: null, pedidos: 0 };
  await page.route('**/version.json', async (route) => {
    pub.pedidos += 1;
    if (pub.version === null) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ version: pub.version }),
    });
  });
  await page.addInitScript(() => {
    sessionStorage.setItem('e2e.vn.cargas', String(Number(sessionStorage.getItem('e2e.vn.cargas') ?? '0') + 1));
  });
  return pub;
}

/** Durante una recarga el contexto se destruye: eso no es un número, se vuelve a medir. */
const cargas = (page: Page) => page.evaluate(() => Number(sessionStorage.getItem('e2e.vn.cargas') ?? '0'))
  .catch(() => -1);
const marca = (page: Page) => page.evaluate((k) => sessionStorage.getItem(k), MARCA);
const ingreso = (page: Page) => page.getByRole('button', { name: 'Entrar', exact: true });

/** Salir y volver a la pestaña, como al pasar a otra app del teléfono y regresar. */
async function salirYVolver(page: Page): Promise<void> {
  await page.evaluate(() => {
    let visible: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible });
    document.dispatchEvent(new Event('visibilitychange'));
    visible = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('AF-VERSION-NUEVA · en el ingreso', () => {
  test('control: con la versión del bundle publicada, revisa y no recarga', async ({ page }) => {
    const pub = await preparar(page);
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect.poll(() => pub.pedidos).toBeGreaterThanOrEqual(1);
    const respuesta = await page.evaluate(async () => (await fetch('/version.json', { cache: 'no-store' })).json());
    expect(respuesta).toEqual({ version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    expect(await cargas(page)).toBe(1);
    expect(await marca(page)).toBeNull();
  });

  test('🔴 pestaña vieja: hay una versión más nueva ⇒ recarga UNA vez, y sin bucle', async ({ page }) => {
    const pub = await preparar(page);
    pub.version = NUEVA;
    await page.goto('/');
    await expect.poll(() => cargas(page)).toBe(2);
    await expect(ingreso(page)).toBeVisible();
    expect(await marca(page)).toBe(NUEVA);
    // El JS sigue siendo el viejo (el servidor no cambió): la segunda carga
    // también revisa, ve la marca y no recarga. Y volver a la pestaña, tampoco.
    const antes = pub.pedidos;
    await salirYVolver(page);
    await expect.poll(() => pub.pedidos).toBeGreaterThan(antes);
    await page.waitForTimeout(1_000);
    expect(await cargas(page)).toBe(2);
  });

  test('cerrar sesión en una pestaña vieja lleva al ingreso y ahí recarga una vez', async ({ page }) => {
    const pub = await preparar(page);
    await ingresar(page);
    pub.version = NUEVA;
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect.poll(() => cargas(page)).toBe(2);
    await expect(ingreso(page)).toBeVisible();
    expect(await marca(page)).toBe(NUEVA);
  });

  test('con el ingreso abierto, al volver a la pestaña también revisa', async ({ page }) => {
    const pub = await preparar(page);
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect.poll(() => pub.pedidos).toBeGreaterThanOrEqual(1);
    pub.version = NUEVA;
    await salirYVolver(page);
    await expect.poll(() => cargas(page)).toBe(2);
    expect(await marca(page)).toBe(NUEVA);
  });

  test('vuelta desde el bfcache (pageshow persisted, sin visibilitychange): también revisa', async ({ page }) => {
    const pub = await preparar(page);
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect.poll(() => pub.pedidos).toBeGreaterThanOrEqual(1);
    pub.version = NUEVA;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect.poll(() => cargas(page)).toBe(2);
    expect(await marca(page)).toBe(NUEVA);
  });

  test('con algo escrito en el formulario, NO recarga', async ({ page }) => {
    const pub = await preparar(page);
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
    pub.version = NUEVA;
    const antes = pub.pedidos;
    await salirYVolver(page);
    await expect.poll(() => pub.pedidos).toBeGreaterThan(antes);
    await page.waitForTimeout(1_000);
    expect(await cargas(page)).toBe(1);
    expect(await marca(page)).toBeNull();
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('ana@example.com');
  });

  test('con una respuesta rara (HTML con 200, como una SPA), NO recarga', async ({ page }) => {
    const pub = await preparar(page);
    await page.unroute('**/version.json');
    await page.route('**/version.json', (route) => {
      pub.pedidos += 1;
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' });
    });
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect.poll(() => pub.pedidos).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(1_000);
    expect(await cargas(page)).toBe(1);
    expect(await marca(page)).toBeNull();
  });

  test('con el canje de un código de Google a medias, NO recarga', async ({ page }) => {
    const pub = await preparar(page);
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e.vn.preparado') === '1') return;
      sessionStorage.setItem('e2e.vn.preparado', '1');
      localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
      localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
      localStorage.setItem('payme.app.mock.google_redirect_signup.v1', 'true');
      localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
    });
    // En el documento de la vuelta el contexto no está: queda el paso «completar»
    // con el código en memoria.
    await page.addInitScript(() => {
      if (location.hash.startsWith('#google_signup=')) sessionStorage.removeItem('payme.app.google_alta_contexto.v1');
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
    const google = page.getByRole('button', { name: 'Continuar con Google', exact: true });
    await expect(google).toHaveAttribute('data-ux-mode', 'redirect');
    await page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
    await page.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
    await google.click();
    await expect(page.getByText('Para terminar de crear tu cuenta, confirma lo siguiente y toca «Crear mi cuenta».'))
      .toBeVisible();
    const cargasEnLaVuelta = await cargas(page);
    pub.version = NUEVA;
    const antes = pub.pedidos;
    await salirYVolver(page);
    await expect.poll(() => pub.pedidos).toBeGreaterThan(antes);
    await page.waitForTimeout(1_000);
    expect(await cargas(page)).toBe(cargasEnLaVuelta);
    expect(await marca(page)).toBeNull();
    await expect(page.getByRole('button', { name: 'Crear mi cuenta', exact: true })).toBeVisible();
  });
});

/**
 * AF-CARTEL-VERSION-NUEVA · decisión 125 · antes este describe era «fuera del
 * ingreso, ni siquiera revisa» y el test de la mesa afirmaba CERO pedidos de
 * versión. Con la sesión iniciada ahora se revisa en toda la app para mostrar
 * el cartel «Hay una versión nueva · Actualizar» (`cartel-version-nueva.spec.ts`).
 * Lo que el test protegía sigue igual: dentro de una mesa NO se recarga sola.
 */
test.describe('AF-VERSION-NUEVA · fuera del ingreso, nunca recarga sola', () => {
  test('🔴 en una mesa abierta: revisa, muestra el cartel y NO recarga, aunque vuelva a la pestaña', async ({ page }) => {
    const pub = await preparar(page);
    await ingresar(page);
    await abrirMesaConLink(page);
    pub.version = NUEVA;
    const antes = pub.pedidos;
    await salirYVolver(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    // Hubo revisión, y con eso el cartel: la persona decide cuándo recargar.
    await expect.poll(() => pub.pedidos).toBeGreaterThan(antes);
    await expect(page.getByText('Hay una versión nueva', { exact: true })).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(await cargas(page)).toBe(1);
    expect(await marca(page)).toBeNull();
  });

  test('en el alta desde el link de una mesa (sin sesión): sin pedidos de versión y sin recarga', async ({ page }) => {
    const pub = await preparar(page);
    pub.version = NUEVA;
    await page.goto('/#/mesa/PA-0001?t=tok-de-una-mesa-e2e-version');
    await expect(page.getByText('Te invitaron a una mesa')).toBeVisible();
    // Sin alta abierta la pantalla ofrece «Ya tengo cuenta»: el mismo LoginScreen.
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(ingreso(page)).toBeVisible();
    await salirYVolver(page);
    await page.waitForTimeout(1_500);
    expect(pub.pedidos).toBe(0);
    expect(await cargas(page)).toBe(1);
  });
});
