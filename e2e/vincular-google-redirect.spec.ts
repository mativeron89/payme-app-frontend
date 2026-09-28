import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-VINCULAR-GOOGLE · decisión 107, punto 1 · «Vincular Google» en la MISMA
 * pestaña, con el mock que replica al dueño v2.141.0
 * (`docs/GOOGLE_VINCULAR_REDIRECT_D107_WIRE.md`).
 *
 * En el riel mock no hay GIS: el botón de Google en redirect hace lo que harían
 * Google (el POST al `login_uri` con el `state` `vincular:`) y el dueño (el 303 a
 * `/#google_link=listo`), y la vuelta es un documento NUEVO, como en real.
 *
 * La contraseña «buena» del mock es la de la demo de `continue/link`
 * (`MOCK_CLAVE_DEMO_VINCULAR`); se compone con `.repeat()`, como pide el auditor
 * de secretos.
 */

const LOGIN_URI = 'https://app.paymemx.com/auth/google/redirect';
const BUENA = 'demo'.repeat(3);
const MALA = 'mala-'.repeat(2);
const INTENTOS = 'payme.app.mock.google_link_intents.v1';
const MARCA = 'payme.app.google_vincular_en_curso.v1';

async function preparar(page: Page, { link = true, vuelta }: { link?: boolean; vuelta?: string } = {}): Promise<void> {
  await page.addInitScript(({ link, vuelta }) => {
    if (sessionStorage.getItem('e2e.vincular.preparado') === '1') return;
    sessionStorage.setItem('e2e.vincular.preparado', '1');
    localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
    if (link) localStorage.setItem('payme.app.mock.google_redirect_link.v1', 'true');
    if (vuelta) localStorage.setItem('payme.app.mock.google_link_vuelta.v1', vuelta);
  }, { link, vuelta });
  await ingresar(page);
}

const seccion = (page: Page) => page.locator('section.cuentas-conectadas');
const google = (page: Page) => seccion(page).getByRole('button', { name: 'Continuar con Google', exact: true });

async function abrirConfiguracion(page: Page): Promise<void> {
  await page.goto('/#/mas');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
  await expect(seccion(page).getByText('No vinculada', { exact: true })).toBeVisible();
}

/** «Vincular Google» → botón en la misma pestaña → Google → vuelta a la contraseña. */
async function irYVolverDeGoogle(page: Page): Promise<void> {
  await seccion(page).getByRole('button', { name: 'Vincular Google', exact: true }).click();
  await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
  await google(page).click();
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await seccion(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

/** Lo guardado por la app (sin la «base» del mock) y la URL: ni el `state` ni la vuelta. */
async function sinRastros(page: Page): Promise<void> {
  const todo = await page.evaluate(() => {
    const valores: string[] = [location.href];
    for (const almacen of [localStorage, sessionStorage]) {
      for (let i = 0; i < almacen.length; i += 1) {
        const clave = almacen.key(i)!;
        if (clave.startsWith('payme.app.mock.')) continue;
        valores.push(`${clave}=${almacen.getItem(clave) ?? ''}`);
      }
    }
    return valores.join('\n');
  });
  expect(todo).not.toContain('vincular:');
  expect(todo).not.toContain('google_link');
  expect(todo).not.toContain(MARCA);
}

test.describe('AF-VINCULAR-GOOGLE · con la capability encendida', () => {
  test('de punta a punta: redirect con `state` vincular: → vuelta → contraseña → «Vinculada»', async ({ page }) => {
    await preparar(page);
    await abrirConfiguracion(page);
    await seccion(page).getByRole('button', { name: 'Vincular Google', exact: true }).click();
    // El botón va en la MISMA pestaña, con el `login_uri` de siempre y el `state` del dueño.
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(google(page)).toHaveAttribute('data-login-uri', LOGIN_URI);
    await expect(google(page)).toHaveAttribute('data-state', /^vincular:[A-Za-z0-9_-]{20,200}$/);
    await capturar(page, 'vincular-01-boton');
    await google(page).click();

    // La vuelta es un documento nuevo: el fragmento sale antes del router y se
    // abre Configuración, directo en la contraseña.
    await expect(seccion(page).getByLabel('Contraseña', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => `${location.pathname}${location.hash}`)).toBe('/mas');
    await sinRastros(page);
    await capturar(page, 'vincular-02-contrasena');

    await seccion(page).getByLabel('Contraseña', { exact: true }).fill(BUENA);
    await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(seccion(page).getByText('Vinculada', { exact: true })).toBeVisible();
    await expect(seccion(page).getByText('Listo: ya puedes entrar con Google.', { exact: true })).toBeVisible();
    await capturar(page, 'vincular-03-vinculada');
    // El dueño lo dice también al volver a leer.
    await page.reload();
    await expect(seccion(page).getByText('Vinculada', { exact: true })).toBeVisible();
  });

  test('contraseña equivocada: se dice y se reintenta SÓLO la contraseña, con el mismo intento', async ({ page }) => {
    await preparar(page);
    await abrirConfiguracion(page);
    await irYVolverDeGoogle(page);
    const campo = seccion(page).getByLabel('Contraseña', { exact: true });
    await campo.fill(MALA);
    await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(seccion(page).getByRole('alert')).toHaveText('La contraseña no es correcta.');
    await expect(campo).toBeVisible();
    await expect(google(page)).toHaveCount(0);
    await campo.fill(BUENA);
    await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(seccion(page).getByText('Vinculada', { exact: true })).toBeVisible();
  });

  test('el tope de la cuenta (429): «Demasiados intentos», sin probar la contraseña', async ({ page }) => {
    await preparar(page);
    await abrirConfiguracion(page);
    await irYVolverDeGoogle(page);
    const campo = seccion(page).getByLabel('Contraseña', { exact: true });
    for (let i = 0; i < 4; i += 1) {
      await campo.fill(MALA);
      await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
      await expect(seccion(page).getByRole('alert')).toHaveText('La contraseña no es correcta.');
    }
    // Con 4 errores el intento sigue; el quinto lo quema. Un intento nuevo, y el
    // quinto error de la hora llega al tope de la cuenta.
    await seccion(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(seccion(page).getByText('No vinculada', { exact: true })).toBeVisible();
    await irYVolverDeGoogle(page);
    await campo.fill(MALA);
    await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(seccion(page).getByRole('alert')).toHaveText('La contraseña no es correcta.');
    // Ahora ni la buena se prueba.
    await campo.fill(BUENA);
    await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(seccion(page).getByRole('alert')).toHaveText('Demasiados intentos. Espera un minuto.');
    await expect(seccion(page).getByText('No vinculada', { exact: true })).toBeVisible();
  });

  test('intento vencido (401 opaco): vuelve a «Vincular Google», con el aviso', async ({ page }) => {
    await preparar(page);
    await abrirConfiguracion(page);
    await irYVolverDeGoogle(page);
    await expect(seccion(page).getByLabel('Contraseña', { exact: true })).toBeVisible();
    // Pasaron los 9 minutos del intento.
    await page.evaluate((k) => {
      const intentos = JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, { vence: number }>;
      for (const i of Object.values(intentos)) i.vence = Date.now() - 1;
      localStorage.setItem(k, JSON.stringify(intentos));
    }, INTENTOS);
    await seccion(page).getByLabel('Contraseña', { exact: true }).fill(BUENA);
    await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(seccion(page).getByRole('alert'))
      .toHaveText('No pudimos vincular esa cuenta de Google. Inténtalo de nuevo.');
    await expect(seccion(page).getByRole('button', { name: 'Vincular Google', exact: true })).toBeVisible();
    await expect(seccion(page).getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  });

  for (const [error, texto] of [
    ['social_auth_failed', 'No pudimos vincular esa cuenta de Google. Inténtalo de nuevo.'],
    ['csrf_failed', 'No pudimos vincular esa cuenta de Google. Inténtalo de nuevo.'],
    ['temporarily_unavailable', 'No pudimos conectar. Prueba de nuevo.'],
  ] as const) {
    test(`la vuelta con #google_redirect_error=${error} es de vincular: Configuración, con el aviso`, async ({ page }) => {
      await preparar(page, { vuelta: error });
      await abrirConfiguracion(page);
      await irYVolverDeGoogle(page);
      await expect(seccion(page).getByRole('alert')).toHaveText(texto);
      await expect(seccion(page).getByRole('button', { name: 'Vincular Google', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => `${location.pathname}${location.hash}`)).toBe('/mas');
      await sinRastros(page);
    });
  }

  test('sin una ida a vincular, el error de la vuelta sigue siendo de «Entrar»', async ({ page }) => {
    await preparar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    // Un documento nuevo, como el 303 (igual que `volverCon` de `google-redirect.spec.ts`).
    await page.goto('about:blank');
    await page.goto('/#google_redirect_error=temporarily_unavailable');
    await expect(page.getByRole('alert')).toHaveText('Prueba de nuevo más tarde.');
    expect(await page.evaluate(() => location.pathname)).toBe('/');
  });
});

test.describe('AF-VINCULAR-GOOGLE · con la capability apagada', () => {
  test('el popup de hoy, sin intento ni `state`', async ({ page }) => {
    await preparar(page, { link: false });
    await abrirConfiguracion(page);
    await seccion(page).getByRole('button', { name: 'Vincular Google', exact: true }).click();
    await expect(google(page)).toBeVisible();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
    await google(page).click();
    await seccion(page).getByLabel('Contraseña', { exact: true }).fill(BUENA);
    await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
    await expect(seccion(page).getByText('Vinculada', { exact: true })).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), INTENTOS)).toBeNull();
  });

  test('se enciende con el popup a la vista (relectura tardía): el popup se retira y se vuelve a empezar en la misma pestaña', async ({ page }) => {
    await preparar(page, { link: false });
    await abrirConfiguracion(page);
    await seccion(page).getByRole('button', { name: 'Vincular Google', exact: true }).click();
    await expect(google(page)).toBeVisible();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
    // La única ventana real: una relectura de `/api/config` que salió desde
    // «Entrar» (AF-ALTA-POPUP-D106) y vuelve después, con la capability ya
    // encendida. Se dispara sobre el MISMO módulo que usa la app (Vite dev).
    await page.evaluate(async () => {
      localStorage.setItem('payme.app.mock.google_redirect_link.v1', 'true');
      const modulo = '/src/api/socialAuth.ts';
      const { releerSocialAuthCapability } = await import(modulo);
      await releerSocialAuthCapability();
    });
    // Nunca popup con la capability encendida: sin el `state` no queda ningún botón.
    await expect(google(page)).toHaveCount(0);
    await seccion(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(seccion(page).getByText('No vinculada', { exact: true })).toBeVisible();
    await seccion(page).getByRole('button', { name: 'Vincular Google', exact: true }).click();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(google(page)).toHaveAttribute('data-state', /^vincular:[A-Za-z0-9_-]{20,200}$/);
  });
});
