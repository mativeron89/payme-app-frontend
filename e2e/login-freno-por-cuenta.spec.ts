import { expect, test, type Page } from '@playwright/test';

/**
 * AF-TEXTO-FRENO-LOGIN · decisión 128 de Mati: después de 5 contraseñas
 * equivocadas en una cuenta hay que esperar 15 minutos, y «¿Olvidaste tu
 * contraseña?» sigue funcionando. App Backend 2.144.0 responde
 * `429 {"error":"too_many_login_attempts"}`, sin cuerpo adicional.
 *
 * Antes de esta entrega ese código caía en el genérico «No pudimos conectar»,
 * que manda a reintentar justo cuando reintentar no sirve.
 *
 * - El texto propio, en español y en inglés.
 * - El formulario se comporta como con los demás errores del login: correo y
 *   contraseña quedan como estaban (medido el 29/09 con `invalid_credentials`,
 *   que tampoco vacía nada). «¿Olvidaste tu contraseña?» queda a la vista y
 *   habilitado, que es la salida que la decisión deja abierta.
 * - `too_many_auth_attempts` (el tope por conexión) conserva su «un minuto».
 *
 * `mockLogin` no rechaza nunca: se reemplaza `api.login` en la página por una
 * que rechaza con el `MockApiError` real, y la pantalla recorre su camino de
 * verdad (`onSubmit` → `extractApiError` → `ERROR_TEXT`). Mismo idioma que
 * `af-login-redesign-vista-previa.spec.ts`.
 */

const CORREO = 'mati@payme.mx';
const CLAVE = 'contrasena-equivocada';

async function loginRechaza(page: Page, status: number, codigo: string): Promise<void> {
  await page.evaluate(async ([s, code]) => {
    const modulo = await import(/* @vite-ignore */ '/src/api/index.ts');
    const { MockApiError } = await import(/* @vite-ignore */ '/src/api/mock/mockApi.ts');
    // La firma es `MockApiError(status, error)`, en ese orden.
    modulo.api.login = async () => { throw new MockApiError(s, code); };
  }, [status, codigo] as const);
}

async function intentarEntrar(page: Page, rotulos: { correo: string; clave: string; entrar: string }): Promise<void> {
  await page.getByLabel(rotulos.correo, { exact: true }).fill(CORREO);
  await page.getByLabel(rotulos.clave, { exact: true }).fill(CLAVE);
  await page.getByRole('button', { name: rotulos.entrar, exact: true }).click();
}

const ES = { correo: 'Email', clave: 'Contraseña', entrar: 'Entrar' };
const EN = { correo: 'Email', clave: 'Password', entrar: 'Log in' };

test.describe('AF-TEXTO-FRENO-LOGIN · el freno por cuenta tiene su texto', () => {
  test('🔴 429 too_many_login_attempts: su texto, correo y contraseña quedan y «¿Olvidaste…?» a la vista', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await loginRechaza(page, 429, 'too_many_login_attempts');
    await intentarEntrar(page, ES);

    await expect(page.locator('#login-error')).toHaveText('Demasiados intentos. Prueba de nuevo en unos minutos.');
    // Controles que discriminan: ni el genérico ni el tope por conexión.
    await expect(page.getByText('No pudimos conectar. Prueba de nuevo.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Demasiados intentos. Espera un minuto.', { exact: true })).toHaveCount(0);

    // Igual que `invalid_credentials`: el formulario no se toca.
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(CORREO);
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue(CLAVE);
    const olvido = page.getByRole('button', { name: '¿Olvidaste tu contraseña?', exact: true });
    await expect(olvido).toBeVisible();
    await expect(olvido).toBeEnabled();
  });

  test('🔴 en inglés: "Too many attempts. Try again in a few minutes."', async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('payme.app.idioma.v1', 'en'); } catch { /* sin storage el test cae, que es lo correcto */ }
    });
    await page.goto('/');
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await loginRechaza(page, 429, 'too_many_login_attempts');
    await intentarEntrar(page, EN);

    await expect(page.locator('#login-error')).toHaveText('Too many attempts. Try again in a few minutes.');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(CLAVE);
    await expect(page.getByRole('button', { name: 'Forgot your password?', exact: true })).toBeVisible();
  });

  test('coherencia: invalid_credentials deja el formulario igual que el freno por cuenta', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await loginRechaza(page, 401, 'invalid_credentials');
    await intentarEntrar(page, ES);

    await expect(page.locator('#login-error')).toHaveText('Email o contraseña incorrectos.');
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue(CORREO);
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue(CLAVE);
  });

  test('too_many_auth_attempts (tope por conexión) sigue con «Espera un minuto.»', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await loginRechaza(page, 429, 'too_many_auth_attempts');
    await intentarEntrar(page, ES);

    await expect(page.locator('#login-error')).toHaveText('Demasiados intentos. Espera un minuto.');
    await expect(page.getByText('Demasiados intentos. Prueba de nuevo en unos minutos.', { exact: true })).toHaveCount(0);
  });
});
