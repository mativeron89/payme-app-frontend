import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';

const redes = new WeakMap<BrowserContext, { blocked: string[]; requests: string[] }>();
test.beforeEach(async ({ context }) => {
  const censo = { blocked: [] as string[], requests: [] as string[] };
  redes.set(context, censo);
  context.on('request', (r) => censo.requests.push(`${r.method()} ${new URL(r.url()).origin}${new URL(r.url()).pathname}`));
  await context.routeWebSocket('**', async (socket) => {
    const u = new URL(socket.url());
    if (u.protocol === 'ws:' && u.host === 'localhost:5176' && u.pathname === '/') { socket.connectToServer(); return; }
    censo.blocked.push(`WS ${u.origin}${u.pathname}`);
    await socket.close();
  });
  await context.route('**/*', async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    if (u.origin === 'http://localhost:5176' && r.method() === 'GET' && !u.pathname.startsWith('/api/')
      && ['document', 'script', 'stylesheet', 'image', 'font', 'manifest'].includes(r.resourceType())) {
      await route.continue();
    } else {
      censo.blocked.push(`${r.method()} ${u.origin}${u.pathname}`);
      await route.abort('blockedbyclient');
    }
  });
});
test.afterEach(async ({ context }, info) => {
  const censo = redes.get(context);
  await info.attach('red-cerrada-alta', { body: Buffer.from(JSON.stringify(censo)), contentType: 'application/json' });
  expect(censo?.blocked).toEqual([]);
});

const SIGNUP = 'signup-token-aaaaaaaaaaaaaaaaaaaa';
const MESA = 'mesa-token-bbbbbbbbbbbbbbbbbbbbb';

test('AF12 · aviso owner Markdown, error/retry y alta por autoridad conservada', async ({ page }, info) => {
  const fixture = readFileSync(new URL('../src/components/LegalMarkdown.test.tsx', import.meta.url), 'utf8');
  const body = fixture.match(/const OWNER_BODY = `([\s\S]*?)`;/)?.[1];
  const expected = [...fixture.matchAll(/^  \['(h2|h3|p|li)', '([^']*)'\],$/gm)].map((m) => [m[1], m[2]]);
  expect(expected).toHaveLength(36);
  expect(body).toBeTruthy();
  const hash = createHash('sha256').update(body!).digest('hex');
  expect(hash).toBe('48425f2baabb23857c8bacbf643a08bf28410a85cff930fa0f74ba11b79ef35f');
  const legal = { kind: 'aviso_privacidad' as const, version: '2.4.1', hash, effective_from: '2026-09-01T00:00:00.000Z', body: body! };
  await page.goto('/');
  await expect(page.getByText('Entra a tu cuenta', { exact: true })).toBeVisible();
  // Fixture de fachada sólo en este navegador mock; NO modifica el mock ni
  // embebe un aviso productivo. La primera lectura falla honestamente.
  await page.evaluate(async (notice) => {
    const path = '/src/api/index.ts';
    const { api } = await import(path) as typeof import('../src/api');
    const response = Object.freeze({ legal_text: Object.freeze(notice) });
    let calls = 0;
    api.getPrivacyNotice = async () => {
      calls += 1;
      if (calls === 1) throw new Error('fixture-legal-no-disponible');
      return response;
    };
  }, legal);
  await page.evaluate((token) => { location.hash = `#/home?signup_invitation=${token}`; }, SIGNUP);
  await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await expect(page.locator('.legal-markdown')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  const doc = page.locator('.legal-notice .legal-markdown');
  await expect(doc.locator('h2')).toHaveText(['Aviso de privacidad']);
  await expect(doc.locator('h3')).toHaveCount(8);
  await expect(doc.locator('li')).toHaveCount(16);
  await expect(doc.locator('strong')).toHaveCount(25);
  await expect(doc.locator('em')).toHaveCount(1);
  expect(await doc.locator('h2,h3,p,li').evaluateAll((nodes) => nodes.map((el) => [
    el.tagName.toLowerCase(), el.textContent!.replace(/\s+/g, ' ').trim(),
  ]))).toEqual(expected);
  await expect(doc).toHaveAttribute('lang', 'es');
  await expect(page.locator('.legal-notice-meta')).toContainText('Versión 2.4.1');
  expect(await doc.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  await expect(page.locator('#splash')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('alta-legal-owner.png'), fullPage: true });
  const conservado = await page.evaluate(async () => {
    const path = '/src/api/index.ts';
    const { api } = await import(path) as typeof import('../src/api');
    return (await api.getPrivacyNotice()).legal_text;
  });
  expect(conservado).toEqual(legal);
  await page.getByPlaceholder('Nombre').fill('Sofía');
  await page.getByPlaceholder('Apellido').fill('Prueba');
  await page.getByPlaceholder('Email').fill('sofia.markdown@example.invalid');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  // La sesión se publica antes de que resuelva register y se libere la custodia.
  // Esperar el efecto concreto, como en el recorrido histórico, no sólo el home.
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('payme.app.mock.ff_signup_invitation.v1'))).toBeNull();
});

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
