import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { mesesDeMexico } from '../src/utils/meses';

/** AF-36 · la burbuja dice el mes, calculado como la app: en hora de México. */
const MESES = mesesDeMexico(new Date(), 'es');

/**
 * AF-31 · el selector de período de «Mis estadísticas» (dueño v2.106.0).
 *
 * Mock: «Mes pasado» suma $1,320 en 5 visitas; este mes, $2,165 en 6. Son
 * distintos a propósito: si el período no cambiara de verdad, el test no pasa.
 */

async function preparar(page: Page, o: { stats?: string; periodo?: string } = {}): Promise<void> {
  await page.addInitScript((op) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (op.stats) localStorage.setItem('payme.app.mock.stats.v1', op.stats);
    if (op.periodo) localStorage.setItem('payme.app.mock.periodo.v1', op.periodo);
  }, o);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const selector = (page: Page) => page.getByRole('button', { name: /^Período: / });

async function elegir(page: Page, periodo: string): Promise<void> {
  await selector(page).click();
  await page.getByRole('radio', { name: new RegExp(`^${periodo}`) }).click();
}

test.describe('AF-31 · período de Mis estadísticas', () => {
  test('«Mes pasado» cambia el consumo, oculta lo que no se mueve y se conserva en 2b', async ({ page }) => {
    await preparar(page);
    const cabecera = page.locator('.est-cabecera');
    await expect(page.locator('.est-total')).toHaveText('$2,165');
    // D479/D482 · «Qué comes» dice los platos distintos; el plato más pedido no tiene tarjeta propia.
    await expect(page.getByRole('button', { name: /^Qué comes/ })).toContainText('7 platos distintos');
    await expect(page.getByRole('heading', { name: 'Plato más pedido' })).toHaveCount(0);

    await selector(page).click();
    // D479/D482 · un desplegable anclado al botón, no una hoja.
    const lista = page.getByRole('radiogroup', { name: 'Elige el período' });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(lista.getByRole('radio')).toHaveCount(4);
    await expect(lista.getByRole('radio', { name: /^Este mes/ })).toHaveAttribute('aria-checked', 'true');
    // AF-36 · cada opción conserva su nombre y lleva el mes al lado, en apagado.
    await expect(lista.getByRole('radio', { name: /^Este mes/ })).toContainText(MESES.actual);
    await expect(lista.getByRole('radio', { name: /^Mes pasado/ })).toContainText(MESES.anterior);
    await capturar(page, 'periodo-01-selector-abierto');
    await lista.getByRole('radio', { name: /^Mes pasado/ }).click();

    // AF-36 · la cabecera dice el MES, no «Mes pasado»; K1 (D482): «Mes completo» en letra chica.
    await expect(selector(page)).toHaveText(MESES.anterior);
    await expect(cabecera).not.toContainText('Mes pasado');
    await expect(cabecera.locator('.est-periodo-estado')).toHaveText('Mes completo');
    await expect(page.locator('.est-total')).toHaveText('$1,320');
    await expect(cabecera).not.toContainText('visitas');
    // D492 · la tarjeta de cocinas está oculta detrás de su bandera.
    await expect(page.getByRole('heading', { name: 'Por tipo de cocina', exact: true })).toHaveCount(0);
    // Lo que sale de pagos sin filtro de fecha NO se mezcla con otro período.
    await expect(page.getByRole('heading', { name: 'Plato más pedido' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Tus restaurantes/ })).toContainText('3 lugares · 5 visitas');
    await capturar(page, 'periodo-02-2a-mes-pasado');

    // 2b con el mismo período. Se espera a la pantalla 2b ANTES de mirar la
    // cabecera: si no, la de 2a satisface la aserción mientras 2b todavía no pintó.
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page).toHaveURL(/:\d+\/restaurantes$/);
    await expect(page.locator('.rest-card').first()).toBeVisible();
    await expect(page.locator('.rest-card')).toHaveCount(3);
    await expect(selector(page)).toHaveText(MESES.anterior);
    await expect(page.locator('.est-contexto')).toContainText('3 lugares');
    await page.getByRole('button', { name: 'Volver' }).click();
    await expect(selector(page)).toHaveText(MESES.anterior);
  });

  test('con el mes vacío el selector sigue: se puede ir a otro período', async ({ page }) => {
    await preparar(page, { stats: 'vacio' });
    // D479/D482 · el vacío es una frase, nunca un $0 grande (1g).
    await expect(page.locator('.est-total')).toHaveCount(0);
    await expect(page.getByText('Todavía no registramos consumos este mes.', { exact: true })).toBeVisible();
    await elegir(page, 'Mes pasado');
    await expect(page.locator('.est-total')).toHaveText('$1,320');
    await elegir(page, 'Este mes');
    await expect(page.getByText('Todavía no registramos consumos este mes.', { exact: true })).toBeVisible();
  });

  test('🔴 backend anterior (no devuelve `period`): no hay selector y dice el mes en curso', async ({ page }) => {
    await preparar(page, { periodo: 'antiguo' });
    await expect(page.locator('.est-total')).toHaveText('$2,165');
    await expect(page.locator('.est-periodo-quieto')).toHaveText(MESES.actual);
    await expect(selector(page)).toHaveCount(0);
  });

  test('🔴 un período PEDIDO que el dueño no confirma no se rotula: dice el mes que llegó', async ({ page }) => {
    await preparar(page);
    await elegir(page, 'Mes pasado');
    await expect(selector(page)).toHaveText(MESES.anterior);
    // Desde acá el backend ignora `?period=` y devuelve el mes en curso sin `period`.
    await page.evaluate(() => localStorage.setItem('payme.app.mock.periodo.v1', 'antiguo'));
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page.locator('.rest-card').first()).toBeVisible();
    await expect(page.locator('.est-periodo-quieto')).toHaveText(MESES.actual);
    await expect(page.locator('.est-cabecera')).not.toContainText(MESES.anterior);
  });

  test('🔴 la cabecera mide lo mismo en 2a, 2b, 2c y 2e, y el estado queda centrado con el botón', async ({ page }) => {
    await preparar(page);
    const medir = () => page.evaluate(() => {
      const c = document.querySelector('.est-cabecera')!.getBoundingClientRect();
      const boton = document.querySelector('.est-periodo-boton')!.getBoundingClientRect();
      const estado = document.querySelector('.est-periodo-estado')!.getBoundingClientRect();
      return { alto: Math.round(c.height), diferencia: Math.abs((boton.top + boton.height / 2) - (estado.top + estado.height / 2)) };
    });
    const altos: number[] = [];
    await expect(page.locator('.est-total')).toBeVisible();
    let m = await medir();
    expect(m.diferencia, '2a').toBeLessThanOrEqual(1);
    altos.push(m.alto);
    await capturar(page, 'cabecera-2a');

    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page.locator('.rest-card').first()).toBeVisible();
    m = await medir();
    expect(m.diferencia, '2b').toBeLessThanOrEqual(1);
    altos.push(m.alto);
    await page.getByRole('button', { name: 'Volver' }).click();

    await page.getByRole('button', { name: /^Qué comes/ }).click();
    await expect(page.getByRole('tab', { name: 'Momento' })).toBeVisible();
    await expect(page.locator('.est-periodo-estado')).toBeVisible();
    m = await medir();
    expect(m.diferencia, '2c').toBeLessThanOrEqual(1);
    altos.push(m.alto);

    await page.getByRole('tab', { name: 'Momento' }).click();
    await expect(page.locator('.est-periodo-estado')).toBeVisible();
    m = await medir();
    expect(m.diferencia, '2e').toBeLessThanOrEqual(1);
    altos.push(m.alto);

    expect(new Set(altos).size, `altos ${altos.join(', ')}`).toBe(1);
    await expect(selector(page)).toHaveText(MESES.actual);
  });
});
