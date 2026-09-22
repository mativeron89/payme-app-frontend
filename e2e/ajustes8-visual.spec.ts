import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

async function capturar(page: Page, name: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function claimsDelItem(page: Page, code: string, name: string): Promise<number> {
  return page.evaluate(async ([mesaCode, itemName]) => {
    const storePath = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; items: Array<{ name: string; claims: unknown[] }> }> };
    };
    const mesa = store.state.mesas.find((candidate) => candidate.code === mesaCode);
    const item = mesa?.items.find((candidate) => candidate.name === itemName);
    if (!item) throw new Error(`item ${itemName} ausente en ${mesaCode}`);
    return item.claims.length;
  }, [code, name] as const);
}

test.describe('AF-AJUSTES8 · correcciones visuales y acto explícito', () => {
  test('V01/V02 · marca, nombre y tres pestañas conservan una geometría estable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await ingresar(page);

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    const widths = await tabs.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    const tabsWithoutClipping = await tabs.evaluateAll((nodes) => nodes.every((node) => node.scrollWidth <= node.clientWidth));
    expect(tabsWithoutClipping).toBe(true);

    const [logoBox, userBox] = await Promise.all([
      page.locator('.hdr-mark').boundingBox(),
      page.locator('.hdr-user').boundingBox(),
    ]);
    // Decisión de Mati del 22/09 (AF-HEADER-WEBKIT, iteración 2): el nombre va
    // deliberadamente por debajo del centro del lockup, exactamente la constante
    // `--hdr-user-nudge` (3 px). La guarda ya no exige cajas centradas: exige que
    // lo único que las separe sea esa constante.
    const nudge = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hdr-user-nudge')));
    expect(nudge).toBe(3);
    expect(Math.abs(
      (((userBox?.y ?? 0) + (userBox?.height ?? 0) / 2) - ((logoBox?.y ?? 0) + (logoBox?.height ?? 0) / 2)) - nudge,
    )).toBeLessThanOrEqual(1);

    const cuentaHeight = await page.locator('.home-tab-panel').evaluate((node) => node.getBoundingClientRect().height);
    await capturar(page, 'v01-v02-cuenta-mobile');

    const longName = 'Alejandra Fernanda Rodríguez Hernández de la Fuente';
    await page.evaluate((name) => {
      const key = 'payme_app_session__mock';
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error('sesión mock ausente');
      const session = JSON.parse(raw) as { user?: { first_name: string; last_name: string } };
      if (!session.user) throw new Error('usuario de sesión ausente');
      session.user.first_name = name;
      session.user.last_name = '';
      localStorage.setItem(key, JSON.stringify(session));
    }, longName);
    await page.reload();
    const longUser = page.locator('.hdr-user');
    await expect(longUser).toHaveText(longName);
    const [longUserBox, bellBox, isEllipsized] = await Promise.all([
      longUser.boundingBox(),
      page.getByRole('button', { name: 'Avisos' }).boundingBox(),
      longUser.evaluate((node) => node.scrollWidth > node.clientWidth),
    ]);
    expect(isEllipsized).toBe(true);
    expect((longUserBox?.x ?? 0) + (longUserBox?.width ?? 0)).toBeLessThanOrEqual(bellBox?.x ?? 0);
    await capturar(page, 'v01-nombre-largo-375');

    await page.getByRole('tab', { name: 'Asociadas' }).click();
    const asociadasHeight = await page.locator('.home-tab-panel').evaluate((node) => node.getBoundingClientRect().height);
    expect(Math.abs(cuentaHeight - asociadasHeight)).toBeLessThanOrEqual(1);
    await capturar(page, 'v01-v02-asociadas-mobile');

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.getByRole('tab', { name: 'Asociadas' })).toBeVisible();
    await capturar(page, 'v01-v02-asociadas-desktop');
  });

  test('V03/V05 · el último consumo se marca localmente y sólo Listo lo registra', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });

    await page.evaluate(async (code) => {
      const storePath = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; items: Array<{ name: string; status?: string; price_cents: number; quantity: number; claims: unknown[] }> }> };
      };
      const target = store.state.mesas.find((candidate) => candidate.code === code);
      if (!target) throw new Error(`mesa ${code} ausente en el mock`);
      for (const item of target.items) {
        if (item.name === 'Tagliatelle Bolognese') {
          item.claims = [];
          item.status = 'available';
        } else {
          item.claims = [{
            who: 'guest',
            fraction_bps: 10000,
            amount_cents: item.price_cents * item.quantity,
            status: 'locked',
          }];
          item.status = 'locked';
        }
      }
    }, mesa.code);

    await page.goto('/#/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await page.goto(`/#/mesa/${mesa.code}`);

    const [titleBox, itemsBox] = await Promise.all([
      page.locator('.mesa-selection-title').boundingBox(),
      page.locator('.mesa-selection-scroll .card').first().boundingBox(),
    ]);
    expect((itemsBox?.y ?? 0) - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0))).toBeGreaterThanOrEqual(16);

    const item = page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true });
    expect(await claimsDelItem(page, mesa.code, 'Tagliatelle Bolognese')).toBe(0);
    await item.click();
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    expect(await claimsDelItem(page, mesa.code, 'Tagliatelle Bolognese')).toBe(0);
    await expect(page.getByRole('dialog', { name: /Con esto se cierra la mesa/ })).toHaveCount(0);
    await expect(page.getByText('Tomado', { exact: true })).toHaveCount(0);
    await capturar(page, 'v03-v05-ultimo-consumo-seleccionado');

    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => claimsDelItem(page, mesa.code, 'Tagliatelle Bolognese')).toBe(1);
  });

  test('V08 · historial separa título, tarjetas blancas y detalle neutro', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro'));
    await ingresar(page);
    await page.goto('/#/mesas');

    const first = page.locator('.hist-item').first();
    const [titleBox, firstBox] = await Promise.all([
      page.locator('.title-card').boundingBox(),
      first.boundingBox(),
    ]);
    expect((firstBox?.y ?? 0) - ((titleBox?.y ?? 0) + (titleBox?.height ?? 0))).toBeGreaterThanOrEqual(16);
    await expect(first).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await capturar(page, 'v08-historial-cerrado');

    const expandable = page.locator('.hist-row[aria-expanded]').first();
    await expandable.click();
    await expect(expandable).toHaveAttribute('aria-expanded', 'true');
    await expect(expandable).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(expandable.locator('.hist-chevron')).toHaveCSS('transform', 'matrix(-1, 0, 0, -1, 0, 0)');
    const detail = expandable.locator('xpath=..').locator('.hist-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toHaveCSS('background-color', 'rgb(248, 250, 252)');
    await expect(detail).toHaveCSS('border-top-style', 'solid');
    await capturar(page, 'v08-historial-abierto');
  });
});
