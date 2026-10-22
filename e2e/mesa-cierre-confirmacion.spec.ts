import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';
import { enTuMesaConLaLista } from './_mesa';

// Riel mock completo. La fachada no se sustituye; inspección sólo de datos sintéticos.
async function preparar(page: Page, mode: 'consumo' | 'igual') {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: mode });
  await page.goto(`/mesa/${mesa.code}`); await enTuMesaConLaLista(page);
  return mesa.code;
}
async function elegirTodo(page: Page) {
  const rows = page.locator('.qc-renglon'); const count = await rows.count(); expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) await rows.nth(index).locator('.qc-libre').click();
}
async function persistido(page: Page, code: string) {
  return page.evaluate(async (code) => {
    const path = '/src/api/mock/store.ts'; const { state } = await import(/* @vite-ignore */ path) as typeof import('../src/api/mock/store');
    const mesa = state.mesas.find((m) => m.code === code); if (!mesa) throw new Error('fixture sin mesa');
    return { status: mesa.status, claims: mesa.items.map((i) => i.claims),
      own: Object.entries(state.informativeSelections).filter(([k]) => k.startsWith(`${mesa.id}:`)) };
  }, code);
}
for (const mode of ['consumo', 'igual'] as const) {
  test(`n422 ${mode}: Revisar cancela sin persistencia; cambiar borrador no hereda confirmación`, async ({ page }) => {
    const code = await preparar(page, mode); const before = await persistido(page, code);
    await elegirTodo(page); await page.getByRole('button', { name: 'Listo', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Con esto se cierra la mesa' });
    await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Revisar', exact: true })).toBeFocused();
    expect(await persistido(page, code)).toEqual(before);
    await dialog.getByRole('button', { name: 'Revisar', exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(await persistido(page, code)).toEqual(before);
    // Quitar un plato hace que el nuevo pedido no complete: no hereda el token anterior.
    await page.locator('.qc-renglon').first().locator('button.qc-circulo--marcado').click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page).toHaveURL(/\/home$/); expect((await persistido(page, code)).status).toBe('open');
  });

  test(`n422 ${mode}: recargar descarta el desafío y la selección rechazada no aparece guardada`, async ({ page }) => {
    const code = await preparar(page, mode); const before = await persistido(page, code);
    await elegirTodo(page); await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Con esto se cierra la mesa' })).toBeVisible();
    const serialized = await page.evaluate(() => Object.values(localStorage).join(' ') + Object.values(sessionStorage).join(' '));
    expect(serialized).not.toContain('payme.app.selection-closure/v1');
    await page.reload(); await enTuMesaConLaLista(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await persistido(page, code)).toEqual(before);
    await expect(page.locator('.qc-renglon [data-estado="mio"]')).toHaveCount(0);
  });
}

test('n422 inglés: Escape devuelve foco y Enter confirma sólo desde Save and close', async ({ page }) => {
  const code = await preparar(page, 'consumo');
  await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
  await page.reload(); await expect(page.locator('.qc-renglon').first()).toBeVisible();
  await elegirTodo(page); const done = page.getByRole('button', { name: 'Done', exact: true });
  await done.click(); const dialog = page.getByRole('dialog', { name: 'This closes the table' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Review', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(done).toBeFocused();
  expect((await persistido(page, code)).status).toBe('open');
  await done.click(); await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Save and close', exact: true });
  await confirm.focus(); await confirm.press('Enter');
  await expect.poll(async () => (await persistido(page, code)).status).toBe('expired');
  await expect(dialog).toHaveCount(0);
});
