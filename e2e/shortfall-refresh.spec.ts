import { expect, test } from '@playwright/test';

type HarnessWindow = Window & {
  __shortfallRefreshRequests?: () => number;
  __shortfallRefreshUnmount?: () => void;
};

test('rotar tokens durante el fetch conserva un solo toque y presenta el detalle', async ({ page }) => {
  await page.goto('/');
  const harnessPath = '/e2e/fixtures/shortfallRefreshHarness.ts';
  await page.evaluate(async (path) => {
    const harness = await import(/* @vite-ignore */ path) as {
      mountShortfallRefreshHarness(): void;
    };
    harness.mountShortfallRefreshHarness();
  }, harnessPath);

  await page.getByRole('button', { name: 'Quién no pagó' }).click();
  await expect(page.getByText('Luis Cárdenas')).toBeVisible();
  await expect(page.getByText('$130.00')).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => (window as HarnessWindow).__shortfallRefreshRequests?.() ?? -1,
  )).toBe(1);

  await page.evaluate(() => (window as HarnessWindow).__shortfallRefreshUnmount?.());
});
