import { expect, test } from '@playwright/test';

const SIGNUP = 'signup-token-aaaaaaaaaaaaaaaaaaaa';
const MESA = 'mesa-token-bbbbbbbbbbbbbbbbbbbbb';

test('D-FF-1 · sin autoridad no existe superficie de registro', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toHaveCount(0);
  // 🔴 REAPUNTADA el 2026-09-17 (APP-LOGIN-REDESIGN-AF-02) y NO porque se
  // pusiera roja: siguió VERDE. El rótulo de la puerta al registro pasó a
  // «Crea tu cuenta» (§4 del paquete), así que la frase vieja ya no existe en
  // ninguna parte y `toHaveCount(0)` era cierto sin mirar la pantalla. Un
  // negativo que no puede fallar no es una guarda. Se apunta al rótulo vigente
  // y por ROL, que además la distingue del título de la burbuja.
  await expect(page.getByRole('button', { name: 'Crea tu cuenta', exact: true })).toHaveCount(0);
});

test('D-FF-1 · fragmento→custodia→aviso→alta y limpieza', async ({ page }) => {
  await page.goto(`/#/home?signup_invitation=${SIGNUP}`);

  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByText('AVISO DE DEMOSTRACIÓN.')).toBeVisible();
  // AF-17 · la versión del aviso mock pasó a `0.0.0`: `0.0.0-demo-local` no
  // tenía la forma que el dueño acepta en `accepted_notice_version`.
  await expect(page.getByText('Versión 0.0.0 ·', { exact: false })).toBeVisible();

  await page.getByLabel('Nombre', { exact: true }).fill('Sofía');
  await page.getByLabel('Apellido', { exact: true }).fill('Prueba');
  await page.getByLabel('Email', { exact: true }).fill('sofia.ff@example.com');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
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
  // 🔴 EDITADA: antes afirmaba que «Crea tu cuenta» NO estaba, para decir «esta
  // pantalla está en login, no en registro». Con el rediseño esa frase es el
  // rótulo del enlace al alta, que en login SÍ aparece cuando hay invitación
  // —que es justo este caso—. La pregunta no cambia; cambia con qué se
  // responde: lo que no puede estar es el FORMULARIO de registro.
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Nombre', { exact: true })).toHaveCount(0);

  const custody = await page.evaluate(() => ({
    signup: sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1'),
    mesa: sessionStorage.getItem('payme_pending_invitation_link'),
  }));
  expect(custody.signup).toContain(SIGNUP);
  expect(custody.mesa).toContain(MESA);
});

test('una sesión activa también retira el raw antes de mostrar la ruta', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

  await page.goto(`/#/home?signup_invitation=${SIGNUP}`);
  await expect(page).toHaveURL(/#\/home$/);
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1'))).not.toBeNull();
});
