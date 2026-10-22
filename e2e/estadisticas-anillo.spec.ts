import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { mesesDeMexico } from '../src/utils/meses';

const MESES = mesesDeMexico(new Date(), 'es');

/**
 * D449 conserva las 16 identidades históricas E173-4, incluidos sus títulos.
 * Sus oráculos visuales se trasladan del anillo a barras por cocina: 0/1/4/7,
 * colores, proporción, lista accesible, detalle inicial/reapertura, teclado,
 * fallback y móvil. El total ahora vive una sola vez en el resumen.
 * D448: 14 fixtures de presentación a 0 ms; dos medidas a 350 ms.
 */
async function preparar(page: Page, opciones: { costura?: string; sinDinero?: boolean; latencia?: 0 | 350 }): Promise<void> {
  await page.addInitScript(({ costura, sinDinero, latencia = 0 }) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    // D448: opt-in de esta fixture; setTimeout(0) conserva la respuesta asíncrona.
    localStorage.setItem('payme.app.mock.latencia.v1', String(latencia));
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
  test('🔴 consumo: reparto visible al entrar y detalle que se puede cerrar y reabrir', async ({ page }) => {
    await preparar(page, { costura: 'cuatro', sinDinero: true });
    await expect(tarjeta(page)).toBeVisible();
    await expect(page.getByText('Importe de lo que elegiste, agrupado por tipo de cocina del restaurante.', { exact: true })).toBeVisible();

    // Cabecera con período y estado; el total sólo en el resumen.
    await expect(burbuja(page)).toContainText(MESES.actual);
    await expect(page.locator('.est-total')).toHaveText('$770');
    await expect(burbuja(page)).not.toContainText(/visita|promedio/);

    // Texto accesible además de las barras decorativas; nunca sólo color.
    await expect(tarjeta(page).getByRole('list', { name: 'Detalle por cocina' })).toContainText('Italiana');
    const centro = tarjeta(page).locator('.est-cocinas-cantidad');
    await expect(centro).toHaveText(/^4\s*cocinas$/);
    await expect(centro).not.toContainText('$');
    await expect(tarjeta(page).locator('.est-cocina-barra')).toHaveCount(4);
    await expect(tarjeta(page).locator('.est-cocina-barra[aria-hidden="true"]')).toHaveCount(4);
    await expect(filas(page).nth(1)).toHaveText(/Japonesa.*32%/);
    await expect(filas(page).nth(2)).toHaveText(/Café.*17%/);

    // El reparto se entiende sin abrir nada; el control sigue permitiendo ocultarlo.
    await expect(detalle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(tarjeta(page).getByRole('list', { name: 'Detalle por cocina', exact: true })).toBeVisible();
    await expect(filas(page)).toHaveCount(4);
    await expect(filas(page).nth(0)).toHaveText(/Italiana.*3 visitas.*\$310.*40%/);
    await expect(filas(page).nth(3)).toHaveText(/Mexicana.*1 visita.*\$86\.50.*11%/);
    await expect(filas(page).first()).toBeVisible();
    await expect(filas(page).last()).toBeVisible();
    await detalle(page).click();
    await expect(detalle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(filas(page)).toHaveCount(0);
    await detalle(page).click();
    await expect(detalle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(filas(page)).toHaveCount(4);
    await expect(filas(page).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mis estadísticas', exact: true })).toBeAttached();
  });

  for (const [sinDinero, titulo, subtitulo] of [
    [true, 'Your selections by type of cuisine', "Value of your selections, grouped by the restaurant's type of cuisine."],
    [false, 'Your spending by type of cuisine', "Amount paid, minus refunds, grouped by the restaurant's type of cuisine."],
  ] as const) {
    test(`inglés y teclado: ${sinDinero ? 'selecciones' : 'pagos'} con reparto visible desde la entrada`, async ({ page }) => {
      await preparar(page, { costura: 'una', sinDinero });
      // Ingresar usa la fixture sintética en español; la preferencia de idioma se relee al recargar.
      await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
      await page.reload();
      const cocina = page.getByRole('region', { name: titulo, exact: true });
      const lista = cocina.getByRole('list', { name: 'Breakdown by cuisine', exact: true });
      const control = cocina.getByRole('button', { name: 'Breakdown by cuisine', exact: true });
      await expect(cocina).toBeVisible();
      await expect(cocina.getByText(subtitulo, { exact: true })).toBeVisible();
      await expect(lista).toBeVisible();
      await expect(lista.getByRole('listitem')).toHaveCount(1);
      await expect(lista.getByRole('listitem')).toContainText('Italian');
      await expect(lista.getByRole('listitem')).toContainText('100%');
      await expect(lista.getByRole('listitem')).toContainText('3 visits');
      await control.focus();
      await expect(control).toBeFocused();
      await control.press('Enter');
      await expect(control).toHaveAttribute('aria-expanded', 'false');
      await expect(lista).toHaveCount(0);
      await expect(control).toBeFocused();
      await control.press('Space');
      await expect(control).toHaveAttribute('aria-expanded', 'true');
      await expect(lista).toBeVisible();
      await expect(lista.getByRole('listitem')).toContainText('100%');
      await expect(control).toBeFocused();
    });
  }

  test('las tres filas con sus subtítulos de la especificación', async ({ page }) => {
    await preparar(page, { costura: 'cuatro', sinDinero: true });
    await expect(tarjeta(page)).toBeVisible();
    await expect(fila(page, /^Tus restaurantes/)).toContainText(/\d+ lugares distintos$/);
    await expect(fila(page, /^Tus restaurantes/)).not.toContainText(/visita|este mes|el mes pasado/);
    await expect(fila(page, /^Qué comes/)).toContainText(/ es lo más elegido · \d+ platos?$/);
    await expect(fila(page, /^Evolución/)).toContainText(/^EvoluciónPromedio mensual de los últimos 6 meses: \$[\d,]+(?:\.\d{2})?$/);

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
    await expect(page.getByText('Importe pagado, descontando reembolsos y agrupado por tipo de cocina del restaurante.', { exact: true })).toBeVisible();
    await expect(tarjeta(page).getByRole('list', { name: 'Detalle por cocina' })).toBeVisible();
    await expect(tarjeta(page).locator('.est-cocina-barra').first()).toBeVisible();
    await expect(filas(page).first()).toBeVisible();
  });

  test('una sola cocina: anillo entero, «1 cocina» y 100 %', async ({ page }) => {
    await preparar(page, { costura: 'una', sinDinero: true });
    await expect(tarjeta(page).locator('.est-cocinas-cantidad')).toHaveText(/^1\s*cocina$/);
    await expect(tarjeta(page).locator('.est-cocina-barra')).toHaveCount(1);
    await expect(tarjeta(page).locator('.est-cocina-barra > span')).toHaveAttribute('style', /width: 100%/);
    await expect(detalle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(filas(page)).toHaveCount(1);
    await expect(filas(page).first()).toBeVisible();
    await expect(filas(page).first()).toHaveText(/Italiana.*100%/);
  });

  test('🔴 siete cocinas: el anillo junta de la cuarta en adelante (cuatro colores), el detalle las muestra todas', async ({ page }) => {
    await preparar(page, { costura: 'siete', sinDinero: true });
    await expect(tarjeta(page).locator('.est-cocinas-cantidad')).toHaveText(/^7\s*cocinas$/);
    // Las siete barras mantienen la paleta; cada grupo tiene su barra propia.
    await expect(tarjeta(page).locator('.est-cocina-barra')).toHaveCount(7);
    const colores = await tarjeta(page).locator('.est-cocina-barra > span').evaluateAll((cs) => cs.map((c) => getComputedStyle(c).backgroundColor));
    expect(colores).toEqual(['rgb(18, 165, 180)', 'rgb(16, 30, 59)', 'rgb(111, 211, 222)', ...Array(4).fill('rgb(100, 116, 139)')]);
    await expect(filas(page)).toHaveCount(7);
    // Los grupos desconocidos mantienen su fallback y su importe; other sigue siendo Otros.
    await expect(filas(page).nth(4)).toHaveText(/Otra cocina.*1 visita.*\$62.*7%/);
    await expect(filas(page).nth(5)).toHaveText(/Otra cocina.*1 visita.*\$44.*5%/);
    await expect(filas(page).nth(6)).toHaveText(/Otros.*1 visita.*\$21.*2%/);
    await expect(filas(page).nth(6)).toBeVisible();
  });

  test('🔴 mes vacío: $0, las filas dicen qué falta y el anillo queda con su pista', async ({ page }) => {
    await preparar(page, { costura: 'vacio', sinDinero: true });
    await expect(page.locator('.est-total')).toHaveText('$0');
    const mes = MESES.actual.toLocaleLowerCase('es-MX');
    await expect(fila(page, /^Tus restaurantes/)).toContainText(`Sin visitas en ${mes}`);
    await expect(fila(page, /^Qué comes/)).toContainText(`Sin platos en ${mes}`);
    // Evolución no depende del mes: igual que siempre.
    await expect(fila(page, /^Evolución/)).toContainText('Promedio mensual de los últimos 6 meses:');
    await expect(tarjeta(page).locator('.est-cocina-barra')).toHaveCount(0);
    await expect(tarjeta(page).locator('.est-cocinas-cantidad')).toHaveText(/^—\s*Sin consumo$/);
    await expect(tarjeta(page).getByText('Sin consumo', { exact: true })).toBeVisible();
    await expect(tarjeta(page).getByText('Todavía no registramos consumos este mes', { exact: true })).toBeVisible();
    await expect(detalle(page)).toHaveCount(0);
    await expect(filas(page)).toHaveCount(0);
    await expect(tarjeta(page).getByRole('list', { name: 'Detalle por cocina', exact: true })).toHaveCount(0);
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
      // Las medidas leen accesos cargados en paralelo: conservan la latencia original.
      await preparar(page, { costura: 'cuatro', sinDinero: true, latencia: 350 });
      await expect(tarjeta(page)).toBeVisible();
      await expect(page.locator('.est-total')).toHaveCSS('font-size', ancho === 390 ? '34px' : '28px');
      await expect(page.locator('.est-total')).toHaveCSS('font-weight', '800');
      const medidas = await page.evaluate(() => {
        const caja = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const barra = caja('.est-cocina-barra');
        const relleno = caja('.est-cocina-barra > span');
        const filas = [...document.querySelectorAll('.stat-acceso')].map((f) => f.getBoundingClientRect().height);
        return {
          burbuja: caja('.est-burbuja').height,
          selector: caja('.est-burbuja .stat-burbuja-periodo').height,
          detalle: caja('.est-detalle').height,
          filas,
          barra: { ancho: barra.width, alto: barra.height, proporcion: relleno.width / barra.width },
          resumen: caja('.est-resumen').width,
          desborde: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(medidas.burbuja).toBeGreaterThanOrEqual(83);
      expect(medidas.selector).toBeGreaterThanOrEqual(44);
      expect(medidas.detalle).toBeGreaterThanOrEqual(44);
      for (const h of medidas.filas) expect(h).toBeGreaterThanOrEqual(64);
      expect(medidas.barra.ancho).toBeGreaterThan(200);
      expect(medidas.barra.alto).toBe(8);
      expect(medidas.barra.proporcion).toBeCloseTo(310 / 770, 3);
      expect(medidas.resumen).toBe(ancho - 32);
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
  // Capturas quietas con el reparto abierto desde la entrada.
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
      await expect(page.locator('.est-total')).toHaveText('$1,320');
      await capturar(page, `e173-estadisticas-${ancho}-${MESES.anterior.toLowerCase()}`);
      await expect(filas(page).first()).toBeVisible();
      await page.locator('.est-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(filas(page).last()).toBeInViewport();
      await capturar(page, `e173-estadisticas-${ancho}-${MESES.anterior.toLowerCase()}-detalle`);
    });

    test(`a ${ancho} px: mes vacío`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await preparar(page, { costura: 'vacio', sinDinero: true });
      await expect(page.locator('.est-total')).toHaveText('$0');
      await capturar(page, `e173-estadisticas-${ancho}-vacio`);
      // La tarjeta del anillo vacío, al fondo: el scroll es de la pantalla, no de la
      // página. Al fondo se ve también que el «+» no tapa la última tarjeta.
      await page.locator('.est-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(tarjeta(page).getByText('Todavía no registramos consumos este mes', { exact: true })).toBeInViewport();
      await capturar(page, `e173-estadisticas-${ancho}-vacio-anillo`);
    });
  }
});
