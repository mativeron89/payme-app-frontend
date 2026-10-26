import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { mesesDeMexico } from '../src/utils/meses';

const MESES = mesesDeMexico(new Date(), 'es');

/**
 * AF-31 · n166 · «Qué comes» por platos (2c), `GET /api/account/stats/dishes`.
 *
 * El mock saca los platos del mismo modelo de visitas que 2a y 2b. Este mes:
 * La Parolaccia ×3 (tres platos por visita), Hanzo ×2 (dos) y Café Nube ×1 (dos)
 * ⇒ 7 platos distintos; los cinco primeros son los tres de La Parolaccia
 * (3 veces) y los dos de Hanzo (2 veces).
 */

async function preparar(
  page: Page,
  o: { stats?: string; platos?: string; momentos?: string; ingredientes?: string; conDinero?: boolean } = {},
): Promise<void> {
  await page.addInitScript((op) => {
    if (!op.conDinero) localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (op.stats) localStorage.setItem('payme.app.mock.stats.v1', op.stats);
    if (op.platos) localStorage.setItem('payme.app.mock.platos.v1', op.platos);
    if (op.momentos) localStorage.setItem('payme.app.mock.momentos.v1', op.momentos);
    if (op.ingredientes) localStorage.setItem('payme.app.mock.ingredientes.v1', op.ingredientes);
  }, o);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const acceso = (page: Page) => page.getByRole('button', { name: /^Qué comes/ });
const tarjeta = (page: Page) => page.getByRole('region', { name: 'Tus platos más pedidos' });
const periodo = (page: Page) => page.getByRole('button', { name: /^Período: / });

test.describe('AF-31 · Qué comes (2c)', () => {
  test('se abre desde 2a: cinco platos con veces y monto, dónde se pidió al desplegar, y vuelve', async ({ page }) => {
    await preparar(page);
    // D479/D482 · el subtítulo del paquete: los platos distintos.
    await expect(acceso(page)).toContainText('7 platos distintos');
    await acceso(page).click();
    await expect(page).toHaveURL(/:\d+\/platos$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Qué comes' })).toBeVisible();
    await expect(tarjeta(page)).toBeVisible();
    await expect(tarjeta(page)).toContainText('7 platos distintos este mes');
    const filas = tarjeta(page).locator('.est-plato');
    await expect(filas).toHaveCount(5);
    // La fila: nombre, veces e importe; el restaurante, sólo al desplegar.
    await expect(filas.first()).toContainText('3 veces');
    await expect(filas.first()).not.toContainText('La Parolaccia');
    await expect(filas.last()).toContainText('2 veces');
    await filas.first().getByRole('button').click();
    await expect(filas.first().locator('.est-plato-lugar')).toHaveCount(1);
    await expect(filas.first().locator('.est-plato-lugar')).toContainText('La Parolaccia');
    await filas.last().getByRole('button').click();
    await expect(filas.last().locator('.est-plato-lugar')).toContainText('Hanzo Sushi');
    // Sin anillos (Claude Design 0.261).
    await expect(page.locator('svg circle')).toHaveCount(0);
    // En base consumo no hay propina que aclarar.
    await expect(page.getByText('Lo cobrado por cada plato, sin la propina.')).toHaveCount(0);
    // Las tres pestañas, en su orden: un control segmentado.
    await expect(page.getByRole('tablist', { name: 'Qué comes' }).getByRole('tab')).toHaveText(['Platos', 'Ingredientes', 'Momento']);
    await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'que-comes-tab-platos');
    await capturar(page, 'platos-01-2c');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(page).toHaveURL(/:\d+\/estadisticas$/);
  });

  test('con pagos, dice que el monto de cada plato no lleva propina', async ({ page }) => {
    await preparar(page, { conDinero: true });
    await acceso(page).click();
    await expect(page.getByText('Lo cobrado por cada plato, sin la propina.')).toBeVisible();
  });

  test('el período elegido en 2a rige en 2c', async ({ page }) => {
    await preparar(page);
    await page.getByRole('button', { name: /^Período: / }).click();
    await page.getByRole('radio', { name: /^Mes pasado/ }).click();
    await expect(page.locator('.est-total')).toHaveText('$1,320');
    await acceso(page).click();
    await expect(tarjeta(page)).toBeVisible();
    await expect(periodo(page)).toHaveText(MESES.anterior);
    await expect(tarjeta(page)).toContainText('platos distintos el mes pasado');
  });

  test('mes sin platos: el vacío', async ({ page }) => {
    await preparar(page, { stats: 'vacio' });
    await acceso(page).click();
    await expect(page.getByText('Todavía no registramos platos este mes.')).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
    await capturar(page, 'platos-02-2c-vacia');
  });

  test('backend anterior (404): el acceso NO se dibuja', async ({ page }) => {
    await preparar(page, { platos: 'antiguo' });
    await expect(page.getByRole('button', { name: /^Tus restaurantes/ })).toBeVisible();
    await expect(acceso(page)).toHaveCount(0);
    // E173-4 · sin la fila, el plato más pedido del mes queda en su tarjeta de antes: no se pierde.
    await expect(page.getByRole('heading', { name: 'Plato más pedido', exact: true })).toBeVisible();
    // Es un dato de este mes: con otro período no va.
    await page.getByRole('button', { name: /^Período: / }).click();
    await page.getByRole('radio', { name: /^Mes pasado/ }).click();
    await expect(page.locator('.est-total')).toHaveText('$1,320');
    await expect(page.getByRole('heading', { name: 'Plato más pedido', exact: true })).toHaveCount(0);
  });

  for (const costura of ['error', 'grande'] as const) {
    test(`${costura === 'error' ? 'error del servidor' : '413 stats_range_too_large'}: error con «Reintentar»`, async ({ page }) => {
      await preparar(page, { platos: costura });
      await acceso(page).click();
      await expect(page.getByText('No pudimos cargar tus platos')).toBeVisible();
      await page.evaluate(() => localStorage.removeItem('payme.app.mock.platos.v1'));
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(tarjeta(page).locator('.est-plato')).toHaveCount(5);
    });
  }

  test.describe('AF-32 · por momento del día (2e)', () => {
    const momentos = (page: Page) => page.getByRole('region', { name: 'Por momento del día' });

    test('la pestaña «Momento»: cuatro momentos con horario, visitas y monto; mismo total que 2a', async ({ page }) => {
      await preparar(page);
      await acceso(page).click();
      const pestanas = page.getByRole('tablist', { name: 'Qué comes' });
      await expect(pestanas.getByRole('tab')).toHaveText(['Platos', 'Ingredientes', 'Momento']);
      await pestanas.getByRole('tab', { name: 'Momento' }).click();
      await expect(momentos(page)).toBeVisible();
      const filas = momentos(page).getByRole('listitem');
      await expect(filas).toHaveCount(4);
      await expect(filas.nth(0)).toContainText('Desayuno');
      await expect(filas.nth(0)).toContainText('hasta las 12');
      await expect(filas.nth(3)).toContainText('Cena');
      await expect(filas.nth(3)).toContainText('desde las 19');
      // Las 6 visitas del mes, como 2a (el mismo modelo del mock).
      await expect(momentos(page)).toContainText('6 visitas este mes');
      // D482 · los cuatro momentos, también en cero, cada uno con su color fijo y el nombre al lado.
      await expect(momentos(page).locator('.est-cuadrito')).toHaveCount(4);
      await expect(page.getByText('Cada visita incluye la propina.')).toHaveCount(0);
      await capturar(page, 'momentos-01-2e');
    });

    test('mes sin visitas: el vacío de momentos', async ({ page }) => {
      await preparar(page, { stats: 'vacio' });
      await acceso(page).click();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(page.getByText('Todavía no registramos visitas este mes.')).toBeVisible();
      await expect(momentos(page)).toHaveCount(0);
      await capturar(page, 'momentos-02-2e-vacia');
    });

    test('el período elegido rige también en los momentos', async ({ page }) => {
      await preparar(page);
      await page.getByRole('button', { name: /^Período: / }).click();
      await page.getByRole('radio', { name: /^Mes pasado/ }).click();
      await expect(page.locator('.est-total')).toHaveText('$1,320');
      await acceso(page).click();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(momentos(page)).toContainText('5 visitas el mes pasado');
    });

    test('con pagos, dice que cada visita incluye la propina', async ({ page }) => {
      await preparar(page, { conDinero: true });
      await acceso(page).click();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(page.getByText('Cada visita incluye la propina.')).toBeVisible();
    });

    test('backend anterior (404 en momentos e ingredientes): no hay pestañas y 2c queda como estaba', async ({ page }) => {
      await preparar(page, { momentos: 'antiguo', ingredientes: 'antiguo' });
      await acceso(page).click();
      await expect(tarjeta(page)).toBeVisible();
      await expect(page.getByRole('tablist')).toHaveCount(0);
    });

    test('error de momentos: su cartel con «Reintentar», y los platos siguen', async ({ page }) => {
      await preparar(page, { momentos: 'error' });
      await acceso(page).click();
      await expect(tarjeta(page)).toBeVisible();
      await page.getByRole('tab', { name: 'Momento' }).click();
      await expect(page.getByText('No pudimos cargar tus momentos')).toBeVisible();
      await page.evaluate(() => localStorage.removeItem('payme.app.mock.momentos.v1'));
      await page.getByRole('button', { name: 'Reintentar' }).click();
      await expect(momentos(page).getByRole('listitem')).toHaveCount(4);
    });
  });
  test.describe('AF-38 · por ingrediente (2d)', () => {
    const region = (page: Page) => page.getByRole('region', { name: 'Por ingrediente principal' });
    const filas = (page: Page) => region(page).getByRole('listitem');
    const pesos = (txt: string) => Number(txt.replace(/[^0-9.]/g, ''));

    async function abrirIngrediente(page: Page): Promise<void> {
      await acceso(page).click();
      await page.getByRole('tablist', { name: 'Qué comes' }).getByRole('tab', { name: 'Ingredientes' }).click();
    }

    test('n178 · las tres pestañas; cada grupo con «N platos», su monto y su barra, «Otros» al final', async ({ page }) => {
      await preparar(page);
      // E173-4 · el total de 2a es `.est-total`.
      const total2a = (await page.locator('.est-total').textContent()) ?? '';
      expect(total2a).toBe('$2,165');
      await abrirIngrediente(page);
      await expect(page.getByRole('tab', { name: 'Ingredientes' })).toHaveAttribute('aria-selected', 'true');
      await expect(region(page)).toBeVisible();
      // D479/D482 · sin la nota «Los mismos N platos…»; K4 · «Clasificado por el nombre del plato» queda.
      await expect(region(page)).not.toContainText('Los mismos');
      await expect(region(page).getByText('Clasificado por el nombre del plato')).toBeVisible();
      // Este mes del mock: carnes, postres, alcohol, pastas y lo que no se reconoce.
      await expect(filas(page)).toHaveCount(5);
      await expect(filas(page).last()).toContainText('Otros');
      await expect(region(page)).toContainText('Bebidas con alcohol');
      // 🔴 Cada fila dice «N platos», como el diseño; ni visitas ni porcentaje.
      const textos = await filas(page).allTextContents();
      for (const fila of textos) {
        expect(fila).toMatch(/\d+ platos?/);
        expect(fila).not.toMatch(/\d+ visitas?/);
        expect(fila).not.toMatch(/\d+%/);
      }
      // 🔴 Son los mismos 7 platos de «Platos»: la suma de los grupos coincide.
      const cuentas = await filas(page).locator('.est-fila-abajo > span:last-child').allTextContents();
      const porFila = cuentas.map((f) => Number(/^(\d+) platos?$/.exec(f)?.[1]));
      expect(porFila.reduce((a, n) => a + n, 0)).toBe(7);
      // El dinero sigue en cada fila y suma lo de 2a.
      const montos = await region(page).locator('.est-fila-monto').allTextContents();
      expect(Math.round(montos.reduce((a, m) => a + pesos(m) * 100, 0))).toBe(216500);
      // Sin anillo: cuadrito y barra por grupo, con color fijo.
      await expect(region(page).locator('svg circle')).toHaveCount(0);
      await expect(region(page).locator('.est-barra')).toHaveCount(5);
      await capturar(page, 'ingrediente-01-con-datos');
    });

    test('🔴 n178 · con el dueño anterior (sin `dish_count`) cada fila dice sus visitas', async ({ page }) => {
      await preparar(page, { ingredientes: 'sin_platos' });
      await abrirIngrediente(page);
      await expect(filas(page)).toHaveCount(5);
      await expect(filas(page).first()).toContainText(/\d+ visitas?/);
      for (const fila of await filas(page).allTextContents()) {
        expect(fila).not.toMatch(/\d+ platos?/);
      }
    });

    test('🔴 «Otros» queda al final aunque sea el grupo MAYOR', async ({ page }) => {
      await preparar(page, { ingredientes: 'otros' });
      await abrirIngrediente(page);
      await expect(filas(page).last()).toContainText('Otros');
      const montos = (await region(page).locator('.est-fila-monto').allTextContents()).map(pesos);
      expect(montos[montos.length - 1]).toBe(Math.max(...montos));
      expect(montos[montos.length - 1]).toBeGreaterThan(montos[0]);
      await capturar(page, 'ingrediente-02-otros-grande');
    });

    test('🔴 una clave desconocida no rompe: se suma a «Otros» y la suma sigue igual', async ({ page }) => {
      await preparar(page, { ingredientes: 'desconocida' });
      await abrirIngrediente(page);
      await expect(filas(page).last()).toContainText('Otros');
      await expect(region(page)).not.toContainText('Postres');
      await expect(region(page)).not.toContainText('grains');
      const montos = await region(page).locator('.est-fila-monto').allTextContents();
      expect(Math.round(montos.reduce((a, m) => a + pesos(m) * 100, 0))).toBe(216500);
    });

    test('vacío: el período sin platos lo dice', async ({ page }) => {
      await preparar(page, { stats: 'vacio' });
      await abrirIngrediente(page);
      await expect(page.getByText('Todavía no registramos platos este mes.')).toBeVisible();
      await expect(region(page)).toHaveCount(0);
      await capturar(page, 'ingrediente-03-vacia');
    });

    test('🔴 backend anterior (404): la pestaña no se dibuja y quedan «Platos» y «Momento»', async ({ page }) => {
      await preparar(page, { ingredientes: 'antiguo' });
      await acceso(page).click();
      await expect(tarjeta(page)).toBeVisible();
      await expect(page.getByRole('tablist', { name: 'Qué comes' }).getByRole('tab')).toHaveText(['Platos', 'Momento']);
    });

    for (const costura of ['error', 'grande'] as const) {
      test(`${costura === 'error' ? 'error del servidor' : '413'}: su cartel con «Reintentar»`, async ({ page }) => {
        await preparar(page, { ingredientes: costura });
        await abrirIngrediente(page);
        await expect(page.getByText('No pudimos cargar tus ingredientes')).toBeVisible();
        await page.evaluate(() => localStorage.removeItem('payme.app.mock.ingredientes.v1'));
        await page.getByRole('button', { name: 'Reintentar' }).click();
        await expect(filas(page)).toHaveCount(5);
      });
    }

    test('con pagos: el pie dice que es lo cobrado, sin la propina', async ({ page }) => {
      await preparar(page, { conDinero: true });
      await abrirIngrediente(page);
      await expect(filas(page).first()).toContainText(/\d+ platos?/);
      await expect(page.getByText('Lo cobrado por cada plato, sin la propina.')).toBeVisible();
    });

    test('con pagos y el dueño anterior: visitas por fila y el pie de lo cobrado', async ({ page }) => {
      await preparar(page, { conDinero: true, ingredientes: 'sin_platos' });
      await abrirIngrediente(page);
      await expect(filas(page).first()).toContainText(/\d+ visitas?/);
      await expect(page.getByText('Lo cobrado por cada plato, sin la propina.')).toBeVisible();
    });

    test('el período elegido rige también acá', async ({ page }) => {
      await preparar(page);
      await page.getByRole('button', { name: /^Período: / }).click();
      await page.getByRole('radio', { name: /^Mes pasado/ }).click();
      await expect(page.locator('.est-total')).toHaveText('$1,320');
      await abrirIngrediente(page);
      // Los montos de las filas son los del mes elegido.
      const montos = await region(page).locator('.est-fila-monto').allTextContents();
      expect(Math.round(montos.reduce((a, m) => a + pesos(m) * 100, 0))).toBe(132000);
      await expect(periodo(page)).toHaveText(MESES.anterior);
    });

    test('el período elegido rige también con el dueño anterior', async ({ page }) => {
      await preparar(page, { ingredientes: 'sin_platos' });
      await page.getByRole('button', { name: /^Período: / }).click();
      await page.getByRole('radio', { name: /^Mes pasado/ }).click();
      await expect(page.locator('.est-total')).toHaveText('$1,320');
      await abrirIngrediente(page);
      const montos = await region(page).locator('.est-fila-monto').allTextContents();
      expect(Math.round(montos.reduce((a, m) => a + pesos(m) * 100, 0))).toBe(132000);
    });
  });
});
