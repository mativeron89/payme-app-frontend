import { expect, test } from '@playwright/test';

interface ProfileRefreshStats {
  profileGets: number;
  avatarGets: number;
  mutations: number;
  firstName: string | null;
  lastName: string | null;
  avatarRevision: string | null;
}

type HarnessWindow = Window & {
  __profileRefreshResolveOldGets?: () => void;
  __profileRefreshStats?: () => ProfileRefreshStats;
  __profileRefreshUnmount?: () => void;
};

test('rotar tokens durante PATCH no abre GET stale ni revierte nombre o avatar', async ({ page }) => {
  await page.goto('/');
  const harnessPath = '/e2e/fixtures/profileRefreshHarness.ts';
  await page.evaluate(async (path) => {
    const harness = await import(/* @vite-ignore */ path) as {
      mountProfileRefreshHarness(): void;
    };
    harness.mountProfileRefreshHarness();
  }, harnessPath);

  await expect.poll(() => page.evaluate(
    () => (window as HarnessWindow).__profileRefreshStats?.().profileGets ?? -1,
  )).toBe(1);
  await page.getByRole('button', { name: 'Editar nombre' }).click();
  await page.getByLabel('Nombre').fill('Renata');
  await page.getByLabel('Apellido').fill('Nueva');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('Renata Nueva')).toBeVisible();

  // Resuelve cualquier GET viejo después del éxito: ninguno puede re-adoptarse.
  await page.evaluate(() => (window as HarnessWindow).__profileRefreshResolveOldGets?.());
  await expect(page.getByText('Renata Nueva')).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => (window as HarnessWindow).__profileRefreshStats?.() ?? null,
  )).toEqual({
    profileGets: 1,
    avatarGets: 2,
    mutations: 1,
    firstName: 'Renata',
    lastName: 'Nueva',
    avatarRevision: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  });

  await page.evaluate(() => (window as HarnessWindow).__profileRefreshUnmount?.());
});
