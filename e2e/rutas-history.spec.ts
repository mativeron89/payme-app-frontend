import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * n130 · AF-HISTORY-N130 · rutas normales con History API, sin romper enlaces
 * viejos. Un caso por clase del censo de enlaces entrantes.
 *
 * 🔴 **Opción A, adenda del Bibliotecario:** los tres enlaces con secreto
 * (invitación `#/mesa/…?t=`, recuperación `#/recovery?token=`, `signup_invitation`)
 * se quedan en el fragmento. El token nunca pasa a path ni a query, y ningún
 * pedido lo lleva.
 */

/** Todos los pedidos que hace la página, para afirmar que ninguno lleva un secreto. */
function pedidos(page: Page): string[] {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  return urls;
}

/**
 * Todas las URLs por las que pasa la página: la inicial y cada `pushState` o
 * `replaceState`. Medir sólo al final no alcanza: la invitación se canjea y
 * navega antes de que el test mire.
 */
async function registrarUrls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __urls: string[] };
    w.__urls = [location.href];
    for (const metodo of ['pushState', 'replaceState'] as const) {
      const original = history[metodo].bind(history);
      history[metodo] = (estado: unknown, titulo: string, url?: string | URL | null) => {
        original(estado, titulo, url);
        w.__urls.push(location.href);
      };
    }
  });
}

/** ¿Alguna URL por la que pasó la página llevó el secreto en path o query? */
async function secretoFueraDelFragmento(page: Page, secreto: string): Promise<string[]> {
  const urls = await page.evaluate(() => (window as unknown as { __urls: string[] }).__urls);
  return urls.filter((u) => {
    const x = new URL(u);
    return `${x.pathname}${x.search}`.includes(secreto);
  });
}

const ruta = (page: Page) => page.evaluate(() => ({
  path: location.pathname,
  search: location.search,
  hash: location.hash,
}));

test.describe('n130 · rutas normales', () => {
  test('un deep link directo abre su pantalla y sobrevive a la recarga', async ({ page }) => {
    await ingresar(page);
    await page.goto('/mesas');
    await expect(page).toHaveURL(/:\d+\/mesas$/);
    await expect(page.getByRole('region', { name: 'Tus mesas' })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/:\d+\/mesas$/);
    await expect(page.getByRole('region', { name: 'Tus mesas' })).toBeVisible();

    await page.goto('/mesa/PA-2847');
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/:\d+\/mesa\/PA-2847$/);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
  });

  test('la navegación de la app crea entradas y Atrás vuelve', async ({ page }) => {
    await ingresar(page);
    await expect(page).toHaveURL(/:\d+\/(home)?$/);
    await page.getByRole('button', { name: 'Mesas', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/mesas$/);
    await page.goBack();
    await expect(page).toHaveURL(/:\d+\/(home)?$/);
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  });
});

test.describe('n130 · enlaces viejos con # y sin secreto → su ruta', () => {
  test('#/mesas pasa a /mesas con replaceState: Atrás no vuelve al #', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesas');
    await expect(page).toHaveURL(/:\d+\/mesas$/);
    expect((await ruta(page)).hash).toBe('');
    await expect(page.getByRole('region', { name: 'Tus mesas' })).toBeVisible();
    await page.goBack();
    expect(page.url()).not.toContain('#/mesas');
  });

  test('#/mesa/PA-2847 (un enlace de mesa guardado) pasa a /mesa/PA-2847', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    await expect(page).toHaveURL(/:\d+\/mesa\/PA-2847$/);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
  });

  test('el QR del restaurante: #/scan?r=… conserva su query en la ruta nueva', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/scan?r=rest-qr-1');
    await expect(page).toHaveURL(/:\d+\/scan\?r=rest-qr-1$/);
  });

  test('los avisos por correo enlazan a la raíz: abre la app', async ({ page }) => {
    await ingresar(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  });
});

test.describe('n130 · opción A · los enlaces con secreto se quedan en el fragmento', () => {
  test('la invitación a la mesa (#/mesa/…?t=): el token nunca va a path, query ni a un pedido', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await registrarUrls(page);
    const urls = pedidos(page);
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
    // La app la canjea y sigue a la mesa, ya sin el token en la URL.
    await expect.poll(async () => (await ruta(page)).path).toBe(`/mesa/${mesa.code}`);
    expect(page.url()).not.toContain(mesa.token);
    expect(await secretoFueraDelFragmento(page, mesa.token), 'el token pasó por path o query').toEqual([]);
    expect(urls.filter((u) => u.includes(mesa.token)), 'un pedido llevó el token').toEqual([]);
  });

  test('la recuperación de cuenta (#/recovery?token=): se queda en el fragmento y no sale en ningún pedido', async ({ page }) => {
    const token = ['payme', 'mock', 'recovery', 'token', '0000000000000001'].join('-');
    await registrarUrls(page);
    const urls = pedidos(page);
    await page.goto(`/#/recovery?token=${token}`);
    await expect.poll(async () => (await ruta(page)).hash).toBe('#/recovery');
    const r = await ruta(page);
    expect(r.path).toBe('/');
    expect(r.search).toBe('');
    expect(page.url()).not.toContain(token);
    expect(await secretoFueraDelFragmento(page, token)).toEqual([]);
    expect(urls.filter((u) => u.includes(token))).toEqual([]);
  });

  test('signup_invitation en el fragmento: se captura y no pasa a la query', async ({ page }) => {
    const invitacion = 'signup-token-cccccccccccccccccccc';
    await registrarUrls(page);
    const urls = pedidos(page);
    await page.goto(`/#/home?signup_invitation=${invitacion}`);
    await expect(page.getByText('Crea tu cuenta', { exact: true })).toBeVisible();
    const r = await ruta(page);
    expect(r.search).not.toContain(invitacion);
    expect(page.url()).not.toContain(invitacion);
    expect(await secretoFueraDelFragmento(page, invitacion)).toEqual([]);
    expect(urls.filter((u) => u.includes(invitacion))).toEqual([]);
  });
});
