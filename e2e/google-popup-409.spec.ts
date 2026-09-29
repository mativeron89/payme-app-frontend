import { expect, test, type Page } from '@playwright/test';

/**
 * AF-POPUP-GOOGLE-409 · decisión 120 · la misma clase que AF-01: el gesto de
 * aceptar queda atado al par legal que se veía.
 *
 * En `LoginScreen` hay seis envíos de `legal_acceptance`. El correo y el canje
 * redirect ya trataban el `409 legal_version_mismatch`. Los tres del alta con
 * Google en VENTANA EMERGENTE no: mostraban el cartel genérico, no releían los
 * textos y el reintento mandaba otra vez el par viejo, así que el alta quedaba
 * trabada. Los tres están dormidos en producción, donde el alta es en la misma
 * pestaña, y esto no los enciende.
 *
 *  1. «Crear mi cuenta» con la credencial retenida (`onCrearConGoogle`);
 *  2. el botón de Google del paso sin credencial (`purpose: 'register'`), que es
 *     por donde sigue el 1 después del 409, porque la credencial es de un uso;
 *  3. el alta en un toque (`continuarConGoogle`).
 *
 * Ahora el 409 relee los textos. Con el par nuevo, las casillas aparecen
 * desmarcadas (`casillaVigente`, AF-01) y el aviso nombra el botón que queda en
 * pantalla: «Continuar con Google». Un 503 con el mismo par las deja como
 * estaban.
 *
 * La fachada `api` se instrumenta desde la página, como en
 * `legal-cambio-de-par.spec.ts`: el primer envío falla y los siguientes van al
 * mock real, que en estos dos endpoints no valida el par.
 */

const HASH_B = 'b'.repeat(64);
const MAYOR = 'Declaro que tengo 18 años o más.';
const TERMINOS = /He leído y acepto los/;
const AVISO_409 = 'Actualizamos los documentos. Vuelve a marcar las casillas y toca «Continuar con Google».';

type Metodo = 'googleRegister' | 'googleContinue';
type Fallo = 'mismatch' | '503';

interface Espia {
  llamadas: Record<string, unknown>[];
  releyo: boolean;
}

async function preparar(page: Page, { continueOn }: { continueOn: boolean }): Promise<void> {
  await page.addInitScript((on) => {
    if (sessionStorage.getItem('e2e.popup409.preparado') === '1') return;
    sessionStorage.setItem('e2e.popup409.preparado', '1');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
    localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
    localStorage.setItem('payme.app.mock.google_continue.v1', on ? 'true' : 'false');
  }, continueOn);
}

/** El primer envío de `metodo` falla con `fallo`; con `mismatch`, la relectura trae términos 1.0.1. */
async function instrumentar(page: Page, metodo: Metodo, fallo: Fallo): Promise<void> {
  await page.evaluate(async ({ m, f, hashB }) => {
    const apiRuta = '/src/api/index.ts';
    const httpRuta = '/src/api/http.ts';
    const { api } = await import(/* @vite-ignore */ apiRuta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const { HttpError } = await import(/* @vite-ignore */ httpRuta) as {
      HttpError: new (status: number, body: { error: string } | null) => Error;
    };
    const w = window as unknown as { __e2ePopup: Espia };
    w.__e2ePopup = { llamadas: [], releyo: false };
    const e = w.__e2ePopup;

    const getText = api.getLegalText.bind(api);
    api.getLegalText = async (...args: unknown[]) => {
      const r = await getText(...args) as { legal_text: Record<string, unknown> };
      if (f !== 'mismatch' || args[0] !== 'terminos_uso' || e.llamadas.length === 0) return r;
      e.releyo = true;
      return { legal_text: { ...r.legal_text, version: '1.0.1', hash: hashB, body: 'Términos sintéticos v2.' } };
    };

    const original = api[m].bind(api);
    api[m] = async (...args: unknown[]) => {
      e.llamadas.push(args[0] as Record<string, unknown>);
      if (e.llamadas.length === 1) {
        throw new HttpError(f === 'mismatch' ? 409 : 503, { error: f === 'mismatch' ? 'legal_version_mismatch' : 'rate_limit_unavailable' });
      }
      return original(...args);
    };
  }, { m: metodo, f: fallo, hashB: HASH_B });
}

const espia = (page: Page) => page.evaluate(() => (window as unknown as { __e2ePopup: Espia }).__e2ePopup);
const terminosDe = (cuerpo: Record<string, unknown>) => {
  const par = cuerpo.legal_acceptance as Record<string, unknown> | undefined;
  return { version: par?.terminos_version, hash: par?.terminos_hash };
};
const mayor = (page: Page) => page.getByRole('checkbox', { name: MAYOR });
const terminos = (page: Page) => page.getByRole('checkbox', { name: TERMINOS });
const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const crearMiCuenta = (page: Page) => page.getByRole('button', { name: 'Crear mi cuenta', exact: true });
/**
 * «Entra» = la cuenta quedó creada y con sesión. Después el mock muestra la
 * puerta legal, porque su alta social no registra la aceptación (el dueño sí):
 * por eso no se espera Inicio.
 */
async function entro(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('payme_app_session__mock');
    return raw ? Boolean((JSON.parse(raw) as { user?: unknown }).user) : false;
  }), 'se creó la cuenta y hay sesión (antes del alta no había ninguna)').toBe(true);
}
const googleInerte = (page: Page) => page.locator('.social-google-gated');

async function marcar(page: Page): Promise<void> {
  await mayor(page).check();
  await terminos(page).check();
}

/** Tras un 409 con par nuevo: relectura hecha, casillas desmarcadas, Google inerte y el aviso. */
async function pideMarcarDeNuevo(page: Page): Promise<void> {
  await expect.poll(async () => (await espia(page)).releyo, 'el 409 relee los textos').toBe(true);
  await expect(mayor(page)).toBeVisible();
  await expect(mayor(page)).not.toBeChecked();
  await expect(terminos(page)).not.toBeChecked();
  await expect(googleInerte(page)).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveText(AVISO_409);
}

/** El alta en popup 0.167.0: «Crea tu cuenta» → Google retiene la credencial → paso con «Crear mi cuenta». */
async function pasoConCredencial(page: Page): Promise<void> {
  await preparar(page, { continueOn: false });
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await google(page).click();
  await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toBeVisible();
  await expect(crearMiCuenta(page)).toBeVisible();
  await expect(mayor(page)).toBeVisible();
}

test.describe('AF-POPUP-GOOGLE-409 · 1 y 2 · «Crear mi cuenta» y el reintento con Google', () => {
  test('🔴 un 409 con par nuevo relee, desmarca y avisa; el reintento con Google sobre el par nuevo entra', async ({ page }) => {
    await pasoConCredencial(page);
    await instrumentar(page, 'googleRegister', 'mismatch');
    await marcar(page);
    await crearMiCuenta(page).click();
    await pideMarcarDeNuevo(page);
    // La credencial era de un uso: lo que queda en pantalla es Google.
    await expect(crearMiCuenta(page)).toHaveCount(0);

    await marcar(page);
    await expect(googleInerte(page)).toHaveCount(0);
    await google(page).click();
    await entro(page);
    const { llamadas } = await espia(page);
    expect(llamadas).toHaveLength(2);
    expect(terminosDe(llamadas[0]!).version).toBe('1.0.0');
    expect(terminosDe(llamadas[1]!)).toEqual({ version: '1.0.1', hash: HASH_B });
  });

  test('🔴 camino 2 solo: un 409 en el botón de Google del paso también relee, desmarca y avisa', async ({ page }) => {
    await pasoConCredencial(page);
    // Primero un 503 en «Crear mi cuenta»: la credencial se suelta y queda
    // Google (purpose `register`) con el MISMO par y las casillas marcadas.
    await instrumentar(page, 'googleRegister', '503');
    await marcar(page);
    await crearMiCuenta(page).click();
    await expect(page.getByRole('alert')).toHaveText('No pudimos completar el ingreso. Prueba de nuevo.');
    await expect(mayor(page)).toBeChecked();
    await expect(google(page)).toBeVisible();
    // Ahora el 409 llega por el camino 2.
    await instrumentar(page, 'googleRegister', 'mismatch');
    await google(page).click();
    await pideMarcarDeNuevo(page);
    await marcar(page);
    await google(page).click();
    await entro(page);
    const { llamadas } = await espia(page);
    expect(terminosDe(llamadas[1]!)).toEqual({ version: '1.0.1', hash: HASH_B });
  });

  test('control · 503 con el MISMO par en «Crear mi cuenta»: las casillas quedan marcadas y el reintento entra', async ({ page }) => {
    await pasoConCredencial(page);
    await instrumentar(page, 'googleRegister', '503');
    await marcar(page);
    await crearMiCuenta(page).click();
    await expect(page.getByRole('alert')).toHaveText('No pudimos completar el ingreso. Prueba de nuevo.');
    await expect(mayor(page)).toBeChecked();
    await expect(terminos(page)).toBeChecked();
    await expect(googleInerte(page)).toHaveCount(0);
    await google(page).click();
    await entro(page);
    const { llamadas, releyo } = await espia(page);
    expect(releyo).toBe(false);
    expect(terminosDe(llamadas[1]!)).toEqual(terminosDe(llamadas[0]!));
  });
});

test.describe('AF-POPUP-GOOGLE-409 · 3 · el alta en un toque', () => {
  async function unToque(page: Page): Promise<void> {
    await preparar(page, { continueOn: true });
    await page.goto('/');
    await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
    await expect(mayor(page)).toBeVisible();
  }

  test('🔴 un 409 con par nuevo relee, desmarca y avisa; el segundo toque sobre el par nuevo entra', async ({ page }) => {
    await unToque(page);
    await instrumentar(page, 'googleContinue', 'mismatch');
    await marcar(page);
    await google(page).click();
    await pideMarcarDeNuevo(page);
    await marcar(page);
    await google(page).click();
    await entro(page);
    const { llamadas } = await espia(page);
    expect(llamadas).toHaveLength(2);
    expect(terminosDe(llamadas[0]!).version).toBe('1.0.0');
    expect(terminosDe(llamadas[1]!)).toEqual({ version: '1.0.1', hash: HASH_B });
  });

  test('control · 503 con el MISMO par: las casillas quedan marcadas y el segundo toque entra', async ({ page }) => {
    await unToque(page);
    await instrumentar(page, 'googleContinue', '503');
    await marcar(page);
    await google(page).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toHaveText(AVISO_409);
    await expect(mayor(page)).toBeChecked();
    await expect(terminos(page)).toBeChecked();
    await expect(googleInerte(page)).toHaveCount(0);
    await google(page).click();
    await entro(page);
    const { llamadas, releyo } = await espia(page);
    expect(releyo).toBe(false);
    expect(terminosDe(llamadas[1]!)).toEqual(terminosDe(llamadas[0]!));
  });
});
