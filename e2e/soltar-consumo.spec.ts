import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-25 · n80 · soltar un consumo propio no pagado (`POST items/release`, dueño
 * v2.100.0; decisión de Mati «Sí, mientras no esté pagado»).
 *
 * La interacción, medida sobre cómo se elige hoy: se toca un consumo, «Listo» lo
 * registra, y la fila queda como «Lo elegiste» con un botón «Soltar» debajo.
 * Soltar lo deja libre para otro, y la fila vuelve a poder elegirse.
 *
 * Los recorridos fijan el dinero apagado —el corte— porque es el estado real de
 * hoy y el único en que el registro de la selección no sigue al pago.
 */

async function conRielApagado(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

/** Mesa en consumo, sin garantía, con el Tagliatelle ya registrado como mío. */
async function mesaConUnoElegido(page: Page): Promise<string> {
  await conRielApagado(page);
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
  await page.goto(`/#/mesa/${mesa.code}`);
  // Testigo positivo del estado declarado (ver `mesa-sin-garantia.spec.ts`).
  await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toBeVisible();
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toBeVisible();
  return mesa.code;
}

/**
 * Cambia la mesa EN MEMORIA del mock, que es lo que lee el próximo pedido. Lo
 * mismo por `localStorage` no alcanza sin recargar: el mock lo pisa al guardar.
 */
async function cambiarMesaEnMemoria(page: Page, code: string, cambio: 'con_pago' | 'cerrada' | 'ya_suelto'): Promise<void> {
  await page.evaluate(async ([c, k]) => {
    const storePath = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; status: string; paid_amount_cents: number; items: Array<{ claims: unknown[] }> }> };
    };
    const mesa = store.state.mesas.find((m) => m.code === c);
    if (!mesa) throw new Error(`mesa ${c} ausente en el mock`);
    if (k === 'con_pago') mesa.paid_amount_cents = 100;
    else if (k === 'cerrada') mesa.status = 'fully_paid';
    else for (const i of mesa.items) i.claims = [];
  }, [code, cambio] as const);
}

test.describe('AF-25 · soltar un consumo (n80)', () => {
  test('lo elegido se ve como «Lo elegiste», se suelta y vuelve a quedar libre', async ({ page }) => {
    await mesaConUnoElegido(page);
    const fila = page.getByRole('button', { name: /^Tagliatelle Bolognese/ }).first();
    await expect(fila).toContainText('Lo elegiste');
    await capturar(page, 'soltar-01-lo-elegiste');

    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toHaveCount(0);
    await expect(fila).not.toContainText('Lo elegiste');
    await capturar(page, 'soltar-02-suelto');

    // Libre de verdad: se puede volver a elegir.
    await fila.click();
    await expect(fila).toHaveAttribute('aria-pressed', 'true');
  });

  test('un doble toque manda UN pedido: nunca aparece «No había nada para soltar»', async ({ page }) => {
    await mesaConUnoElegido(page);
    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).dblclick();
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toBeVisible();
    await expect(page.getByText('No había nada para soltar.')).toHaveCount(0);
  });

  test('🔴 con un pago en la mesa NO se ofrece soltar, aunque sigue diciendo «Lo elegiste»', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    await cambiarMesaEnMemoria(page, code, 'con_pago');
    // El detalle no tiene recarga manual: salir y volver lo vuelve a pedir, sin
    // recargar la página (que pisaría el cambio hecho en memoria).
    await page.goto('/#/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await page.goto(`/#/mesa/${code}`);
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toBeVisible();
    const fila = page.getByRole('button', { name: /^Tagliatelle Bolognese/ }).first();
    await expect(fila).toContainText('Lo elegiste');
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toHaveCount(0);
  });

  test('si la mesa dejó de aceptar cambios, lo dice con texto neutro', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    await cambiarMesaEnMemoria(page, code, 'cerrada');
    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    await expect(page.getByText('La mesa ya no acepta cambios.')).toBeVisible();
  });

  test('si ya estaba suelto, lo dice: el mensaje sale de lo que contestó el dueño', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    await cambiarMesaEnMemoria(page, code, 'ya_suelto');
    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    await expect(page.getByText('No había nada para soltar.')).toBeVisible();
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toHaveCount(0);
  });

  test('en «partes iguales» no se ofrece soltar', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });
    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toBeVisible();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Tagliatelle Bolognese/ }).first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /^Soltar/ })).toHaveCount(0);
    await expect(page.getByText('Lo elegiste')).toHaveCount(0);
  });
});
