import { expect, test, type Page } from '@playwright/test';

/**
 * AF-16 · tocar «Google» en el ingreso sirve también para registrarse.
 *
 * Decisión de Mati, 2026-09-18, después de probarlo él mismo en producción y
 * recibir el cartel genérico: *«Yo quiero que se pueden registrar usando Google,
 * es FUNDAMENTAL que se registren usando Google»*.
 *
 * El dueño contesta `google/login` con un `401 social_auth_failed` opaco cuando
 * la identidad no tiene cuenta. El riel mock lo reproduce con su seam de
 * `localStorage` (`payme.app.mock.google_sin_cuenta.v1`), el mismo tipo de
 * seam que el alta pública; ninguno de los dos existe en el build real.
 *
 * Las capturas se escriben sólo si `PAYME_E2E_CAPTURAS` nombra un directorio:
 * en la CI no se escribe nada.
 */

const PREFIJO_TOKEN_MOCK = 'mock-google-credential-';

async function preparar(page: Page, { altaPublica, sinCuenta }: {
  altaPublica: boolean;
  sinCuenta: boolean;
}): Promise<void> {
  await page.addInitScript(([alta, sin]) => {
    // Sólo en la PRIMERA carga: el alta tiene que poder apagar el «sin
    // cuenta», como en el dueño, y un init script corre en cada navegación.
    if (sessionStorage.getItem('e2e.af16.preparado') === '1') return;
    sessionStorage.setItem('e2e.af16.preparado', '1');
    localStorage.setItem('payme.app.mock.public_signup.v1', alta ? 'true' : 'false');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', sin ? 'true' : 'false');
  }, [altaPublica, sinCuenta] as const);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

/** Todo valor guardado en el navegador, para buscar ahí el token. */
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

const google = (page: Page) => page.getByRole('button', { name: 'Continuar con Google', exact: true });
const tituloAlta = (page: Page) => page.getByText('Crea tu cuenta con Google', { exact: true });

test('persona NUEVA: toca Google en el ingreso, completa sus datos y queda adentro', async ({ page }) => {
  await preparar(page, { altaPublica: true, sinCuenta: true });
  await page.goto('/');
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  await capturar(page, '01-ingreso');

  await google(page).click();

  // 🔴 La transición: no termina en el cartel, continúa hacia el alta.
  await expect(tituloAlta(page)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  // Sólo lo que el dueño exige para `google_register`: sin contraseña ni
  // «Registrarme».
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Aviso de privacidad')).toBeVisible();

  // Prellenado desde los claims del token (el mock entrega uno con forma de
  // id_token): sugerencia, no autoridad.
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Ana');
  await expect(page.getByLabel('Apellido', { exact: true })).toHaveValue('Demo');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('ana.demo@payme.local');
  await capturar(page, '02-crea-tu-cuenta-con-google');

  // Si falta un dato, el botón de Google espera y la pantalla dice qué falta
  // en vez de quedar sin acciones.
  await page.getByLabel('Nombre', { exact: true }).fill('');
  await expect(page.getByText('Escribe tu nombre y apellido aquí arriba para continuar con Google.')).toBeVisible();
  await expect(google(page)).toHaveCount(0);

  // Editable: lo que la persona escribe gana sobre la sugerencia.
  await page.getByLabel('Nombre', { exact: true }).fill('Nora');
  await page.getByLabel('Apellido', { exact: true }).fill('Nueva');
  await page.getByLabel('Email', { exact: true }).fill('nora@ejemplo.mx');
  await capturar(page, '03-datos-completos');

  // El token del ingreso fallido ya está consumido en el dueño: un toque más.
  await google(page).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await capturar(page, '04-adentro');

  const usuario = await page.evaluate(() => {
    const raw = localStorage.getItem('payme_app_session__mock');
    return raw ? (JSON.parse(raw) as { user?: { first_name?: string; last_name?: string } }).user ?? null : null;
  });
  expect(usuario).toMatchObject({ first_name: 'Nora', last_name: 'Nueva' });

  // 🔴 El id_token no quedó guardado en ningún lado. Control positivo: la
  // búsqueda mira valores reales (la sesión sí está).
  const valores = await almacenado(page);
  expect(valores.some((v) => v.startsWith('payme_app_session__mock='))).toBe(true);
  expect(valores.filter((v) => v.includes(PREFIJO_TOKEN_MOCK))).toEqual([]);
});

test('«Crea tu cuenta» empieza por Google: un toque, datos confirmados y adentro, sin contraseña', async ({ page }) => {
  await preparar(page, { altaPublica: true, sinCuenta: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();

  // 🔴 Google está ARRIBA y disponible sin haber escrito nada.
  await expect(google(page)).toBeVisible();
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('');
  const orden = await page.evaluate(() => {
    const boton = document.querySelector('.social-provider-google');
    const campo = document.querySelector('.ingreso-campo');
    return boton && campo
      ? Boolean(boton.compareDocumentPosition(campo) & Node.DOCUMENT_POSITION_FOLLOWING)
      : null;
  });
  expect(orden, 'Google tiene que estar antes del primer campo').toBe(true);
  // El formulario manual sigue ahí, debajo, como alternativa.
  await expect(page.getByText('O regístrate con tu correo', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await capturar(page, '06-crea-tu-cuenta-google-primero');

  await google(page).click();
  await expect(tituloAlta(page)).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveCount(0);
  // Con el token retenido no se vuelve a pedir Google: se confirma con un botón.
  await expect(google(page)).toHaveCount(0);
  const crear = page.getByRole('button', { name: 'Crear mi cuenta', exact: true });
  // 🔴 Los datos llegan PRELLENADOS desde los claims: un toque en Google y la
  // persona sólo confirma.
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue('Ana');
  await expect(page.getByLabel('Apellido', { exact: true })).toHaveValue('Demo');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('ana.demo@payme.local');
  await expect(crear).toBeEnabled();
  // Sugerencia, no autoridad: sin nombre no se puede crear, y lo editado gana.
  await page.getByLabel('Nombre', { exact: true }).fill('');
  await expect(crear).toBeDisabled();
  await page.getByLabel('Nombre', { exact: true }).fill('Gala');
  await page.getByLabel('Apellido', { exact: true }).fill('Primero');
  await expect(page.getByLabel('Aviso de privacidad')).toBeVisible();
  // El aviso de «falta nombre» es del paso SIN token: acá no hay botón de
  // Google que esperar, y afirmarlo sería mentir sobre la pantalla.
  await expect(page.getByText('Escribe tu nombre y apellido aquí arriba para continuar con Google.')).toHaveCount(0);
  await expect(crear).toBeEnabled();
  await capturar(page, '07-confirmar-datos');
  await crear.click();

  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  const usuario = await page.evaluate(() => {
    const raw = localStorage.getItem('payme_app_session__mock');
    return raw ? (JSON.parse(raw) as { user?: { first_name?: string; last_name?: string } }).user ?? null : null;
  });
  expect(usuario).toMatchObject({ first_name: 'Gala', last_name: 'Primero' });
  const valores = await almacenado(page);
  expect(valores.some((v) => v.startsWith('payme_app_session__mock='))).toBe(true);
  expect(valores.filter((v) => v.includes(PREFIJO_TOKEN_MOCK))).toEqual([]);
});

test('persona EXISTENTE: toca Google en el ingreso y entra directo, sin pasar por el alta', async ({ page }) => {
  await preparar(page, { altaPublica: true, sinCuenta: false });
  await page.goto('/');
  await google(page).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect(tituloAlta(page)).toHaveCount(0);
});

test('alta CERRADA: el ingreso fallido deja el cartel neutro y no promete un alta', async ({ page }) => {
  await preparar(page, { altaPublica: false, sinCuenta: true });
  await page.goto('/');
  await google(page).click();

  await expect(page.getByRole('alert')).toHaveText(
    'No pudimos entrar con Google. Prueba de nuevo o entra con tu correo y contraseña.',
  );
  await capturar(page, '05-alta-cerrada');
  await expect(tituloAlta(page)).toHaveCount(0);
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  // El botón sigue ahí: se puede volver a intentar.
  await expect(google(page)).toBeVisible();
});

test('desde el paso de Google se puede volver al ingreso con correo', async ({ page }) => {
  await preparar(page, { altaPublica: true, sinCuenta: true });
  await page.goto('/');
  await google(page).click();
  await expect(tituloAlta(page)).toBeVisible();

  await page.getByRole('button', { name: 'Ya tengo cuenta → entrar', exact: true }).click();
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();

  // Y el alta normal, tocada a mano, vuelve completa: con contraseña.
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await expect(tituloAlta(page)).toHaveCount(0);
});
