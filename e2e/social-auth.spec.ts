import { expect, test, type Page } from '@playwright/test';

const SIGNUP = 'signup-social-e2e-aaaaaaaaaaaaaaaaaaaa';
const RECOVERY_TOKEN = 'payme-mock-recovery-token-0000000000000001';

function externalRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost') requests.push(`${request.method()} ${url.origin}${url.pathname}`);
  });
  return requests;
}

async function openRegistration(page: Page): Promise<void> {
  await page.goto(`/#/home?signup_invitation=${SIGNUP}`);
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByText('AVISO DE DEMOSTRACIÓN.')).toBeVisible();
  await page.getByPlaceholder('Nombre').fill('Sofía');
  await page.getByPlaceholder('Apellido').fill('Social');
}

test('password sigue disponible y Google mock entra sin cargar terceros', async ({ page }) => {
  const external = externalRequests(page);
  await page.goto('/');

  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByPlaceholder('Contraseña')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

  expect(external).toEqual([]);
});

test('alta Google hereda invitación/nombres y la limpia sólo al persistir', async ({ page }) => {
  const external = externalRequests(page);
  await openRegistration(page);

  await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1')
  ))).toBeNull();
  const user = await page.evaluate(() => {
    const raw = localStorage.getItem('payme_app_session__mock');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { first_name?: string; last_name?: string } };
    return parsed.user ?? null;
  });
  expect(user).toMatchObject({ first_name: 'Sofía', last_name: 'Social' });
  expect(external).toEqual([]);
});

test('Facebook mock completa login sin URL/storage raw ni Meta', async ({ page }) => {
  const external = externalRequests(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar con Facebook', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/[?&](code|state)=/);
  expect(await page.evaluate(() => (
    sessionStorage.getItem('payme.app.mock.facebook_flow.v1')
  ))).toBeNull();
  expect(external).toEqual([]);
});

test('alta Facebook hereda datos y limpia su custodia sin abrir Meta', async ({ page }) => {
  const external = externalRequests(page);
  await openRegistration(page);
  await page.getByRole('button', { name: 'Continuar con Facebook', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1')
  ))).toBeNull();
  expect(await page.evaluate(() => (
    sessionStorage.getItem('payme.app.mock.facebook_flow.v1')
  ))).toBeNull();
  expect(external).toEqual([]);
});

test('recovery responde igual para cualquier correo y completa sin sesión previa', async ({ page }) => {
  const external = externalRequests(page);
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('no-existe@example.com');
  await page.getByRole('button', { name: '¿Olvidaste tu contraseña?', exact: true }).click();
  await expect(page.getByText(
    'Si existe una cuenta con ese correo, te enviaremos instrucciones.',
    { exact: true },
  )).toBeVisible();

  await page.evaluate((token) => { window.location.hash = `#/recovery?token=${token}`; }, RECOVERY_TOKEN);
  await expect(page).toHaveURL(/#\/recovery$/);
  await expect(page.getByRole('heading', { name: 'Crear una contraseña nueva' })).toBeVisible();
  await page.getByLabel('Contraseña', { exact: true }).fill('nueva-clave-segura');
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill('nueva-clave-segura');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Listo', { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test('recovery invalida una sesión previa antes de volver al ingreso', async ({ page }) => {
  const external = externalRequests(page);
  await page.goto('/');
  await page.getByPlaceholder('Email').fill('mati@payme.mx');
  await page.getByRole('button', { name: '¿Olvidaste tu contraseña?', exact: true }).click();
  await expect(page.getByText(
    'Si existe una cuenta con ese correo, te enviaremos instrucciones.',
    { exact: true },
  )).toBeVisible();
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();

  await page.evaluate((token) => { window.location.hash = `#/recovery?token=${token}`; }, RECOVERY_TOKEN);
  await page.getByLabel('Contraseña', { exact: true }).fill('otra-clave-segura');
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill('otra-clave-segura');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByText('Listo', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('payme_app_session__mock')))
    .toBeNull();
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});
