import { expect, test } from '@playwright/test';

const SIGNUP = 'signup-token-aaaaaaaaaaaaaaaaaaaa';
const MESA = 'mesa-token-bbbbbbbbbbbbbbbbbbbbb';

test('D-FF-1 · sin autoridad no existe superficie de registro', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toHaveCount(0);
  await expect(page.getByText('¿No tienes cuenta? Regístrate')).toHaveCount(0);
});

test('D-FF-1 · fragmento→custodia→aviso→alta y limpieza', async ({ page }) => {
  await page.goto(`/#/home?signup_invitation=${SIGNUP}`);

  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByText('AVISO DE DEMOSTRACIÓN.')).toBeVisible();
  await expect(page.getByText('Versión 0.0.0-demo-local', { exact: false })).toBeVisible();

  await page.getByPlaceholder('Nombre').fill('Sofía');
  await page.getByPlaceholder('Apellido').fill('Prueba');
  await page.getByPlaceholder('Email').fill('sofia.ff@example.com');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1'))).toBeNull();
});

test('link combinado conserva autoridades separadas y respeta “Ya tengo cuenta”', async ({ page }) => {
  await page.goto(`/#/mesa/PA-2847?t=${MESA}&signup_invitation=${SIGNUP}`);

  // Las dos se custodian antes de mostrar la pantalla; ninguna queda en URL.
  await expect(page).toHaveURL(/#\/mesa\/PA-2847$/);
  await expect(page.getByRole('button', { name: 'Crear cuenta gratis', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toHaveCount(0);

  const custody = await page.evaluate(() => ({
    signup: sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1'),
    mesa: sessionStorage.getItem('payme_pending_invitation_link'),
  }));
  expect(custody.signup).toContain(SIGNUP);
  expect(custody.mesa).toContain(MESA);
});

test('una sesión activa también retira el raw antes de mostrar la ruta', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('mati@payme.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

  await page.goto(`/#/home?signup_invitation=${SIGNUP}`);
  await expect(page).toHaveURL(/#\/home$/);
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1'))).not.toBeNull();
});
