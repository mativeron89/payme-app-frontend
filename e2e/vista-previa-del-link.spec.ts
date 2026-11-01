import { expect, test, type Browser, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-5 · D622 (mejora 5) · D629 · D676 · el link de la mesa sin sesión dice quién invita y dónde.
 *
 * Contra el mock (seam `payme.app.mock.link_preview.v1`: sin él el mock no publica `features.link_preview`, como el
 * dueño de antes; `encendido`; `sin_nombre`, el nombre en `null` de D676). Los fallos que el mock no produce (503,
 * red, una forma rara, más de 1,5 s) se arman reemplazando `api.getVistaPreviaDelLink` en la página y navegando DENTRO
 * del documento (el patrón de `invitacion-estados`).
 *
 * 🔴 «Ni un píxel distinto»: cada caso sin vista previa se compara contra la pantalla de hoy (sin la capacidad) por el
 * HTML de la pantalla y por la captura, byte a byte. Capturas del catálogo (D542) sólo con `PAYME_E2E_CAPTURAS`.
 */
const SEAM = 'payme.app.mock.link_preview.v1';
const SIGNUP = 'signup-token-link-mesa-aaaaaaaa';
const HOY = 'Te invitaron a una mesa';
const A1_TXT = 'Para ver la mesa y elegir tus platos, necesitas una cuenta de PayMe.';
const B_ALTA_TXT = 'Crea tu cuenta o entra para sumarte y elegir tus platos.';
const LINK_CUALQUIERA = '/#/mesa/PA-0001?t=tok-cualquiera-largo';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

const titulo = (page: Page) => page.getByRole('heading', { level: 1 });

/** Espera que terminen las animaciones finitas (la entrada de la tarjeta). */
async function quietas(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => undefined))));
}

/** El organizador (la cuenta del mock) abre una mesa con link; después se sale de la sesión y se abre el link. */
async function linkDeUnaMesaViva(page: Page): Promise<{ hash: string; restaurante: string; nombre: string }> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true });
  const datos = await page.evaluate((code) => {
    const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!) as {
      user: { first_name: string };
      mesas: Array<{ code: string; restaurant: { name: string } }>;
    };
    localStorage.removeItem('payme_app_session__mock');
    return { nombre: st.user.first_name, restaurante: st.mesas.find((m) => m.code === code)!.restaurant.name };
  }, mesa.code);
  await page.reload();
  return { hash: mesa.link.slice(mesa.link.indexOf('#')), ...datos };
}

async function conSeam(page: Page, valor: 'encendido' | 'sin_nombre'): Promise<void> {
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [SEAM, valor] as const);
}

type Falla = 'contar' | 'colgar' | 'lenta' | 'retenida';
/** Cómo termina una consulta retenida: el 403 del mock (el token no es de ninguna mesa) o un fallo armado. */
type Final = 'mock' | '503' | 'red' | 'rara';

/**
 * Reemplaza la fachada en la página y cuenta las llamadas. `colgar` no vuelve nunca; `lenta` contesta una vista previa
 * VÁLIDA a los 2,5 s; `retenida` espera a `soltarVistaPrevia` para terminar como se le diga.
 */
async function reemplazarVistaPrevia(page: Page, modo: Falla): Promise<void> {
  await page.evaluate(async (m) => {
    const rutaApi = '/src/api/index.ts';
    const rutaHttp = '/src/api/http.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const { HttpError } = await import(/* @vite-ignore */ rutaHttp) as { HttpError: new (s: number, b: unknown) => Error };
    const w = window as unknown as { __vista: number; __soltar: (f: string) => void };
    w.__vista = 0;
    const original = api.getVistaPreviaDelLink!.bind(api);
    api.getVistaPreviaDelLink = (...args: unknown[]) => {
      w.__vista += 1;
      if (m === 'colgar') return new Promise(() => undefined);
      if (m === 'lenta') {
        return new Promise((r) => { setTimeout(() => r({ inviter_first_name: 'Ana', restaurant_name: 'Tacos El Güero' }), 2500); });
      }
      if (m === 'retenida') {
        return new Promise((res, rej) => {
          w.__soltar = (f: string) => {
            if (f === '503') rej(new HttpError(503, { error: 'invitation_link_unavailable' }));
            else if (f === 'red') rej(new TypeError('Failed to fetch'));
            else if (f === 'rara') res({ inviter_first_name: 'Ana', restaurant_name: 'Tacos El Güero', inviter_last_name: 'López' });
            else original(...args).then(res, rej);
          };
        });
      }
      return original(...args);
    };
  }, modo);
}
const llamadas = (page: Page) => page.evaluate(() => (window as unknown as { __vista: number }).__vista);
const soltarVistaPrevia = (page: Page, f: Final) =>
  page.evaluate((x) => { (window as unknown as { __soltar: (f: string) => void }).__soltar(x); }, f);

/** Abre el link dentro del documento (un `goto` recargaría y perdería el reemplazo). */
async function alLink(page: Page, ruta: string): Promise<void> {
  await page.evaluate((h) => { window.location.hash = h; }, ruta.slice(ruta.indexOf('#') + 1));
}

/** La capability del alta ya se leyó (con éxito o no): recién ahí el color de «Entrar» es el definitivo (D373). */
async function capacidadLeida(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const ruta = '/src/api/socialAuth.ts';
    const m = await import(/* @vite-ignore */ ruta) as { socialAuthSnapshot: () => { status: string } };
    return m.socialAuthSnapshot().status;
  })).not.toBe('pending');
  await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true })).toHaveClass(/link-btn-brand/);
}

/** El HTML de la pantalla del link y su captura, quieta y con la capability del alta ya leída. */
async function foto(page: Page): Promise<{ html: string; captura: Buffer }> {
  await capacidadLeida(page);
  await quietas(page);
  return {
    html: await page.locator('.link-screen').evaluate((el) => el.outerHTML),
    captura: await page.screenshot({ animations: 'disabled' }),
  };
}

/** El HTML de la pantalla de hoy: sin la capacidad (el dueño de antes), el mismo link, en otra página. */
async function htmlDeHoy(browser: Browser, ruta: string): Promise<string> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(ruta);
  await expect(titulo(page)).toHaveText(HOY);
  const { html } = await foto(page);
  await page.close();
  return html;
}

test.use({ viewport: { width: 390, height: 844 } });

test.describe('AF-5 · con vista previa', () => {
  test('🔴 D629 · «{nombre} te invitó a su mesa en {restaurante}», el cuerpo y los botones de siempre, y nada más', async ({ page }) => {
    await conSeam(page, 'encendido');
    const { hash, nombre, restaurante } = await linkDeUnaMesaViva(page);
    await page.goto(`/${hash}`);
    await expect(titulo(page)).toHaveText(`${nombre} te invitó a su mesa en ${restaurante}`);
    await expect(titulo(page)).toHaveCount(1);
    const tarjeta = page.locator('.title-card');
    await expect(tarjeta.getByText(A1_TXT, { exact: true })).toBeVisible();
    await expect(tarjeta.getByRole('button')).toHaveText(['Ya tengo cuenta · Entrar']);
    await expect(tarjeta.locator('.title-card-cuadro')).toHaveAttribute('data-icono', 'persona-mas');
    // Nada más: sin foto, apellido, total, personas, platos ni el código de la mesa.
    const cuerpo = await page.locator('body').innerText();
    expect(cuerpo).not.toContain('Verón');
    expect(cuerpo).not.toMatch(/\$\s?\d/);
    expect(cuerpo).not.toMatch(/PA-\d/);
    expect(cuerpo).not.toMatch(/\d+\s*(personas?|comensales?)/i);
    await expect(page.locator('.link-screen img')).toHaveCount(0);
    await quietas(page);
    await capturar(page, 'af5-01-link-con-quien-invita');
  });

  test('con el alta: la tarjeta de B también dice quién invita, y el formulario es el de siempre', async ({ page }) => {
    await conSeam(page, 'encendido');
    const { hash, nombre, restaurante } = await linkDeUnaMesaViva(page);
    await page.goto(`/${hash}&signup_invitation=${SIGNUP}`);
    await expect(titulo(page)).toHaveText(`${nombre} te invitó a su mesa en ${restaurante}`);
    await page.getByRole('button', { name: 'Crear cuenta gratis', exact: true }).click();
    const tarjeta = page.locator('.title-card');
    await expect(tarjeta.getByRole('heading', { level: 1 })).toHaveText(`${nombre} te invitó a su mesa en ${restaurante}`);
    await expect(tarjeta.getByText(B_ALTA_TXT, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible();
    await quietas(page);
    await capturar(page, 'af5-02-alta-con-quien-invita');
  });

  test('🔴 D583 · después del alta, el canje y la mesa como hoy', async ({ page }) => {
    await conSeam(page, 'encendido');
    const { hash, nombre, restaurante } = await linkDeUnaMesaViva(page);
    await page.goto(`/${hash}&signup_invitation=${SIGNUP}`);
    await expect(titulo(page)).toHaveText(`${nombre} te invitó a su mesa en ${restaurante}`);
    await page.getByRole('button', { name: 'Crear cuenta gratis', exact: true }).click();
    await page.getByLabel('Nombre', { exact: true }).fill('Invitada');
    await page.getByLabel('Apellido', { exact: true }).fill('PorLink');
    await page.getByLabel('Email', { exact: true }).fill('invitada-af5@demo.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/mesa/${hash.match(/PA-[A-Za-z0-9]+/)![0]}(?![?&]t=)`));
    await expect(page.getByRole('heading', { level: 1 }).first()).not.toHaveText(/te invitó a su mesa/);
  });

  test('EN · «{0} invited you to their table at {1}»', async ({ page }) => {
    await conSeam(page, 'encendido');
    const { hash, nombre, restaurante } = await linkDeUnaMesaViva(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.goto(`/${hash}`);
    await expect(titulo(page)).toHaveText(`${nombre} invited you to their table at ${restaurante}`);
    await expect(page.getByText('To see the table and pick your dishes, you need a PayMe account.', { exact: true })).toBeVisible();
  });
});

test.describe('AF-5 · D676 · el nombre en null', () => {
  test('🔴 «Te invitaron a una mesa en {restaurante}», sin nombre (ES y EN)', async ({ page }) => {
    await conSeam(page, 'sin_nombre');
    const { hash, nombre, restaurante } = await linkDeUnaMesaViva(page);
    await page.goto(`/${hash}`);
    await expect(titulo(page)).toHaveText(`Te invitaron a una mesa en ${restaurante}`);
    expect(await page.locator('body').innerText()).not.toContain(nombre);
    await quietas(page);
    await capturar(page, 'af5-03-link-sin-nombre');
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(titulo(page)).toHaveText(`You've been invited to a table at ${restaurante}`);
  });
});

test.describe('AF-5 · sin vista previa: la pantalla de hoy, idéntica', () => {
  test('🔴 sin la capacidad (el dueño de antes) no se pide nada y el título es el de hoy', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await reemplazarVistaPrevia(page, 'contar');
    await alLink(page, LINK_CUALQUIERA);
    await expect(titulo(page)).toHaveText(HOY);
    await expect(page.getByText(A1_TXT, { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await llamadas(page)).toBe(0);
  });

  test('🔴 un link válido sin la capacidad tampoco dice nada', async ({ page }) => {
    const { hash, nombre, restaurante } = await linkDeUnaMesaViva(page);
    await page.goto(`/${hash}`);
    await expect(titulo(page)).toHaveText(HOY);
    const cuerpo = await page.locator('body').innerText();
    expect(cuerpo).not.toContain(restaurante);
    expect(cuerpo).not.toContain(`${nombre} te`);
  });

  /**
   * 🔴 «Ni un píxel distinto». Dos comparaciones: (1) en la MISMA página, la captura mientras la consulta está en vuelo
   * (la pantalla de hoy) contra la captura después de que termina en fallo, byte a byte: cuando el fallo llega no
   * cambia ni un píxel; (2) el HTML de la pantalla contra el de la pantalla de hoy de una página sin la capacidad. Dos
   * páginas distintas no se comparan por píxel: la composición de cada una puede diferir en el suavizado del texto
   * aunque el HTML sea el mismo (medido: 7 de 29 corridas con diferencias de suavizado en la tarjeta).
   */
  for (const final of ['mock', '503', 'red', 'rara'] as const) {
    const nombre = final === 'mock' ? 'token inválido (el 403 del mock)' : final;
    test(`🔴 ${nombre}: ni un píxel distinto de la pantalla de hoy`, async ({ page, browser }) => {
      const hoy = await htmlDeHoy(browser, LINK_CUALQUIERA);
      await conSeam(page, 'encendido');
      await page.goto('/');
      await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
      await reemplazarVistaPrevia(page, 'retenida');
      await alLink(page, LINK_CUALQUIERA);
      await expect.poll(() => llamadas(page)).toBe(1);
      const enVuelo = await foto(page);
      expect(enVuelo.html, 'mientras llega, la pantalla de hoy').toBe(hoy);
      await soltarVistaPrevia(page, final);
      await page.waitForTimeout(800);
      await expect(titulo(page)).toHaveText(HOY);
      const despues = await foto(page);
      expect(despues.html).toBe(hoy);
      expect(despues.captura.equals(enVuelo.captura), 'la captura no cambia ni un píxel').toBe(true);
    });
  }

  test('🔴 más de 1,5 s: queda la de hoy aunque una respuesta válida llegue después', async ({ page, browser }) => {
    const hoy = await htmlDeHoy(browser, LINK_CUALQUIERA);
    await conSeam(page, 'encendido');
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await reemplazarVistaPrevia(page, 'lenta');
    await alLink(page, LINK_CUALQUIERA);
    await expect.poll(() => llamadas(page)).toBe(1);
    const enVuelo = await foto(page);
    expect(enVuelo.html).toBe(hoy);
    // La respuesta (válida, con nombre) llega a los 2,5 s: pasado ese momento, sigue la de hoy.
    await page.waitForTimeout(3000);
    await expect(titulo(page)).toHaveText(HOY);
    const despues = await foto(page);
    expect(despues.html).toBe(hoy);
    expect(despues.captura.equals(enVuelo.captura), 'la captura no cambia ni un píxel').toBe(true);
  });

  test('🔴 mientras la consulta no vuelve, se puede entrar: el alta no espera', async ({ page }) => {
    await conSeam(page, 'encendido');
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await reemplazarVistaPrevia(page, 'colgar');
    await alLink(page, LINK_CUALQUIERA);
    await expect.poll(() => llamadas(page)).toBe(1);
    await expect(titulo(page)).toHaveText(HOY);
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  });

  test('🔴 la respuesta no se guarda en el dispositivo (ni localStorage ni sessionStorage)', async ({ page }) => {
    await conSeam(page, 'encendido');
    const { hash, nombre, restaurante } = await linkDeUnaMesaViva(page);
    const leer = () => page.evaluate(() => {
      const todo: Record<string, string> = {};
      for (const s of [localStorage, sessionStorage]) {
        for (let i = 0; i < s.length; i += 1) todo[`${s === localStorage ? 'local' : 'sesion'}:${s.key(i)}`] = s.getItem(s.key(i)!) ?? '';
      }
      return todo;
    });
    const antes = await leer();
    await page.goto(`/${hash}`);
    await expect(titulo(page)).toHaveText(`${nombre} te invitó a su mesa en ${restaurante}`);
    await page.waitForTimeout(300);
    const despues = await leer();
    // Lo único nuevo es la custodia del token de siempre (sessionStorage), no la respuesta.
    const nuevas = Object.keys(despues).filter((k) => !(k in antes));
    expect(nuevas.filter((k) => k !== 'sesion:payme_pending_invitation_link')).toEqual([]);
    for (const [k, v] of Object.entries(despues)) {
      expect(v, k).not.toContain('te invitó a su mesa');
      if (!k.endsWith('payme_mock_state_v1')) expect(v, k).not.toContain('inviter_first_name');
    }
    const guardado = await page.evaluate(() => {
      const todo: string[] = [];
      for (const s of [localStorage, sessionStorage]) {
        for (let i = 0; i < s.length; i += 1) todo.push(`${s.key(i)}=${s.getItem(s.key(i)!)}`);
      }
      return todo.join('\n');
    });
    // El nombre de la cuenta del mock vive en el estado del mock (es su base de datos), no en una clave de la vista
    // previa: fuera del seam del riel mock, ninguna clave lleva «preview» ni «vista».
    const claves = guardado.split('\n').map((l) => l.split('=')[0]!).filter((k) => k !== SEAM);
    expect(claves.filter((k) => /preview|vista/i.test(k))).toEqual([]);
  });
});
