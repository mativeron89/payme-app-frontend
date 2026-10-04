import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * E174-3 · decisión 174 de Mati: «si alguien me invita a una mesa tiene que
 * aparecer la imagen de quién me invitó, si es que cargó imagen».
 *
 * Dueño v2.148.0: `invitation_received` suma `payload.has_inviter_avatar`, una
 * PISTA; la foto sale de `GET /notifications/{id}/inviter-avatar`, que decide
 * por sí misma (404 no oracular). El front pide sólo con la pista en `true`;
 * mientras carga, o con 404, iniciales. Usa el caché en memoria (decisión 175).
 *
 * Las notificaciones se cargan en el estado del mock de esta página. Fixture:
 * Sofía (`payme_mx_sofi`) tiene foto visible; María (`payme_mx_maru`) no.
 */
interface Espia { llamadas: Record<string, number>; colgar: boolean; pendientes: Array<() => void> }

const invitacion = (id: string, nombre: string, payme: string, pista: boolean | undefined) => ({
  id,
  type: 'invitation_received',
  title: 'Te invitaron a una mesa',
  body: `${nombre} te invitó a una mesa`,
  payload: {
    mesa_code: 'PA-7001',
    inviter_name: nombre,
    inviter_payme_id: payme,
    ...(pista === undefined ? {} : { has_inviter_avatar: pista }),
  },
  related_entity_type: 'invitation',
  related_entity_id: `inv-${id}`,
  read_at: '2026-10-04T10:00:00.000Z',
  created_at: '2026-10-04T09:00:00.000Z',
});

async function preparar(page: Page, filas: ReturnType<typeof invitacion>[]): Promise<void> {
  await ingresar(page);
  await page.evaluate(async (avisos) => {
    const rutaStore = '/src/api/mock/store.ts';
    const rutaApi = '/src/api/index.ts';
    const { state } = await import(/* @vite-ignore */ rutaStore) as { state: { notifications: unknown[] } };
    state.notifications = avisos;
    const { api } = await import(/* @vite-ignore */ rutaApi) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const w = window as unknown as { __invitador: Espia };
    w.__invitador = { llamadas: {}, colgar: false, pendientes: [] };
    const original = api.getInviterAvatar!.bind(api);
    api.getInviterAvatar = (...args: unknown[]) => {
      const id = args[0] as string;
      w.__invitador.llamadas[id] = (w.__invitador.llamadas[id] ?? 0) + 1;
      if (!w.__invitador.colgar) return original(...args);
      return new Promise((res, rej) => w.__invitador.pendientes.push(() => { original(...args).then(res, rej); }));
    };
  }, filas);
}

const espia = (page: Page) => page.evaluate(() => (window as unknown as { __invitador: Espia }).__invitador);
const colgar = (page: Page, valor: boolean) => page.evaluate((v) => {
  (window as unknown as { __invitador: Espia }).__invitador.colgar = v;
}, valor);
const soltar = (page: Page) => page.evaluate(() => {
  (window as unknown as { __invitador: Espia }).__invitador.pendientes.splice(0).forEach((f) => f());
});

const fila = (page: Page, nombre: string) => page.locator('.aviso-row').filter({ hasText: `${nombre} te invitó` });
const foto = (page: Page, nombre: string) => fila(page, nombre).locator('.aviso-invitador-foto');
const iniciales = (page: Page, nombre: string) => fila(page, nombre).locator('.avatar');

async function abrirAvisos(page: Page, cuantas: number): Promise<void> {
  await irEnLaApp(page, '/avisos');
  await expect(page.locator('.aviso-row')).toHaveCount(cuantas);
}

test.describe('E174-3 · la foto de quien invita', () => {
  test('🔴 con la pista en true y foto visible: la foto, pedida una sola vez', async ({ page }) => {
    await preparar(page, [invitacion('inv-sofi', 'Sofía Fernández', 'payme_mx_sofi', true)]);
    await abrirAvisos(page, 1);
    await expect(foto(page, 'Sofía Fernández')).toBeVisible();
    await expect(foto(page, 'Sofía Fernández')).toHaveAttribute('src', /^blob:/);
    expect((await espia(page)).llamadas).toEqual({ 'inv-sofi': 1 });
  });

  test('🔴 mientras carga: las iniciales de quien invita; al llegar, la foto', async ({ page }) => {
    await preparar(page, [invitacion('inv-sofi', 'Sofía Fernández', 'payme_mx_sofi', true)]);
    await colgar(page, true);
    await abrirAvisos(page, 1);
    await expect(iniciales(page, 'Sofía Fernández')).toBeVisible();
    await expect(iniciales(page, 'Sofía Fernández')).toHaveText('SF');
    await expect(foto(page, 'Sofía Fernández')).toHaveCount(0);
    await expect.poll(async () => (await espia(page)).pendientes.length).toBe(1);
    await soltar(page);
    await expect(foto(page, 'Sofía Fernández')).toBeVisible();
  });

  test('🔴 con la pista en true pero 404 (sin foto visible): quedan las iniciales', async ({ page }) => {
    await preparar(page, [invitacion('inv-maria', 'María Ruiz', 'payme_mx_maru', true)]);
    await abrirAvisos(page, 1);
    await expect.poll(async () => (await espia(page)).llamadas['inv-maria'] ?? 0).toBe(1);
    await expect(iniciales(page, 'María Ruiz')).toHaveText('MR');
    await expect(foto(page, 'María Ruiz')).toHaveCount(0);
  });

  test('🔴 sin la pista (notificación anterior a v2.148.0) o en false: ni un pedido, el ícono de siempre', async ({ page }) => {
    await preparar(page, [
      invitacion('inv-vieja', 'Sofía Fernández', 'payme_mx_sofi', undefined),
      invitacion('inv-falsa', 'Juan López', 'payme_mx_juan', false),
    ]);
    await abrirAvisos(page, 2);
    for (const nombre of ['Sofía Fernández', 'Juan López']) {
      await expect(fila(page, nombre).locator('svg').first()).toBeVisible();
      await expect(foto(page, nombre)).toHaveCount(0);
      await expect(iniciales(page, nombre)).toHaveCount(0);
    }
    expect((await espia(page)).llamadas).toEqual({});
  });

  test('🔴 al volver a Notificaciones la foto está al instante, mientras se revalida', async ({ page }) => {
    await preparar(page, [invitacion('inv-sofi', 'Sofía Fernández', 'payme_mx_sofi', true)]);
    await abrirAvisos(page, 1);
    await expect(foto(page, 'Sofía Fernández')).toBeVisible();
    const src = await foto(page, 'Sofía Fernández').getAttribute('src');

    await irEnLaApp(page, '/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await colgar(page, true);
    await abrirAvisos(page, 1);
    await expect(foto(page, 'Sofía Fernández')).toHaveAttribute('src', src!);
    await expect.poll(async () => (await espia(page)).llamadas['inv-sofi']).toBe(2);
    await soltar(page);
    await expect(foto(page, 'Sofía Fernández')).toHaveAttribute('src', src!);
  });

  test('borrar la notificación saca su foto de memoria', async ({ page }) => {
    await preparar(page, [invitacion('inv-sofi', 'Sofía Fernández', 'payme_mx_sofi', true)]);
    await abrirAvisos(page, 1);
    await expect(foto(page, 'Sofía Fernández')).toBeVisible();
    const src = await foto(page, 'Sofía Fernández').getAttribute('src');
    await fila(page, 'Sofía Fernández').getByRole('button', { name: 'Borrar notificación', exact: true }).click();
    await expect(page.locator('.aviso-row')).toHaveCount(0);
    expect(await page.evaluate((u) => fetch(u).then((r) => r.ok, () => false), src!)).toBe(false);
  });
});
