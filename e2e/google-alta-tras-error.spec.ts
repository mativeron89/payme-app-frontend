import { expect, test, type Page } from '@playwright/test';

/**
 * AF-HIGIENE-ALTA · punto 4 · decisiones 92, 102 y 103. «Entrar» con Google en
 * la misma pestaña, sin cuenta: la vuelta trae `#google_redirect_error=social_auth_failed`
 * y la app lleva a «Crea tu cuenta con Google» (decisión 73). Hasta 0.199.0 ese
 * paso creaba con los datos del formulario y el botón en POPUP, el que falla en
 * iPhone. Con `google_redirect_signup` encendido, el paso usa el MISMO alta en
 * un toque que «Crea tu cuenta»: redirect con `state` `alta:`, canje al volver.
 * Apagado, igual que antes.
 *
 * Costuras del mock: `payme.app.mock.google_redirect.v1` (fase 1),
 * `…google_redirect_signup.v1`, `…google_sin_cuenta.v1` (la vuelta sin
 * vínculo), `…public_signup.v1`, `…legal_3_0_0.v1` (las casillas) y
 * `…latencia_aviso_ms.v1`.
 */

const LOGIN_URI = 'https://app.paymemx.com/auth/google/redirect';
const CONTEXTO = 'payme.app.google_alta_contexto.v1';
const PENDIENTES = 'payme.app.mock.google_signup_pending.v1';

interface Seams {
  altaRedirect?: boolean;
  latenciaAviso?: number;
}

async function preparar(page: Page, s: Seams): Promise<void> {
  await page.addInitScript((op: Seams) => {
    if (sessionStorage.getItem('e2e.tras-error.preparado') === '1') return;
    sessionStorage.setItem('e2e.tras-error.preparado', '1');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
    localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
    localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
    if (op.altaRedirect) localStorage.setItem('payme.app.mock.google_redirect_signup.v1', 'true');
    if (op.latenciaAviso) localStorage.setItem('payme.app.mock.latencia_aviso_ms.v1', String(op.latenciaAviso));
  }, s);
}

/** Todas las URLs por las que pasa cada documento: la inicial y cada push/replace. */
async function registrarUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const previas = JSON.parse(sessionStorage.getItem('e2e.tras-error.urls') ?? '[]') as string[];
    previas.push(location.href);
    sessionStorage.setItem('e2e.tras-error.urls', JSON.stringify(previas));
    for (const metodo of ['pushState', 'replaceState'] as const) {
      const original = history[metodo].bind(history);
      history[metodo] = (estado: unknown, titulo: string, url?: string | URL | null) => {
        original(estado, titulo, url);
        const lista = JSON.parse(sessionStorage.getItem('e2e.tras-error.urls') ?? '[]') as string[];
        lista.push(location.href);
        sessionStorage.setItem('e2e.tras-error.urls', JSON.stringify(lista));
      };
    }
  });
}

const urls = (page: Page) => page.evaluate(
  () => JSON.parse(sessionStorage.getItem('e2e.tras-error.urls') ?? '[]') as string[],
);

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const adentro = (page: Page) => page.getByRole('button', { name: 'Nueva', exact: true });
const paso = (page: Page) => page.getByText('Crea tu cuenta con Google', { exact: true });
const contexto = (page: Page) => page.evaluate((k) => sessionStorage.getItem(k), CONTEXTO);

async function marcarCasillas(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
  await page.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
}

/** «Entrar» con Google en la misma pestaña; el mock vuelve sin vínculo. */
async function entrarSinCuenta(page: Page): Promise<void> {
  await page.goto('/');
  await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
  await expect(google(page)).not.toHaveAttribute('data-state', /.*/);
  await google(page).click();
  await expect(paso(page)).toBeVisible();
}

test.describe('AF-HIGIENE-ALTA · alta con Google después de «Entrar» sin cuenta', () => {
  test('encendido: error → «Crea tu cuenta con Google» → redirect → canje → 201', async ({ page }) => {
    await preparar(page, { altaRedirect: true });
    await registrarUrls(page);
    await entrarSinCuenta(page);

    // El botón del paso es el alta en un toque: redirect, el MISMO login_uri y
    // state `alta:<id>`. No pide datos: los pone Google.
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(google(page)).toHaveAttribute('data-login-uri', LOGIN_URI);
    await expect(google(page)).toHaveAttribute('data-state', /^alta:[0-9a-f-]{36}$/);
    // `exact`: sin él, el texto viejo «Revisa tus datos y toca…» lo contiene y
    // el testigo pasaría por el vecino (mutante P4-L).
    await expect(page.getByText('Toca «Continuar con Google» otra vez para crear tu cuenta.', { exact: true }))
      .toBeVisible();
    for (const campo of ['Nombre', 'Apellido', 'Email', 'Contraseña']) {
      await expect(page.getByLabel(campo, { exact: true }), campo).toHaveCount(0);
    }
    // Y ningún cartel que pida esos datos.
    await expect(page.locator('.note-datos-google, .note-correo-social')).toHaveCount(0);

    // Sin las casillas no hay contexto; con ellas, el que viaja al canje.
    expect(await contexto(page)).toBeNull();
    await marcarCasillas(page);
    await capturar(page, 'alta-tras-error-01-paso');
    expect(JSON.parse((await contexto(page)) ?? 'null')).toEqual({
      accepted_notice_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      legal_acceptance: expect.objectContaining({ adult_declaration: true }),
    });

    await google(page).click();
    // El aviso dura 2,4 s y sale antes que Inicio: se mira primero.
    await expect(page.getByText('¡Listo! Creamos tu cuenta de PayMe.', { exact: true })).toBeVisible();
    await expect(adentro(page)).toBeVisible();

    // Pasó por las dos vueltas: la del error y la del alta, y salió limpia.
    const recorrido = await urls(page);
    expect(recorrido.some((u) => u.includes('#google_redirect_error=social_auth_failed'))).toBe(true);
    const vuelta = recorrido.map((u) => u.includes('#google_signup=')).lastIndexOf(true);
    expect(vuelta).toBeGreaterThan(-1);
    expect(recorrido[vuelta + 1]).toMatch(/\/$/);
    // El código no quedó en la URL ni en ningún storage de la app (el registro
    // de URLs es de este test y se salta).
    const almacenado = await page.evaluate(() => {
      const valores: string[] = [location.href];
      for (const almacen of [localStorage, sessionStorage]) {
        for (let i = 0; i < almacen.length; i += 1) {
          const clave = almacen.key(i)!;
          if (clave === 'e2e.tras-error.urls') continue;
          valores.push(`${clave}=${almacen.getItem(clave) ?? ''}`);
        }
      }
      return valores.join('\n');
    });
    expect(almacenado).not.toContain('google_signup=');
    expect(await contexto(page)).toBeNull();
    expect(await page.evaluate(
      (k) => Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, unknown>).length,
      PENDIENTES,
    )).toBe(0);
  });

  test('encendido: mientras carga el aviso, el paso no ofrece botón ni campos; después, el de redirect', async ({ page }) => {
    // La vuelta del error es un documento NUEVO y el aviso se vuelve a pedir:
    // con latencia, esa ventana es la que en «Crea tu cuenta» dejaba el popup.
    await preparar(page, { altaRedirect: true, latenciaAviso: 6000 });
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect', { timeout: 15_000 });
    await google(page).click();
    await expect(paso(page)).toBeVisible();
    await expect(google(page)).toHaveCount(0);
    for (const campo of ['Nombre', 'Apellido', 'Email']) {
      await expect(page.getByLabel(campo, { exact: true }), campo).toHaveCount(0);
    }
    await expect(google(page)).toHaveAttribute('data-state', /^alta:[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
  });

  test('apagado: el paso de siempre, con los datos del formulario y el botón en popup', async ({ page }) => {
    await preparar(page, {});
    await entrarSinCuenta(page);
    await expect(page.getByText(
      'Revisa tus datos y toca «Continuar con Google» otra vez para crear tu cuenta.',
      { exact: true },
    )).toBeVisible();
    await page.getByLabel('Nombre', { exact: true }).fill('Ana');
    await page.getByLabel('Apellido', { exact: true }).fill('Pérez');
    await page.getByLabel('Email', { exact: true }).fill('ana.perez@example.com');
    await expect(google(page)).toBeVisible();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
    await expect(google(page)).not.toHaveAttribute('data-state', /.*/);
  });
});
