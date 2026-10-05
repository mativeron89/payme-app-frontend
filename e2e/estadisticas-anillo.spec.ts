import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { mesesDeMexico } from '../src/utils/meses';

const MESES = mesesDeMexico(new Date(), 'es');

/**
 * E173-4 · decisión 173 · Estadísticas según la especificación de Claude Design
 * (`ops/…/claude-design-estadisticas-20261004/…/PANTALLA-estadisticas.md`).
 *
 * - La burbuja: el período y el total, sin visitas ni promedio; un mes sin
 *   consumo dice $0.00.
 * - Las filas: «{n} lugares distintos», «{plato} es lo más elegido · {n}
 *   platos», «Promedio mensual de los últimos 6 meses: {monto}».
 * - «Tu consumo por tipo de cocina»: anillo de 168 px, grosor 20, con su pista;
 *   el centro dice cuántas cocinas, sin montos; «Detalle por cocina» cerrado
 *   por defecto.
 *
 * `consumption_month` sigue siendo OPCIONAL: ausente o inválido ⇒ la pantalla
 * de siempre. Costura del mock `payme.app.mock.stats.v1`: `una`, `cuatro`,
 * `siete`, `vacio`, `ausente`, `raro`. Con el dinero del mock apagado es
 * «consumo»; encendido (default `sandbox`), «gasto».
 */
async function preparar(page: Page, opciones: { costura?: string; sinDinero?: boolean }): Promise<void> {
  await page.addInitScript(({ costura, sinDinero }) => {
    if (costura) localStorage.setItem('payme.app.mock.stats.v1', costura);
    if (sinDinero) localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  }, opciones);
  await ingresar(page);
  await page.goto('/#/estadisticas');
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const tarjeta = (page: Page) => page.getByRole('region', { name: /^Tu (consumo|gasto) por tipo de cocina$/ });
const burbuja = (page: Page) => page.locator('.est-burbuja');
const detalle = (page: Page) => tarjeta(page).getByRole('button', { name: 'Detalle por cocina', exact: true });
const filas = (page: Page) => tarjeta(page).getByRole('listitem');
const fila = (page: Page, nombre: RegExp) => page.getByRole('button', { name: nombre });

test.describe('E173-4 · Estadísticas (Claude Design)', () => {
  test('🔴 consumo: burbuja con el total solo, centro con las cocinas y detalle cerrado que se abre', async ({ page }) => {
    await preparar(page, { costura: 'cuatro', sinDinero: true });
    await expect(tarjeta(page)).toBeVisible();
    await expect(page.getByText('Lo que elegiste en tus mesas', { exact: true })).toBeVisible();

    // La burbuja: el mes y el total, sin visitas ni promedio.
    await expect(burbuja(page)).toContainText(MESES.actual);
    await expect(page.locator('.est-total')).toHaveText('$770.00');
    await expect(burbuja(page)).not.toContainText(/visita|promedio/);

    // El anillo: el reparto en su aria-label; el centro sin montos.
    await expect(page.getByRole('img', { name: 'Consumo por tipo de cocina: Italiana 40%, Japonesa 32%, Café 17%, Mexicana 11%' })).toBeVisible();
    const centro = tarjeta(page).locator('.stat-anillo-centro');
    await expect(centro).toHaveText(/^4\s*cocinas$/);
    await expect(centro).not.toContainText('$');
    // La pista y una porción por cocina.
    await expect(tarjeta(page).locator('circle')).toHaveCount(5);
    await expect(tarjeta(page).locator('circle.anillo-pista')).toHaveCount(1);

    // El detalle, cerrado por defecto; se abre y se cierra.
    await expect(detalle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(filas(page)).toHaveCount(0);
    await detalle(page).click();
    await expect(detalle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(filas(page)).toHaveCount(4);
    await expect(filas(page).nth(0)).toHaveText(/Italiana.*3 visitas.*\$310\.00.*40%/);
    await expect(filas(page).nth(3)).toHaveText(/Mexicana.*1 visita.*\$86\.50.*11%/);
    await detalle(page).click();
    await expect(filas(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Mis estadísticas', exact: true })).toBeAttached();
  });

  test('las tres filas con sus subtítulos de la especificación', async ({ page }) => {
    await preparar(page, { costura: 'cuatro', sinDinero: true });
    await expect(tarjeta(page)).toBeVisible();
    await expect(fila(page, /^Tus restaurantes/)).toContainText(/\d+ lugares distintos$/);
    await expect(fila(page, /^Tus restaurantes/)).not.toContainText(/visita|este mes|el mes pasado/);
    await expect(fila(page, /^Qué comes/)).toContainText(/ es lo más elegido · \d+ platos?$/);
    await expect(fila(page, /^Evolución/)).toContainText(/^EvoluciónPromedio mensual de los últimos 6 meses: \$[\d,]+\.\d{2}$/);

    // Los platos de la fila son `distinctDishes`, el mismo número que «Qué comes»
    // pone al centro de su anillo (no «distintos − 1», como decía «y N platos más»).
    const platos = Number(/ · (\d+) platos?$/.exec((await fila(page, /^Qué comes/).textContent()) ?? '')?.[1]);
    expect(platos).toBeGreaterThan(1);
    await fila(page, /^Qué comes/).click();
    await expect(page.locator('.stat-anillo-total')).toHaveText(String(platos));
  });

  test('con pagos es «gasto»', async ({ page }) => {
    await preparar(page, {});
    await expect(page.getByRole('heading', { name: 'Tu gasto por tipo de cocina', exact: true })).toBeVisible();
    await expect(page.getByText('Lo que pagaste, descontando reembolsos', { exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /^Gasto por tipo de cocina: / })).toBeVisible();
  });

  test('una sola cocina: anillo entero, «1 cocina» y 100 %', async ({ page }) => {
    await preparar(page, { costura: 'una', sinDinero: true });
    await expect(tarjeta(page).locator('.stat-anillo-centro')).toHaveText(/^1\s*cocina$/);
    await expect(tarjeta(page).locator('circle')).toHaveCount(2);
    await detalle(page).click();
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page).first()).toHaveText(/Italiana.*100%/);
  });

  test('🔴 siete cocinas: el anillo junta de la cuarta en adelante (cuatro colores), el detalle las muestra todas', async ({ page }) => {
    await preparar(page, { costura: 'siete', sinDinero: true });
    await expect(tarjeta(page).locator('.stat-anillo-centro')).toHaveText(/^7\s*cocinas$/);
    // La pista y cuatro porciones.
    await expect(tarjeta(page).locator('circle')).toHaveCount(5);
    const colores = await tarjeta(page).locator('g circle').evaluateAll((cs) => cs.map((c) => c.getAttribute('stroke')));
    expect(colores).toEqual(['#0FB5C9', '#101E3B', '#6FD3DE', '#64748B']);
    await detalle(page).click();
    await expect(filas(page)).toHaveCount(7);
  });

  test('🔴 mes vacío: $0.00, las filas dicen qué falta y el anillo queda con su pista', async ({ page }) => {
    await preparar(page, { costura: 'vacio', sinDinero: true });
    await expect(page.locator('.est-total')).toHaveText('$0.00');
    const mes = MESES.actual.toLocaleLowerCase('es-MX');
    await expect(fila(page, /^Tus restaurantes/)).toContainText(`Sin visitas en ${mes}`);
    await expect(fila(page, /^Qué comes/)).toContainText(`Sin platos en ${mes}`);
    // Evolución no depende del mes: igual que siempre.
    await expect(fila(page, /^Evolución/)).toContainText('Promedio mensual de los últimos 6 meses:');
    await expect(tarjeta(page).locator('circle')).toHaveCount(1);
    await expect(tarjeta(page).locator('.stat-anillo-centro')).toHaveText(/^—\s*Sin consumo$/);
    await expect(page.getByRole('img', { name: 'Consumo por tipo de cocina: Sin consumo' })).toBeVisible();
    await expect(tarjeta(page).getByText('Todavía no registramos consumos este mes', { exact: true })).toBeVisible();
    await expect(detalle(page)).toHaveCount(0);
  });

  for (const costura of ['ausente', 'raro'] as const) {
    test(`campo ${costura === 'ausente' ? 'ausente (backend anterior)' : 'inválido'}: la pantalla de siempre`, async ({ page }) => {
      await preparar(page, { costura, sinDinero: true });
      // Testigo positivo: la pantalla de siempre, con su ancla.
      await expect(page.getByText('Promedio por visita', { exact: true })).toBeVisible();
      await expect(tarjeta(page)).toHaveCount(0);
      await expect(burbuja(page)).toHaveCount(0);
    });
  }
});

test.describe('E173-4 · las medidas de la especificación', () => {
  for (const [ancho, alto, total] of [[390, 844, '26px'], [320, 568, '21px']] as const) {
    test(`a ${ancho} px: burbuja de 83, total de ${total}, filas de 64, anillo de 168 y el «+» sin tapar la última tarjeta`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await preparar(page, { costura: 'cuatro', sinDinero: true });
      await expect(tarjeta(page)).toBeVisible();
      await expect(page.locator('.est-total')).toHaveCSS('font-size', total);
      await expect(page.locator('.est-total')).toHaveCSS('font-weight', '800');
      const medidas = await page.evaluate(() => {
        const caja = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const svg = document.querySelector('.est-cocinas svg')!;
        const filas = [...document.querySelectorAll('.stat-acceso')].map((f) => f.getBoundingClientRect().height);
        const anillo = svg.querySelector('g circle')!;
        return {
          burbuja: caja('.est-burbuja').height,
          selector: caja('.est-burbuja .stat-burbuja-periodo').height,
          detalle: caja('.est-detalle').height,
          filas,
          svg: { ancho: svg.getBoundingClientRect().width, caja: svg.getAttribute('viewBox') },
          anillo: { r: anillo.getAttribute('r'), grosor: anillo.parentElement!.getAttribute('stroke-width') },
          desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(medidas.burbuja).toBeGreaterThanOrEqual(83);
      expect(medidas.selector).toBeGreaterThanOrEqual(44);
      expect(medidas.detalle).toBeGreaterThanOrEqual(44);
      for (const h of medidas.filas) expect(h).toBeGreaterThanOrEqual(64);
      expect(medidas.svg).toEqual({ ancho: 168, caja: '0 0 168 168' });
      expect(medidas.anillo).toEqual({ r: '74', grosor: '20' });
      expect(medidas.desborde).toBe(0);

      // Al final del scroll, el «+» no tapa la última tarjeta.
      await page.locator('.est-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const [ultima, mas] = await Promise.all([
        tarjeta(page).boundingBox(),
        page.locator('.appbar-fab').boundingBox(),
      ]);
      expect(ultima!.y + ultima!.height).toBeLessThanOrEqual(mas!.y);
    });
  }
});

test.describe('E173-4 · capturas para Mati', () => {
  // Captura quieta: sin esto la flecha de «Detalle por cocina» sale a mitad de su giro de 0,2 s
  // (la regla de `prefers-reduced-motion` lo apaga).
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });
  for (const [ancho, alto] of [[390, 844], [320, 568]] as const) {
    test(`a ${ancho} px: septiembre con datos (y su detalle) y un mes vacío`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await preparar(page, { sinDinero: true });
      await expect(tarjeta(page)).toBeVisible();
      await page.getByRole('button', { name: /^Período: / }).click();
      await page.getByRole('radio', { name: /^Mes pasado/ }).click();
      await expect(burbuja(page)).toContainText(MESES.anterior);
      await expect(page.locator('.est-total')).toHaveText('$1,320.00');
      await capturar(page, `e173-estadisticas-${ancho}-${MESES.anterior.toLowerCase()}`);
      await detalle(page).click();
      await expect(filas(page).first()).toBeVisible();
      await page.locator('.est-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(filas(page).last()).toBeInViewport();
      await capturar(page, `e173-estadisticas-${ancho}-${MESES.anterior.toLowerCase()}-detalle`);
    });

    test(`a ${ancho} px: mes vacío`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await preparar(page, { costura: 'vacio', sinDinero: true });
      await expect(page.locator('.est-total')).toHaveText('$0.00');
      await capturar(page, `e173-estadisticas-${ancho}-vacio`);
      // La tarjeta del anillo vacío, al fondo: el scroll es de la pantalla, no de la
      // página. Al fondo se ve también que el «+» no tapa la última tarjeta.
      await page.locator('.est-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(tarjeta(page).getByText('Todavía no registramos consumos este mes', { exact: true })).toBeInViewport();
      await capturar(page, `e173-estadisticas-${ancho}-vacio-anillo`);
    });
  }
});
