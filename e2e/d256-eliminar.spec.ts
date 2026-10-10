import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D256 · Mati: «no permite borrar la mesa ni consumos en el histórico de viaje,
 * como en "Mesas" que desplazas hacia la izquierda y aparezca el botón de
 * eliminar». En Balance › Consumos, deslizar a la izquierda un ticket o un gasto
 * deja ver «Eliminar» en rojo, sólo donde el dueño dice `puede_eliminar` (quien
 * lo cargó o quien lo pagó, con el viaje abierto). Se elimina sin otra
 * confirmación y la cuenta se recalcula (App Backend 2.175.0, `viaje_version=4`).
 *
 * En la semilla del mock, de Cancún Mati pagó sólo «Bar La Ola» ($960).
 */

const CANCUN = 'd1000000-0000-4000-8000-000000000001';

test.use({ viewport: { width: 375, height: 812 } });

async function conViajes(page: Page, extra: Record<string, string> = {}): Promise<void> {
  await page.addInitScript((seams) => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    for (const [k, v] of Object.entries(seams)) localStorage.setItem(k, v);
  }, extra);
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

const consumo = (page: Page, lugar: string) => page.locator('.vjb-consumos > li').filter({ hasText: lugar });

/** Arrastra la fila con el puntero, a la izquierda. */
async function deslizar(page: Page, fila: Locator, dx = -120): Promise<void> {
  const caja = (await fila.boundingBox())!;
  const y = caja.y + caja.height / 2;
  const x = caja.x + caja.width - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await page.mouse.move(x + (dx * k) / 8, y);
  await page.mouse.up();
}

async function aConsumos(page: Page): Promise<void> {
  await ir(page, `/viaje-balance/${CANCUN}`);
  await expect(page.getByRole('tab', { name: 'Consumos', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(consumo(page, 'Bar La Ola')).toBeVisible();
}

test('🔴 D256 · deslizar «Bar La Ola» (lo pagué yo), «Eliminar» y la cuenta se recalcula', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^−\$542/);
  await aConsumos(page);
  const bar = consumo(page, 'Bar La Ola');
  await deslizar(page, bar);
  const eliminar = bar.getByRole('button', { name: 'Eliminar Bar La Ola', exact: true });
  await expect(bar.locator('.deslizable--abierta')).toHaveCount(1);
  await expect(eliminar).toBeInViewport({ ratio: 1 });
  await eliminar.click();
  // Sin otra pregunta (Mati descartó la confirmación extra).
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Ticket eliminado', { exact: true })).toBeVisible();
  await expect(consumo(page, 'Bar La Ola')).toHaveCount(0);
  // La cuenta del dueño: ya no pagué nada, y el balance del viaje cambió.
  await page.getByRole('tab', { name: 'Miembros', exact: true }).click();
  await expect(page.locator('.vjb-fila').filter({ hasText: 'Tú' }).locator('.vjb-cifra')).toHaveText('$0');
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  // −$542 − ($960 que pagué − $240 que me tocaba, entre cuatro) = −$1,262.
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^−\$1,262/);
});

test('🔴 D256 · lo que no cargué ni pagué no se desliza: no hay «Eliminar»', async ({ page }) => {
  await conViajes(page);
  await aConsumos(page);
  const mariscos = consumo(page, 'Mariscos El Faro');
  // Sin gesto: la fila de siempre. (Arrastrarla con el mouse es un clic que abre el ticket; con el dedo, un scroll.)
  await expect(mariscos.locator('.deslizable')).toHaveCount(0);
  await expect(mariscos.getByRole('button', { name: /^Eliminar / })).toHaveCount(0);
  // El único «Eliminar» de Consumos es el de lo que pagué.
  await expect(page.getByRole('button', { name: /^Eliminar / })).toHaveText(['Eliminar']);
  await expect(page.getByRole('button', { name: /^Eliminar / })).toHaveAccessibleName('Eliminar Bar La Ola');
});

test('🔴 D256 · un gasto a mano que cargué: «Gasto eliminado»', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Carga manual', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Taxi al aeropuerto');
  await page.getByLabel('Monto', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await aConsumos(page);
  const taxi = consumo(page, 'Taxi al aeropuerto');
  await deslizar(page, taxi);
  await taxi.getByRole('button', { name: 'Eliminar Taxi al aeropuerto', exact: true }).click();
  await expect(page.getByText('Gasto eliminado', { exact: true })).toBeVisible();
  await expect(consumo(page, 'Taxi al aeropuerto')).toHaveCount(0);
});

for (const [seam, aviso, sigue] of [
  ['ya_no_estaba', 'Ya no estaba', false],
  ['cerrado', 'El viaje ya no está abierto', true],
  ['prohibido', 'Sólo pueden eliminarlo quien lo cargó o quien lo pagó.', true],
] as const) {
  test(`🔴 D256 · el dueño contesta «${seam}»: «${aviso}», y la lista se vuelve a pedir`, async ({ page }) => {
    await conViajes(page, { 'payme.app.mock.viajes.eliminar.v1': seam });
    await aConsumos(page);
    const bar = consumo(page, 'Bar La Ola');
    await deslizar(page, bar);
    await bar.getByRole('button', { name: 'Eliminar Bar La Ola', exact: true }).click();
    await expect(page.getByText(aviso, { exact: true })).toBeVisible();
    await expect(page.getByText('Ticket eliminado', { exact: true })).toHaveCount(0);
    // Con «ya no estaba» el dueño ya lo había sacado; si no, sigue en la lista.
    await expect(consumo(page, 'Bar La Ola')).toHaveCount(sigue ? 1 : 0);
    await expect(page.locator('.deslizable--abierta')).toHaveCount(0);
  });
}

test('🔴 D256 · el 404 del viaje (ya no es miembro) sigue el camino de siempre: «Este viaje ya no está disponible.»', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.eliminar.v1': 'sin_viaje' });
  await aConsumos(page);
  const bar = consumo(page, 'Bar La Ola');
  await deslizar(page, bar);
  await bar.getByRole('button', { name: 'Eliminar Bar La Ola', exact: true }).click();
  await expect(page.getByText('Este viaje ya no está disponible.', { exact: true })).toBeVisible();
  await expect(page.getByText('Ticket eliminado', { exact: true })).toHaveCount(0);
});

test('🔴 D256 · el aviso «eliminó un gasto» se ve en Notificaciones y abre el viaje', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.aviso_eliminado.v1': 'encendido' });
  await ir(page, '/avisos');
  const fila = page.getByText('Luis Pérez eliminó un gasto de Cancún 2026: Taxi al aeropuerto.', { exact: false });
  await expect(fila).toBeVisible();
  await fila.click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
});
