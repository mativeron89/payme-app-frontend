import { expect, test, type Page } from '@playwright/test';

/**
 * AF-ALTA-POPUP-D106 · con `google_redirect_signup` encendido, NINGÚN camino de
 * ingreso o alta con Google abre popup.
 *
 * Mati (27/09, 17:47Z) quiso crear una cuenta y Google le mostró «400 …
 * malformed», el síntoma del popup en iPhone. El dueño registró un
 * `POST /google/continue` (sólo sale de un botón `continue` en popup) y cero
 * `POST /auth/google/redirect`. Con la capability leída con todo encendido ese
 * botón no existe: la página la había leído ANTES de que se encendiera, y hasta
 * 0.200.1 no la volvía a leer nunca (cerrar sesión no recarga).
 *
 * Cada test corre con la configuración que sirve producción: redirect, alta en
 * redirect, «continuar» en un toque, alta pública, paquete legal y @. El testigo
 * es un registro de TODOS los botones de Google que se dibujaron en cada
 * documento, con su modo: en el riel mock, el botón en popup es el que no trae
 * `data-ux-mode`. «Nunca popup» se afirma sobre ese registro, no sobre el
 * último botón a la vista.
 */

const LOGIN_URI = 'https://app.paymemx.com/auth/google/redirect';
const ALTA_REDIRECT = 'payme.app.mock.google_redirect_signup.v1';
const REGISTRO = 'e2e.d106.botones';
const SIGNUP = 'e2e-d106-invitacion-de-alta-0123456789';

interface Seams {
  /** El ingreso en la misma pestaña (fase 1); por defecto encendido, como en producción. */
  redirect?: boolean;
  /** El alta en la misma pestaña; por defecto encendida, como en producción. */
  altaRedirect?: boolean;
  /** Con `false`, alta sólo por invitación: el dueño no ofrece el un-toque. */
  altaPublica?: boolean;
  /** Una versión del aviso que `continue` no acepta (con sufijo). */
  versionAviso?: string;
  latenciaAviso?: number;
}

async function preparar(page: Page, s: Seams = {}): Promise<void> {
  await page.addInitScript((op: Seams) => {
    if (sessionStorage.getItem('e2e.d106.preparado') === '1') return;
    sessionStorage.setItem('e2e.d106.preparado', '1');
    if (op.altaPublica !== false) localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
    if (op.redirect !== false) localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
    if (op.altaRedirect !== false) localStorage.setItem('payme.app.mock.google_redirect_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
    if (op.versionAviso) localStorage.setItem('payme.app.mock.aviso_version.v1', op.versionAviso);
    if (op.latenciaAviso) localStorage.setItem('payme.app.mock.latencia_aviso_ms.v1', String(op.latenciaAviso));
  }, s);
  // Cada botón de Google que entra al DOM, en cada documento: `redirect` o `popup`.
  await page.addInitScript((clave: string) => {
    const anotar = (boton: HTMLElement) => {
      const lista = JSON.parse(sessionStorage.getItem(clave) ?? '[]') as string[];
      lista.push(boton.dataset.uxMode === 'redirect' ? `redirect ${boton.dataset.state ?? '-'}` : 'popup');
      sessionStorage.setItem(clave, JSON.stringify(lista));
    };
    new MutationObserver((cambios) => {
      for (const cambio of cambios) {
        for (const nodo of cambio.addedNodes) {
          if (!(nodo instanceof HTMLElement)) continue;
          if (nodo.matches('.social-provider-google')) anotar(nodo);
          nodo.querySelectorAll<HTMLElement>('.social-provider-google').forEach(anotar);
        }
      }
    }).observe(document, { childList: true, subtree: true });
    // Y cada vez que la ranura de Google ENTRA a releer la capability: inerte o no.
    // Sólo la entrada (la clase antes no la tenía): otro cambio de clase mientras
    // relee —`social-google-gated`, por ejemplo— no es otra relectura. Anotar
    // cada mutación contaba renders, no relecturas, y daba [true, true] según el
    // tiempo (medido: 3/20 y 4/20 antes de este cambio).
    new MutationObserver((cambios) => {
      for (const cambio of cambios) {
        const el = cambio.target as HTMLElement;
        if (!el.classList?.contains('social-google-releyendo')) continue;
        if ((cambio.oldValue ?? '').split(/\s+/).includes('social-google-releyendo')) continue;
        const lista = JSON.parse(sessionStorage.getItem(`${clave}.releyendo`) ?? '[]') as boolean[];
        lista.push(el.hasAttribute('inert'));
        sessionStorage.setItem(`${clave}.releyendo`, JSON.stringify(lista));
      }
    }).observe(document, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
  }, REGISTRO);
}

const releyendo = (page: Page) => page.evaluate(
  (clave) => JSON.parse(sessionStorage.getItem(`${clave}.releyendo`) ?? '[]') as boolean[],
  REGISTRO,
);

const botones = (page: Page) => page.evaluate(
  (clave) => JSON.parse(sessionStorage.getItem(clave) ?? '[]') as string[],
  REGISTRO,
);

/** Ningún botón de Google en popup en todo lo que se dibujó, y al menos uno. */
async function nuncaPopup(page: Page, minimo = 1): Promise<string[]> {
  const lista = await botones(page);
  expect(lista, 'botones de Google dibujados').not.toContain('popup');
  expect(lista.length, 'botones de Google dibujados').toBeGreaterThanOrEqual(minimo);
  return lista;
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const creaTuCuenta = (page: Page) => page.getByRole('button', { name: 'Crea tu cuenta', exact: true });
const paso = (page: Page) => page.getByText('Crea tu cuenta con Google', { exact: true });
const registrarme = (page: Page) => page.getByRole('button', { name: 'Registrarme', exact: true });

async function esAltaEnRedirect(page: Page): Promise<void> {
  await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
  await expect(google(page)).toHaveAttribute('data-login-uri', LOGIN_URI);
  await expect(google(page)).toHaveAttribute('data-state', /^alta:[0-9a-f-]{36}$/);
}

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

test.describe('AF-ALTA-POPUP-D106 · el censo de caminos con Google, con todo encendido', () => {
  test('«Log in»: el botón va en la misma pestaña y sin state de alta', async ({ page }) => {
    await preparar(page);
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(google(page)).toHaveAttribute('data-login-uri', LOGIN_URI);
    await expect(google(page)).not.toHaveAttribute('data-state', /.*/);
    expect(new Set(await nuncaPopup(page))).toEqual(new Set(['redirect -']));
  });

  test('«Crea tu cuenta», con el aviso lento: sin botón mientras carga, después el alta en redirect', async ({ page }) => {
    await preparar(page, { latenciaAviso: 4000 });
    await page.goto('/');
    await creaTuCuenta(page).click();
    await expect(page.getByText('Crea tu cuenta', { exact: true }).first()).toBeVisible();
    await esAltaEnRedirect(page);
    await capturar(page, 'd106-01-crea-tu-cuenta');
    const lista = await nuncaPopup(page, 2);
    expect(lista.at(-1)).toMatch(/^redirect alta:/);
  });

  test('alta por link de invitación: el alta en redirect lleva la invitación', async ({ page }) => {
    await preparar(page);
    await page.goto(`/#/home?signup_invitation=${SIGNUP}`);
    await esAltaEnRedirect(page);
    await page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
    await page.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
    const contexto = await page.evaluate(() => sessionStorage.getItem('payme.app.google_alta_contexto.v1'));
    expect(JSON.parse(contexto ?? 'null')).toMatchObject({ invitation_token: SIGNUP });
    await nuncaPopup(page);
  });

  test('«Entrar» sin cuenta → «Crea tu cuenta con Google»: el paso va en redirect', async ({ page }) => {
    await preparar(page);
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await google(page).click();
    await expect(paso(page)).toBeVisible();
    await esAltaEnRedirect(page);
    // Dos documentos: el del ingreso y el de la vuelta con el error.
    const lista = await nuncaPopup(page, 2);
    expect(lista[0]).toBe('redirect -');
    expect(lista.at(-1)).toMatch(/^redirect alta:/);
  });

  test('aviso con una versión que «continuar» no acepta: sin Google en el alta, con el alta por correo', async ({ page }) => {
    await preparar(page, { versionAviso: '2.3.0-rc.1' });
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await creaTuCuenta(page).click();
    await expect(registrarme(page)).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await expect(google(page)).toHaveCount(0);
    // Tampoco el separador que anuncia a Google sobre el vacío.
    await expect(page.getByText('O regístrate con tu correo', { exact: true })).toHaveCount(0);
    // Y «Entrar» sin cuenta tampoco termina en el paso con popup: vuelve al alta
    // por correo (hasta 0.200.1 era el paso de siempre, con el botón en popup).
    await page.getByRole('button', { name: 'Ya tengo cuenta → entrar', exact: true }).click();
    await google(page).click();
    await expect(registrarme(page)).toBeVisible();
    await expect(paso(page)).toHaveCount(0);
    await expect(google(page)).toHaveCount(0);
    await capturar(page, 'd106-02-version-no-aceptada');
    expect(new Set(await nuncaPopup(page))).toEqual(new Set(['redirect -']));
  });

  test('alta sólo por invitación (sin un toque): sin Google en el alta, con el alta por correo', async ({ page }) => {
    await preparar(page, { altaPublica: false });
    await page.goto(`/#/home?signup_invitation=${SIGNUP}`);
    await expect(registrarme(page)).toBeVisible();
    await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
    await expect(google(page)).toHaveCount(0);
    await expect(page.getByText('O regístrate con tu correo', { exact: true })).toHaveCount(0);
    expect(await botones(page)).toEqual([]);
  });
});

test.describe('AF-ALTA-POPUP-D106 · la capability se vuelve a leer', () => {
  test('el caso de Mati: la página leyó Google en popup, el dueño lo encendió, cerró sesión y creó cuenta → nunca popup', async ({ page }) => {
    // La página se carga con el ingreso y el alta de Google en popup, como una
    // pestaña abierta antes de que el dueño los encendiera.
    await preparar(page, { redirect: false, altaRedirect: false });
    await page.goto('/');
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

    // El dueño enciende los dos con la página abierta. Desde acá, el testigo.
    await page.evaluate(([fase1, alta]) => {
      localStorage.setItem(fase1, 'true');
      localStorage.setItem(alta, 'true');
    }, ['payme.app.mock.google_redirect.v1', ALTA_REDIRECT]);
    await page.evaluate((k) => sessionStorage.removeItem(k), REGISTRO);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    // Ni el botón del ingreso aparece en popup un instante: espera la relectura.
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await creaTuCuenta(page).click();
    await esAltaEnRedirect(page);
    const lista = await nuncaPopup(page, 2);
    expect(lista[0]).toBe('redirect -');
    expect(lista.at(-1)).toMatch(/^redirect alta:/);
  });

  test('pantalla abierta, el dueño la enciende, la persona vuelve a la pestaña: el botón pasa a redirect', async ({ page }) => {
    await preparar(page, { altaRedirect: false });
    await page.goto('/');
    await creaTuCuenta(page).click();
    // Apagada: el alta en un toque en popup es lo que el dueño sirve.
    await expect(page.locator('.ingreso-alta-google .social-provider-google')).toBeVisible();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);

    await page.evaluate((k) => localStorage.setItem(k, 'true'), ALTA_REDIRECT);
    await salirYVolver(page);
    await esAltaEnRedirect(page);
    await expect(page.locator('.social-google-releyendo')).toHaveCount(0);
    // Mientras releía, el botón que estaba no respondía.
    expect(await releyendo(page)).toEqual([true]);
    // Y al revés, si el dueño lo apaga, vuelve el popup: sigue al dueño en los dos sentidos.
    await page.evaluate((k) => localStorage.removeItem(k), ALTA_REDIRECT);
    await salirYVolver(page);
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
  });

  test('vuelta desde el bfcache (pageshow persisted, sin visibilitychange): también relee', async ({ page }) => {
    await preparar(page, { altaRedirect: false });
    await page.goto('/');
    await creaTuCuenta(page).click();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
    await page.evaluate((k) => localStorage.setItem(k, 'true'), ALTA_REDIRECT);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await esAltaEnRedirect(page);
    expect(await releyendo(page)).toEqual([true]);
  });

  test('una respuesta que no cambia nada no vuelve a dibujar el botón', async ({ page }) => {
    await preparar(page);
    await page.goto('/');
    await creaTuCuenta(page).click();
    await esAltaEnRedirect(page);
    const antes = await botones(page);
    await salirYVolver(page);
    await expect.poll(() => releyendo(page)).toEqual([true]);
    await expect(page.locator('.social-google-releyendo')).toHaveCount(0);
    expect(await botones(page)).toEqual(antes);
  });
});
