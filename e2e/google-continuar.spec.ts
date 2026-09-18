import { expect, test, type Page } from '@playwright/test';

/**
 * AF-17 · «Continuar con Google» en un toque (App Backend v2.92.0).
 *
 * Decisiones de Mati, 2026-09-18: *«no quiero que tengan que colocar
 * manualmente el mail!»* y, para un correo que ya tiene cuenta, *«Pedirle la
 * contraseña una vez, ahí mismo, y conectar Google»*.
 *
 * El mock publica `features.google_continue` por defecto (como el dueño
 * v2.92.0) y reproduce cada rama con seams de `localStorage`, que el build real
 * no consulta. La conducta sin la capability (backend 2.91.0) la fija
 * `google-ingreso-alta.spec.ts`.
 *
 * ⚠️ Cada test espera la frase del aviso ANTES de tocar Google: el modo
 * un-toque existe recién con el aviso cargado (su versión es la que viaja).
 * Tocar antes es el camino 0.167.0, y eso es fail-closed, no un bug.
 */

interface Seams {
  altaPublica?: boolean;
  sinCuenta?: boolean;
  correoConCuenta?: boolean;
  sinNombre?: boolean;
}

async function preparar(page: Page, seams: Seams): Promise<void> {
  await page.addInitScript((s: Seams) => {
    if (sessionStorage.getItem('e2e.af17.preparado') === '1') return;
    sessionStorage.setItem('e2e.af17.preparado', '1');
    localStorage.setItem('payme.app.mock.public_signup.v1', s.altaPublica ? 'true' : 'false');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', s.sinCuenta ? 'true' : 'false');
    localStorage.setItem('payme.app.mock.google_correo_con_cuenta.v1', s.correoConCuenta ? 'true' : 'false');
    localStorage.setItem('payme.app.mock.google_sin_nombre.v1', s.sinNombre ? 'true' : 'false');
  }, seams);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

function almacenado(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const valores: string[] = [];
    for (const almacen of [localStorage, sessionStorage]) {
      for (let i = 0; i < almacen.length; i += 1) {
        const clave = almacen.key(i)!;
        valores.push(`${clave}=${almacen.getItem(clave) ?? ''}`);
      }
    }
    return valores;
  });
}

function usuarioDeSesion(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('payme_app_session__mock');
    return raw ? (JSON.parse(raw) as { user?: Record<string, string> }).user ?? null : null;
  });
}

const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const aviso = (page: Page) => page.locator('.ingreso-aviso-google');
const adentro = (page: Page) => page.getByRole('button', { name: 'Nueva', exact: true });

/** El modo un-toque está listo: la frase del aviso, con su enlace, bajo el botón. */
async function unToqueListo(page: Page): Promise<void> {
  await expect(aviso(page)).toHaveText('Al continuar aceptas el Aviso de privacidad');
  await expect(aviso(page).getByRole('link', { name: 'Aviso de privacidad' })).toHaveAttribute('href', '/privacy');
}

test('cuenta EXISTENTE: un toque y adentro, con la frase del aviso bajo el botón', async ({ page }) => {
  await preparar(page, {});
  await page.goto('/');
  await unToqueListo(page);
  await capturar(page, '01-ingreso-continuar');
  await google(page).click();
  await expect(adentro(page)).toBeVisible();
});

test('persona NUEVA en el ingreso: un toque crea la cuenta con los datos de Google, sin escribir nada', async ({ page }) => {
  await preparar(page, { altaPublica: true, sinCuenta: true });
  await page.goto('/');
  await unToqueListo(page);
  await google(page).click();

  await expect(adentro(page)).toBeVisible();
  // Bienvenida breve, sin pantalla intermedia.
  await expect(page.getByText('¡Listo! Creamos tu cuenta de PayMe.')).toBeVisible();
  await capturar(page, '02-cuenta-creada');
  expect(await usuarioDeSesion(page)).toMatchObject({
    first_name: 'Ana', last_name: 'Demo', email: 'ana.demo@payme.local',
  });
  // Nunca apareció un campo para escribir.
  await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toHaveCount(0);

  const valores = await almacenado(page);
  expect(valores.some((v) => v.startsWith('payme_app_session__mock='))).toBe(true);
  expect(valores.filter((v) => v.includes('mock-google-credential-'))).toEqual([]);
});

test('«Crea tu cuenta»: Google arriba de todo, un toque y adentro', async ({ page }) => {
  await preparar(page, { altaPublica: true, sinCuenta: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await unToqueListo(page);
  await capturar(page, '03-crea-tu-cuenta-continuar');
  await google(page).click();
  await expect(adentro(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear mi cuenta', exact: true })).toHaveCount(0);
});

test('correo con cuenta: pide la contraseña UNA vez, acepta la correcta y conecta Google', async ({ page }) => {
  await preparar(page, { sinCuenta: true, correoConCuenta: true });
  await page.goto('/');
  await unToqueListo(page);
  await google(page).click();

  await expect(page.getByText('Conecta tu cuenta con Google', { exact: true })).toBeVisible();
  await expect(page.getByText('Ya tienes una cuenta con este correo. Escribe tu contraseña para conectarla con Google.')).toBeVisible();
  // 🔴 El link_intent vive sólo en memoria.
  expect((await almacenado(page)).filter((v) => v.includes('mock-link-intent-'))).toEqual([]);
  await capturar(page, '04-conectar-contrasena');

  const conectar = page.getByRole('button', { name: 'Conectar con Google', exact: true });
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrecta1');
  await conectar.click();
  await expect(page.getByRole('alert')).toHaveText('Contraseña incorrecta. Prueba de nuevo.');
  await capturar(page, '05-contrasena-incorrecta');

  // Mismo intento: la correcta conecta.
  await page.getByLabel('Contraseña', { exact: true }).fill('demo'.repeat(3));
  await conectar.click();
  await expect(adentro(page)).toBeVisible();
  await expect(page.getByText('Listo: conectamos tu cuenta con Google.')).toBeVisible();
  expect((await almacenado(page)).filter((v) => v.includes('mock-link-intent-'))).toEqual([]);
});

test('correo con cuenta: al quinto error el intento se quema y se vuelve a Google con texto neutro', async ({ page }) => {
  await preparar(page, { sinCuenta: true, correoConCuenta: true });
  await page.goto('/');
  await unToqueListo(page);
  await google(page).click();
  await expect(page.getByText('Conecta tu cuenta con Google', { exact: true })).toBeVisible();

  const conectar = page.getByRole('button', { name: 'Conectar con Google', exact: true });
  for (let i = 0; i < 5; i += 1) {
    await page.getByLabel('Contraseña', { exact: true }).fill(`incorrecta${i}x`);
    await conectar.click();
    await expect(page.getByRole('alert')).toHaveText('Contraseña incorrecta. Prueba de nuevo.');
  }
  // El sexto ya no tiene intento: 401 ⇒ vuelve al ingreso.
  await page.getByLabel('Contraseña', { exact: true }).fill('demo'.repeat(3));
  await conectar.click();
  await expect(page.getByRole('alert')).toHaveText('No pudimos conectar tu cuenta. Toca «Continuar con Google» otra vez.');
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  await expect(google(page)).toBeVisible();
});

test('Google sin nombre: el paso pide SÓLO nombre y apellido y el reintento crea la cuenta', async ({ page }) => {
  await preparar(page, { altaPublica: true, sinCuenta: true, sinNombre: true });
  await page.goto('/');
  await unToqueListo(page);
  await google(page).click();

  await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toBeVisible();
  await expect(page.getByText('Google no nos dio tu nombre. Escríbelo y toca «Continuar con Google» otra vez.')).toBeVisible();
  // Sin correo (lo pone Google) ni contraseña.
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  await page.getByLabel('Nombre', { exact: true }).fill('Rita');
  await page.getByLabel('Apellido', { exact: true }).fill('Sinnombre');
  await unToqueListo(page);
  await capturar(page, '06-perfil-requerido');
  await google(page).click();

  await expect(adentro(page)).toBeVisible();
  expect(await usuarioDeSesion(page)).toMatchObject({ first_name: 'Rita', last_name: 'Sinnombre' });
});

test('alta CERRADA: persona nueva recibe el cartel neutro, sin paso de alta ni texto que revele la cuenta', async ({ page }) => {
  await preparar(page, { altaPublica: false, sinCuenta: true });
  await page.goto('/');
  await unToqueListo(page);
  await google(page).click();

  await expect(page.getByRole('alert')).toHaveText(
    'No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.',
  );
  await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
});

test('🔴 sin features.google_continue (backend 2.91.0): sin frase de un-toque, conducta 0.167.0', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.google_continue.v1', 'false'));
  await preparar(page, { altaPublica: true, sinCuenta: true });
  await page.goto('/');
  await expect(google(page)).toBeVisible();
  // Testigo positivo de que la pantalla ya aplicó la capability: el botón está.
  await expect(aviso(page)).toHaveCount(0);
  await google(page).click();
  // 0.167.0: el ingreso fallido lleva al paso con formulario, no crea la cuenta.
  await expect(page.getByText('Crea tu cuenta con Google', { exact: true })).toBeVisible();
  await expect(adentro(page)).toHaveCount(0);
});
