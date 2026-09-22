import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

async function sembrarDosAvisos(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const storePath = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ storePath) as {
      state: { notifications: Array<Record<string, unknown>> };
    };
    state.notifications = [
      {
        id: 'm04-a', type: 'mesa_expired', title: null,
        body: 'La mesa PA-1099 se cerró.', payload: { mesa_code: 'PA-1099' },
        related_entity_type: 'mesa', related_entity_id: null, read_at: null,
        created_at: '2026-09-21T12:00:00.000Z',
      },
      {
        id: 'm04-b', type: 'mesa_shortfall_charged', title: null,
        body: 'Segundo aviso sin leer.', payload: null,
        related_entity_type: null, related_entity_id: null, read_at: null,
        created_at: '2026-09-21T11:00:00.000Z',
      },
    ];
  });
}

test.describe('M01/M04 · verificación móvil sintética', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
  });

  test('N=2 distribuye dos opciones y preserva las seis implementadas en igualdad', async ({ page }) => {
    await page.evaluate(async () => {
      const storePath = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; original_participants?: number; guarantee_mode?: boolean; status?: string }> };
      };
      const mesa = state.mesas.find((candidate) => candidate.code === 'PA-2847');
      if (!mesa) throw new Error('PA-2847 ausente');
      mesa.original_participants = 2;
      // Listo v2 (Decisión 7, `e0c4889`/`903b6a8`): con el riel apagado las filas
      // de una mesa en igual sólo se editan si el dueño publica `supported` y
      // `mutable`, y eso exige igual SIN garantía y mesa `open` (`capability` en
      // `contract-mirror/services/informativeSelections.js`; el mock lo refleja).
      // PA-3121 nace garantizada y `partially_paid` —un estado que bajo el corte
      // no existe— así que acá se la deja como nace en producción con los pagos
      // apagados. PA-2847 es `consumo` y no pasa por la capability.
      const igual = state.mesas.find((candidate) => candidate.code === 'PA-3121');
      if (!igual) throw new Error('PA-3121 ausente');
      igual.guarantee_mode = false;
      igual.status = 'open';
    });
    await page.goto('/#/mesa/PA-2847');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();

    const consumo = page.getByRole('radiogroup', { name: '¿Cuánto tomas tú?' });
    await expect(consumo.getByRole('radio')).toHaveCount(2);
    const widths = await consumo.getByRole('radio').evaluateAll((nodes) => (
      nodes.map((node) => node.getBoundingClientRect().width)
    ));
    expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThanOrEqual(1);
    expect(Math.min(...widths)).toBeGreaterThan(100);
    await expect(page.locator('.mesa-selection-title')).toContainText('La Parolaccia / PA-2847');
    await capturar(page, 'm01-consumo-n2');

    await page.goto('/#/mesa/PA-3121');
    await page.getByRole('button', { name: 'Omakase para dos', exact: true }).click();
    await expect(page.getByRole('radiogroup', { name: '¿Cuánto tomas tú?' }).getByRole('radio')).toHaveCount(6);
    await capturar(page, 'm01-igual-seis');
  });

  test('cabecera y Avisos conservan alineación, aire y contexto restaurante / ID', async ({ page }) => {
    const [logo, user] = await Promise.all([
      page.locator('.hdr-mark').boundingBox(),
      page.locator('.hdr-user').boundingBox(),
    ]);
    expect(Math.abs(
      ((logo?.y ?? 0) + (logo?.height ?? 0) / 2)
      - ((user?.y ?? 0) + (user?.height ?? 0) / 2),
    )).toBeLessThanOrEqual(2);

    await page.getByRole('button', { name: 'Avisos' }).click();
    const [title, firstContent] = await Promise.all([
      page.locator('.avisos-title-card').boundingBox(),
      page.locator('.avisos-scroll > *').first().boundingBox(),
    ]);
    const contentGap = (firstContent?.y ?? 0) - ((title?.y ?? 0) + (title?.height ?? 0));
    expect(contentGap).toBeGreaterThanOrEqual(16);
    expect(contentGap).toBeLessThanOrEqual(32);
    await expect(page.getByText('Hanzo Sushi / PA-4520', { exact: true })).toBeVisible();
    await capturar(page, 'm04-avisos');
  });

  test('abrir un aviso confirma sólo esa lectura antes de navegar', async ({ page }) => {
    await sembrarDosAvisos(page);
    await page.getByRole('button', { name: 'Avisos' }).click();
    await page.getByRole('button', { name: /La mesa PA-1099 se cerró/ }).click();
    await expect(page).toHaveURL(/#\/mesa\/PA-1099$/);
    const reads = await page.evaluate(async () => {
      const storePath = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ storePath) as {
        state: { notifications: Array<{ id: string; read_at: string | null }> };
      };
      return state.notifications.map(({ id, read_at }) => ({ id, read_at }));
    });
    expect(reads.find(({ id }) => id === 'm04-a')?.read_at).not.toBeNull();
    expect(reads.find(({ id }) => id === 'm04-b')?.read_at).toBeNull();
  });

  test('un error conserva la fila sin leer, muestra feedback y no navega', async ({ page }) => {
    await sembrarDosAvisos(page);
    await page.evaluate(async () => {
      const apiPath = '/src/api/index.ts';
      const mockPath = '/src/api/mock/mockApi.ts';
      const [{ api }, { MockApiError }] = await Promise.all([
        import(/* @vite-ignore */ apiPath),
        import(/* @vite-ignore */ mockPath),
      ]);
      api.markNotificationRead = async () => { throw new MockApiError(500, 'internal_error'); };
    });
    await page.getByRole('button', { name: 'Avisos' }).click();
    await page.getByRole('button', { name: /La mesa PA-1099 se cerró/ }).click();
    await expect(page.getByText('No se pudo marcar como leído', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#\/avisos$/);
    await expect(page.getByRole('button', { name: /La mesa PA-1099 se cerró/ }).locator('.aviso-dot')).not.toHaveClass(/off/);
  });

  test('un 404 stale sólo navega tras releer la misma fila ya leída', async ({ page }) => {
    await sembrarDosAvisos(page);
    await page.evaluate(async () => {
      const apiPath = '/src/api/index.ts';
      const mockPath = '/src/api/mock/mockApi.ts';
      const storePath = '/src/api/mock/store.ts';
      const [{ api }, { MockApiError }, { state }] = await Promise.all([
        import(/* @vite-ignore */ apiPath),
        import(/* @vite-ignore */ mockPath),
        import(/* @vite-ignore */ storePath),
      ]);
      api.markNotificationRead = async (id: string) => {
        const row = state.notifications.find((notification: { id: string }) => notification.id === id);
        if (row) row.read_at = new Date().toISOString();
        throw new MockApiError(404, 'notification_not_found_or_already_read');
      };
    });
    await page.getByRole('button', { name: 'Avisos' }).click();
    await page.getByRole('button', { name: /La mesa PA-1099 se cerró/ }).click();
    await expect(page).toHaveURL(/#\/mesa\/PA-1099$/);
    await expect(page.getByText('No se pudo marcar como leído', { exact: true })).toHaveCount(0);
  });
});
