import { expect, test, type Page } from '@playwright/test';
import { omitirGuiaEnFixture, irEnLaApp } from './_app';

const textos = {
  es: { title: 'Bloqueados', empty: 'No bloqueaste a nadie', error: 'No pudimos cargar tus bloqueados', retry: 'Reintentar', unblock: 'Desbloquear a Luna Prueba', back: 'Volver', confirm: '¿Desbloquear a Luna Prueba? Va a poder volver a mandarte solicitudes.', notice: 'Luna Prueba ya no está bloqueado' },
  en: { title: 'Blocked people', empty: "You haven't blocked anyone", error: "We couldn't load your blocked people", retry: 'Retry', unblock: 'Unblock Luna Prueba', back: 'Back', confirm: 'Unblock Luna Prueba? They will be able to send you requests again.', notice: 'Luna Prueba is no longer blocked' },
};

async function preparar(page: Page, idioma: 'es' | 'en', modo: 'lista' | 'vacio' | 'error' = 'lista') {
  await omitirGuiaEnFixture(page);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('fixture.c189@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('fixture-c189');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await page.evaluate(async ({ modo }) => {
    const ruta = '/src/api/index.ts';
    const api = (await import(/* @vite-ignore */ ruta)).api as Record<string, (...args: string[]) => Promise<unknown>>;
    const store = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ store);
    // Personas inventadas; ninguna captura depende del directorio sembrado.
    state.friends = [
      { id: '11111111-1111-4111-8111-111111111111', payme_id: 'payme_mx_juan', first_name: 'Luna', last_name: 'Prueba', full_name: 'Luna Prueba', email: 'luna@example.invalid' },
      { id: '22222222-2222-4222-8222-222222222222', payme_id: 'payme_mx_sofi', first_name: 'Sol', last_name: 'Ejemplo', full_name: 'Sol Ejemplo', email: 'sol@example.invalid' },
    ];
    if (modo === 'lista') {
      await api.blockUser!('11111111-1111-4111-8111-111111111111');
      await api.blockUser!('22222222-2222-4222-8222-222222222222');
    }
    if (modo === 'error') api.getBlockedUsers = async () => { throw new Error('red-ficticia'); };
  }, { idioma, modo });
  // El cambio usa el control del proveedor, sin recargar el mock en memoria.
  if (idioma === 'en') {
    await irEnLaApp(page, '/mas');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
  }
  await irEnLaApp(page, '/amigos');
}

async function captura(page: Page, nombre: string) {
  if (process.env.PAYME_E2E_CAPTURAS) await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/c189-${nombre}.png` });
}

for (const idioma of ['es', 'en'] as const) {
  const t = textos[idioma];
  test(`A1 lista mock con nombre y @ · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma);
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await expect(page.getByRole('heading', { name: t.title, exact: true })).toBeFocused();
    await expect(page.getByText('Luna Prueba', { exact: true })).toBeVisible();
    await expect(page.getByText('Sol Ejemplo', { exact: true })).toBeVisible();
    await expect(page.getByText('@juan.lopez', { exact: true })).toBeVisible();
    await expect(page.getByText('@sofi.fernandez', { exact: true })).toBeVisible();
    await captura(page, `${idioma}-lista`);
    await page.getByRole('button', { name: t.back, exact: true }).click();
    await expect(page.getByRole('button', { name: t.title, exact: true })).toBeFocused();
  });
  test(`A2 cancelar conserva, confirmar quita y recarga · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma);
    await page.getByRole('button', { name: t.title, exact: true }).click();
    page.once('dialog', async (dialog) => { expect(dialog.message()).toBe(t.confirm); await dialog.dismiss(); });
    await page.getByRole('button', { name: t.unblock, exact: true }).click();
    await expect(page.getByText('Luna Prueba', { exact: true })).toBeVisible();
    // Una respuesta nueva del dueño agrega un testigo que sólo aparece al recargar.
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta);
      const leer = api.getBlockedUsers;
      api.getBlockedUsers = async () => {
        const r = await leer();
        return { blocked: r.blocked.map((p: { full_name: string }) => ({ ...p, full_name: p.full_name === 'Sol Ejemplo' ? 'Sol Recargado' : p.full_name })) };
      };
    });
    page.once('dialog', async (dialog) => { expect(dialog.message()).toBe(t.confirm); await dialog.accept(); });
    await page.getByRole('button', { name: t.unblock, exact: true }).click();
    await expect(page.locator('.toast')).toContainText(t.notice);
    await expect(page.getByText('Luna Prueba', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Sol Recargado', { exact: true })).toBeVisible();
  });
  test(`A3 vacío · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma, 'vacio');
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await expect(page.getByText(t.empty, { exact: true })).toBeVisible();
    await captura(page, `${idioma}-vacio`);
  });
  test(`A4 error distinto de vacío y reintento · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma, 'error');
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(t.error);
    await expect(page.getByText(t.empty, { exact: true })).toHaveCount(0);
    await captura(page, `${idioma}-error`);
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta);
      api.getBlockedUsers = async () => ({ blocked: [] });
    });
    await page.getByRole('button', { name: t.retry, exact: true }).click();
    await expect(page.getByText(t.empty, { exact: true })).toBeVisible();
  });
}
for (const width of [320, 390]) {
  test(`A6 ancho ${width} sin scroll horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await preparar(page, 'es');
    await page.getByRole('button', { name: textos.es.title, exact: true }).click();
    await expect(page.getByText('Luna Prueba', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('.scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}
