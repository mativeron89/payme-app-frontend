import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';
import { enTuMesaConLaLista, confirmarGuardadoDeMesa } from './_mesa';

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
  test(`D945 · Finalizar en ${mode} conserva la mesa si el dueño exige confirmar el cierre`, async ({ page }) => {
    const code = await preparar(page, mode);
    const antes = await persistido(page, code);
    await elegirTodo(page);
    await page.getByRole('button', { name: 'Finalizar', exact: true }).click();
    await expect(page.getByText('Con esto se cierra la mesa. Toca «Continuar» para confirmarlo.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/mesa/' + code + '$'));
    await expect(page.getByRole('dialog', { name: 'Con esto se cierra la mesa', exact: true })).toHaveCount(0);
    expect(await persistido(page, code)).toEqual(antes);
  });

  test(`n422 ${mode}: Revisar cancela sin persistencia; cambiar borrador no hereda confirmación`, async ({ page }) => {
    const code = await preparar(page, mode); const before = await persistido(page, code);
    await elegirTodo(page); await page.getByRole('button', { name: /^(Listo|Continuar)$/, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Con esto se cierra la mesa' });
    await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Revisar', exact: true })).toBeFocused();
    expect(await persistido(page, code)).toEqual(before);
    await dialog.getByRole('button', { name: 'Revisar', exact: true }).click();
    await expect(dialog).toHaveCount(0); expect(await persistido(page, code)).toEqual(before);
    // Quitar un plato hace que el nuevo pedido no complete: no hereda el token anterior.
    await page.locator('.qc-renglon').first().locator('button.qc-circulo--marcado').click();
    await page.getByRole('button', { name: /^(Listo|Continuar)$/, exact: true }).click();
    await expect(page.getByText('Listo, quedó guardado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page).toHaveURL(/\/home$/); expect((await persistido(page, code)).status).toBe('open');
  });

  test(`W1 · ${mode}: el cierre desde un destino lateral requiere confirmación del dueño`, async ({ page }) => {
    const code = await preparar(page, mode);
    const before = await persistido(page, code);
    await elegirTodo(page);
    await page.getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('button', { name: 'Mesas', exact: true }).click();
    await confirmarGuardadoDeMesa(page);
    const dialog = page.getByRole('dialog', { name: 'Con esto se cierra la mesa' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/mesa/${code}$`));
    expect(await persistido(page, code)).toEqual(before);
    await dialog.getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
    await expect(page).toHaveURL(/\/mesas$/);
    expect((await persistido(page, code)).status).toBe('expired');
  });

  test(`n422 ${mode}: recargar descarta el desafío y la selección rechazada no aparece guardada`, async ({ page }) => {
    const code = await preparar(page, mode); const before = await persistido(page, code);
    await elegirTodo(page); await page.getByRole('button', { name: /^(Listo|Continuar)$/, exact: true }).click();
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
  // D469 · «My items» arranca cerrado: se abre por su cabecera (el helper espera los títulos en español).
  await page.reload();
  await expect(page.locator('.desplegable.tus-consumos .desplegable-cabecera')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.qc-renglon').first()).toBeVisible();
  await elegirTodo(page); const done = page.getByRole('button', { name: 'Continue', exact: true });
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.getByText('This closes the table. Tap «Continue» to confirm.', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await done.click();
  const dialog = page.getByRole('dialog', { name: 'This closes the table' });
  await expect(dialog).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Review', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(done).toBeFocused();
  expect((await persistido(page, code)).status).toBe('open');
  await done.click();
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Save and close', exact: true });
  await confirm.focus(); await confirm.press('Enter');
  await expect.poll(async () => (await persistido(page, code)).status).toBe('expired');
  await expect(dialog).toHaveCount(0);
});
