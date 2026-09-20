import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar } from './_app';
import { configurarTicketSinQr, estadoN179 } from './fixtures/ticket-sin-qr';

const CAPTURES_DIR = process.env.AF_N179_FEEDBACK_CAPTURES_DIR;

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function hastaConsumoDos(
  page: Page,
  options: { respuestaResolverInvalida?: boolean } = {},
): Promise<void> {
  await configurarTicketSinQr(page);
  await ingresar(page);
  if (options.respuestaResolverInvalida) {
    await page.evaluate(async () => {
      const storagePath = '/src/api/storage.ts';
      const storePath = '/src/api/mock/store.ts';
      const [{ loadSession }, { state, persist }] = await Promise.all([
        import(/* @vite-ignore */ storagePath),
        import(/* @vite-ignore */ storePath),
      ]);
      const session = loadSession();
      if (!session) throw new Error('fixture_requires_session');
      const byUser = state.restaurantResolutions[session.principal_id] ?? {};
      state.restaurantResolutions[session.principal_id] = byUser;
      byUser['rfc:TEG010101AB1'] = {
        id: 'respuesta-sintetica-invalida',
        name: 'Tacos El Güero',
        category: 'other',
        address: null,
      };
      persist();
    });
  }
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
  const sumar = page.getByRole('button', { name: 'Un comensal más' });
  await sumar.click();
  await sumar.click();
  await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?' })).toContainText('2');
  await expect(page.getByText('$840.00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('$420.00', { exact: true })).toBeVisible();
}

async function clickCentro(locator: Locator, page: Page): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
}

async function acreditarUnaMesa(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
  const state = await estadoN179(page);
  expect(state.mesas).toHaveLength(1);
  expect(state.mesaLedgerKeys).toHaveLength(1);
}

for (const target of ['círculo', 'rótulo', 'espacio intermedio'] as const) {
  test(`${target}: toda la affordance Continuar ejecuta una sola apertura`, async ({ page }) => {
    await hastaConsumoDos(page);
    const action = page.getByRole('button', { name: 'Continuar', exact: true });
    const circle = action.locator('.appbar-fab');
    const label = action.locator('.appbar-label');

    if (target === 'círculo') {
      await clickCentro(circle, page);
    } else if (target === 'rótulo') {
      await clickCentro(label, page);
    } else {
      const [actionBox, circleBox, labelBox] = await Promise.all([
        action.boundingBox(),
        circle.boundingBox(),
        label.boundingBox(),
      ]);
      expect(actionBox).not.toBeNull();
      expect(circleBox).not.toBeNull();
      expect(labelBox).not.toBeNull();
      const top = circleBox!.y + circleBox!.height;
      const bottom = labelBox!.y;
      expect(bottom, 'debe existir espacio táctil entre círculo y rótulo').toBeGreaterThan(top);
      const y = top + (bottom - top) / 2;
      expect(y).toBeGreaterThan(actionBox!.y);
      expect(y).toBeLessThan(actionBox!.y + actionBox!.height);
      await page.mouse.click(actionBox!.x + actionBox!.width / 2, y);
    }

    await acreditarUnaMesa(page);
  });
}

test('fuera de la celda central no inicia la apertura', async ({ page }) => {
  await hastaConsumoDos(page);
  await clickCentro(page.locator('.division-stepper-title'), page);
  await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
  const state = await estadoN179(page);
  expect(state.mesas).toHaveLength(0);
  expect(state.mesaLedgerKeys).toHaveLength(0);
});

test('doble toque conserva pending visible y una sola apertura', async ({ page }) => {
  await hastaConsumoDos(page);
  const action = page.getByRole('button', { name: 'Continuar', exact: true });
  await action.evaluate((node: HTMLButtonElement) => {
    node.click();
    node.click();
  });
  const pending = page.getByRole('button', { name: 'Continuando…', exact: true });
  await expect(pending).toBeDisabled();
  await expect(pending).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('[role="status"].note')).toHaveText('Continuando…');
  await acreditarUnaMesa(page);
});

test('fallo sintético de resolución restaura el CTA y deja error visible', async ({ page }, testInfo) => {
  await hastaConsumoDos(page, { respuestaResolverInvalida: true });
  await expect(page.getByRole('alert')).toHaveText('Este QR no corresponde a un restaurante disponible.');
  await page.evaluate(async () => {
    const apiPath = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ apiPath);
    const resolveOriginal = api.resolveRestaurant.bind(api);
    localStorage.setItem('payme.test.n179.resolve_calls', '0');
    api.resolveRestaurant = async (...args: Parameters<typeof resolveOriginal>) => {
      const calls = Number(localStorage.getItem('payme.test.n179.resolve_calls') ?? '0');
      localStorage.setItem('payme.test.n179.resolve_calls', String(calls + 1));
      return resolveOriginal(...args);
    };
  });

  await clickCentro(page.getByRole('button', { name: 'Continuar', exact: true }).locator('.appbar-label'), page);
  const pending = page.getByRole('button', { name: 'Continuando…', exact: true });
  await expect(pending).toBeDisabled();
  await expect(page.locator('[role="status"].note')).toHaveText('Continuando…');

  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Este QR no corresponde a un restaurante disponible.');
  const restored = page.getByRole('button', { name: 'Continuar', exact: true });
  await expect(restored).toBeEnabled();
  await expect(restored).not.toHaveAttribute('aria-busy', 'true');
  const state = await estadoN179(page);
  expect(state.mesas).toHaveLength(0);
  expect(state.mesaLedgerKeys).toHaveLength(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('payme.test.n179.resolve_calls')))
    .toBe('1');

  const capture = CAPTURES_DIR
    ? join(CAPTURES_DIR, 'continuar-resolve-error-390x844.png')
    : testInfo.outputPath('continuar-resolve-error-390x844.png');
  if (CAPTURES_DIR) mkdirSync(CAPTURES_DIR, { recursive: true });
  await page.screenshot({ path: capture, fullPage: true });
});
