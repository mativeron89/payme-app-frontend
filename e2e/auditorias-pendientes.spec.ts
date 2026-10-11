import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * AF-AUDITORIAS-PENDIENTES-Y-TICKET-CERRADO-20261011 (0.239.1) · lo que faltó en 0.238.0 y lo nuevo, punto por punto:
 * F-03 (la coma decimal), F-02 (el período viejo), F-13 (el teclado de Qué comes), V-02 (el ticket de un viaje cerrado
 * desde Estadísticas), D279 (cerrar y salir en Configuración; el aviso en el viaje) y D280 («+ Gasto»). F-14 (el
 * comprobante en inglés) no se alcanza en el navegador: el comprobante sale después de pagar y los pagos están
 * cortados (`pago-completo.spec.ts` se saltea por lo mismo); lo cubre `src/i18n/traduccion.test.ts` sobre todo el
 * diccionario.
 */
test.use({ viewport: { width: 375, height: 812 } });

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const ESTADO_VIAJES = 'payme.app.mock.viajes.estado.v1';
const AMBIGUO = 'No sabemos si es con decimales o con miles. Escríbelo sin separador de miles: 1250 o 12.50.';

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  // D276-1 · el día de la corrida no decide a dónde va «Nueva» (`_app.ts`).
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

/** Navegación de la app (sin recargar). */
async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/auditorias-${page.viewportSize()!.width}-${nombre}.png` });
}

test.describe('🔴 1 · F-03 · la coma decimal en la Carga manual', () => {
  test('«12,50» son $12.50: el total lo dice, se guarda así y Balance lo muestra así (antes, $1,250)', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill('Taxi coma');
    await page.getByLabel('Monto', { exact: true }).fill('12,50');
    await expect(page.getByText('Total $12.50', { exact: true })).toBeVisible();
    await capturar(page, 'f03-coma');
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    await ir(page, `/viaje-balance/${CANCUN}`);
    await expect(page.locator('.vjb-consumo').filter({ hasText: 'Taxi coma' })).toContainText('$12.50');
    await expect(page.locator('.vjb-consumo').filter({ hasText: 'Taxi coma' })).not.toContainText('$1,250');
  });

  test('🔴 «1.250» no se adivina: el aviso, sin total y «Listo» apagado; escrito sin ambigüedad, sí', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill('Hotel');
    const monto = page.getByLabel('Monto', { exact: true });
    await monto.fill('1.250');
    await expect(page.getByText(AMBIGUO, { exact: true })).toBeVisible();
    await expect(page.getByText(/^Total \$/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeDisabled();
    await capturar(page, 'f03-ambiguo');
    for (const [texto, total] of [['1250', '$1,250'], ['1.250,00', '$1,250'], ['1,250', '$1,250']] as const) {
      await monto.fill(texto);
      await expect(page.getByText(AMBIGUO, { exact: true })).toHaveCount(0);
      await expect(page.getByText(`Total ${total}`, { exact: true })).toBeVisible();
    }
  });

  test('«¿Quién pagó?» con montos ajustados lee igual: «1.250» lo dice el aviso', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill('Cena');
    await page.getByLabel('Monto', { exact: true }).fill('1300');
    const grupo = page.getByRole('group', { name: '¿Quién pagó?', exact: true });
    await grupo.getByRole('checkbox', { name: /^Luis Pérez/ }).click();
    await page.getByRole('button', { name: 'Ajustar montos', exact: true }).click();
    await page.getByLabel('Cuánto pagaste tú', { exact: true }).fill('1.250');
    await page.getByLabel('Cuánto pagó Luis Pérez', { exact: true }).fill('50');
    await expect(page.getByText(AMBIGUO, { exact: true })).toBeVisible();
    await page.getByLabel('Cuánto pagaste tú', { exact: true }).fill('1,250');
    await expect(page.getByText(AMBIGUO, { exact: true })).toHaveCount(0);
    await expect(page.getByText('Suman $1,300 de $1,300', { exact: true })).toBeVisible();
  });
});

/**
 * F-02 · como la prueba de Codex: la fachada se envuelve en la página (el mismo módulo que usa la app) para retener
 * las respuestas de «Mes pasado» y «Últimos 3 meses», marcadas con su período; se resuelven al revés (primero la
 * nueva) y la vieja no puede pisar lo que se ve. El período se cambia con el módulo de la app: mientras carga, el
 * selector no se ve.
 */
type Metodo = 'getStatsRestaurants' | 'getStatsDishes';
async function retener(page: Page, metodo: Metodo, marca: 'nombres' | 'vaciar-mes-pasado'): Promise<void> {
  await page.evaluate(async ({ metodo, marca, ruta }) => {
    const { api } = (await import(/* @vite-ignore */ ruta)) as { api: Record<string, (p?: string) => Promise<Record<string, unknown>>> };
    const original = api[metodo]!.bind(api);
    const w = window as unknown as { soltar: Record<string, () => void> };
    w.soltar = {};
    api[metodo] = async (period?: string) => {
      const valor = await original(period);
      let marcado = valor;
      if (marca === 'nombres') {
        const lista = metodo === 'getStatsRestaurants' ? 'restaurants' : 'dishes';
        marcado = { ...valor, [lista]: (valor[lista] as Array<{ name: string }>).map((x) => ({ ...x, name: `${x.name} · ${period}` })) };
      } else if (period === 'last_month') {
        marcado = { ...valor, restaurants: [] };
      }
      if (period === 'last_month' || period === 'last_3_months') await new Promise<void>((r) => { w.soltar[period] = r; });
      return marcado;
    };
  }, { metodo, marca, ruta: '/src/api/index.ts' });
}

async function elegirPeriodo(page: Page, clave: 'last_month' | 'last_3_months'): Promise<void> {
  await page.evaluate(async ({ clave, ruta }) => {
    const m = (await import(/* @vite-ignore */ ruta)) as { elegirPeriodo: (c: string) => void };
    m.elegirPeriodo(clave);
  }, { clave, ruta: '/src/api/periodoEstadisticas.ts' });
  await expect.poll(() => page.evaluate((c) => typeof (window as unknown as { soltar: Record<string, unknown> }).soltar[c], clave))
    .toBe('function');
}

async function soltar(page: Page, clave: 'last_month' | 'last_3_months'): Promise<void> {
  await page.evaluate((c) => (window as unknown as { soltar: Record<string, () => void> }).soltar[c]!(), clave);
}

/** Dos cuadros: lo que la vieja haría ya estaría pintado. */
async function dosCuadros(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe('🔴 2 · F-02 · una respuesta vieja no pisa el período nuevo', () => {
  test('Tus restaurantes', async ({ page }) => {
    await ingresar(page);
    await page.goto('/estadisticas');
    await retener(page, 'getStatsRestaurants', 'nombres');
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    await expect(page.getByText(/ · this_month$/).first()).toBeVisible();
    await elegirPeriodo(page, 'last_month');
    await elegirPeriodo(page, 'last_3_months');
    await soltar(page, 'last_3_months');
    await expect(page.getByText(/ · last_3_months$/).first()).toBeVisible();
    await soltar(page, 'last_month');
    await dosCuadros(page);
    await expect(page.getByText(/ · last_month$/)).toHaveCount(0);
    await expect(page.getByText(/ · last_3_months$/).first()).toBeVisible();
  });

  test('Estadísticas (el acceso a Tus restaurantes)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/estadisticas');
    const acceso = page.getByRole('button', { name: /^Tus restaurantes/ });
    await expect(acceso).toContainText(/lugar(es)? distintos?/);
    await retener(page, 'getStatsRestaurants', 'vaciar-mes-pasado');
    await elegirPeriodo(page, 'last_month');
    await elegirPeriodo(page, 'last_3_months');
    await soltar(page, 'last_3_months');
    await expect(acceso).toContainText(/lugar(es)? distintos?/);
    // La vieja (mes pasado, sin visitas) llega después: no se escribe.
    await soltar(page, 'last_month');
    await dosCuadros(page);
    await expect(acceso).toContainText(/lugar(es)? distintos?/);
    await expect(acceso).not.toContainText('Sin visitas');
  });

  test('Qué comes', async ({ page }) => {
    await ingresar(page);
    await page.goto('/estadisticas');
    await retener(page, 'getStatsDishes', 'nombres');
    await ir(page, '/platos');
    await expect(page.getByText(/ · this_month$/).first()).toBeVisible();
    await elegirPeriodo(page, 'last_month');
    await elegirPeriodo(page, 'last_3_months');
    await soltar(page, 'last_3_months');
    await expect(page.getByText(/ · last_3_months$/).first()).toBeVisible();
    await soltar(page, 'last_month');
    await dosCuadros(page);
    await expect(page.getByText(/ · last_month$/)).toHaveCount(0);
    await expect(page.getByText(/ · last_3_months$/).first()).toBeVisible();
  });
});

test.describe('🔴 3 · F-13 · las pestañas de Qué comes, con el teclado', () => {
  test('las flechas, Inicio y Fin eligen y llevan el foco; Tab sale de las pestañas', async ({ page }) => {
    await ingresar(page);
    await page.goto('/platos');
    const tab = (n: string) => page.getByRole('tab', { name: n, exact: true });
    await expect(tab('Momento')).toBeVisible();
    await tab('Platos').focus();
    for (const [tecla, destino] of [
      ['ArrowRight', 'Ingrediente'], ['ArrowRight', 'Momento'], ['ArrowRight', 'Platos'],
      ['ArrowLeft', 'Momento'], ['Home', 'Platos'], ['End', 'Momento'],
    ] as const) {
      await page.keyboard.press(tecla);
      await expect(tab(destino), `${tecla} → ${destino}`).toBeFocused();
      await expect(tab(destino)).toHaveAttribute('aria-selected', 'true');
    }
    // Sólo la elegida está en el orden de Tab: Tab sale de las pestañas, hacia el panel.
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).not.toHaveAttribute('role', 'tab');
  });
});

/** Cancún, cerrado desde Configuración (D279) y con todas las transferencias pagadas: en Cerrados. */
async function cancunEnCerrados(page: Page): Promise<void> {
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Configuración' }).click();
  await page.getByRole('button', { name: 'Cerrar viaje', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar viaje', exact: true }).click();
  // D279 · se vuelve a la pantalla del viaje, que ya espera pagos.
  await expect(page.getByText(/Tú le transfieres \$542 a Luis Pérez/)).toBeVisible();
  await page.evaluate((k) => {
    const e = JSON.parse(localStorage.getItem(k)!) as { viajes: Array<{ id: string; transferencias: Array<{ estado: string }> }> };
    for (const tr of e.viajes.find((v) => v.id === 'd1000000-0000-4000-8000-000000000001')!.transferencias) tr.estado = 'pagada';
    localStorage.setItem(k, JSON.stringify(e));
  }, ESTADO_VIAJES);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

test.describe('🔴 5 · V-02 · «Ver ticket completo» con el viaje en Cerrados', () => {
  test('abre el ticket en sólo lectura (antes: 409 y a Cerrados), y Atrás vuelve', async ({ page }) => {
    await conViajes(page);
    await cancunEnCerrados(page);
    await page.goto('/estadisticas');
    await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
    const mariscos = page.getByRole('region', { name: 'Mariscos El Faro', exact: true });
    await mariscos.getByRole('button', { name: /^Mariscos El Faro/ }).click();
    await mariscos.locator('.rest-visita-fila').click();
    await mariscos.getByRole('button', { name: 'Ver ticket completo', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
    await expect(page.getByRole('heading', { name: 'Mariscos El Faro', level: 1 })).toBeVisible();
    await expect(page.locator('.vjt-aviso-ticket')).toHaveText('Este viaje ya se cerró: el ticket es sólo para ver.');
    // Nada para elegir, marcar ni borrar.
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toHaveCount(0);
    await expect(page.getByText('¿Quiénes estuvieron?', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Eliminar/ })).toHaveCount(0);
    await expect(page.getByText(/falta elegir/)).toHaveCount(0);
    // Lo mío, con lo que me tocó.
    await expect(page.getByText('Te toca', { exact: true })).toBeVisible();
    await capturar(page, 'v02-ticket-cerrado');
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/restaurantes$/);
  });
});

test.describe('🔴 6 · D279 · cerrar y salir en Configuración; en el viaje, el aviso en el medio', () => {
  test('el viaje: sin «Cerrar viaje» ni «Salir», y «Toca el [cámara] para cargar un ticket» en el medio del espacio libre', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje/${CANCUN}`);
    await expect(page.getByText('Ver balance del viaje', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar viaje', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Salir del viaje', exact: true })).toHaveCount(0);
    const aviso = page.locator('.vjv-aviso-cargar');
    await expect(aviso).toHaveText('Toca elpara cargar un ticket');
    await expect(aviso.getByRole('img', { name: 'ícono de cámara' })).toBeVisible();
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const linea = r('.vjv-aviso-cargar .aviso-sin-mesas-cuerpo');
      return { arriba: linea.top - r('.vjv-configuracion').bottom, abajo: r('.appbar-fab').top - linea.bottom, pos: getComputedStyle(document.querySelector('.vjv-aviso-cargar')!).position };
    });
    expect(Math.abs(m.arriba - m.abajo)).toBeLessThanOrEqual(1);
    expect(m.arriba).toBeGreaterThan(24);
    expect(m.pos).toBe('static');
    await capturar(page, 'd279-viaje');
  });

  test('Configuración: al pie, «Cerrar viaje» y «Salir del viaje», con sus hojas de siempre', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje/${CANCUN}`);
    await page.getByRole('button', { name: 'Configuración' }).click();
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    await capturar(page, 'd279-configuracion');
    // Salir: la hoja, y con consumos no se puede (H02), sin salir de Configuración.
    await page.getByRole('button', { name: 'Salir del viaje', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Salir del viaje', exact: true }).click();
    await expect(page.getByText('Todavía no puedes salir de Cancún 2026', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Entendido', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    // Cerrar: la vista previa y, al confirmar, la pantalla del viaje esperando pagos.
    await page.getByRole('button', { name: 'Cerrar viaje', exact: true }).click();
    await expect(page.getByRole('dialog').getByText('¿Cerrar Cancún 2026?', { exact: true })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cerrar viaje', exact: true }).click();
    await expect(page.getByText(/Tú le transfieres \$542 a Luis Pérez/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toHaveCount(0);
    // Esperando pagos no tiene Configuración: «Salir del viaje» queda en la pantalla (H02).
    await expect(page.getByRole('button', { name: 'Salir del viaje', exact: true })).toBeVisible();
  });
});

for (const ancho of [375, 390]) {
  test.describe(`🔴 7 · D280 · «+ Gasto» a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: 812 } });

    test('debajo de la burbuja, a la derecha, antes de los pendientes; abre la Carga manual de ese viaje', async ({ page }) => {
      await conViajes(page);
      const grupo = page.locator('.viaje-grupo').filter({ hasText: 'Cancún 2026' });
      const gasto = grupo.getByRole('button', { name: 'Cargar gasto en Cancún 2026', exact: true });
      await expect(gasto).toHaveText('Gasto');
      // El pendiente de Mariscos llega con el detalle del viaje, después de la lista.
      await expect(grupo.locator('.viaje-pendiente')).toBeVisible();
      const m = await grupo.evaluate((g) => {
        const r = (s: string) => g.querySelector(s)!.getBoundingClientRect();
        return { b: r('.viaje-burbuja'), g: r('.viaje-gasto'), p: r('.viaje-pendiente') };
      });
      expect(Math.round(m.g.top - m.b.bottom)).toBe(8);
      expect(Math.round(m.b.right - m.g.right)).toBe(0);
      // Una píldora, no una franja: angosta y empezando a la derecha (sin `align-self` se estiraría a todo el ancho).
      expect(m.g.width).toBeLessThan(m.b.width / 2);
      expect(m.g.left).toBeGreaterThan(m.b.left + m.b.width / 2);
      expect(Math.round(m.g.height)).toBe(44);
      expect(Math.round(m.p.top - m.g.bottom)).toBe(8);
      // Esperando pagos no la lleva.
      await expect(page.locator('.viaje-grupo').filter({ hasText: 'Monterrey' }).locator('.viaje-gasto')).toHaveCount(0);
      await grupo.scrollIntoViewIfNeeded();
      await capturar(page, 'd280-gasto');
      await gasto.click();
      await expect(page).toHaveURL(new RegExp(`/viaje-gasto/${CANCUN}$`));
      await expect(page.getByRole('heading', { name: 'Carga manual', level: 1 })).toBeVisible();
    });
  });
}
