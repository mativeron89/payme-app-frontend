import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, type MesaAbierta } from './_app';

/**
 * AF-INVITACION-TRAS-GOOGLE · defecto que Mati reportó en producción el 29/09:
 * «Invité a una mesa a alguien que NO tenía cuenta. Hizo el proceso de alta de
 * cuenta con GMAIL y cuando ingresó a su usuario, no estaba la cuenta a la cuál
 * lo había invitado.»
 *
 * La causa: la vuelta de Google en la misma pestaña es un documento NUEVO en la
 * raíz (`/#google_signup=` o `/#google_redirect=`), y el front la limpia a `/`.
 * El token sigue custodiado, pero su lector depende de que la ruta sea la de la
 * mesa: JoinMesaScreen no se monta y nadie hace accept-link.
 *
 * El arreglo: al elegir «Crear cuenta gratis» o «Ya tengo cuenta», una marca
 * `{code, savedAt}` en sessionStorage (sin token). Al entrar, si la marca vale
 * (30 min, un uso) y la invitación custodiada es de esa misma mesa, la ruta
 * vuelve a la mesa en vez de ir a Inicio.
 *
 * El riel mock repite el 303 de Google con una recarga real (documento nuevo),
 * como en `google-alta-redirect.spec.ts`.
 */

const SESION_MOCK = 'payme_app_session__mock';
const CUSTODIA = 'payme_pending_invitation_link';
const MARCA = 'payme.app.retorno_mesa.v1';

interface Seams {
  altaRedirect?: boolean;
  sinCuenta?: boolean;
  legal?: boolean;
}

/** Las costuras del mock para Google en la misma pestaña, escritas una vez. */
async function costuras(page: Page, s: Seams): Promise<void> {
  await page.evaluate((op: Seams) => {
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_redirect.v1', 'true');
    if (op.altaRedirect) localStorage.setItem('payme.app.mock.google_redirect_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', op.sinCuenta ? 'true' : 'false');
    if (op.legal) localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
  }, s);
}

/** Quien organiza abre una mesa; después, sin sesión, la persona invitada abre el link en frío. */
async function invitadoAbreElLink(page: Page, s: Seams): Promise<MesaAbierta> {
  await ingresar(page);
  const mesa = await abrirMesaConLink(page);
  await costuras(page, s);
  await page.evaluate((k) => localStorage.removeItem(k), SESION_MOCK);
  await page.goto('about:blank');
  await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
  await expect(page.getByText('Te invitaron a una mesa')).toBeVisible();
  return mesa;
}

const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });

async function marcarCasillas(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
  await page.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
}

const almacenado = (page: Page) => page.evaluate(([c, m]) => ({
  custodia: sessionStorage.getItem(c),
  marca: sessionStorage.getItem(m),
}), [CUSTODIA, MARCA] as const);

const enInicio = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/:\d+\/(home)?$/);
};

async function sumadoALaMesa(page: Page, mesa: MesaAbierta): Promise<void> {
  await expect(page.getByText('¡Te sumaste a la mesa!', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
  expect(page.url()).not.toContain(mesa.token);
  expect(await almacenado(page)).toEqual({ custodia: null, marca: null });
}

test.describe('AF-INVITACION-TRAS-GOOGLE · con Google en la misma pestaña, el invitado cae en la mesa', () => {
  test('🔴 (a) link → «Crear cuenta gratis» → casillas → Google → «¡Te sumaste a la mesa!»', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, { altaRedirect: true, sinCuenta: true, legal: true });
    await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await marcarCasillas(page);
    await google(page).click();
    await sumadoALaMesa(page, mesa);
  });

  test('🔴 (b) link → «Ya tengo cuenta · Entrar» → Google → puerta legal → «¡Te sumaste a la mesa!»', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, { legal: true });
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await google(page).click();
    // Las puertas siguen antes: primero la legal, después la mesa.
    const puerta = page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' });
    await expect(puerta).toBeVisible();
    await puerta.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
    await puerta.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
    await puerta.getByRole('button', { name: 'Continuar', exact: true }).click();
    await sumadoALaMesa(page, mesa);
  });

  test('🔴 (e) la mesa cerró mientras volvía de Google: «Esta mesa ya cerró»', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, { altaRedirect: true, sinCuenta: true, legal: true });
    await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await marcarCasillas(page);
    // La mesa muere antes de volver, en la memoria del mock y en su storage.
    await page.evaluate(async (code) => {
      const storePath = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; status: string }> };
        persist: () => void;
      };
      state.mesas.find((m) => m.code === code)!.status = 'settled';
      persist();
    }, mesa.code);
    await google(page).click();
    await expect(page.getByText('Esta mesa ya cerró')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
    expect(await almacenado(page)).toEqual({ custodia: null, marca: null });
  });
});

test.describe('AF-INVITACION-TRAS-GOOGLE · negativos: sin la marca de esa mesa, Inicio', () => {
  test('(c) abrir el link SIN elegir, ir a «/» y entrar con Google desde el ingreso general: Inicio', async ({ page }) => {
    await invitadoAbreElLink(page, {});
    await page.goto('/');
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await google(page).click();
    await enInicio(page);
    await expect(page.getByText('¡Te sumaste a la mesa!', { exact: true })).toHaveCount(0);
  });

  test('(c) la marca es de OTRA mesa que la invitación custodiada: Inicio', async ({ page }) => {
    await ingresar(page);
    const mesaA = await abrirMesaConLink(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    const mesaB = await abrirMesaConLink(page);
    await costuras(page, {});
    await page.evaluate((k) => localStorage.removeItem(k), SESION_MOCK);
    await page.goto('about:blank');
    // En A elige «Ya tengo cuenta» (queda la marca de A)…
    await page.goto(`/#/mesa/${mesaA.code}?t=${mesaA.token}`);
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(google(page)).toBeVisible();
    // …pero después abre el link de B y no elige (la custodia pasa a B).
    await page.goto(`/#/mesa/${mesaB.code}?t=${mesaB.token}`);
    await expect(page.getByText('Te invitaron a una mesa')).toBeVisible();
    await expect.poll(async () => JSON.parse((await almacenado(page)).custodia ?? '{}').code).toBe(mesaB.code);
    expect(JSON.parse((await almacenado(page)).marca ?? 'null')?.code, 'la marca de A sigue ahí').toBe(mesaA.code);
    await page.goto('/');
    await google(page).click();
    await enInicio(page);
  });

  test('(d) la marca venció (más de 30 minutos): Inicio', async ({ page }) => {
    await invitadoAbreElLink(page, {});
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    // Testigo: la marca existe; se la envejece 31 minutos.
    const envejecida = await page.evaluate((m) => {
      const marca = JSON.parse(sessionStorage.getItem(m) ?? 'null') as { code: string; savedAt: number } | null;
      if (!marca) return false;
      sessionStorage.setItem(m, JSON.stringify({ ...marca, savedAt: marca.savedAt - 31 * 60 * 1000 }));
      return true;
    }, MARCA);
    expect(envejecida, 'la marca se escribió al elegir «Ya tengo cuenta»').toBe(true);
    await google(page).click();
    await enInicio(page);
    await expect(page.getByText('¡Te sumaste a la mesa!', { exact: true })).toHaveCount(0);
  });
});

/**
 * Dónde se BORRA la marca, además del uso único al entrar: al cerrar la
 * custodia (canje hecho), en un rechazo terminal y al cerrar sesión. Por
 * correo no hay recarga y la ruta sigue siendo la de la mesa, así que la marca
 * NO se consume al entrar: estos casos la ven llegar hasta el borrado.
 */
test.describe('AF-INVITACION-TRAS-GOOGLE · la marca se borra', () => {
  async function entrarConCorreo(page: Page): Promise<void> {
    await page.getByLabel('Email', { exact: true }).fill('invitada@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  }
  const marca = async (page: Page) => (await almacenado(page)).marca;

  test('(f) el canje cerró (por correo): la custodia se cierra y la marca también', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, {});
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    expect(JSON.parse((await marca(page)) ?? 'null')?.code, 'testigo: la marca se escribió').toBe(mesa.code);
    await entrarConCorreo(page);
    await sumadoALaMesa(page, mesa);
  });

  test('(g) rechazo terminal (la mesa ya cerró, por correo): la marca se borra', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await page.evaluate(([code, sesion]) => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      st.mesas.find((m: { code: string }) => m.code === code).status = 'settled';
      localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
      localStorage.removeItem(sesion);
    }, [mesa.code, SESION_MOCK] as const);
    await page.reload();
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    expect(JSON.parse((await marca(page)) ?? 'null')?.code, 'testigo: la marca se escribió').toBe(mesa.code);
    await entrarConCorreo(page);
    await expect(page.getByText('Esta mesa ya cerró')).toBeVisible();
    expect(await almacenado(page)).toEqual({ custodia: null, marca: null });
  });

  test('(h) al cerrar sesión la marca se borra', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, {});
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    // Entra por el QR de un restaurante (un enlace de entrada que se respeta):
    // la marca no se consume y queda durante la sesión.
    await page.goto('/scan?r=rest-qr-1');
    await entrarConCorreo(page);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
    expect(JSON.parse((await marca(page)) ?? 'null')?.code, 'testigo: la marca sigue durante la sesión').toBe(mesa.code);
    await page.goto('/mas');
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    expect(await marca(page)).toBeNull();
  });
});
