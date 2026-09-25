import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

async function capturar(page: import('@playwright/test').Page, name: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${name}.png`, fullPage: true });
}

test.describe('U05 · foto entre amigos y acuse explícito', () => {
  test('Ahora no conserva toda la app y no persiste un acuse local', async ({ page }) => {
    await ingresar(page);
    const notice = page.getByLabel('Actualización del Aviso de Privacidad');
    await expect(notice).toBeVisible();
    await expect(notice.getByRole('link', { name: /Ver Aviso de Privacidad/ })).toHaveAttribute('href', '/privacy');
    await capturar(page, 'u05-aviso-foto-amigos');

    await notice.getByRole('button', { name: 'Ahora no', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    await expect(page.getByPlaceholder('Buscar entre tus amigos')).toBeVisible();
    await expect(page.getByLabel('Actualización del Aviso de Privacidad')).toHaveCount(0);

    const persisted = await page.evaluate(() => Object.entries(localStorage));
    expect(JSON.stringify(persisted)).not.toContain('avatar-notice');
    expect(JSON.stringify(persisted)).not.toContain('5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5');
  });

  test('Entendido acusa el texto mostrado; el acuse del lector no inventa fotos ajenas', async ({ page }) => {
    await ingresar(page);
    const notice = page.getByLabel('Actualización del Aviso de Privacidad');
    await expect(notice).toContainText('2.5.5');
    await notice.getByRole('button', { name: 'Entendido', exact: true }).click();
    await expect(notice).toHaveCount(0);

    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    const sofia = page.locator('.friend-row').filter({ hasText: 'Sofía Fernández' });
    const maria = page.locator('.friend-row').filter({ hasText: 'María Ruiz' });
    await expect(sofia.locator('.friend-avatar-image')).toBeVisible();
    await expect(sofia.locator('.friend-avatar-image')).toHaveAttribute('src', /^blob:/);
    // María no tiene una foto autorizada en el fixture. El acuse de quien la
    // mira no cambia eso: conserva el monograma y no aparece un <img>.
    await expect(maria.locator('.friend-avatar-image')).toHaveCount(0);
    await expect(maria.locator('.avatar')).toBeVisible();
    await capturar(page, 'u05-fotos-y-fallback');
  });

  /**
   * Adenda a AF-LISTO-INICIO (2026-09-24) · pin tolerante: el front acepta los
   * pares 2.5.5 y 3.0.0 con sus huellas exactas, y ningún otro. El riel mock
   * sigue sirviendo 2.5.5; acá el servidor (parchado en el módulo `api`) devuelve
   * el otro par válido o uno ajeno ANTES de entrar, que es cuando el cartel lee.
   */
  const HASH_300 = 'f5251653514f7616ac2700ebacee106b9fbaee48b4c42fda35708b28aa95f949';

  async function conServidorQueDevuelve(page: import('@playwright/test').Page, version: string, hash: string): Promise<void> {
    await page.goto('/');
    await page.evaluate(async ([v, h]) => {
      const route = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ route) as {
        api: Record<string, (...args: unknown[]) => Promise<unknown>>;
      };
      // El decodificador REAL sigue en el camino: es el pin que se prueba. Sólo
      // se sustituye lo que el servidor contesta.
      const pinRoute = '/src/api/friendAvatarNotice.ts';
      const pin = await import(/* @vite-ignore */ pinRoute) as { decodeFriendAvatarNotice: (raw: unknown) => unknown };
      const legal = await module.api.getPrivacyNotice() as { legal_text: Record<string, unknown> };
      module.api.getFriendAvatarNotice = async () => pin.decodeFriendAvatarNotice(
        { notice_version: v, notice_hash: h, acknowledged: false, acknowledged_at: null },
      );
      module.api.getPrivacyNotice = async () => ({ legal_text: { ...legal.legal_text, version: v, hash: h } });
      module.api.acknowledgeFriendAvatarNotice = async (body: unknown) => {
        localStorage.setItem('payme.app.e2e.u05.acuse', JSON.stringify(body));
        const b = body as { notice_version: string; notice_hash: string };
        return pin.decodeFriendAvatarNotice(
          { notice_version: b.notice_version, notice_hash: b.notice_hash, acknowledged: true, acknowledged_at: '2026-09-24T00:00:00.000Z' },
        );
      };
    }, [version, hash] as const);
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  }

  test('pin tolerante · con el par 3.0.0 el cartel se muestra y «Entendido» acusa ese par exacto', async ({ page }) => {
    await conServidorQueDevuelve(page, '3.0.0', HASH_300);
    const notice = page.getByLabel('Actualización del Aviso de Privacidad');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('3.0.0');
    await notice.getByRole('button', { name: 'Entendido', exact: true }).click();
    await expect(notice).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('payme.app.e2e.u05.acuse') ?? 'null')))
      .toEqual({ notice_version: '3.0.0', notice_hash: HASH_300 });
  });

  test('pin tolerante · un par ajeno o cruzado no muestra el cartel ni acusa nada (falla cerrado)', async ({ page }) => {
    await conServidorQueDevuelve(page, '3.0.0', '5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5');
    await expect(page.getByLabel('Actualización del Aviso de Privacidad')).toHaveCount(0);
    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    await expect(page.getByPlaceholder('Buscar entre tus amigos')).toBeVisible();
    await expect(page.getByLabel('Actualización del Aviso de Privacidad')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('payme.app.e2e.u05.acuse'))).toBeNull();
  });
});
