import { expect, test, type Page } from '@playwright/test';

/**
 * AF-GOOGLE-REDIRECT · decisiones 92 y 94 · «Entrar» con Google en la MISMA
 * pestaña, lado de la app (`docs/GOOGLE_REDIRECT_D92_WIRE.md` en el dueño
 * `a8987b0`).
 *
 * En el riel mock no hay GIS ni AB: el botón mock en modo redirect hace lo que
 * harían Google (el POST al `login_uri`) y el dueño (el 303 a `/#…`) con el
 * mock del dueño, y la vuelta es un documento NUEVO, como en real.
 *
 * Costuras: `payme.app.mock.google_redirect.v1` (`'true'` = `enabled: true`;
 * si no, el bloque se publica con `enabled: false`, como hoy lo sirve el dueño),
 * `payme.app.mock.google_sin_cuenta.v1` y `payme.app.mock.public_signup.v1`.
 */

const LOGIN_URI = 'https://app.paymemx.com/auth/google/redirect';

async function preparar(page: Page, o: { redirect?: boolean; sinCuenta?: boolean; altaPublica?: boolean } = {}): Promise<void> {
  await page.addInitScript((op) => {
    if (op.redirect) localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
    if (op.sinCuenta) localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
    if (op.altaPublica !== undefined) {
      localStorage.setItem('payme.app.mock.public_signup.v1', op.altaPublica ? 'true' : 'false');
    }
  }, o);
}

/** Todas las URLs por las que pasa cada documento: la inicial y cada push/replace. */
async function registrarUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __urls: string[] };
    w.__urls = [location.href];
    for (const metodo of ['pushState', 'replaceState'] as const) {
      const original = history[metodo].bind(history);
      history[metodo] = (estado: unknown, titulo: string, url?: string | URL | null) => {
        original(estado, titulo, url);
        w.__urls.push(location.href);
      };
    }
  });
}

const urls = (page: Page) => page.evaluate(() => (window as unknown as { __urls: string[] }).__urls);
const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const ingreso = (page: Page) => page.getByText('Log in', { exact: true });
const inicio = (page: Page) => page.getByRole('button', { name: 'Nueva', exact: true });

/** Una vuelta en frío, como la del 303: un documento nuevo. */
async function volverCon(page: Page, fragmento: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/#${fragmento}`);
}

async function limpia(page: Page): Promise<void> {
  expect(await page.evaluate(() => ({ path: location.pathname, search: location.search, hash: location.hash })))
    .toEqual({ path: '/', search: '', hash: '' });
}

test.describe('AF-GOOGLE-REDIRECT · con el flag apagado, el popup de siempre', () => {
  test('enabled=false (lo servido hoy): el botón no pide redirect y entra en la misma página, como antes', async ({ page }) => {
    await preparar(page);
    await registrarUrls(page);
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
    await expect(google(page)).not.toHaveAttribute('data-login-uri', /.*/);
    await google(page).click();
    await expect(inicio(page)).toBeVisible();
    // Sin ida y vuelta: el documento es el mismo y nunca hubo fragmento de vuelta.
    expect((await urls(page)).some((u) => u.includes('google_redirect'))).toBe(false);
  });
});

test.describe('AF-GOOGLE-REDIRECT · con el flag encendido, «Entrar» en la misma pestaña', () => {
  test('el botón de «Entrar» pide redirect con el login_uri exacto', async ({ page }) => {
    await preparar(page, { redirect: true });
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(google(page)).toHaveAttribute('data-login-uri', LOGIN_URI);
  });

  test('«Crea tu cuenta» sigue en popup (fase 1)', async ({ page }) => {
    await preparar(page, { redirect: true, altaPublica: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
    await expect(page.getByText('Crea tu cuenta', { exact: true }).first()).toBeVisible();
    await expect(google(page)).toBeVisible();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
  });

  test('ida y vuelta: entra a Inicio, y el código nunca toca path, query ni un pedido', async ({ page }) => {
    await preparar(page, { redirect: true });
    await registrarUrls(page);
    const pedidos: string[] = [];
    page.on('request', (r) => pedidos.push(r.url()));
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await google(page).click();
    await expect(inicio(page)).toBeVisible();
    await limpia(page);

    // El documento de la vuelta nació con el fragmento del 303 y lo soltó.
    const vistas = await urls(page);
    const conCodigo = vistas.find((u) => u.includes('#google_redirect='));
    expect(conCodigo, 'la vuelta no pasó por el fragmento').toBeDefined();
    const codigo = new URL(conCodigo!).hash.slice('#google_redirect='.length);
    expect(codigo).toMatch(/^[A-Za-z0-9_-]{20,200}$/);
    for (const u of vistas) {
      const x = new URL(u);
      expect(`${x.pathname}${x.search}`, `el código pasó por path o query: ${u}`).not.toContain(codigo);
    }
    expect(pedidos.filter((u) => u.includes(codigo)), 'un pedido llevó el código en la URL').toEqual([]);
    // La primera URL después de la inicial ya es la limpia: se sacó antes que nada.
    expect(new URL(vistas[vistas.indexOf(conCodigo!) + 1]!).hash).toBe('');
  });

  test('el mismo código dos veces: la segunda no entra y lo dice', async ({ page }) => {
    await preparar(page, { redirect: true });
    await registrarUrls(page);
    await page.goto('/');
    await google(page).click();
    await expect(inicio(page)).toBeVisible();
    const conCodigo = (await urls(page)).find((u) => u.includes('#google_redirect='))!;
    const codigo = new URL(conCodigo).hash.slice('#google_redirect='.length);

    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(ingreso(page)).toBeVisible();

    await volverCon(page, `google_redirect=${codigo}`);
    await expect(page.getByRole('alert'))
      .toContainText('No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.');
    await expect(ingreso(page)).toBeVisible();
    await limpia(page);
  });

  test('sin vínculo (el dueño contesta social_auth_failed): lleva a «Crea tu cuenta con Google», como el popup', async ({ page }) => {
    await preparar(page, { redirect: true, sinCuenta: true, altaPublica: true });
    await page.goto('/');
    await google(page).click();
    await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toBeVisible();
    await limpia(page);
  });
});

test.describe('AF-GOOGLE-REDIRECT · cada error de la vuelta, con el texto que ya existe', () => {
  for (const [error, texto] of [
    ['csrf_failed', 'No pudimos completar el ingreso. Prueba de nuevo.'],
    ['temporarily_unavailable', 'Prueba de nuevo más tarde.'],
  ] as const) {
    test(`#google_redirect_error=${error}`, async ({ page }) => {
      await preparar(page, { redirect: true });
      await volverCon(page, `google_redirect_error=${error}`);
      await expect(page.getByRole('alert')).toContainText(texto);
      await expect(ingreso(page)).toBeVisible();
      await limpia(page);
    });
  }

  test('#google_redirect_error=social_auth_failed con el alta cerrada: el texto neutro, sin prometer alta', async ({ page }) => {
    await preparar(page, { redirect: true, altaPublica: false });
    await volverCon(page, 'google_redirect_error=social_auth_failed');
    await expect(page.getByRole('alert'))
      .toContainText('No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.');
    await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toHaveCount(0);
    await limpia(page);
  });

  test('#google_redirect_error=social_auth_failed con alta: «Crea tu cuenta con Google»', async ({ page }) => {
    await preparar(page, { redirect: true, altaPublica: true });
    await volverCon(page, 'google_redirect_error=social_auth_failed');
    await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toBeVisible();
    await limpia(page);
  });

  test('una vuelta con un código que no es del dueño: no canjea, lo dice y limpia la URL', async ({ page }) => {
    await preparar(page, { redirect: true });
    const pedidos: string[] = [];
    page.on('request', (r) => { if (r.method() === 'POST') pedidos.push(r.url()); });
    await volverCon(page, 'google_redirect=corto');
    await expect(page.getByRole('alert')).toContainText('No pudimos completar el ingreso. Prueba de nuevo.');
    await limpia(page);
  });
});
