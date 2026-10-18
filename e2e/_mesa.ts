import { expect, type Page } from '@playwright/test';

/**
 * D223 · «Tu mesa» (turno 2 · 2.9–2.11): la mesa del TITULAR se titula «Tu
 * mesa» y su lista de platos vive dentro de «Tus consumos». Desde D360-7 esa
 * tarjeta arranca ABIERTA (antes, cerrada) y «Quiénes están en la mesa»
 * arranca CERRADA (D360-4a). Quien no es titular sigue viendo «¿Qué
 * consumiste?» con la lista abierta. Los helpers son idempotentes: abren sólo
 * si está cerrado, así sirven con cualquiera de los dos estados.
 */

/** El título de la mesa del titular. */
export const tituloTuMesa = (page: Page) => page.getByRole('heading', { name: 'Tu mesa', exact: true });

/** La cabecera de «Tus consumos» (un `<button aria-expanded>`). */
export const cabeceraTusConsumos = (page: Page) =>
  page.getByRole('region', { name: 'Tus consumos' }).locator('.desplegable-cabecera');

/**
 * Abre «Tus consumos» si está cerrado. Sin «Tus consumos» (no titular), no hace
 * nada. Espera antes el título de la mesa (cualquiera de los dos): sin eso, si
 * la pantalla todavía no montó, «no está» se confundía con «no es titular».
 */
export async function abrirTusConsumos(page: Page): Promise<void> {
  // Una mesa cerrada muestra su cierre, con otro título: ahí no hay lista que
  // abrir y no se espera de más.
  const titulo = page.getByRole('heading', { name: /^(Tu mesa|¿Qué consumiste\?)$/ });
  const hayMesa = await titulo.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
  if (!hayMesa) return;
  const cabecera = cabeceraTusConsumos(page);
  if ((await cabecera.count()) === 0) return;
  if ((await cabecera.getAttribute('aria-expanded')) !== 'true') await cabecera.click();
  await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
}

/**
 * D360-4a · abre «Quiénes están en la mesa», que arranca cerrado. Si ya está
 * abierto no lo toca (un clic de más lo cerraría).
 */
export async function abrirQuienes(page: Page): Promise<void> {
  const cabecera = page.getByRole('region', { name: 'Quiénes están en la mesa' }).locator('.desplegable-cabecera');
  await expect(cabecera).toBeVisible();
  if ((await cabecera.getAttribute('aria-expanded')) !== 'true') await cabecera.click();
  await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
}

/** Espera «Tu mesa» y deja la lista de platos abierta. */
export async function enTuMesaConLaLista(page: Page): Promise<void> {
  await expect(tituloTuMesa(page)).toBeVisible();
  await abrirTusConsumos(page);
}
