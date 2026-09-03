import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * F2-03 (R105) · **el corte se declara donde se prueba, no se hereda.**
 *
 * Con Q6 resuelta el default del mock es `sandbox`: los pagos están vivos y la
 * superficie que este recorrido afirma ausente vuelve a existir. Por eso el modo
 * se fija ANTES del render, con el mismo seam que usa el resto de la suite.
 *
 * 🔴 **Es el ÚNICO cambio que la adenda F2-03 autoriza en este archivo.** No se
 * toca producto, ruta, copy, contrato ni la intención del spec: las aserciones
 * son exactamente las que ya estaban.
 */
async function conRielApagado(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

test('Mis ítems conserva la campana táctil pero no abandona un pago congelado', async ({ page }) => {
  await conRielApagado(page);
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
  // CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02) · el estado real se
  // avisa igual, pero sin prometer un reintento que la app ya no ofrece.
  await expect(page.getByRole('button', { name: 'Reintentar ese pago', exact: true })).toHaveCount(0);
  await expect(page.getByText('Puedes revisarlo en Mis pagos.')).toBeVisible();

  const url = page.url();
  const bell = page.getByRole('button', { name: 'Avisos', exact: true });
  await expect(bell).toBeEnabled();
  await bell.click();
  await expect(page.locator('.toast')).toHaveText('Termina este paso para abrir tus avisos.');
  expect(page.url()).toBe(url);
});
