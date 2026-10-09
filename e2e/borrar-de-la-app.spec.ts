import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * AF-BORRAR-MESAS-20261009 · decisiones 238 y 239 de Mati · n334 · App Backend
 * v2.169.0 (`contract-mirror/contract/ocultamientos-v1.json`).
 *
 * En Mesas, deslizar a la izquierda una tarjeta terminada («Tus mesas») o un
 * pago del historial deja ver «Eliminar» en rojo. La mesa pregunta «¿Borrar
 * también su historial?»; el pago se borra. Un aviso ofrece «Deshacer». Es
 * borrar DE LA APP (ocultar por persona): el servidor conserva todo.
 *
 * El sujeto: una mesa propia y terminada de «Tus mesas» del seed, con un pago
 * propio en el historial ($334, sembrado) y un aviso sin leer de esa mesa.
 */

test.use({ viewport: { width: 375, height: 667 } });

const PAGO = 'a0000000-0000-4000-8000-000000000334';
const AVISO = 'a0000000-0000-4000-8000-000000000335';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-borrar-${nombre}.png` });
}

/** Siembra el pago y el aviso de la mesa; devuelve su código. */
async function sembrar(page: Page): Promise<string> {
  const code = await page.evaluate(async ([pagoId, avisoId]) => {
    const ruta = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ ruta) as {
      state: {
        mesas: Array<{ id: string; code: string; status: string; openedByUser?: boolean; restaurant: { name: string } }>;
        history: Array<Record<string, unknown> & { id: string }>;
        movementDetails: Record<string, unknown>;
        notifications: unknown[];
      };
      persist: () => void;
    };
    const terminadas = ['fully_paid', 'expired', 'completed', 'settled', 'cancelled'];
    const viva = state.mesas.find((m) => m.openedByUser && terminadas.includes(m.status));
    if (!viva) throw new Error('sin mesa terminada propia en el seed');
    const modelo = state.history.find((h) => state.movementDetails[h.id]);
    if (!modelo) throw new Error('sin pago con detalle en el seed');
    state.history.push({
      ...modelo, id: pagoId, mesa_code: viva.code, mesa_status: viva.status,
      amount_cents: 33400, date: new Date().toISOString(),
    });
    state.movementDetails[pagoId] = structuredClone(state.movementDetails[modelo.id]);
    state.notifications = [{
      id: avisoId, type: 'generic', title: null, body: 'Aviso de la mesa', payload: null,
      related_entity_type: 'mesa', related_entity_id: viva.id, read_at: null,
      created_at: new Date().toISOString(),
    }];
    persist();
    return viva.code;
  }, [PAGO, AVISO] as const);
  return code;
}

async function aMesas(page: Page, costuras: Record<string, string> = {}): Promise<string> {
  await page.addInitScript((c) => {
    for (const [k, v] of Object.entries(c)) localStorage.setItem(k, v);
  }, costuras);
  await ingresar(page);
  const code = await sembrar(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await irEnLaApp(page, '/mesas');
  await expect(tusMesas(page).locator('.tu-mesa').first()).toBeVisible();
  await expect(tarjetaDelPago(page)).toBeVisible();
  return code;
}

const tusMesas = (page: Page) => page.getByRole('region', { name: 'Tus mesas' });
const tarjetaDeLaMesa = (page: Page) => tusMesas(page).locator('.tu-mesa').first();
const tarjetaDelPago = (page: Page) => page.locator('.hist-item').filter({ hasText: '$334' });
const pregunta = (page: Page) => page.getByRole('dialog', { name: '¿Borrar también su historial?' });
const abierta = (tarjeta: Locator) => tarjeta.locator('.deslizable--abierta');

/** Arrastra la tarjeta con el puntero (dx < 0: a la izquierda). */
async function deslizar(page: Page, tarjeta: Locator, dx: number, desdeDerecha = true): Promise<void> {
  const caja = (await tarjeta.boundingBox())!;
  const y = caja.y + Math.min(30, caja.height / 2);
  const x = desdeDerecha ? caja.x + caja.width - 40 : caja.x + 120;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await page.mouse.move(x + (dx * k) / 8, y);
  await page.mouse.up();
}

async function abrirYEliminar(page: Page, tarjeta: Locator): Promise<void> {
  await deslizar(page, tarjeta, -120);
  await expect(abierta(tarjeta)).toHaveCount(1);
  await tarjeta.locator('.deslizable-eliminar').click();
}

test.describe('D239 · el gesto', () => {
  test('deslizar a la izquierda deja ver «Eliminar» en rojo; soltar antes de la mitad vuelve', async ({ page }) => {
    await aMesas(page);
    const tarjeta = tarjetaDeLaMesa(page);
    const eliminar = tarjeta.locator('.deslizable-eliminar');
    await deslizar(page, tarjeta, -30);
    await expect(abierta(tarjeta)).toHaveCount(0);
    await deslizar(page, tarjeta, -120);
    await expect(abierta(tarjeta)).toHaveCount(1);
    await expect(eliminar).toHaveText('Eliminar');
    await expect(eliminar).toHaveCSS('background-color', 'rgb(180, 35, 24)');
    await expect(eliminar).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(eliminar).toHaveCSS('opacity', '1');
    await expect(eliminar).toBeInViewport({ ratio: 1 });
    await capturar(page, '01-deslizada');
  });

  test('deslizar de vuelta, tocar la tarjeta o tocar afuera la cierra; una sola abierta a la vez', async ({ page }) => {
    await aMesas(page);
    const mesa = tarjetaDeLaMesa(page);
    const pago = tarjetaDelPago(page);
    await deslizar(page, mesa, -120);
    await deslizar(page, mesa, 120, false);
    await expect(abierta(mesa)).toHaveCount(0);

    await deslizar(page, mesa, -120);
    await mesa.locator('.hist-main').click();
    await expect(abierta(mesa)).toHaveCount(0);

    // Tocar afuera, con el foco fuera de la tarjeta: si no, la cerraría el
    // `blur` del botón rojo y no el toque (deslizar de vuelta lo enfoca).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await deslizar(page, mesa, -120);
    expect(await mesa.evaluate((e) => e.contains(document.activeElement))).toBe(false);
    await page.getByRole('heading', { name: 'Mesas', exact: true }).click();
    await expect(abierta(mesa)).toHaveCount(0);

    await deslizar(page, mesa, -120);
    await deslizar(page, pago, -120);
    await expect(abierta(pago)).toHaveCount(1);
    await expect(abierta(mesa)).toHaveCount(0);
    // Cerrada, el rojo no se pinta (ni asoma por las esquinas).
    await expect(mesa.locator('.deslizable-eliminar')).toHaveCSS('opacity', '0');
  });

  test('el arrastre no abre el detalle del pago', async ({ page }) => {
    await aMesas(page);
    const pago = tarjetaDelPago(page);
    await deslizar(page, pago, -120);
    // El click que sigue al arrastre no abre el detalle ni cierra lo que abrió.
    await expect(abierta(pago)).toHaveCount(1);
    await expect(pago.getByRole('button', { expanded: false }).first()).toBeVisible();
    await expect(pago.locator('.hist-detail')).toHaveCount(0);
  });
});

test.describe('D238 · la mesa: «¿Borrar también su historial?»', () => {
  test('«No, sólo la mesa»: la mesa sale; su pago queda en el historial; el texto es honesto', async ({ page }) => {
    await aMesas(page);
    await abrirYEliminar(page, tarjetaDeLaMesa(page));
    await expect(pregunta(page)).toBeVisible();
    await expect(pregunta(page)).toContainText('La mesa se borra de tu app; PayMe conserva el registro. Su historial son tus pagos de esa mesa.');
    await expect(pregunta(page).getByRole('button', { name: 'No, sólo la mesa', exact: true })).toBeFocused();
    await capturar(page, '02-pregunta');
    const ocultadas = await espiarPedido(page);
    await pregunta(page).getByRole('button', { name: 'No, sólo la mesa', exact: true }).click();
    await expect(page.getByText('Borraste la mesa de tu app.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deshacer', exact: true })).toBeVisible();
    await expect(tusMesas(page).locator('.tu-mesa')).toHaveCount(0);
    await expect(tarjetaDelPago(page)).toBeVisible();
    expect(await ocultadas()).toEqual([{ include_history: false }]);
    await capturar(page, '03-aviso-deshacer');
  });

  test('«Sí, también el historial»: salen la mesa y su pago', async ({ page }) => {
    await aMesas(page);
    await abrirYEliminar(page, tarjetaDeLaMesa(page));
    await pregunta(page).getByRole('button', { name: 'Sí, también el historial', exact: true }).click();
    await expect(page.getByText('Borraste la mesa de tu app.')).toBeVisible();
    await expect(tusMesas(page).locator('.tu-mesa')).toHaveCount(0);
    await expect(tarjetaDelPago(page)).toHaveCount(0);
  });

  test('el ✕ y Escape no borran nada', async ({ page }) => {
    await aMesas(page);
    await abrirYEliminar(page, tarjetaDeLaMesa(page));
    await pregunta(page).getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(pregunta(page)).toHaveCount(0);
    await tarjetaDeLaMesa(page).locator('.deslizable-eliminar').focus();
    await page.keyboard.press('Enter');
    await expect(pregunta(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pregunta(page)).toHaveCount(0);
    await irEnLaApp(page, '/');
    await irEnLaApp(page, '/mesas');
    await expect(tusMesas(page).locator('.tu-mesa')).toHaveCount(1);
  });

  test('«Deshacer» la devuelve', async ({ page }) => {
    await aMesas(page);
    await abrirYEliminar(page, tarjetaDeLaMesa(page));
    await pregunta(page).getByRole('button', { name: 'Sí, también el historial', exact: true }).click();
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
    await expect(page.getByText('Volvió a tu app.')).toBeVisible();
    await expect(tusMesas(page).locator('.tu-mesa')).toHaveCount(1);
    await expect(tarjetaDelPago(page)).toBeVisible();
  });
});

test.describe('D238 · el pago del historial', () => {
  test('«Eliminar» borra el pago sin preguntar; «Deshacer» lo devuelve; la mesa queda', async ({ page }) => {
    await aMesas(page);
    await abrirYEliminar(page, tarjetaDelPago(page));
    await expect(pregunta(page)).toHaveCount(0);
    await expect(page.getByText('Borraste el pago de tu app.')).toBeVisible();
    await expect(tarjetaDelPago(page)).toHaveCount(0);
    await expect(tusMesas(page).locator('.tu-mesa')).toHaveCount(1);
    await capturar(page, '04-pago-borrado');
    await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
    await expect(tarjetaDelPago(page)).toBeVisible();
  });
});

test.describe('cuando el dueño no oculta', () => {
  test('409 (la mesa volvió a estar en curso): lo dice y la tarjeta vuelve con la lista', async ({ page }) => {
    const code = await aMesas(page);
    await page.evaluate(async (c) => {
      const ruta = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ ruta) as { state: { mesas: Array<{ code: string; status: string; expires_at: string }> } };
      const m = state.mesas.find((x) => x.code === c)!;
      m.status = 'open';
      m.expires_at = new Date(Date.now() + 60 * 60_000).toISOString();
    }, code);
    await abrirYEliminar(page, tarjetaDeLaMesa(page));
    await pregunta(page).getByRole('button', { name: 'No, sólo la mesa', exact: true }).click();
    await expect(page.getByText('Esta mesa volvió a estar en curso: todavía no se puede borrar.')).toBeVisible();
    await expect(page.getByText('Borraste la mesa de tu app.')).toHaveCount(0);
  });

  test('404 (ya no está): lo dice', async ({ page }) => {
    await aMesas(page);
    await page.evaluate(async (pagoId) => {
      const ruta = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ ruta) as { state: { history: Array<{ id: string }> } };
      state.history = state.history.filter((h) => h.id !== pagoId);
    }, PAGO);
    await abrirYEliminar(page, tarjetaDelPago(page));
    await expect(page.getByText('Ese pago ya no está disponible.')).toBeVisible();
  });
});

test.describe('la caché de lo último visto (0.225.0)', () => {
  test('después de borrar, ni Mesas ni la campana muestran un cuadro de lo borrado', async ({ page }) => {
    await aMesas(page);
    // Antes: la mesa tiene un aviso sin leer, y Inicio y Mesas quedan guardados.
    await irEnLaApp(page, '/');
    await expect(page.locator('.hdr-badge')).toHaveText('1');
    await irEnLaApp(page, '/mesas');
    await expect(tusMesas(page).locator('.tu-mesa')).toHaveCount(1);

    // El dueño lento: la lista nueva tarda, así que lo que se vea mientras tanto
    // sale de lo guardado. Sin olvidarlo, aparecerían la mesa y la campana.
    await page.evaluate(() => localStorage.setItem('payme.app.mock.latencia.v1', '900'));
    await abrirYEliminar(page, tarjetaDeLaMesa(page));
    await pregunta(page).getByRole('button', { name: 'Sí, también el historial', exact: true }).click();
    await expect(page.getByText('Borraste la mesa de tu app.')).toBeVisible();
    await page.evaluate(() => {
      const w = window as unknown as { __vistos: string[] };
      w.__vistos = [];
      new MutationObserver(() => {
        if (document.querySelector('.tu-mesa')) w.__vistos.push('tu-mesa');
        if ([...document.querySelectorAll('.hist-item')].some((e) => (e.textContent ?? '').includes('$334'))) w.__vistos.push('pago');
        if (document.querySelector('.hdr-badge')) w.__vistos.push('campana');
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await irEnLaApp(page, '/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await irEnLaApp(page, '/mesas');
    await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
    await page.waitForTimeout(2200);
    expect(await page.evaluate(() => (window as unknown as { __vistos: string[] }).__vistos)).toEqual([]);
    // Control positivo: la lista sí llegó (y sin la mesa).
    await expect(page.locator('.hist-item').first()).toBeVisible();
  });
});

test.describe('sin la capacidad', () => {
  for (const valor of ['apagado', 'ausente']) {
    test(`con el seam en «${valor}» no hay gesto ni «Eliminar»`, async ({ page }) => {
      await aMesas(page, { 'payme.app.mock.ocultar.v1': valor });
      await expect(page.locator('.deslizable')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Eliminar/ })).toHaveCount(0);
    });
  }
});

test.describe('la alternativa sin gesto', () => {
  test('Tab llega a «Eliminar», la tarjeta se abre con el foco y Enter pregunta', async ({ page }) => {
    await aMesas(page);
    const tarjeta = tarjetaDeLaMesa(page);
    const eliminar = tarjeta.getByRole('button', { name: /^Eliminar / });
    await tarjeta.locator('.hist-row').focus().catch(() => undefined);
    await page.getByRole('heading', { name: 'Mesas', exact: true }).click();
    for (let k = 0; k < 12 && !(await eliminar.evaluate((e) => e === document.activeElement)); k += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(eliminar).toBeFocused();
    await expect(abierta(tarjeta)).toHaveCount(1);
    await expect(eliminar).toBeInViewport({ ratio: 1 });
    await capturar(page, '05-teclado');
    await page.keyboard.press('Enter');
    await expect(pregunta(page)).toBeVisible();
  });

  test('en inglés', async ({ page }) => {
    await aMesas(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await irEnLaApp(page, '/mesas');
    const tarjeta = page.getByRole('region', { name: 'Your tables' }).locator('.tu-mesa').first();
    await abrirYEliminar(page, tarjeta);
    await expect(page.getByRole('dialog', { name: 'Also delete its history?' })).toBeVisible();
    await page.getByRole('button', { name: 'No, just the table', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  });
});

/** Anota los `include_history` con que la pantalla pide ocultar una mesa. */
async function espiarPedido(page: Page): Promise<() => Promise<unknown[]>> {
  await page.evaluate(async () => {
    const w = window as unknown as { __pedidos: unknown[] };
    w.__pedidos = [];
    const route = '/src/api/index.ts';
    const module = await import(/* @vite-ignore */ route) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const original = module.api.ocultarMesa!.bind(module.api);
    module.api.ocultarMesa = (code: unknown, incluir: unknown) => {
      w.__pedidos.push({ include_history: incluir });
      return original(code, incluir);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __pedidos: unknown[] }).__pedidos);
}
