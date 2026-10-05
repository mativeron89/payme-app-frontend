import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * E174-3B · decisión 174 de Mati: «si alguien me invita a una mesa tiene que
 * aparecer la imagen de quién me invitó, si es que cargó imagen». Eso se ve sobre
 * todo en la tarjeta «Te invitaron» de Notificaciones y en la burbuja de Inicio,
 * que salen de `GET /invitations`. Dueño v2.149.0: `has_inviter_avatar` (pista)
 * y `GET /invitations/{id}/inviter-avatar` (decide, 404 no oracular).
 *
 * Seed del mock: la invitación pendiente es de Sofía, que tiene foto visible.
 * Se espía la fachada en la página: cuántas veces se pide cada foto, y si se
 * cuelga hasta que el test la suelte.
 */
interface Espia { llamadas: Record<string, number>; colgar: boolean; pendientes: Array<() => void> }

async function espiar(page: Page, opciones: { pistaForzada?: boolean; invitadorDe?: string } = {}): Promise<void> {
  await page.evaluate(async ({ pistaForzada, invitadorDe }) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    if (invitadorDe) {
      const rutaStore = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ rutaStore) as {
        state: { pendingInvitations: Array<Record<string, unknown>> };
      };
      state.pendingInvitations = state.pendingInvitations.map((i) => ({ ...i, inviter_payme_id: invitadorDe }));
    }
    if (pistaForzada !== undefined) {
      const traer = api.getPendingInvitations!.bind(api);
      api.getPendingInvitations = async () => {
        const r = await traer() as { invitations: Array<Record<string, unknown>> };
        return { invitations: r.invitations.map((i) => ({ ...i, has_inviter_avatar: pistaForzada })) };
      };
    }
    const w = window as unknown as { __inv: Espia };
    w.__inv = { llamadas: {}, colgar: false, pendientes: [] };
    const original = api.getInvitationInviterAvatar!.bind(api);
    api.getInvitationInviterAvatar = (...args: unknown[]) => {
      const id = args[0] as string;
      w.__inv.llamadas[id] = (w.__inv.llamadas[id] ?? 0) + 1;
      if (!w.__inv.colgar) return original(...args);
      return new Promise((res, rej) => w.__inv.pendientes.push(() => { original(...args).then(res, rej); }));
    };
  }, opciones);
}

const espia = (page: Page) => page.evaluate(() => (window as unknown as { __inv: Espia }).__inv);
const totalPedidos = async (page: Page) => Object.values((await espia(page)).llamadas).reduce((a, b) => a + b, 0);
const colgar = (page: Page, v: boolean) => page.evaluate((x) => { (window as unknown as { __inv: Espia }).__inv.colgar = x; }, v);
const soltar = (page: Page) => page.evaluate(() => {
  (window as unknown as { __inv: Espia }).__inv.pendientes.splice(0).forEach((f) => f());
});

const tarjeta = (page: Page) => page.locator('.inv-card').first();
const burbuja = (page: Page) => page.locator('.mesa-card[data-invitacion]').first();

async function abrirAvisos(page: Page): Promise<void> {
  await irEnLaApp(page, '/avisos');
  await expect(tarjeta(page)).toBeVisible();
}

test.describe('E174-3B · la foto de quien invita en las invitaciones', () => {
  test('🔴 «Te invitaron»: con la pista y foto visible, la foto en lugar del ícono del restaurante', async ({ page }) => {
    await ingresar(page);
    await espiar(page);
    await abrirAvisos(page);
    await expect(tarjeta(page).locator('.foto-quien-invita')).toBeVisible();
    await expect(tarjeta(page).locator('.foto-quien-invita')).toHaveAttribute('src', /^blob:/);
    await expect(tarjeta(page).locator('[data-icono]')).toHaveCount(0);
    expect(await totalPedidos(page)).toBe(1);
  });

  test('🔴 sin la pista (dueño anterior o sin foto): el ícono de siempre y ni un pedido', async ({ page }) => {
    await ingresar(page);
    await espiar(page, { pistaForzada: false });
    await abrirAvisos(page);
    await expect(tarjeta(page).locator('[data-icono]')).toHaveCount(1);
    await expect(tarjeta(page).locator('.foto-quien-invita, .avatar')).toHaveCount(0);
    expect(await totalPedidos(page)).toBe(0);
  });

  test('🔴 con la pista pero 404 (la ruta decide): las iniciales de quien invita', async ({ page }) => {
    await ingresar(page);
    // La pista dice true, pero quien invita no tiene foto visible: la ruta da 404.
    await espiar(page, { pistaForzada: true, invitadorDe: 'payme_mx_maru' });
    await abrirAvisos(page);
    await expect.poll(() => totalPedidos(page)).toBe(1);
    await expect(tarjeta(page).locator('.avatar')).toBeVisible();
    await expect(tarjeta(page).locator('.foto-quien-invita')).toHaveCount(0);
  });

  test('mientras carga, las iniciales; al llegar, la foto', async ({ page }) => {
    await ingresar(page);
    await espiar(page);
    await colgar(page, true);
    await abrirAvisos(page);
    await expect(tarjeta(page).locator('.avatar')).toBeVisible();
    await expect.poll(async () => (await espia(page)).pendientes.length).toBe(1);
    await soltar(page);
    await expect(tarjeta(page).locator('.foto-quien-invita')).toBeVisible();
  });

  test('🔴 la burbuja de Inicio también la muestra, y al volver está al instante (memoria de la sesión)', async ({ page }) => {
    await ingresar(page);
    await espiar(page);
    // Inicio ya se montó antes del espía: se vuelve a entrar para que pida.
    await abrirAvisos(page);
    await expect(tarjeta(page).locator('.foto-quien-invita')).toBeVisible();
    const src = await tarjeta(page).locator('.foto-quien-invita').getAttribute('src');

    await colgar(page, true);
    await irEnLaApp(page, '/');
    await expect(burbuja(page)).toBeVisible();
    const foto = burbuja(page).locator('.mesa-top-quien .foto-quien-invita');
    // La misma URL que en Avisos, mientras la revalidación sigue colgada.
    await expect(foto).toHaveAttribute('src', src!);
    await expect(burbuja(page).locator('.mesa-kicker')).toHaveText('Sofía te invitó a');
    await soltar(page);
    await expect(foto).toHaveAttribute('src', src!);
  });
});
