import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar } from '../_app';
import { vigilarCsp, violaciones } from './violaciones';

/**
 * n186 · la CSP de la app (en producción, Report-Only) aplicada como
 * OBLIGATORIA sobre el build mock (proyecto `csp-app`, `e2e/csp/servidor.mjs`).
 *
 * En el riel mock no se carga el GIS real ni Stripe.js: el login de Google y la
 * tarjeta son del mock. Por eso hay un caso aparte que demuestra, bajo la misma
 * política obligatoria, que los orígenes reales de Google y Stripe pasan (se
 * enrutan a stubs locales) y que un origen ajeno NO pasa.
 */
test.beforeEach(async ({ page }) => {
  await vigilarCsp(page);
});

test('control: la política está aplicada como OBLIGATORIA y bloquea un script inline', async ({ page }) => {
  const r = await page.goto('/');
  expect(r?.headers()['content-security-policy'], 'el documento no trae la CSP obligatoria').toContain("default-src 'self'");
  expect(r?.headers()['x-payme-csp-origen']).toBe('Content-Security-Policy-Report-Only');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  const ejecuto = await page.evaluate(async () => {
    const s = document.createElement('script');
    s.textContent = 'window.__inlineCorrio = true;';
    document.head.appendChild(s);
    await new Promise((r) => setTimeout(r, 50));
    return (window as unknown as { __inlineCorrio?: boolean }).__inlineCorrio === true;
  });
  expect(ejecuto, 'un script inline corrió: la CSP no está aplicada').toBe(false);
  expect((await violaciones(page)).map((v) => v.directiva)).toContain('script-src-elem');
});

test('ingreso con Google (mock) sin ninguna violación', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  expect(await violaciones(page)).toEqual([]);
});

test('abrir mesa con la tarjeta de garantía (y su 3DS) sin ninguna violación', async ({ page }) => {
  await ingresar(page);
  await abrirMesaConLink(page);
  // El splash usa el `<style>` inline: si su hash no coincidiera, habría violación.
  expect(await violaciones(page)).toEqual([]);
});

test('los orígenes reales de Google y Stripe pasan; uno ajeno no', async ({ page }) => {
  const stubJs = (marca: string) => ({ status: 200, contentType: 'text/javascript', body: `window.${marca}=true;` });
  const stubHtml = { status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' };
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill(stubJs('__gsi')));
  await page.route('https://js.stripe.com/v3/', (r) => r.fulfill(stubJs('__stripe')));
  await page.route('https://evil.example.test/x.js', (r) => r.fulfill(stubJs('__ajeno')));
  await page.route('https://js.stripe.com/v3/elements-inner-card.html', (r) => r.fulfill(stubHtml));
  await page.route('https://hooks.stripe.com/3d_secure', (r) => r.fulfill(stubHtml));
  await page.route('https://accounts.google.com/gsi/button', (r) => r.fulfill(stubHtml));
  await page.route('https://api.stripe.com/v1/ping', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();

  const r = await page.evaluate(async () => {
    const cargar = (src: string) => new Promise<boolean>((ok) => {
      const s = document.createElement('script');
      s.src = src; s.onload = () => ok(true); s.onerror = () => ok(false);
      document.head.appendChild(s);
    });
    const marco = (src: string) => { const f = document.createElement('iframe'); f.src = src; document.body.appendChild(f); };
    const gsi = await cargar('https://accounts.google.com/gsi/client');
    const stripe = await cargar('https://js.stripe.com/v3/');
    const ajeno = await cargar('https://evil.example.test/x.js');
    marco('https://js.stripe.com/v3/elements-inner-card.html');
    marco('https://hooks.stripe.com/3d_secure');
    marco('https://accounts.google.com/gsi/button');
    const api = await fetch('https://api.stripe.com/v1/ping').then((x) => x.ok).catch(() => false);
    await new Promise((res) => setTimeout(res, 300));
    return { gsi, stripe, ajeno, api };
  });
  expect(r).toEqual({ gsi: true, stripe: true, ajeno: false, api: true });
  // La ÚNICA violación es la del origen ajeno: los marcos y el fetch pasaron.
  expect(await violaciones(page)).toEqual([{ directiva: 'script-src-elem', bloqueado: 'https://evil.example.test/x.js' }]);
});
