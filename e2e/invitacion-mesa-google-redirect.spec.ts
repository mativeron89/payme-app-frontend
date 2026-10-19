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
 *
 * D372 · P02 suma dos registros, con las mismas reglas: el modo que se eligió
 * en la invitación (P02-a: una recarga vuelve a B, no a A) y la marca de que la
 * persona salió a Google (P02-b: si vuelve sin terminar, un aviso junto al
 * botón). Los dos se borran con el retorno.
 */

const SESION_MOCK = 'payme_app_session__mock';
const CUSTODIA = 'payme_pending_invitation_link';
const MARCA = 'payme.app.retorno_mesa.v1';
const MODO = 'payme.app.retorno_mesa_modo.v1';
const SALIDA = 'payme.app.google_salida.v1';
const AVISO = 'Parece que Google no terminó. Toca «Continuar con Google» de nuevo.';
const AVISO_CASILLAS = 'Parece que Google no terminó. Marca las casillas y toca «Continuar con Google» de nuevo.';
const A1_TXT = 'Para ver la mesa y pagar tu parte, necesitas una cuenta de PayMe';

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

const almacenado = (page: Page) => page.evaluate(([c, m, mo, sa]) => ({
  custodia: sessionStorage.getItem(c),
  marca: sessionStorage.getItem(m),
  modo: sessionStorage.getItem(mo),
  salida: sessionStorage.getItem(sa),
}), [CUSTODIA, MARCA, MODO, SALIDA] as const);
const VACIO = { custodia: null, marca: null, modo: null, salida: null };

/** P02-b · una salida a Google de hace `edadMs`, con claves de más si se piden. */
const plantarSalida = (page: Page, extra: Record<string, unknown> = {}, edadMs = 0) =>
  page.evaluate(([k, e, edad]) => { sessionStorage.setItem(k, JSON.stringify({ savedAt: Date.now() - edad, ...e })); },
    [SALIDA, extra, edadMs] as const);

/**
 * P02-b · si el aviso llegó a estar en la página, desde que carga: un `toHaveCount(0)` espera, y no ve un aviso que
 * apareció y se fue.
 */
async function espiarAviso(page: Page): Promise<void> {
  await page.addInitScript((aviso) => {
    const w = window as unknown as { __avisoVisto: boolean };
    w.__avisoVisto = false;
    new MutationObserver(() => {
      if (document.body?.textContent?.includes(aviso)) w.__avisoVisto = true;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, AVISO);
}
const avisoVisto = (page: Page) => page.evaluate(() => (window as unknown as { __avisoVisto?: boolean }).__avisoVisto ?? false);
const avisoEnLaRanura = (page: Page) => page.locator('.social-provider-slot').getByRole('status').filter({ hasText: AVISO });

const enInicio = async (page: Page) => {
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/:\d+\/(home)?$/);
};

async function sumadoALaMesa(page: Page, mesa: MesaAbierta): Promise<void> {
  await expect(page.getByText('¡Te sumaste a la mesa!', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
  expect(page.url()).not.toContain(mesa.token);
  expect(await almacenado(page)).toEqual(VACIO);
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
    expect(await almacenado(page)).toEqual(VACIO);
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
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
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
    // P02-a · el modo recordado es de A: en B se ve A (los botones), no el formulario. B también se titula «Te
    // invitaron a una mesa», así que el título solo no distingue.
    await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true })).toBeVisible();
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
    expect(await almacenado(page)).toEqual(VACIO);
  });

  test('(h) al cerrar sesión la marca, el modo y la salida a Google se borran, sin aviso', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, {});
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    // Entra por el QR de un restaurante (un enlace de entrada que se respeta):
    // la marca no se consume y queda durante la sesión.
    await page.goto('/scan?r=rest-qr-1');
    await entrarConCorreo(page);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
    expect(JSON.parse((await marca(page)) ?? 'null')?.code, 'testigo: la marca sigue durante la sesión').toBe(mesa.code);
    // P02-b · una salida a Google que quedó de antes: el cierre de sesión la borra ANTES de que el ingreso la vea
    // (el ingreso espera a tener el botón de Google).
    await plantarSalida(page);
    await espiarAviso(page);
    await page.goto('/mas');
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    // Control positivo: el botón de Google está (el ingreso ya revisó la salida).
    await expect(google(page)).toBeVisible();
    expect(await almacenado(page)).toMatchObject({ marca: null, modo: null, salida: null });
    expect(await avisoVisto(page), 'no hubo aviso después de cerrar sesión').toBe(false);
  });
});

test.describe('D372 · P02-a · la recarga vuelve al modo que se eligió en la invitación', () => {
  test('🔴 (i) alta: la recarga vuelve a «Crea tu cuenta», con Google en redirect y las casillas desmarcadas', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, { altaRedirect: true, sinCuenta: true, legal: true });
    await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
    const modo = JSON.parse((await almacenado(page)).modo ?? 'null') as { code: string; modo: string; savedAt: number } | null;
    expect(modo, 'testigo: el modo se anotó').toMatchObject({ code: mesa.code, modo: 'register' });
    expect(Object.keys(modo!).sort()).toEqual(['code', 'modo', 'savedAt']);
    await page.reload();
    await expect(page.locator('.ingreso-burbuja-titulo')).toHaveText('Crea tu cuenta');
    await expect(page.getByText('Crea tu cuenta o entra para sumarte y pagar tu parte.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crear cuenta gratis', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true })).toHaveCount(0);
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await expect(page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /He leído y acepto los/ })).not.toBeChecked();
  });

  test('🔴 (j) ingreso: la recarga vuelve a «Log in», con la tarjeta de la invitación arriba', async ({ page }) => {
    const mesa = await invitadoAbreElLink(page, {});
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(page.getByText('Log in', { exact: true })).toBeVisible();
    expect(JSON.parse((await almacenado(page)).modo ?? 'null')).toMatchObject({ code: mesa.code, modo: 'login' });
    await page.reload();
    await expect(page.getByText('Log in', { exact: true })).toBeVisible();
    await expect(page.getByText(A1_TXT, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true })).toHaveCount(0);
  });

  test('(l) un modo de más de 30 minutos no se usa: A, y el modo se borra', async ({ page }) => {
    await invitadoAbreElLink(page, {});
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    const envejecido = await page.evaluate((k) => {
      const m = JSON.parse(sessionStorage.getItem(k) ?? 'null') as { savedAt: number } | null;
      if (!m) return false;
      sessionStorage.setItem(k, JSON.stringify({ ...m, savedAt: m.savedAt - 31 * 60 * 1000 }));
      return true;
    }, MODO);
    expect(envejecido, 'testigo: el modo se anotó').toBe(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true })).toBeVisible();
    expect((await almacenado(page)).modo).toBeNull();
  });
});

test.describe('D372 · P02-b · «Parece que Google no terminó»', () => {
  /** El ingreso general en `/`, con Google en la misma pestaña. */
  async function ingresoConGoogle(page: Page): Promise<void> {
    await page.goto('/');
    await costuras(page, {});
    await page.reload();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
  }

  test('🔴 (m) el toque del botón que sale a Google anota la salida (sólo la hora) antes de irse', async ({ page }) => {
    await ingresoConGoogle(page);
    expect((await almacenado(page)).salida, 'control: no había salida').toBeNull();
    // La ida del mock es asíncrona: leída en el mismo turno que el clic, la marca ya está.
    const salida = await page.evaluate((k) => {
      document.querySelector<HTMLButtonElement>('.social-google-container button')!.click();
      return sessionStorage.getItem(k);
    }, SALIDA);
    const valor = JSON.parse(salida ?? 'null') as Record<string, unknown> | null;
    expect(valor && Object.keys(valor)).toEqual(['savedAt']);
    expect(typeof valor!.savedAt).toBe('number');
  });

  test('(m2) una vuelta de Google (con error) borra la salida sin avisar', async ({ page }) => {
    await page.goto('/');
    await costuras(page, {});
    await plantarSalida(page);
    await espiarAviso(page);
    await page.goto('about:blank');
    await page.goto('/#google_redirect_error=temporarily_unavailable');
    await expect(page.getByRole('alert')).toContainText('Prueba de nuevo más tarde.');
    await expect(google(page)).toBeVisible();
    expect((await almacenado(page)).salida).toBeNull();
    expect(await avisoVisto(page)).toBe(false);
  });

  test('🔴 (n) con la salida y sin vuelta, el ingreso avisa junto a Google, una sola vez', async ({ page }) => {
    await ingresoConGoogle(page);
    await plantarSalida(page);
    await page.reload();
    await expect(avisoEnLaRanura(page)).toHaveText(AVISO);
    expect((await almacenado(page)).salida, 'se consume al avisar').toBeNull();
    await espiarAviso(page);
    await page.reload();
    await expect(google(page)).toBeVisible();
    expect(await avisoVisto(page), 'la segunda carga no avisa').toBe(false);
  });

  for (const [caso, extra, edad] of [
    ['vencida', {}, 31 * 60 * 1000],
    ['con una clave de más', { code: 'PA-0001' }, 0],
  ] as const) {
    test(`(o) una salida ${caso} no avisa y se borra`, async ({ page }) => {
      await ingresoConGoogle(page);
      await plantarSalida(page, extra, edad);
      await espiarAviso(page);
      await page.reload();
      await expect(google(page)).toBeVisible();
      expect(await avisoVisto(page)).toBe(false);
      expect((await almacenado(page)).salida).toBeNull();
    });
  }

  test('(p) la página que vuelve del bfcache (pageshow persisted) avisa; un pageshow común, no', async ({ page }) => {
    await ingresoConGoogle(page);
    await plantarSalida(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })));
    expect((await almacenado(page)).salida, 'un pageshow común no la toca').not.toBeNull();
    await expect(avisoEnLaRanura(page)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(avisoEnLaRanura(page)).toHaveText(AVISO);
    expect((await almacenado(page)).salida).toBeNull();
  });

  test('🔴 (r) en el alta con las casillas a la vista y sin marcar, el aviso pide marcarlas; marcadas, el texto de siempre', async ({ page }) => {
    await invitadoAbreElLink(page, { altaRedirect: true, sinCuenta: true, legal: true });
    await page.getByRole('button', { name: 'Crear cuenta gratis' }).click();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await plantarSalida(page);
    await page.reload();
    const aviso = page.locator('.social-provider-slot').getByRole('status');
    await expect(aviso).toHaveText(AVISO_CASILLAS);
    await marcarCasillas(page);
    await expect(aviso).toHaveText(AVISO);
  });

  test('🔴 (q) en B («Ya tengo cuenta»), salir a Google y volver sin terminar: B en «Log in», con el aviso', async ({ page }) => {
    await invitadoAbreElLink(page, {});
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(google(page)).toHaveAttribute('data-ux-mode', 'redirect');
    await plantarSalida(page);
    await page.reload();
    await expect(page.getByText('Log in', { exact: true })).toBeVisible();
    await expect(page.getByText(A1_TXT, { exact: true })).toBeVisible();
    await expect(avisoEnLaRanura(page)).toHaveText(AVISO);
  });
});
