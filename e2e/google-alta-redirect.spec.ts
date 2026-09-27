import { expect, test, type Page } from '@playwright/test';

/**
 * AF-GOOGLE-ALTA-REDIRECT · decisión 102 · «Crea tu cuenta» con Google en la
 * MISMA pestaña, lado de la app (`docs/GOOGLE_ALTA_REDIRECT_D102_WIRE.md` en el
 * dueño `e81b7c2`).
 *
 * En el riel mock no hay GIS ni AB: el botón mock en redirect hace lo que harían
 * Google (el POST al `login_uri` con el `state` de alta) y el dueño (el 303 a
 * `/#google_signup=…`), y la vuelta es un documento NUEVO, como en real.
 *
 * Costuras: `payme.app.mock.google_redirect.v1` (fase 1),
 * `payme.app.mock.google_redirect_signup.v1` (esta), `…public_signup.v1`,
 * `…google_sin_cuenta.v1`, `…google_correo_con_cuenta.v1`,
 * `…google_sin_nombre.v1` y `…legal_3_0_0.v1` (las casillas).
 */

const LOGIN_URI = 'https://app.paymemx.com/auth/google/redirect';
const CONTEXTO = 'payme.app.google_alta_contexto.v1';
const PENDIENTES = 'payme.app.mock.google_signup_pending.v1';

interface Seams {
  redirect?: boolean;
  altaRedirect?: boolean;
  sinNombre?: boolean;
  correoConCuenta?: boolean;
  legal?: boolean;
  /** Decisión 103: el @usuario está ENCENDIDO en producción desde el 27/09. */
  username?: boolean;
  /** ms de latencia del aviso en el mock: abre la ventana antes de que cargue. */
  latenciaAviso?: number;
}

async function preparar(page: Page, s: Seams): Promise<void> {
  await page.addInitScript((op: Seams) => {
    if (sessionStorage.getItem('e2e.d102.preparado') === '1') return;
    sessionStorage.setItem('e2e.d102.preparado', '1');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
    if (op.redirect) localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
    if (op.altaRedirect) localStorage.setItem('payme.app.mock.google_redirect_signup.v1', 'true');
    if (op.sinNombre) localStorage.setItem('payme.app.mock.google_sin_nombre.v1', 'true');
    if (op.correoConCuenta) localStorage.setItem('payme.app.mock.google_correo_con_cuenta.v1', 'true');
    if (op.legal) localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
    // El @ ya está encendido por defecto (decisión 103). La cuenta que nace en
    // el mock reusa el id de la demo, que trae su @: `null` la declara sin @,
    // como una cuenta recién creada de verdad.
    if (op.username) {
      localStorage.setItem('payme.app.mock.username.v1', 'true');
      localStorage.setItem('payme.app.mock.username_propio.v1',
        JSON.stringify({ 'a0000000-0000-4000-8000-000000000001': null }));
    }
    if (op.latenciaAviso) localStorage.setItem('payme.app.mock.latencia_aviso_ms.v1', String(op.latenciaAviso));
  }, s);
}

/** Todas las URLs por las que pasa cada documento: la inicial y cada push/replace. */
async function registrarUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const previas = JSON.parse(sessionStorage.getItem('e2e.d102.urls') ?? '[]') as string[];
    previas.push(location.href);
    sessionStorage.setItem('e2e.d102.urls', JSON.stringify(previas));
    for (const metodo of ['pushState', 'replaceState'] as const) {
      const original = history[metodo].bind(history);
      history[metodo] = (estado: unknown, titulo: string, url?: string | URL | null) => {
        original(estado, titulo, url);
        const lista = JSON.parse(sessionStorage.getItem('e2e.d102.urls') ?? '[]') as string[];
        lista.push(location.href);
        sessionStorage.setItem('e2e.d102.urls', JSON.stringify(lista));
      };
    }
  });
}

const urls = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('e2e.d102.urls') ?? '[]') as string[]);

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const adentro = (page: Page) => page.getByRole('button', { name: 'Nueva', exact: true });
const crearMiCuenta = (page: Page) => page.getByRole('button', { name: 'Crear mi cuenta', exact: true });

/**
 * ⚠️ El alta en un toque existe recién con el aviso cargado (su versión es la
 * que viaja). Antes, el botón es el de «captura» en popup: tocarlo ahí es otro
 * camino, y el test lo mediría por la razón equivocada. Se espera el modo listo:
 * redirect con la capability, o la frase del un-toque sin ella (sin casillas).
 */
async function irACreaTuCuenta(page: Page, modo: 'redirect' | 'popup'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(google(page)).toBeVisible();
  if (modo === 'redirect') await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
  else await expect(page.locator('.ingreso-aviso-google')).toHaveText('Al continuar aceptas el Aviso de privacidad');
}

async function marcarCasillas(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
  await page.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
}

function usuarioDeSesion(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('payme_app_session__mock');
    return raw ? (JSON.parse(raw) as { user?: Record<string, string> }).user ?? null : null;
  });
}

const pendientes = (page: Page) => page.evaluate(
  (k) => Object.keys(JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, unknown>).length,
  PENDIENTES,
);

/** El código del fragmento no quedó en ningún storage de la app ni en la URL. */
async function codigoEnNingunLado(page: Page): Promise<void> {
  const todo = await page.evaluate(() => {
    const valores: string[] = [location.href];
    for (const almacen of [localStorage, sessionStorage]) {
      for (let i = 0; i < almacen.length; i += 1) {
        const clave = almacen.key(i)!;
        if (clave === 'e2e.d102.urls') continue;
        valores.push(`${clave}=${almacen.getItem(clave) ?? ''}`);
      }
    }
    return valores.join('\n');
  });
  expect(todo).not.toContain('google_signup=');
}

test.describe('AF-GOOGLE-ALTA-REDIRECT · apagado: el alta en popup de hoy', () => {
  test('enabled=false (lo servido hoy): «Crea tu cuenta» no pide redirect y crea en la misma página', async ({ page }) => {
    // La fase 1 encendida y la 2 apagada: «Entrar» va en redirect, el alta NO.
    await preparar(page, { redirect: true });
    await registrarUrls(page);
    await irACreaTuCuenta(page, 'popup');
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
    await expect(google(page)).not.toHaveAttribute('data-state', /.*/);
    await google(page).click();
    // El aviso dura 2,4 s y sale antes que Inicio: se mira primero.
    await expect(page.getByText('¡Listo! Creamos tu cuenta de PayMe.')).toBeVisible();
    await expect(adentro(page)).toBeVisible();
    expect((await urls(page)).some((u) => u.includes('google_signup'))).toBe(false);
    expect(await page.evaluate((k) => sessionStorage.getItem(k), CONTEXTO)).toBeNull();
  });

  /**
   * ⚠️ Esto NO vigila la guarda propia del front (el alta exige la fase 1 en
   * `socialAuth.ts`): el mock, como el dueño, ya publica `enabled:false` sin la
   * fase 1, así que el front nunca ve la combinación. Esa guarda la caza el
   * unitario de `googleAltaRedirect.test.ts` (mutante M01). Esto fija la
   * conducta de punta a punta con el seam de alta cargado.
   */
  test('con la fase 1 apagada, aunque el seam del alta esté cargado, sigue el popup', async ({ page }) => {
    await preparar(page, { altaRedirect: true });
    await irACreaTuCuenta(page, 'popup');
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
  });
});

test.describe('AF-GOOGLE-ALTA-REDIRECT · encendido: «Crea tu cuenta» en la misma pestaña', () => {
  test('201 de punta a punta: state de alta, casillas a sessionStorage, vuelta limpia, cuenta creada', async ({ page }) => {
    await preparar(page, { redirect: true, altaRedirect: true, legal: true });
    await registrarUrls(page);
    await irACreaTuCuenta(page, 'redirect');

    // El botón de alta: redirect, el MISMO login_uri y state `alta:<id>`.
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(google(page)).toHaveAttribute('data-login-uri', LOGIN_URI);
    await expect(google(page)).toHaveAttribute('data-state', /^alta:[0-9a-f-]{36}$/);

    // Nada avanza sin las casillas, y sin ellas no hay contexto guardado.
    expect(await page.evaluate((k) => sessionStorage.getItem(k), CONTEXTO)).toBeNull();
    await marcarCasillas(page);
    await capturar(page, 'd102-01-crea-tu-cuenta');
    const ctx = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k) ?? 'null'), CONTEXTO);
    expect(ctx).toEqual({
      accepted_notice_version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      legal_acceptance: expect.objectContaining({ adult_declaration: true }),
    });

    await google(page).click();
    // El aviso dura 2,4 s y sale antes que Inicio: se mira primero.
    await expect(page.getByText('¡Listo! Creamos tu cuenta de PayMe.')).toBeVisible();
    await expect(adentro(page)).toBeVisible();
    await capturar(page, 'd102-02-cuenta-creada');

    // La vuelta llegó con el fragmento (el documento nuevo es la ÚLTIMA vez que
    // aparece) y salió con replaceState: lo siguiente es la raíz limpia.
    const recorrido = await urls(page);
    const vuelta = recorrido.map((u) => u.includes('#google_signup=')).lastIndexOf(true);
    expect(vuelta).toBeGreaterThan(-1);
    expect(recorrido[vuelta + 1]).toMatch(/\/$/);
    await codigoEnNingunLado(page);
    // El contexto se borró tras el canje terminal, y la fila del dueño se consumió.
    expect(await page.evaluate((k) => sessionStorage.getItem(k), CONTEXTO)).toBeNull();
    expect(await pendientes(page)).toBe(0);
    expect(await usuarioDeSesion(page)).toMatchObject({ first_name: expect.any(String) });
  });

  test('422 profile_required: pide el nombre y reintenta con el MISMO código, sin volver a Google → 201', async ({ page }) => {
    await preparar(page, { redirect: true, altaRedirect: true, sinNombre: true });
    await registrarUrls(page);
    await irACreaTuCuenta(page, 'redirect');
    await google(page).click();

    await expect(page.getByText('Google no nos dio tu nombre. Escríbelo y toca «Crear mi cuenta».')).toBeVisible();
    await expect(google(page)).toHaveCount(0);
    // Una sola alta pendiente en el dueño: la del código que sigue vivo.
    expect(await pendientes(page)).toBe(1);
    await capturar(page, 'd102-03-perfil');
    await page.getByPlaceholder('Nombre').fill('Ana');
    await page.getByPlaceholder('Apellido').fill('Paz');
    await crearMiCuenta(page).click();

    await expect(adentro(page)).toBeVisible();
    expect(await usuarioDeSesion(page)).toMatchObject({ first_name: 'Ana', last_name: 'Paz' });
    expect(await pendientes(page)).toBe(0);
    // Sin otra ida a Google: un solo código en todo el recorrido (la misma
    // vuelta aparece dos veces: el 303 simulado y el documento nuevo).
    const codigos = new Set((await urls(page)).flatMap((u) => /#google_signup=([^&]+)/.exec(u)?.[1] ?? []));
    expect(codigos.size).toBe(1);
    await codigoEnNingunLado(page);
  });

  test('409 link_required: el paso de la contraseña de siempre, y conecta', async ({ page }) => {
    await preparar(page, { redirect: true, altaRedirect: true, correoConCuenta: true });
    await irACreaTuCuenta(page, 'redirect');
    await google(page).click();

    await expect(page.getByText('Conecta tu cuenta con Google', { exact: true })).toBeVisible();
    await capturar(page, 'd102-04-vincular');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo'.repeat(3));
    await page.getByRole('button', { name: /Conectar/ }).click();
    await expect(adentro(page)).toBeVisible();
    expect(await pendientes(page)).toBe(0);
  });
});

test.describe('AF-GOOGLE-ALTA-REDIRECT · sessionStorage perdido y código vencido', () => {
  /** En el documento de la vuelta, el contexto no está: como si se hubiera perdido. */
  async function perderContextoAlVolver(page: Page): Promise<void> {
    await page.addInitScript((k) => {
      if (location.hash.startsWith('#google_signup=')) sessionStorage.removeItem(k);
    }, CONTEXTO);
  }

  test('sin el contexto, vuelven las casillas y se canjea con el MISMO código mientras no venza → 201', async ({ page }) => {
    await preparar(page, { redirect: true, altaRedirect: true, legal: true });
    await perderContextoAlVolver(page);
    await irACreaTuCuenta(page, 'redirect');
    await marcarCasillas(page);
    await google(page).click();

    await expect(page.getByText('Para terminar de crear tu cuenta, confirma lo siguiente y toca «Crear mi cuenta».')).toBeVisible();
    await expect(crearMiCuenta(page)).toBeDisabled();
    expect(await pendientes(page)).toBe(1);
    await expect(page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' })).toBeVisible();
    await capturar(page, 'd102-05-contexto-perdido');
    await marcarCasillas(page);
    await crearMiCuenta(page).click();
    // El aviso dura 2,4 s y sale antes que Inicio: se mira primero.
    await expect(page.getByText('¡Listo! Creamos tu cuenta de PayMe.')).toBeVisible();
    await expect(adentro(page)).toBeVisible();
    expect(await pendientes(page)).toBe(0);
  });

  test('código vencido → 401: lo dice sin afirmar nada de la cuenta, y suelta el código', async ({ page }) => {
    await preparar(page, { redirect: true, altaRedirect: true, legal: true });
    await perderContextoAlVolver(page);
    await irACreaTuCuenta(page, 'redirect');
    await marcarCasillas(page);
    await google(page).click();
    await expect(crearMiCuenta(page)).toBeVisible();

    // Pasaron los 10 minutos: la fila del dueño venció.
    await page.evaluate((k) => {
      const filas = JSON.parse(localStorage.getItem(k) ?? '{}') as Record<string, { expira: number }>;
      for (const f of Object.values(filas)) f.expira = Date.now() - 1;
      localStorage.setItem(k, JSON.stringify(filas));
    }, PENDIENTES);
    await marcarCasillas(page);
    await crearMiCuenta(page).click();

    await expect(page.getByRole('alert')).toHaveText('No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.');
    await expect(crearMiCuenta(page)).toHaveCount(0);
    // Terminal: el código se soltó de la memoria, no sólo de la pantalla.
    expect(await page.evaluate(async () => {
      const ruta = '/src/api/googleAltaRedirect.ts';
      const m = await import(/* @vite-ignore */ ruta) as { hayCodigoAlta: () => boolean };
      return m.hayCodigoAlta();
    })).toBe(false);
    await expect(adentro(page)).toHaveCount(0);
    expect(await usuarioDeSesion(page)).toBeNull();
    await codigoEnNingunLado(page);
    await capturar(page, 'd102-06-vencido');
  });
});

test('409 legal_version_mismatch: el código sigue vivo, se releen los textos y se reintenta → 201', async ({ page }) => {
  await preparar(page, { redirect: true, altaRedirect: true, legal: true });
  // Entre la ida y la vuelta cambió el texto legal: el par guardado ya no es el vigente.
  await page.addInitScript((k) => {
    if (!location.hash.startsWith('#google_signup=')) return;
    const ctx = JSON.parse(sessionStorage.getItem(k) ?? 'null') as { legal_acceptance?: { aviso_hash: string } } | null;
    if (ctx?.legal_acceptance) {
      ctx.legal_acceptance.aviso_hash = 'f'.repeat(64);
      sessionStorage.setItem(k, JSON.stringify(ctx));
    }
  }, CONTEXTO);
  await irACreaTuCuenta(page, 'redirect');
  await marcarCasillas(page);
  await google(page).click();

  await expect(page.getByRole('alert')).toHaveText('Actualizamos los documentos. Vuelve a marcar las casillas y toca «Crear mi cuenta».');
  await expect(crearMiCuenta(page)).toBeDisabled();
  expect(await pendientes(page)).toBe(1);
  await expect(page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' })).toBeVisible();
  await capturar(page, 'd102-07-legal-cambio');
  await marcarCasillas(page);
  await crearMiCuenta(page).click();
  await expect(page.getByText('¡Listo! Creamos tu cuenta de PayMe.')).toBeVisible();
  await expect(adentro(page)).toBeVisible();
  expect(await pendientes(page)).toBe(0);
});

/**
 * Mientras el aviso no cargó, el alta en un toque todavía no existe. Hoy, sin el
 * alta en redirect, en esa ventana el botón es la «captura» en POPUP; encendida,
 * ese popup es justo el que falla en iPhone, así que no se muestra hasta que el
 * botón pueda ir en redirect (wire D102 §1).
 */
test.describe('AF-GOOGLE-ALTA-REDIRECT · el toque antes de que cargue el aviso', () => {
  test('encendido: no hay botón en popup mientras carga el aviso; después aparece en redirect', async ({ page }) => {
    await preparar(page, { redirect: true, altaRedirect: true, latenciaAviso: 6000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
    await expect(page.locator('.ingreso-alta-google')).toBeVisible();
    await expect(google(page)).toHaveCount(0);
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect', { timeout: 15_000 });
  });

  test('apagado (control): en esa ventana está la «captura» en popup de siempre', async ({ page }) => {
    await preparar(page, { redirect: true, latenciaAviso: 6000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
    await expect(google(page)).toBeVisible();
    await expect(google(page)).not.toHaveAttribute('data-ux-mode', /.*/);
  });
});

/**
 * Decisión 103: el @usuario está encendido en producción. Una cuenta que nace
 * con el alta en redirect no tiene @ todavía: después del 201 la app pide
 * elegirlo (la pantalla del @), y recién después entra.
 */
test('como está servido hoy (@ encendido): 201 → «Elige tu @usuario» → adentro', async ({ page }) => {
  await preparar(page, { redirect: true, altaRedirect: true, legal: true, username: true });
  await irACreaTuCuenta(page, 'redirect');
  await marcarCasillas(page);
  await google(page).click();

  await expect(page.getByRole('heading', { name: 'Elige tu @usuario' })).toBeVisible();
  await expect(adentro(page)).toHaveCount(0);
  await capturar(page, 'd102-08-elige-tu-arroba');
  await page.getByLabel('Tu @usuario', { exact: true }).fill('ana.nueva');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(adentro(page)).toBeVisible();
  expect(await pendientes(page)).toBe(0);
  await codigoEnNingunLado(page);
});

test('«Entrar» (fase 1) sin cambios: su botón no lleva el state de alta', async ({ page }) => {
  await preparar(page, { redirect: true, altaRedirect: true });
  await page.goto('/');
  await expect(page.getByText('Log in', { exact: true })).toBeVisible();
  await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
  await expect(google(page)).not.toHaveAttribute('data-state', /.*/);
});
