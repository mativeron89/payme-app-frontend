import { expect, test, type Page } from '@playwright/test';
import type { Evolucion } from '../src/api/evolucion';
import { ingresar } from './_app';

type Modo = 'normal' | 'base-cero' | 'ausente' | 'error' | 'otra-base' | 'fecha-invalida' | 'vacio' | 'promedio-incoherente' | 'tardia';

/** Fixture sintética y efímera de presentación; contratos y mock global intactos. */
async function preparar(page: Page, modo: Modo = 'normal', ingles = false): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-10-21T18:00:00Z'));
  await page.addInitScript(() => {
    if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await ingresar(page);
  if (ingles) {
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
  }
  await page.evaluate(async (modo) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const rutaHttp = '/src/api/http.ts';
    const { HttpError } = await import(/* @vite-ignore */ rutaHttp) as typeof import('../src/api/http');
    const rutaPeriodo = '/src/api/periodoEstadisticas.ts';
    const { periodoActual } = await import(/* @vite-ignore */ rutaPeriodo) as typeof import('../src/api/periodoEstadisticas');
    const original = api.getStats.bind(api);
    api.getStats = async (period) => {
      const datos = await original(period);
      const total = modo === 'vacio' ? 0 : period === 'this_year' ? 30003 : period === 'last_3_months' ? 20002 : 10001;
      const visitas = modo === 'vacio' ? 0 : period === 'this_year' ? 9 : period === 'last_3_months' ? 6 : 3;
      return { ...datos, consumption_month: {
        basis: 'consumption', total_cents: total, visits: visitas,
        avg_per_visit_cents: modo === 'promedio-incoherente' ? 3334 : visitas ? Math.floor(total / visitas) : 0,
        categories: total ? [{ category: 'italian', amount_cents: total, visits: visitas }] : [],
      } };
    };
    let retenerMesPasado = false;
    if (modo === 'tardia') {
      (window as unknown as { armarRetencionD449: () => void }).armarRetencionD449 = () => { retenerMesPasado = true; };
    }
    api.getStatsEvolution = async () => {
      if (modo === 'ausente') throw new HttpError(404, null);
      if (modo === 'error') throw new Error('fixture_comparacion_no_disponible');
      const months = Array.from({ length: 6 }, (_, i) => {
        const totalCents = modo === 'base-cero' && i === 3 ? 0 : [0, 10000, 0, 10000, 15000, 999900][i];
        return {
          monthStart: new Date(Date.UTC(2026, 4 + i, 1, 6)).toISOString(),
          totalCents, visits: totalCents ? (i === 3 ? 2 : 3) : 0,
          categories: totalCents ? [{ category: 'italian', amountCents: totalCents, visits: i === 3 ? 2 : 3 }] : [],
        };
      });
      if (modo === 'fecha-invalida') months[3].monthStart = '2026-08-01T00:00:00.000Z';
      const totalCents = months.reduce((n, m) => n + m.totalCents, 0);
      const datos: Evolucion = { basis: modo === 'otra-base' ? 'payments' : 'consumption', months, totalCents, avgPerMonthCents: Math.floor(totalCents / 6) };
      if (modo === 'tardia' && retenerMesPasado && periodoActual() === 'last_month') {
        retenerMesPasado = false;
        // Se arma tras la carga inicial: retiene sólo la próxima respuesta de Mes pasado.
        // Los efectos dobles de montaje de StrictMode conservan sus respuestas normales.
        const tardia = { ...datos, months: months.map((m, i) => i === 4 ? { ...m, totalCents: 888800, categories: [{ category: 'italian', amountCents: 888800, visits: m.visits }] } : m) };
        const suma = tardia.months.reduce((n, m) => n + m.totalCents, 0);
        return new Promise<Evolucion>((resolve) => {
          (window as unknown as { liberarD449: () => void }).liberarD449 = () => resolve({ ...tardia, totalCents: suma, avgPerMonthCents: Math.floor(suma / 6) });
        });
      }
      return datos;
    };
  }, modo);
  // Navegación en el mismo documento: conserva sólo esta fixture efímera.
  await page.evaluate(() => { location.hash = '#/estadisticas'; });
  await expect(page.locator('.est-resumen')).toBeVisible();
}

const comparacion = (page: Page) => page.getByRole('region', { name: 'Meses completos', exact: true });
const resumen = (page: Page) => page.getByRole('region', { name: 'Tu consumo registrado', exact: true });
async function periodo(page: Page, nombre: string): Promise<void> {
  await page.getByRole('button', { name: /^Período: / }).click();
  await page.getByRole('radio', { name: new RegExp(`^${nombre}`) }).click();
}

test('D449 · resumen acreditado y dos meses completos, excluyendo el actual', async ({ page }) => {
  await preparar(page);
  await expect(resumen(page).locator('.est-total')).toHaveText('$100.01');
  await expect(resumen(page).locator('dd')).toHaveText(['3', '$33.33']);
  await expect(page.locator('.est-cabecera')).not.toContainText('$');
  await expect(page.locator('.est-periodo-estado')).toHaveText('En curso');
  const c = comparacion(page);
  // D479/D482 · T4 · «Agosto 2026»: mayúscula inicial sola.
  await expect(c.locator('.est-mes h3')).toHaveText(['Agosto 2026', 'Septiembre 2026']);
  await expect(c.locator('.est-mes strong')).toHaveText(['$100', '$150']);
  await expect(c.locator('.est-diferencias dd')).toHaveText(['+$50 (+50%)', '+1', '$0']);
  // D479/D482 · la base se rotula en la fila («Consumo»), sin «· MXN»; la nota del promedio vive en Evolución.
  await expect(c.locator('.est-diferencias dt').first()).toHaveText('Consumo');
  await expect(c).toContainText('Septiembre frente a agosto. No cambia con el período.');
  await expect(c).not.toContainText('$9,999');
});

test('D449 · agregados identificados, comparación independiente y selector accesible', async ({ page }) => {
  await preparar(page);
  const selector = page.getByRole('button', { name: /^Período: / });
  await selector.focus();
  await selector.press('Enter');
  await page.getByRole('radio', { name: /^Últimos 3 meses/ }).press('Enter');
  await expect(resumen(page).locator('.est-total')).toHaveText('$200.02');
  await expect(resumen(page).locator('dd')).toHaveText(['6', '$33.33']);
  await expect(page.locator('.est-periodo-estado')).toHaveText('En curso');
  await expect(comparacion(page)).toContainText('No cambia con el período.');
  await expect(comparacion(page).locator('.est-mes strong')).toHaveText(['$100', '$150']);
  await periodo(page, 'Este año');
  await expect(resumen(page).locator('.est-total')).toHaveText('$300.03');
  await expect(resumen(page).locator('dd')).toHaveText(['9', '$33.33']);
  await expect(comparacion(page).locator('.est-mes strong')).toHaveText(['$100', '$150']);
  await periodo(page, 'Mes pasado');
  await expect(page.locator('.est-periodo-estado')).toHaveText('Mes completo');
  await expect(resumen(page).locator('.est-total')).toHaveText('$100.01');
  for (const nombre of ['Tus restaurantes', 'Qué comes', 'Evolución']) await expect(page.getByRole('button', { name: new RegExp(`^${nombre}`) })).toBeVisible();
});

test('D449 · base cero: diferencia monetaria sin porcentaje ni promedio inventado', async ({ page }) => {
  await preparar(page, 'base-cero');
  const c = comparacion(page);
  await expect(c.locator('.est-mes strong')).toHaveText(['$0', '$150']);
  await expect(c.locator('.est-diferencias dd')).toHaveText(['+$150', '+3', 'No disponible']);
  await expect(c).toContainText('Sin porcentaje: agosto está en $0.');
  await expect(c).not.toContainText('%');
});

for (const modo of ['ausente', 'error', 'otra-base', 'fecha-invalida'] as const) {
  test(`D449 · ${modo}: no convertir falta de comparación en cero`, async ({ page }) => {
    await preparar(page, modo);
    const c = comparacion(page);
    await expect(c).toHaveAttribute('aria-busy', 'false');
    // v0.260.1 · un fallo de lectura tiene su propio texto; ausencia y datos no comparables conservan el de siempre.
    await expect(c).toContainText(modo === 'error'
      ? 'No pudimos cargar la comparación. Intenta de nuevo más tarde.'
      : 'No hay datos comparables para estos dos meses completos.');
    await expect(c.locator('.est-mes')).toHaveCount(0);
    await expect(c).not.toContainText('$0');
    await expect(resumen(page).locator('.est-total')).toHaveText('$100.01');
    if (modo === 'ausente') await expect(page.getByRole('button', { name: /^Evolución/ })).toHaveCount(0);
    else await expect(page.getByRole('button', { name: /^Evolución/ })).toBeVisible();
  });
}

for (const modo of ['vacio', 'promedio-incoherente'] as const) {
  test(`D449 · ${modo}: promedio no disponible y total acreditado`, async ({ page }) => {
    await preparar(page, modo);
    // D479/D482 · 1g · sin consumos, una frase y no un $0 grande.
    if (modo === 'vacio') {
      await expect(resumen(page).locator('.est-total')).toHaveCount(0);
      await expect(resumen(page).locator('.est-vacio')).toHaveText('Todavía no registramos consumos este mes.');
    } else {
      await expect(resumen(page).locator('.est-total')).toHaveText('$100.01');
    }
    await expect(resumen(page).locator('dd')).toHaveText([modo === 'vacio' ? '0' : '3', 'No disponible']);
    await expect(comparacion(page).locator('.est-mes strong')).toHaveText(['$100', '$150']);
  });
}

test('D449 · inglés y teclado conservan rótulos, resumen y comparación', async ({ page }) => {
  await preparar(page, 'normal', true);
  const c = page.getByRole('region', { name: 'Complete months', exact: true });
  // D479/D482 · el inglés confirmado por Mati: «orders».
  await expect(page.getByRole('region', { name: 'Your recorded orders', exact: true })).not.toContainText('MXN');
  await expect(c.locator('.est-mes h3')).toHaveText(['August 2026', 'September 2026']);
  await expect(c.locator('.est-diferencias dt').first()).toHaveText('Orders');
  await expect(c).toContainText("September versus August. Doesn't change with the period.");
  const selector = page.getByRole('button', { name: /^Period: / });
  await selector.focus();
  await selector.press('Enter');
  await page.getByRole('radio', { name: /^Last month/ }).press('Enter');
  await expect(page.locator('.est-periodo-estado')).toHaveText('Complete month');
  await expect(c.locator('.est-mes strong')).toHaveText(['$100', '$150']);
});

test('D449 · respuesta antigua de evolución no pisa la tanda del nuevo período', async ({ page }) => {
  await preparar(page, 'tardia');
  await expect(comparacion(page).locator('.est-mes strong')).toHaveText(['$100', '$150']);
  await page.evaluate(() => {
    (window as unknown as { armarRetencionD449: () => void }).armarRetencionD449();
  });
  await periodo(page, 'Mes pasado');
  await expect(page.locator('.est-periodo-estado')).toHaveText('Mes completo');
  await expect(comparacion(page)).toHaveAttribute('aria-busy', 'true');
  await expect(comparacion(page)).toContainText('Cargando comparación…');
  await expect(comparacion(page).locator('.est-mes')).toHaveCount(0);
  await periodo(page, 'Este año');
  await expect(resumen(page).locator('.est-total')).toHaveText('$300.03');
  await expect(comparacion(page)).toHaveAttribute('aria-busy', 'false');
  await expect(comparacion(page).locator('.est-mes strong')).toHaveText(['$100', '$150']);
  await page.evaluate(async () => {
    (window as unknown as { liberarD449: () => void }).liberarD449();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await expect(comparacion(page).locator('.est-mes strong')).toHaveText(['$100', '$150']);
  await expect(comparacion(page)).not.toContainText('$8,888');
  await expect(resumen(page).locator('.est-total')).toHaveText('$300.03');
});
