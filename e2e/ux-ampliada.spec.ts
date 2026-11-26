import { abrirTusConsumos } from './_mesa';
import { sacarFoto } from './_camara';
import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';
import { hastaCompartir } from './fixtures/mi-parte-d344';
const TIP = 'La eliges tú para toda la mesa y se reparte según lo que consumió cada quien. Es voluntaria y puedes cambiarla después.';
const FULL = 'Esta mesa tiene muchas solicitudes pendientes.';
const PEDIR_ACEPTAR = 'Pídele a quien la abrió que acepte las que tiene.';
const CUENTA_LISTA = 'Tu cuenta ya está lista. Pídele a quien te invitó un link nuevo o abre tu propia mesa.';
const NEUTRO = 'No pudimos sumarte a esta mesa.';
async function foto(page: Page, nombre: string) {
  if (process.env.PAYME_E2E_CAPTURAS) {
    await page.locator('.hdr-user').evaluateAll(xs => xs.forEach(x => { x.textContent = 'Demo'; }));
    await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/${nombre}.png`, animations: 'disabled' });
  }
}
test('K18 · explicación y enlace en la hoja nativa', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: (data: ShareData) => {
    (window as unknown as { textoCompartido: string }).textoCompartido = data.text ?? ''; return Promise.resolve();
  } }));
  const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await expect(page.getByText(TIP, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compartir…', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { textoCompartido: string }).textoCompartido)).toContain(code);
  await foto(page, '18-compartir-mesa');
});
test('K18 · sin soporte no ofrece Compartir…', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await expect(page.getByText(TIP, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compartir…', exact: true })).toHaveCount(0);
});
async function apagarFacebook(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const social = '/src/api/socialAuth.ts';
    const { applySocialAuthConfig } = await import(/* @vite-ignore */ social) as typeof import('../src/api/socialAuth');
    const original = api.getConfig.bind(api);
    api.getConfig = async () => {
      const config = await original();
      return {
        ...config,
        features: {
          ...config.features,
          social_auth: {
            ...config.features.social_auth as Record<string, unknown>,
            facebook_sign_in: { enabled: false, registration: false, login: false, app_id: null, redirect_uri: null },
          },
        },
      };
    };
    applySocialAuthConfig(await api.getConfig());
  });
}
test('K19 · Google principal en cuenta de entrada por link', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('payme.app.mock.public_signup.v1', 'true'); });
  await page.goto('/#/mesa/PA-1234?t=ejemplo-link-de-mesa');
  await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
  const google = page.getByRole('group', { name: 'Continuar con Google', exact: true });
  await expect(google).toBeVisible();
  expect(await google.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('input[type=email]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.ingreso-desde-mesa .ingreso-entrar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.getByText('O entra con tu correo', { exact: true })).toBeVisible();
  await expect(page.getByText('O regístrate con tu correo', { exact: true })).toHaveCount(0);
  await expect(page.locator('.social-provider-facebook')).toBeVisible();
  await expect(page.getByText('O continúa con', { exact: true })).toBeVisible();
  await apagarFacebook(page);
  await expect(google).toBeVisible();
  await expect(page.locator('.social-provider-facebook')).toHaveCount(0);
  await expect(page.getByText('O continúa con', { exact: true })).toHaveCount(0);
  await foto(page, '19-cuenta-desde-link');
});
test('K19 · cuenta desde link con el divisor de Entrar en inglés', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.idioma.v1', 'en');
  });
  await page.goto('/#/mesa/PA-1234?t=ejemplo-link-de-mesa');
  await page.getByRole('button', { name: /Already have an account.*Log in/i }).click();
  await expect(page.getByText('Or log in with your email', { exact: true })).toBeVisible();
  await expect(page.getByText('Or sign up with your email', { exact: true })).toHaveCount(0);
  await apagarFacebook(page);
  await expect(page.getByText('Or continue with', { exact: true })).toHaveCount(0);
  await foto(page, '19b-cuenta-desde-link-en');
});
test('K20 · menú de amigo y solicitud; confirmación propia y foco', async ({ page }) => {
  await ingresar(page); await irEnLaApp(page, '/amigos');
  const amigo = page.getByRole('button', { name: 'Información de Juan López', exact: true });
  await amigo.focus(); await amigo.press('Enter'); await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  const hoja = page.getByRole('dialog', { name: /¿Bloquear a Juan López/ });
  await expect(hoja).toBeVisible();
  await expect(hoja.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await foto(page, '20-confirmar-bloqueo');
  await page.keyboard.press('Escape'); await expect(amigo).toBeFocused();
  await page.getByRole('tab', { name: /Solicitudes/ }).click();
  const mas = page.getByRole('button', { name: /^Más acciones de / }).first(); await mas.click();
  await expect(page.getByRole('button', { name: /^Bloquear a / })).toBeVisible();
});
for (const origen of ['amigo', 'solicitud'] as const) {
  test(`K20 · bloquear desde ${origen} confirma el id; Cancelar y Escape no llaman`, async ({ page }) => {
    await ingresar(page);
    const persona = await page.evaluate(async (origen) => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
      const target = origen === 'amigo'
        ? (await api.getFriends()).friends.find(f => f.full_name === 'Juan López')!
        : (await api.getIncomingFriendRequests()).requests[0]!.user;
      const original = api.blockUser.bind(api);
      api.blockUser = async (id) => {
        const ids = JSON.parse(sessionStorage.getItem('k20-blocks') ?? '[]') as string[];
        sessionStorage.setItem('k20-blocks', JSON.stringify([...ids, id]));
        return original(id);
      };
      return { id: target.id, nombre: target.full_name, primerNombre: target.first_name };
    }, origen);
    const llamadas = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('k20-blocks') ?? '[]') as string[]);
    await irEnLaApp(page, '/amigos');
    if (origen === 'solicitud') await page.getByRole('tab', { name: /Solicitudes/ }).click();
    const menu = page.getByRole('button', { name: `${origen === 'amigo' ? 'Información de' : 'Más acciones de'} ${persona.nombre}`, exact: true });
    const hoja = page.getByRole('dialog', { name: /^¿Bloquear a / });
    const abrir = async () => {
      await menu.focus(); await menu.press('Enter');
      await page.getByRole('button', { name: /^Bloquear( a |$)/ }).click();
      await expect(hoja).toBeVisible();
      await expect(hoja.getByRole('button', { name: 'Bloquear', exact: true })).toHaveText('Bloquear');
    };
    await abrir();
    await hoja.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(hoja).toHaveCount(0);
    expect(await llamadas()).toEqual([]);
    await abrir();
    await page.keyboard.press('Escape');
    await expect(hoja).toHaveCount(0);
    await expect(menu).toBeFocused();
    expect(await llamadas()).toEqual([]);
    await abrir();
    await hoja.getByRole('button', { name: 'Bloquear', exact: true }).click();
    await expect(hoja).toHaveCount(0);
    expect(await llamadas()).toEqual([persona.id]);
    await expect(page.getByRole('tab', { selected: true })).toBeFocused();
    const nombre = origen === 'amigo' ? persona.nombre : persona.primerNombre;
    await expect(page.locator('.toast--sobre-barra')).toContainText(`Bloqueaste a ${nombre}`);
    if (origen === 'amigo') await foto(page, 'm-bloqueaste-es');
  });
}
test('M · aviso de bloqueo y botón de quitar en EN', async ({ page }) => {
  await ingresar(page);
  await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
  await page.reload();
  await irEnLaApp(page, '/amigos');
  const menu = page.getByRole('button', { name: 'Delete Juan López', exact: true });
  await menu.focus(); await menu.press('Enter');
  const hoja = page.getByRole('dialog', { name: 'Remove Juan López from your friends?', exact: true });
  await expect(hoja.getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
  await foto(page, 'm-quitar-en');
  await hoja.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(menu).toBeFocused();

  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Block', exact: true }).click();
  await page.getByRole('dialog', { name: /^Block Juan López/ })
    .getByRole('button', { name: 'Block', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('You blocked Juan López');
  await foto(page, 'm-bloqueaste-en');
});
test('Legal y ayuda conserva los enlaces vigentes', async ({ page }) => {
  await ingresar(page); await irEnLaApp(page, '/mas');
  const seccion = page.getByRole('region', { name: 'Legal y ayuda', exact: true });
  await expect(seccion.getByRole('link', { name: 'Aviso de privacidad', exact: true })).toHaveAttribute('href', '/privacy');
  await expect(seccion.getByRole('link', { name: 'Términos de uso', exact: true })).toHaveAttribute('href', '/terminos');
  await seccion.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const titulo = seccion.getByRole('heading', { name: 'Legal y ayuda', exact: true });
  await expect(titulo).toHaveCSS('padding-left', '16px');
  await expect(titulo).toBeInViewport({ ratio: 1 });
  await expect(seccion.locator('.list-row')).toHaveCount(2);
  for (const fila of await seccion.locator('.list-row').all()) {
    await expect(fila.locator('svg')).toHaveCount(2);
    await expect(fila).toBeInViewport({ ratio: 1 });
  }
  await foto(page, '21-legal-y-ayuda');
});
for (const [status, code] of [[403, 'invitation_link_not_valid'], [409, 'join_request_not_allowed'], [410, 'mesa_not_joinable'], [409, 'join_requests_full']] as const) {
  test(`K23 · link ${status} ${code}: texto y sin reintento`, async ({ page }) => {
    await ingresar(page);
    await page.evaluate(async ({ status: s, code: c }) => {
      const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
      const errores = '/src/api/http.ts'; const { HttpError } = await import(/* @vite-ignore */ errores) as typeof import('../src/api/http');
      api.acceptInvitationLink = async () => { throw new HttpError(s, { error: c }); };
    }, { status, code });
    await page.evaluate(() => { location.hash = '#/mesa/PA-1234?t=ejemplo-link-de-mesa'; });
    const full = code === 'join_requests_full';
    await expect(page.getByRole('heading', { name: full ? FULL : NEUTRO, exact: true })).toBeVisible();
    await expect(page.locator('.link-cuerpo')).toHaveText(full ? PEDIR_ACEPTAR : CUENTA_LISTA);
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);
    const salida = page.getByRole('button', { name: 'Ir a Inicio', exact: true });
    await expect(salida).toHaveText('Ir a Inicio');
    await expect(salida).toBeInViewport({ ratio: 1 });
    if (full) await foto(page, '23-solicitudes-pendientes');
    await salida.click();
    await expect(page).toHaveURL(/\/home$/);
  });
}

test('K20 · el menú del último amigo queda visible fuera de la tarjeta', async ({ page }) => {
  await ingresar(page); await irEnLaApp(page, '/amigos');
  const mas = page.locator('.amigo-deslizable').last().getByRole('button', { name: /^Eliminar / });
  await mas.focus(); await expect(mas).toBeInViewport();
  await mas.press('Enter');
  const hoja = page.getByRole('dialog', { name: /¿Quitar a / });
  await expect(hoja.getByRole('button', { name: 'Quitar', exact: true })).toBeVisible();
  await foto(page, 'm-quitar-es');
  await page.keyboard.press('Escape'); await expect(mas).toBeFocused();
});
test('K22 · apertura sin jerga en el caso correcto', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const errores = '/src/api/http.ts'; const { HttpError } = await import(/* @vite-ignore */ errores) as typeof import('../src/api/http');
    api.createMesa = async () => { throw new HttpError(400, { error: 'invalid_items' }); };
  });
  await page.getByRole('button', { name: 'Escanear', exact: true }).click(); await sacarFoto(page);
  await page.getByRole('radio', { name: /Cada uno lo suyo/ }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('No pudimos abrir la mesa. Prueba de nuevo.');
  await foto(page, '22-apertura-error');
});
test('K22 · tarjeta pendiente conserva bloqueo y mensaje de un solo intento', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'sandbox'));
  await ingresar(page); await irEnLaApp(page, '/mesa/PA-2847'); await abrirTusConsumos(page);
  await page.getByRole('button', { name: 'Tagliatelle Bolognese, $195', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('radio', { name: '10%', exact: true }).click();
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const errores = '/src/api/http.ts'; const { HttpError } = await import(/* @vite-ignore */ errores) as typeof import('../src/api/http');
    api.payMesa = async () => { throw new HttpError(409, { error: 'monetary_family_reconciliation_required' }); };
  });
  await page.getByRole('button', { name: 'Pagar $216', exact: true }).click();
  await expect(page.getByText('Estamos confirmando un intento anterior. No se hizo ningún cobro nuevo. Vuelve a intentar en unos minutos.', { exact: true }).first()).toBeVisible();
  await foto(page, '22-tarjeta-intento-anterior');
});
