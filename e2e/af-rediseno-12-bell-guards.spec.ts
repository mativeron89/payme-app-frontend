import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

test('Mis ítems conserva la campana táctil pero no abandona un pago congelado', async ({ page }) => {
  await ingresar(page);

  await page.evaluate(async (code) => {
    const modulePath = '/src/api/idempotency.ts';
    const journal = await import(modulePath) as {
      resolveMoneyActor: () => Promise<{ id: string }>;
      scopeForActor: (actor: { id: string }, raw: string) => string;
      acquireMonetaryIntent: (scope: string, operation: string) => Promise<{ key: string }>;
      prepareMonetaryRequest: (
        scope: string,
        operation: string,
        handle: { key: string },
        payload: { idempotency_key: string },
      ) => Promise<void>;
    };
    const actor = await journal.resolveMoneyActor();
    const scope = journal.scopeForActor(actor, `pay:${code}|bell-guard-probe`);
    const operation = `mesa_pay:${code}`;
    const handle = await journal.acquireMonetaryIntent(scope, operation);
    await journal.prepareMonetaryRequest(scope, operation, handle, { idempotency_key: handle.key });
  }, 'PA-3121');

  await page.goto('/#/mesa/PA-3121');
  await expect(page.getByText('Tienes un pago sin confirmar.')).toBeVisible();

  const url = page.url();
  const bell = page.getByRole('button', { name: 'Avisos', exact: true });
  await expect(bell).toBeEnabled();
  await bell.click();
  await expect(page.locator('.toast')).toHaveText('Termina este paso para abrir tus avisos.');
  expect(page.url()).toBe(url);
});
