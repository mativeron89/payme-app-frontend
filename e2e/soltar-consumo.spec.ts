import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, irEnLaApp, sinRefresco } from './_app';

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
  await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  // Decisión 32 · «Listo» registra y vuelve a Inicio; se vuelve a la mesa para mirar lo tomado.
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
  await page.goto(`/#/mesa/${mesa.code}`);
  await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toBeVisible();
  return mesa.code;
}

/**
 * Cambia la mesa EN MEMORIA del mock, que es lo que lee el próximo pedido. Lo
 * mismo por `localStorage` no alcanza sin recargar: el mock lo pisa al guardar.
 */
async function cambiarMesaEnMemoria(
  page: Page,
  code: string,
  cambio: 'con_pago' | 'cerrada' | 'ya_suelto' | 'pago_ajeno' | 'mitad_pagada',
): Promise<void> {
  await page.evaluate(async ([c, k]) => {
    const storePath = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; status: string; paid_amount_cents: number; items: Array<{ name: string; status?: string; claims: unknown[] }> }> };
    };
    const mesa = store.state.mesas.find((m) => m.code === c);
    if (!mesa) throw new Error(`mesa ${c} ausente en el mock`);
    if (k === 'con_pago') mesa.paid_amount_cents = 100;
    else if (k === 'cerrada') mesa.status = 'fully_paid';
    else if (k === 'ya_suelto') for (const i of mesa.items) i.claims = [];
    else if (k === 'pago_ajeno') {
      // Otra persona pagó el Risotto: la mesa queda `partially_paid`.
      mesa.status = 'partially_paid';
      mesa.paid_amount_cents = 22000;
      const risotto = mesa.items.find((i) => i.name === 'Risotto ai Funghi')!;
      risotto.claims = [{ who: 'guest', fraction_bps: 10000, amount_cents: 22000, status: 'paid' }];
      (risotto as { status?: string }).status = 'paid';
    } else {
      // Pagué la mitad del Tagliatelle y la otra mitad sigue elegida.
      mesa.status = 'partially_paid';
      mesa.paid_amount_cents = 9750;
      const tagliatelle = mesa.items.find((i) => i.name === 'Tagliatelle Bolognese')!;
      tagliatelle.claims = [
        { who: 'user', fraction_bps: 5000, amount_cents: 9750, status: 'paid' },
        { who: 'user', fraction_bps: 5000, amount_cents: null, status: 'locked' },
      ];
    }
  }, [code, cambio] as const);
}

/**
 * AF-QUE-CONSUMISTE · decisión 90 · el renglón por el plato (`data-plato`). Lo
 * registrado ya no dice «Lo elegiste» en gris: es el renglón propio en teal con
 * la píldora de su porción (regla 2 del diseño), y se suelta con el círculo.
 */
const fila = (page: Page, nombre: string) => page.locator(`.qc-renglon[data-plato="${nombre}"]`).first();

test.describe('AF-25 · soltar un consumo (n80)', () => {
  test('lo elegido se ve como propio, se suelta y vuelve a quedar libre', async ({ page }) => {
    await mesaConUnoElegido(page);
    const tagliatelle = fila(page, 'Tagliatelle Bolognese');
    await expect(tagliatelle.locator('[data-estado="registrado"]')).toBeVisible();
    await expect(tagliatelle.locator('.qc-pildora')).toHaveText('Entero');
    // Regla 7 · el círculo marcado suelta, y se pinta con el check, no con la X
    // (`M9 9l6 6` es el trazo de `x-circle`).
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).locator('path'))
      .toHaveAttribute('d', 'M5 12.5l4.7 4.7L19 7.5');
    await expect(page.locator('.qc-lista path[d="M9 9l6 6"]')).toHaveCount(0);
    await capturar(page, 'soltar-01-lo-elegiste');

    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toHaveCount(0);
    await expect(tagliatelle.locator('[data-estado="libre"]')).toBeVisible();
    await capturar(page, 'soltar-02-suelto');

    // Libre de verdad: se puede volver a elegir.
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await expect(tagliatelle.getByRole('radiogroup')).toBeVisible();
  });

  test('un doble toque manda UN pedido: nunca aparece «No había nada para soltar»', async ({ page }) => {
    await mesaConUnoElegido(page);
    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).dblclick();
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toBeVisible();
    await expect(page.getByText('No había nada para soltar.')).toHaveCount(0);
  });

  test('🔴 backend SIN el dato (anterior a v2.103.0): con un pago en la mesa NO se ofrece soltar', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.parte_pagada.v1', 'antiguo'));
    const code = await mesaConUnoElegido(page);
    await cambiarMesaEnMemoria(page, code, 'con_pago');
    // El detalle no tiene recarga manual: salir y volver lo vuelve a pedir, sin
    // recargar la página (que pisaría el cambio hecho en memoria).
    await irEnLaApp(page, '/home');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await irEnLaApp(page, `/mesa/${code}`);
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);
    await expect(fila(page, 'Tagliatelle Bolognese').locator('[data-estado="registrado"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toHaveCount(0);
  });

  test('🔴 AF-29 · con el dato del dueño, un pago de OTRO no quita «Soltar»', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    await cambiarMesaEnMemoria(page, code, 'pago_ajeno');
    await irEnLaApp(page, '/home');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await irEnLaApp(page, `/mesa/${code}`);
    // Testigo: el pago ajeno se ve en la mesa.
    await expect(fila(page, 'Risotto ai Funghi').locator('[data-estado="pagado"]')).toContainText('Pagado');
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toBeVisible();
    await capturar(page, 'soltar-03-con-pago-de-otro');
    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toBeVisible();
  });

  test('AF-29 · con parte pagada, la fila dice qué pagaste y qué elegiste', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    await cambiarMesaEnMemoria(page, code, 'mitad_pagada');
    await irEnLaApp(page, '/home');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await irEnLaApp(page, `/mesa/${code}`);
    await expect(fila(page, 'Tagliatelle Bolognese')).toContainText('Pagaste ½ · elegiste ½ más');
    // Lo elegido que queda se puede soltar; lo pagado, no (el dueño suelta sólo lo `locked`).
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toBeVisible();
  });

  test('si la mesa dejó de aceptar cambios, lo dice con texto neutro', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    // AF-HIGIENE-2 · sin refresco entre el cierre y la respuesta de «Soltar».
    await sinRefresco(page, async () => {
      await cambiarMesaEnMemoria(page, code, 'cerrada');
      await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
      await expect(page.getByText('La mesa ya no acepta cambios.')).toBeVisible();
    });
  });

  test('si ya estaba suelto, lo dice: el mensaje sale de lo que contestó el dueño', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    // AF-HIGIENE-2 · sin refresco: si relee la mesa ya suelta, «Soltar» desaparece.
    await sinRefresco(page, async () => {
      await cambiarMesaEnMemoria(page, code, 'ya_suelto');
      await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
      await expect(page.getByText('No había nada para soltar.')).toBeVisible();
      await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toHaveCount(0);
    });
  });

  test('backend anterior sin la ruta (404): lo dice una vez y deja de ofrecer «Soltar»', async ({ page }) => {
    await mesaConUnoElegido(page);
    await page.evaluate(() => localStorage.setItem('payme.app.mock.soltar.v1', 'antiguo'));
    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    await expect(page.getByText('Soltar todavía no está disponible.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' })).toHaveCount(0);
    // Lo elegido sigue viéndose como propio: el campo existe en el backend anterior.
    await expect(fila(page, 'Tagliatelle Bolognese').locator('[data-estado="registrado"]')).toBeVisible();
    await expect(page.getByText('No pudimos soltarlo. Intenta de nuevo.')).toHaveCount(0);
  });

  test('un 404 de ÍTEM (item_not_found) no se confunde con un backend sin la ruta', async ({ page }) => {
    const code = await mesaConUnoElegido(page);
    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await page.goto(`/#/mesa/${code}`);
    await expect(page.getByRole('button', { name: 'Soltar Risotto ai Funghi' })).toBeVisible();
    // El Tagliatelle deja de existir en la mesa del mock: el dueño contestaría
    // 404 `item_not_found` CON `item_id`.
    // AF-HIGIENE-2 · sin refresco: si relee la mesa sin el Tagliatelle, su
    // «Soltar» desaparece antes del toque.
    await sinRefresco(page, async () => {
      await page.evaluate(async (c) => {
        const storePath = '/src/api/mock/store.ts';
        const store = await import(/* @vite-ignore */ storePath) as {
          state: { mesas: Array<{ code: string; items: Array<{ name: string }> }> };
        };
        const mesa = store.state.mesas.find((m) => m.code === c)!;
        mesa.items = mesa.items.filter((i) => i.name !== 'Tagliatelle Bolognese');
      }, code);
      await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
      await expect(page.getByText('No pudimos soltarlo. Intenta de nuevo.')).toBeVisible();
      await expect(page.getByText('Soltar todavía no está disponible.')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Soltar Risotto ai Funghi' })).toBeVisible();
    });
  });

  /**
   * En «partes iguales» no hay soltar CONTRA EL DUEÑO: la selección es una
   * declaración local hasta «Listo». Desde el diseño de la decisión 90, el
   * círculo y «Soltar» deshacen esa declaración en el renglón (regla 7), así que
   * lo que se fija es que no viaja ningún `releaseItems` ni sale su aviso.
   */
  test('en «partes iguales» no se suelta contra el dueño: soltar sólo deshace la declaración', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });
    await page.goto(`/#/mesa/${mesa.code}`);
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
      const w = window as unknown as { __soltados: number };
      w.__soltados = 0;
      const original = api.releaseItems.bind(api);
      api.releaseItems = async (...a: unknown[]) => { w.__soltados += 1; return original(...a); };
    });
    const tagliatelle = fila(page, 'Tagliatelle Bolognese');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await tagliatelle.getByRole('radio', { name: 'Entero' }).click();
    await expect(tagliatelle.locator('[data-estado="mio"]')).toBeVisible();
    await page.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    await expect(tagliatelle.locator('[data-estado="libre"]')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __soltados: number }).__soltados)).toBe(0);
    await expect(page.getByText('Listo, lo soltaste. Ya lo puede elegir otra persona.')).toHaveCount(0);
  });
});
