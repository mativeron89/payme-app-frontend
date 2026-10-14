import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D268 · la auditoría de seguridad del 2026-10-10, lado de la app (App Backend
 * 2.178.0).
 *
 * - S-02: la vuelta de Google por redirect se canjea SÓLO si esta pestaña
 *   empezó ese ingreso. Con `features.google_redirect_binding` el botón manda
 *   `entrar:<challenge>` / `crear:<challenge>` y el verifier queda en
 *   `sessionStorage`; sin la capacidad, el registro «sin binding». Sin
 *   registro, el código no se canjea. Con la sesión abierta, se descarta.
 * - S-05: con la invitación a la mesa pendiente, tomar un plato responde
 *   `403 invitation_not_accepted`: la mesa lo dice y ofrece ir a Avisos.
 *
 * El testigo de S-02 es el mismo código en dos vueltas: la que no debe entrar
 * (sin el registro, o con otro verifier) y la de control, con el registro
 * restituido, que entra. Así el «no entró» no puede venir de un código muerto.
 */

test.use({ viewport: { width: 375, height: 812 } });

const ENTRAR = 'payme.app.google_inicio_entrar.v1';
const CREAR = 'payme.app.google_inicio_crear.v1';
const SESION = 'payme_app_session__mock';

interface Seams {
  /** `false` = el dueño no publica `google_redirect_binding` (anterior a 2.178.0). */
  binding?: boolean;
  sinCuenta?: boolean;
}

async function preparar(page: Page, s: Seams = {}): Promise<void> {
  await page.addInitScript((op: Seams) => {
    if (sessionStorage.getItem('e2e.d268.preparado') === '1') return;
    sessionStorage.setItem('e2e.d268.preparado', '1');
    localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
    localStorage.setItem('payme.app.mock.google_redirect_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', op.sinCuenta ? 'true' : 'false');
    if (op.binding === false) localStorage.setItem('payme.app.mock.google_redirect_binding.v1', 'apagado');
  }, s);
  /**
   * La costura de la prueba: con `e2e.d268.vuelta` puesto, el próximo documento
   * que llega con la vuelta de Google (`#google_redirect=`/`#google_signup=`)
   * pierde el registro de inicio ANTES de que arranque la app —como si la vuelta
   * se abriera en otra pestaña— o lo cambia por otro verifier. El registro
   * original y el fragmento quedan guardados para la vuelta de control.
   */
  await page.addInitScript(([entrar, crear]: readonly [string, string]) => {
    const modo = sessionStorage.getItem('e2e.d268.vuelta');
    if (!modo || !/^#google_(redirect|signup)=/.test(location.hash)) return;
    sessionStorage.removeItem('e2e.d268.vuelta');
    sessionStorage.setItem('e2e.d268.fragmento', location.hash);
    for (const clave of [entrar, crear]) {
      const valor = sessionStorage.getItem(clave);
      if (valor === null) continue;
      sessionStorage.setItem(`e2e.d268.guardado.${clave}`, valor);
      if (modo === 'otro-verifier') {
        sessionStorage.setItem(clave, JSON.stringify({ binding: true, verifier: 'o'.repeat(43) }));
      } else {
        sessionStorage.removeItem(clave);
      }
    }
  }, [ENTRAR, CREAR] as const);
}

const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const adentro = (page: Page) => page.getByRole('button', { name: 'Escanear', exact: true });
const ingreso = (page: Page) => page.getByText('Log in', { exact: true });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/d268-${nombre}.png`, fullPage: true });
}

const leer = (page: Page, clave: string) => page.evaluate((k) => sessionStorage.getItem(k), clave);
const sesion = (page: Page) => page.evaluate((k) => localStorage.getItem(k), SESION);

/** base64url(SHA-256(verifier)), en el navegador. */
const challengeDe = (page: Page, verifier: string) => page.evaluate(async (v) => {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  let b = '';
  for (const x of d) b += String.fromCharCode(x);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}, verifier);

/** La vuelta de control: el registro original restituido y el MISMO fragmento, en un documento nuevo. */
async function vueltaDeControl(page: Page): Promise<void> {
  const fragmento = await page.evaluate(([entrar, crear]) => {
    for (const clave of [entrar, crear]) {
      const guardado = sessionStorage.getItem(`e2e.d268.guardado.${clave}`);
      if (guardado !== null) sessionStorage.setItem(clave, guardado);
    }
    return sessionStorage.getItem('e2e.d268.fragmento');
  }, [ENTRAR, CREAR] as const);
  expect(fragmento).toMatch(/^#google_(redirect|signup)=[A-Za-z0-9_-]{20,200}$/);
  await page.goto('about:blank');
  await page.goto(`/${fragmento!}`);
}

test.describe('🔴 D268 · S-02 · «Entrar» con Google, atado a esta pestaña', () => {
  test('el botón manda `entrar:<challenge>` del verifier que guardó; al volver lo canjea y lo borra', async ({ page }) => {
    await preparar(page);
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect(google(page)).toHaveAttribute('data-state', /^entrar:[A-Za-z0-9_-]{43}$/);
    const state = await google(page).getAttribute('data-state');
    const registro = JSON.parse((await leer(page, ENTRAR)) ?? 'null') as { binding: boolean; verifier: string };
    expect(registro).toEqual({ binding: true, verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(`entrar:${await challengeDe(page, registro.verifier)}`).toBe(state);
    // El verifier no viaja: ni en el state ni en la URL.
    expect(state).not.toContain(registro.verifier);
    await capturar(page, '01-entrar');

    await google(page).click();
    await expect(adentro(page)).toBeVisible();
    expect(await leer(page, ENTRAR)).toBeNull();
    expect(page.url()).not.toContain(registro.verifier);
  });

  test('una vuelta que esta pestaña no empezó NO se canjea; el mismo código, con su registro, sí', async ({ page }) => {
    await preparar(page);
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-state', /^entrar:/);
    await page.evaluate(() => sessionStorage.setItem('e2e.d268.vuelta', 'sin-registro'));
    await google(page).click();

    await expect(page.getByRole('alert')).toHaveText(
      'No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.',
    );
    await expect(ingreso(page)).toBeVisible();
    await expect(adentro(page)).toHaveCount(0);
    expect(await sesion(page)).toBeNull();
    await capturar(page, '02-vuelta-ajena');

    await vueltaDeControl(page);
    await expect(adentro(page)).toBeVisible();
  });

  test('con OTRO verifier en esta pestaña: el dueño no lo canjea; con el suyo, sí', async ({ page }) => {
    await preparar(page);
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-state', /^entrar:/);
    await page.evaluate(() => sessionStorage.setItem('e2e.d268.vuelta', 'otro-verifier'));
    await google(page).click();

    await expect(page.getByRole('alert')).toHaveText(
      'No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.',
    );
    await expect(adentro(page)).toHaveCount(0);
    expect(await sesion(page)).toBeNull();

    await vueltaDeControl(page);
    await expect(adentro(page)).toBeVisible();
  });

  test('sin la capacidad del dueño: el registro «sin binding»; sin él, tampoco se canjea', async ({ page }) => {
    await preparar(page, { binding: false });
    await page.goto('/');
    await expect(ingreso(page)).toBeVisible();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(google(page)).not.toHaveAttribute('data-state', /.*/);
    expect(JSON.parse((await leer(page, ENTRAR)) ?? 'null')).toEqual({ binding: false });
    await page.evaluate(() => sessionStorage.setItem('e2e.d268.vuelta', 'sin-registro'));
    await google(page).click();

    // El código del dueño anterior está suelto: si la app lo canjeara, entraría.
    await expect(page.getByRole('alert')).toHaveText(
      'No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.',
    );
    await expect(adentro(page)).toHaveCount(0);

    await vueltaDeControl(page);
    await expect(adentro(page)).toBeVisible();
  });

  test('con la sesión abierta, la vuelta se descarta antes del primer cuadro: la sesión no cambia', async ({ page }) => {
    await preparar(page);
    // Un código vivo de esta pestaña, sin canjear: se toma con la costura y se
    // vuelve a la página sin él.
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-state', /^entrar:/);
    await page.evaluate(() => sessionStorage.setItem('e2e.d268.vuelta', 'sin-registro'));
    await google(page).click();
    await expect(page.getByRole('alert')).toBeVisible();

    // Entra con correo y contraseña.
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(adentro(page)).toBeVisible();
    const antes = await sesion(page);
    expect(antes).not.toBeNull();

    // Con la sesión abierta llega la vuelta, con su registro restituido: se descarta.
    await vueltaDeControl(page);
    await expect(adentro(page)).toBeVisible();
    expect(await sesion(page)).toBe(antes);
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await leer(page, ENTRAR)).toBeNull();
    await capturar(page, '03-sesion-abierta');

    // Control: el código seguía vivo. Sin sesión y con el registro, entra con Google.
    await page.evaluate((k) => localStorage.removeItem(k), SESION);
    await vueltaDeControl(page);
    await expect(adentro(page)).toBeVisible();
    expect(await sesion(page)).not.toBe(antes);
  });
});

test.describe('🔴 D268 · S-02 · «Crea tu cuenta» con Google, atado a esta pestaña', () => {
  async function irAlAlta(page: Page): Promise<void> {
    await preparar(page, { sinCuenta: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
    await expect(google(page)).toHaveAttribute('data-state', /^crear:[A-Za-z0-9_-]{43}$/);
    const registro = JSON.parse((await leer(page, CREAR)) ?? 'null') as { verifier: string };
    expect(`crear:${await challengeDe(page, registro.verifier)}`).toBe(await google(page).getAttribute('data-state'));
    for (const casilla of await page.getByRole('checkbox').all()) await casilla.check();
  }

  test('sin el verifier al volver, no se crea la cuenta y la pantalla lo dice', async ({ page }) => {
    await irAlAlta(page);
    await capturar(page, '04-crea-tu-cuenta');
    await page.evaluate(() => sessionStorage.setItem('e2e.d268.vuelta', 'sin-registro'));
    await google(page).click();

    await expect(page.getByRole('alert')).toHaveText('No pudimos completar el ingreso. Prueba de nuevo.');
    await expect(adentro(page)).toHaveCount(0);
    expect(await sesion(page)).toBeNull();
    // Se puede volver a empezar: el botón vuelve, con un par nuevo de esta pestaña.
    await expect(google(page)).toHaveAttribute('data-state', /^entrar:[A-Za-z0-9_-]{43}$/);
    await capturar(page, '05-alta-sin-verifier');
  });

  test('con su verifier, el alta en un toque sigue igual', async ({ page }) => {
    await irAlAlta(page);
    await google(page).click();
    await expect(page.getByText('¡Listo! Creamos tu cuenta de PayMe.', { exact: true })).toBeVisible();
    await expect(adentro(page)).toBeVisible();
    expect(await leer(page, CREAR)).toBeNull();
  });
});

test.describe('🔴 D268 · S-05 · la invitación a la mesa sigue pendiente', () => {
  /** Una mesa en consumo de la que esta cuenta NO es titular (la siembra como `barra-items-sin-pago`). */
  async function sembrarMesaAjena(page: Page, code: string): Promise<void> {
    await page.evaluate(async (c) => {
      const storePath = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<Record<string, unknown>> };
        persist: () => void;
      };
      const template = state.mesas[0] as { restaurant: unknown; active_staff: unknown };
      state.mesas = state.mesas.filter((m) => m.code !== c);
      state.mesas.unshift({
        id: `${c.replace(/\D/g, '').padStart(8, '0')}-0000-4000-8000-000000000000`,
        code: c,
        restaurant: structuredClone(template.restaurant),
        total_cents: 84000,
        paid_amount_cents: 0,
        tip_amount_cents: 0,
        division_mode: 'consumo',
        expected_participants: 2,
        status: 'open',
        expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
        items: [
          { id: '30000000-0000-4000-8000-000000000268', name: 'Consumo de 300', price_cents: 30000 },
          { id: '54000000-0000-4000-8000-000000000268', name: 'Consumo de 540', price_cents: 54000 },
        ].map((item) => ({
          ...item, category: 'other', quantity: 1, status: 'available', lockedBy: null, lock_expires_at: null, claims: [],
        })),
        slots: null,
        active_staff: structuredClone(template.active_staff),
        openedByUser: false,
        captured_shortfall_cents: 0,
        guarantee_method: 'none',
        guarantee_mode: false,
        closure_reason: null,
      });
      persist();
    }, code);
  }

  test('«Listo» con un plato: la mesa dice «Primero acepta la invitación» y lleva a Avisos', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await sembrarMesaAjena(page, 'PA-2680');
    await page.evaluate(() => localStorage.setItem('payme.app.mock.invitacion_pendiente.v1', 'PA-2680'));
    await page.goto('/#/mesa/PA-2680');

    // Ve la mesa (el dueño se la muestra para que decida), y no hay aviso todavía.
    await page.getByRole('button', { name: 'Consumo de 300', exact: true }).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'Primero acepta la invitación a esta mesa.' });
    await expect(aviso).toHaveCount(0);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();

    await expect(aviso).toBeVisible();
    // No volvió a Inicio como tras un «Listo» aceptado: sigue en la mesa.
    await expect(page).toHaveURL(/\/mesa\/PA-2680$/);
    await capturar(page, '06-invitacion-pendiente');
    await aviso.getByRole('button', { name: 'Ver avisos', exact: true }).click();
    await expect(page).toHaveURL(/\/avisos$/);
  });
});
