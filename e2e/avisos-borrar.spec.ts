import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * E174-2 · decisión 174 de Mati: «tiene que haber una opción para borrar las
 * notificaciones». Eligió «Una por una y todas (Recomendada)»: cada una se
 * borra con un ícono, y arriba, junto a «Marcar leídos», «Borrar todas» pide
 * confirmación. Dueño v2.148.0: `DELETE /notifications/{id}` y
 * `DELETE /notifications`.
 *
 * Las notificaciones se cargan en el estado del mock de esta página (el mismo
 * módulo: la navegación es del mismo documento). Se cuentan las llamadas a la
 * fachada para ver que «Volver» no borra.
 */
const AVISOS = [
  { id: 'e174-a', body: 'Aviso A sin leer', read_at: null },
  { id: 'e174-b', body: 'Aviso B sin leer', read_at: null },
  { id: 'e174-c', body: 'Aviso C leído', read_at: '2026-10-04T10:00:00.000Z' },
];

async function preparar(page: Page): Promise<void> {
  await ingresar(page);
  await page.evaluate(async (avisos) => {
    const rutaStore = '/src/api/mock/store.ts';
    const rutaApi = '/src/api/index.ts';
    const { state } = await import(/* @vite-ignore */ rutaStore) as { state: { notifications: unknown[] } };
    state.notifications = avisos.map((a, i) => ({
      ...a, type: 'generic', title: null, payload: null,
      related_entity_type: null, related_entity_id: null,
      created_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
    }));
    const { api } = await import(/* @vite-ignore */ rutaApi) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const w = window as unknown as { __borrar: { una: number; todas: number; fallarTodas: boolean } };
    w.__borrar = { una: 0, todas: 0, fallarTodas: false };
    const una = api.deleteNotification!.bind(api);
    api.deleteNotification = (...a: unknown[]) => { w.__borrar.una += 1; return una(...a); };
    const todas = api.deleteAllNotifications!.bind(api);
    api.deleteAllNotifications = (...a: unknown[]) => {
      w.__borrar.todas += 1;
      if (w.__borrar.fallarTodas) return Promise.reject(new TypeError('Failed to fetch'));
      return todas(...a);
    };
  }, AVISOS);
}

const llamadas = (page: Page) => page.evaluate(
  () => (window as unknown as { __borrar: { una: number; todas: number } }).__borrar,
);

async function abrirAvisos(page: Page): Promise<void> {
  await irEnLaApp(page, '/avisos');
  await expect(page.getByRole('heading', { level: 1, name: 'Notificaciones', exact: true })).toBeVisible();
  await expect(page.locator('.aviso-row')).toHaveCount(AVISOS.length);
}

const fila = (page: Page, texto: string) => page.locator('.aviso-row').filter({ hasText: texto });
const borrarTodas = (page: Page) => page.getByRole('button', { name: 'Borrar todas', exact: true });
const hoja = (page: Page) => page.getByRole('dialog', { name: '¿Borrar todas las notificaciones?' });

test.describe('E174-2 · borrar notificaciones', () => {
  test('🔴 cada notificación tiene su papelera, con nombre y descripción para el lector; borra sólo esa y sin confirmar', async ({ page }) => {
    await preparar(page);
    await abrirAvisos(page);
    const papelera = fila(page, 'Aviso B sin leer').getByRole('button', { name: 'Borrar notificación', exact: true });
    await expect(papelera).toHaveAccessibleDescription('Aviso B sin leer');
    await papelera.click();
    await expect(hoja(page)).toHaveCount(0);
    await expect(fila(page, 'Aviso B sin leer')).toHaveCount(0);
    await expect(page.locator('.aviso-row')).toHaveCount(AVISOS.length - 1);
    await expect(fila(page, 'Aviso A sin leer')).toBeVisible();
    expect(await llamadas(page)).toEqual({ una: 1, todas: 0, fallarTodas: false });
  });

  test('si otra sesión ya la borró (404): sin error, la lista se relee y la fila se va', async ({ page }) => {
    await preparar(page);
    await abrirAvisos(page);
    // Se borra «por detrás», en el estado del mock, sin que la pantalla se entere.
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ ruta) as { state: { notifications: Array<{ id: string }> } };
      state.notifications = state.notifications.filter((n) => n.id !== 'e174-a');
    });
    await fila(page, 'Aviso A sin leer').getByRole('button', { name: 'Borrar notificación', exact: true }).click();
    await expect(fila(page, 'Aviso A sin leer')).toHaveCount(0);
    await expect(page.locator('.aviso-row')).toHaveCount(AVISOS.length - 1);
    await expect(page.getByText('No se pudo borrar la notificación')).toHaveCount(0);
  });

  test('🔴 con el teclado: foco en la papelera y Enter borra', async ({ page }) => {
    await preparar(page);
    await abrirAvisos(page);
    const papelera = fila(page, 'Aviso C leído').getByRole('button', { name: 'Borrar notificación', exact: true });
    await papelera.focus();
    await expect(papelera).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(fila(page, 'Aviso C leído')).toHaveCount(0);
    expect((await llamadas(page)).una).toBe(1);
  });

  test('🔴 «Borrar todas» va junto a «Marcar leídos» y pide confirmación: Volver y Escape no borran', async ({ page }) => {
    await preparar(page);
    await abrirAvisos(page);
    const acciones = page.locator('.avisos-actions');
    await expect(acciones.getByRole('button', { name: 'Marcar leídos', exact: true })).toBeVisible();
    await expect(acciones.getByRole('button', { name: 'Borrar todas', exact: true })).toBeVisible();

    await borrarTodas(page).click();
    await expect(hoja(page)).toBeVisible();
    // El foco entra a la hoja en «Volver», la salida segura.
    await expect(hoja(page).getByRole('button', { name: 'Volver', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(hoja(page)).toHaveCount(0);
    await expect(borrarTodas(page)).toBeFocused();

    await borrarTodas(page).click();
    await hoja(page).getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(hoja(page)).toHaveCount(0);
    await expect(page.locator('.aviso-row')).toHaveCount(AVISOS.length);
    expect((await llamadas(page)).todas).toBe(0);
  });

  test('🔴 confirmar borra todas, y el contador de no leídas de Inicio queda en cero', async ({ page }) => {
    await preparar(page);
    // Control positivo: antes de borrar, Inicio cuenta las dos sin leer.
    await irEnLaApp(page, '/avisos');
    await irEnLaApp(page, '/');
    await expect(page.locator('.hdr-badge')).toHaveText('2');

    await abrirAvisos(page);
    await borrarTodas(page).click();
    await hoja(page).getByRole('button', { name: 'Sí, borrar todas', exact: true }).click();
    await expect(hoja(page)).toHaveCount(0);
    await expect(page.locator('.aviso-row')).toHaveCount(0);
    await expect(borrarTodas(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Marcar leídos', exact: true })).toHaveCount(0);
    expect((await llamadas(page)).todas).toBe(1);

    await irEnLaApp(page, '/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(page.locator('.hdr-badge')).toHaveCount(0);
  });

  test('si «Borrar todas» falla: lo dice, no borra nada en pantalla y la hoja sigue abierta', async ({ page }) => {
    await preparar(page);
    await page.evaluate(() => {
      (window as unknown as { __borrar: { fallarTodas: boolean } }).__borrar.fallarTodas = true;
    });
    await abrirAvisos(page);
    await borrarTodas(page).click();
    await hoja(page).getByRole('button', { name: 'Sí, borrar todas', exact: true }).click();
    await expect(page.getByText('No se pudieron borrar las notificaciones')).toBeVisible();
    await expect(hoja(page)).toBeVisible();
    await expect(page.locator('.aviso-row')).toHaveCount(AVISOS.length);
  });

  test('la hoja avisa que las invitaciones de arriba no se borran, cuando las hay', async ({ page }) => {
    await preparar(page);
    await abrirAvisos(page);
    // El mock trae una invitación pendiente (la tarjeta «Te invitaron»).
    await expect(page.locator('.inv-card')).toHaveCount(1);
    await borrarTodas(page).click();
    await expect(hoja(page).getByText('Las invitaciones de arriba no se borran.')).toBeVisible();
    await hoja(page).getByRole('button', { name: 'Sí, borrar todas', exact: true }).click();
    await expect(page.locator('.aviso-row')).toHaveCount(0);
    await expect(page.locator('.inv-card')).toHaveCount(1);
  });
});
