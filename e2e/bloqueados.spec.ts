import { expect, test, type Page } from '@playwright/test';
import { omitirGuiaEnFixture, irEnLaApp } from './_app';

const textos = {
  es: { title: 'Bloqueados', empty: 'No bloqueaste a nadie', error: 'No pudimos cargar tus bloqueados', retry: 'Reintentar', unblock: 'Desbloquear a Juan López', back: 'Volver', confirm: '¿Desbloquear a Juan López? No vuelve sola a tus amigos, pero va a poder mandarte solicitudes de nuevo.', notice: 'Desbloqueaste a Juan López' },
  en: { title: 'Blocked people', empty: "You haven't blocked anyone", error: "We couldn't load your blocked people", retry: 'Retry', unblock: 'Unblock Juan López', back: 'Back', confirm: "Unblock Juan López? They won't be added back to your friends, but they'll be able to send you requests again.", notice: 'You unblocked Juan López' },
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
    // Personas inventadas; nombres y @ corresponden al directorio ficticio sembrado.
    state.friends = [
      { id: '11111111-1111-4111-8111-111111111111', payme_id: 'payme_mx_juan', first_name: 'Juan', last_name: 'López', full_name: 'Juan López', email: 'luna@example.invalid' },
      { id: '22222222-2222-4222-8222-222222222222', payme_id: 'payme_mx_sofi', first_name: 'Sofía', last_name: 'Fernández', full_name: 'Sofía Fernández', email: 'sol@example.invalid' },
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
  await irEnLaApp(page, '/mas');
}

async function captura(page: Page, nombre: string) {
  if (process.env.PAYME_E2E_CAPTURAS) await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/c189-${nombre}.png` });
}

for (const idioma of ['es', 'en'] as const) {
  const t = textos[idioma];
  test(`A1 lista mock con nombre y @ · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma);
    await captura(page, `${idioma}-configuracion`);
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await expect(page.getByRole('heading', { name: t.title, exact: true })).toBeFocused();
    await expect(page.getByText('Juan López', { exact: true })).toBeVisible();
    await expect(page.getByText('Sofía Fernández', { exact: true })).toBeVisible();
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
    await expect(page.getByText('Juan López', { exact: true })).toBeVisible();
    // Una respuesta nueva del dueño agrega un testigo que sólo aparece al recargar.
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta);
      const leer = api.getBlockedUsers;
      api.getBlockedUsers = async () => {
        const r = await leer();
        return { blocked: r.blocked.map((p: { full_name: string }) => ({ ...p, full_name: p.full_name === 'Sofía Fernández' ? 'Sol Recargado' : p.full_name })) };
      };
    });
    page.once('dialog', async (dialog) => { expect(dialog.message()).toBe(t.confirm); await dialog.accept(); });
    await page.getByRole('button', { name: t.unblock, exact: true }).click();
    await expect(page.locator('.toast')).toContainText(t.notice);
    await expect(page.getByText('Juan López', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Sol Recargado', { exact: true })).toBeVisible();
  });
  test(`foco de teclado tras desbloqueo fallido · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma);
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta);
      api.unblockUser = async () => { throw new Error('red-ficticia'); };
    });
    const button = page.getByRole('button', { name: t.unblock, exact: true });
    await button.focus();
    page.once('dialog', dialog => dialog.accept());
    await page.keyboard.press('Enter');
    await expect(page.locator('.toast')).toContainText(idioma === 'es' ? 'No pudimos desbloquear a Juan López' : "We couldn't unblock Juan López");
    await expect(page.getByRole('heading', { name: t.title, exact: true })).toBeFocused();
    await expect(page.getByText('Juan López', { exact: true })).toBeVisible();
  });
  test(`foco de teclado tras Reintentar fallido · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma, 'error');
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await page.getByRole('button', { name: t.retry, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toContainText(t.error);
    await expect(page.getByRole('heading', { name: t.title, exact: true })).toBeFocused();
  });
  test(`mock conserva bloqueados tras recarga · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma);
    await page.reload();
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await expect(page.getByText('Juan López', { exact: true })).toBeVisible();
    await expect(page.getByText('Sofía Fernández', { exact: true })).toBeVisible();
  });
  test(`404 block_not_found recarga la lista · ${idioma}`, async ({ page }) => {
    await preparar(page, idioma);
    await page.getByRole('button', { name: t.title, exact: true }).click();
    await expect(page.getByText('Juan López', { exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta);
      await api.unblockUser('11111111-1111-4111-8111-111111111111');
    });
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: t.unblock, exact: true }).click();
    await expect(page.getByText('Juan López', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Sofía Fernández', { exact: true })).toBeVisible();
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
for (const idioma of ['es', 'en'] as const) for (const width of [320, 390]) {
  test(`A6 ancho ${width} sin scroll horizontal · ${idioma}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await preparar(page, idioma);
    const entrada = page.getByRole('button', { name: textos[idioma].title, exact: true });
    await expect(entrada).toHaveClass('list-row');
    await expect(entrada.locator('svg')).toHaveCount(2);
    const anchoEntrada = await entrada.evaluate(el => el.getBoundingClientRect().width);
    const anchoHermana = await page.getByRole('button', { name: idioma === 'es' ? 'Notificaciones' : 'Notifications', exact: true }).evaluate(el => el.getBoundingClientRect().width);
    expect(anchoEntrada).toBe(anchoHermana);
    await entrada.click();
    await expect(page.getByText('Juan López', { exact: true })).toBeVisible();
    const fila = page.locator('li').filter({ hasText: 'Juan López' });
    expect(await fila.evaluate(el => getComputedStyle(el).gap)).toBe('12px');
    await expect(fila.locator('.fr-name .id')).toHaveText('@juan.lopez');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(await page.locator('.scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}
