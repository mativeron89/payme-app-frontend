import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D479/D482 · «Mis estadísticas» según Claude Design 0.261 (AF-1 + AF-2).
 *
 * El mock es el del paquete: octubre con La Parolaccia ×3, Hanzo Sushi ×2 y Café
 * Nube ×1 ($2,165), septiembre $1,320 y agosto $680. El reloj queda fijo en el
 * 21/10/2026 para que el período sea octubre, como el diseño. Las formas nuevas
 * del dueño (platos agrupados y `quantity`, 2.195.0) entran por una fixture
 * efímera en la página, con los mismos tipos de la app: el mock global no cambia.
 *
 * Con `PAYME_E2E_CAPTURAS=<carpeta>` deja las capturas de 1a–1p a 390 × 844, en
 * español e inglés, para la prueba de Mati.
 */

const AHORA = new Date('2026-10-21T18:00:00Z');

interface Opciones {
  readonly ingles?: boolean;
  readonly conDinero?: boolean;
  readonly seams?: Readonly<Record<string, string>>;
}

async function preparar(page: Page, o: Opciones = {}): Promise<void> {
  await page.clock.setFixedTime(AHORA);
  await page.addInitScript((op) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    if (!op.conDinero) localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    for (const [k, v] of Object.entries(op.seams ?? {})) localStorage.setItem(`payme.app.mock.${k}.v1`, v);
  }, { ...o, seams: o.seams ?? {} });
  await ingresar(page);
  // El ingreso de la fixture es en español; el idioma se elige después, como una persona.
  if (o.ingles) await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
  await page.goto('/#/estadisticas');
}

/** Una costura del mock después de ingresar: se guarda y se recarga la principal. */
async function conCostura(page: Page, clave: string, valor: string | null): Promise<void> {
  await page.evaluate(([k, v]) => {
    if (v === null) localStorage.removeItem(`payme.app.mock.${k}.v1`);
    else localStorage.setItem(`payme.app.mock.${k}.v1`, v);
  }, [clave, valor] as const);
  await page.goto('/#/estadisticas');
}

/** Cambia de pantalla sin recargar: conserva las fixtures efímeras de la página. */
async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((r) => { location.hash = r; }, ruta);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/d482-${nombre}.png`, fullPage: true });
}

const periodo = (page: Page) => page.getByRole('button', { name: /^(Período|Period): / });
const resumen = (page: Page) => page.getByRole('region', { name: 'Tu consumo registrado', exact: true });

test.describe('D479/D482 · la principal', () => {
  test('cabecera común y el orden del paquete: resumen → accesos → meses completos (D492: sin cocinas)', async ({ page }) => {
    await preparar(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Mis estadísticas' })).toBeVisible();
    await expect(periodo(page)).toHaveText('Octubre');
    // K1 (D482) · «En curso» en letra chica junto al mes.
    await expect(page.locator('.est-periodo-estado')).toHaveText('En curso');
    await expect(resumen(page)).toContainText('$2,165');
    await expect(resumen(page)).not.toContainText('MXN');
    const titulos = await page.locator('.est-scroll h2').allTextContents();
    expect(titulos).toEqual(['Tu consumo registrado', 'Meses completos']);
    const orden = await page.locator('.est-scroll > *').evaluateAll((els) => els.map((e) => e.className));
    expect(orden.slice(0, 3)).toEqual(['est-resumen est-panel', 'est-panel est-accesos', 'est-comparacion est-panel']);
    // Los tres accesos en una sola lista, con los subtítulos del paquete.
    const accesos = page.getByRole('navigation', { name: 'Mis estadísticas' }).getByRole('button');
    await expect(accesos).toHaveText(['Tus restaurantes3 lugares · 6 visitas', 'Qué comes7 platos distintos', 'EvoluciónÚltimos 6 meses']);
    await expect(page.getByText('Detalle por cocina')).toHaveCount(0);
  });

  /**
   * 🔴 D492 · Mati: «Por tipo de cocina» ponía todo en «Otros». Con un mes que SÍ trae tres cocinas, la tarjeta no
   * aparece mientras su bandera esté apagada; el resto de la principal sigue. La tarjeta encendida la prueba
   * `EstadisticasScreen.test.tsx`.
   */
  test('🔴 D492 · con cocinas en el mes, la tarjeta «Por tipo de cocina» no aparece (bandera apagada)', async ({ page }) => {
    await preparar(page);
    await expect(resumen(page)).toContainText('$2,165');
    await expect(page.getByRole('region', { name: 'Por tipo de cocina', exact: true })).toHaveCount(0);
    await expect(page.locator('.est-cocinas')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Por tipo de cocina', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Mis estadísticas' }).getByRole('button')).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Meses completos' })).toBeVisible();
    await capturar(page, 'd492-sin-cocinas-es');
  });

  test('meses completos: dos columnas «Agosto 2026», diferencias con signo y «No cambia con el período»', async ({ page }) => {
    await preparar(page);
    const meses = page.getByRole('region', { name: 'Meses completos' });
    await expect(meses).toContainText('Septiembre frente a agosto. No cambia con el período.');
    await expect(meses.locator('.est-mes h3')).toHaveText(['Agosto 2026', 'Septiembre 2026']);
    await expect(meses.locator('.est-diferencias dt')).toHaveText(['Consumo', 'Visitas', 'Promedio por visita']);
    await expect(meses.locator('.est-diferencias dd').first()).toHaveText(/^\+\$640 \(\+94\.1%\)$/);
    await expect(meses.locator('.est-diferencias dd').first().locator('svg')).toHaveCount(1);
  });

  test('1g · vacío: una frase y nunca un $0 grande; sin la tarjeta de cocinas', async ({ page }) => {
    await preparar(page, { seams: { stats: 'vacio' } });
    await expect(resumen(page)).toContainText('Todavía no registramos consumos este mes.');
    await expect(page.locator('.est-total')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Por tipo de cocina' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Tus restaurantes/ })).toContainText('Sin visitas este mes');
    await expect(page.getByRole('button', { name: /^Qué comes/ })).toContainText('Sin platos este mes');
    await capturar(page, '1g-vacio-es');
  });
});

test.describe('D479/D482 · el período, un desplegable anclado', () => {
  test('abre con las cuatro opciones y su segundo texto; flechas, Escape y el foco vuelve al botón', async ({ page }) => {
    await preparar(page);
    await expect(periodo(page)).toHaveAttribute('aria-expanded', 'false');
    await periodo(page).click();
    await expect(periodo(page)).toHaveAttribute('aria-expanded', 'true');
    const opciones = page.getByRole('radiogroup', { name: 'Elige el período' }).getByRole('radio');
    await expect(opciones).toHaveText(['Este mesOctubre', 'Mes pasadoSeptiembre', 'Últimos 3 mesesAgosto a octubre', 'Este año2026']);
    // El foco entra en la elegida; las flechas recorren.
    await expect(opciones.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(opciones.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(opciones.nth(3)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('radiogroup', { name: 'Elige el período' })).toHaveCount(0);
    await expect(periodo(page)).toBeFocused();
    await expect(periodo(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('elegir «Mes pasado» rearma la pantalla y lo marca «Mes completo»; un toque afuera cierra', async ({ page }) => {
    await preparar(page);
    await periodo(page).click();
    await page.getByRole('radio', { name: /^Mes pasado/ }).click();
    await expect(periodo(page)).toHaveText('Septiembre');
    await expect(page.locator('.est-periodo-estado')).toHaveText('Mes completo');
    await expect(resumen(page)).toContainText('$1,320');
    await expect(periodo(page)).toBeFocused();
    await periodo(page).click();
    // Un toque afuera del desplegable (que tapa el resumen): el título de meses completos (D492: sin cocinas).
    await page.locator('.est-comparacion h2').click();
    await expect(page.getByRole('radiogroup', { name: 'Elige el período' })).toHaveCount(0);
  });
});

/** 1e/1f · el resumen que no llega o que falla: se reemplaza y se remonta la principal. */
async function conStats(page: Page, modo: 'cargando' | 'error'): Promise<void> {
  await page.evaluate(async (m) => {
    const { api } = await import(/* @vite-ignore */ ('/src/api/index.ts' as string)) as typeof import('../src/api');
    api.getStats = () => (m === 'cargando' ? new Promise(() => {}) : Promise.reject(new Error('fixture_stats_no_disponible')));
  }, modo);
  await ir(page, '#/evolucion');
  await ir(page, '#/estadisticas');
}

/** «Ver todo el ticket»: una mesa por consumo, con lo de otro y lo que nadie eligió, sin identidades. */
async function conTicketDeLaMesa(page: Page, modo: 'bien' | 'falla-una-vez' = 'bien'): Promise<void> {
  await page.evaluate(async (m) => {
    const { api } = await import(/* @vite-ignore */ ('/src/api/index.ts' as string)) as typeof import('../src/api');
    const original = api.getMesa.bind(api);
    let fallar = m === 'falla-una-vez';
    api.getMesa = async (code) => {
      const r = await original(code);
      if (fallar) { fallar = false; throw new Error('fixture_ticket_no_disponible'); }
      const base = r.mesa.items[0]!;
      const item = (name: string, price: number, quantity: number, mio: number, queda: number) => ({
        ...base, id: `fx-${name}`, name, price_cents: price, quantity, my_bps: mio, remaining_bps: queda,
      });
      return { ...r, mesa: { ...r.mesa, division_mode: 'consumo', items: [
        item('Tagliatelle Bolognese', 13111, 1, 10000, 0),
        item('Tiramisú', 26222, 1, 5000, 0),
        item('Pizza Margherita', 18000, 1, 0, 0),
        item('Agua mineral', 4500, 2, 0, 0),
        item('Pan de la casa', 3000, 1, 0, 10000),
      ] } };
    };
  }, modo);
}

/** AF-2 · `quantity` en los ítems (stats_version=3), con un ítem entero de 2 unidades. */
async function conCantidades(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ ('/src/api/index.ts' as string)) as typeof import('../src/api');
    const original = api.getStatsRestaurants.bind(api);
    api.getStatsRestaurants = async (p) => {
      const d = await original(p);
      return { ...d, restaurants: d.restaurants.map((r, ri) => ({ ...r, visits: r.visits.map((v, vi) => ({
        ...v,
        items: v.items.map((it, ii) => ({ ...it, quantity: ri === 0 && vi === 0 && ii === v.items.length - 1 ? 2 : 1 })),
      })) })) };
    };
  });
}

test.describe('D479/D482 · Tus restaurantes', () => {
  test('1j · tarjetas con el color de su cocina y «3 lugares · 6 visitas» sobre la lista', async ({ page }) => {
    await preparar(page);
    await ir(page, '#/restaurantes');
    await expect(page.getByRole('heading', { level: 1, name: 'Tus restaurantes' })).toBeVisible();
    await expect(page.locator('.est-contexto')).toHaveText('3 lugares · 6 visitas');
    await expect(page.locator('.rest-card')).toHaveCount(3);
    await expect(page.locator('.rest-card').first()).toContainText('Italiana · 3 visitas');
    const color = await page.locator('.rest-card .est-cuadrito').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(color).toBe('rgb(18, 165, 180)');
  });

  test('1k · la visita (2b) sin día de la semana ni modalidad; lo tuyo con la porción delante', async ({ page }) => {
    await preparar(page);
    await ir(page, '#/restaurantes');
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia' });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await expect(visita.getByRole('button').first()).toHaveText(/^\d{2}\/\d{2} · \d{2}:\d{2}\$[\d,.]+$/);
    await expect(visita).not.toContainText('Por consumo');
    await visita.getByRole('button').first().click();
    await expect(visita).toHaveClass(/abierta/);
    const navy = await visita.locator('.rest-visita-fila').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(navy).toBe('rgb(16, 30, 59)');
    await expect(visita.locator('.est-consumo.mio').first()).toBeVisible();
    await expect(visita.getByRole('button', { name: 'Ver todo el ticket', exact: true })).toBeVisible();
    await capturar(page, '1k-visita-abierta-es');
  });

  test('AF-2 · con `quantity`, la cantidad va delante del nombre sólo si la línea entera es tuya', async ({ page }) => {
    await preparar(page);
    await conCantidades(page);
    await ir(page, '#/restaurantes');
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia' });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.getByRole('button').first().click();
    const prefijos = await visita.locator('.est-consumo.mio .est-consumo-prefijo').allTextContents();
    expect(prefijos.length).toBeGreaterThan(0);
    for (const p of prefijos) expect(p).toMatch(/^(2|½|⅓|⅔|¼|¾|\d+%)$/);
  });

  test('1p · «Ver todo el ticket» suma lo de los demás sin nombres; «Solo lo mío» lo saca; vuelve con «· N más»', async ({ page }) => {
    await preparar(page);
    await conTicketDeLaMesa(page);
    await ir(page, '#/restaurantes');
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia' });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.getByRole('button').first().click();
    await visita.getByRole('button', { name: 'Ver todo el ticket', exact: true }).click();
    const otros = visita.locator('.est-consumo.otro');
    await expect(otros).toHaveCount(3);
    await expect(otros.nth(0)).toHaveText('½TiramisúLo eligió otro$131.11');
    await expect(otros.nth(1)).toHaveText('Pizza MargheritaLo eligió otro$180');
    await expect(otros.nth(2)).toHaveText('2Agua mineralLo eligió otro$90');
    await expect(visita.locator('.est-consumo.libre')).toHaveText(['Pan de la casa$30']);
    const rosado = await otros.first().evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(rosado).toBe('rgb(251, 231, 227)');
    await capturar(page, '1p-ticket-completo-es');
    await visita.getByRole('button', { name: 'Solo lo mío' }).click();
    await expect(otros).toHaveCount(0);
    await expect(visita.getByRole('button', { name: 'Ver todo el ticket · 4 más' })).toBeVisible();
  });

  test('el ticket que no carga muestra el error en la tarjeta y «Reintentar» lo trae', async ({ page }) => {
    await preparar(page);
    await conTicketDeLaMesa(page, 'falla-una-vez');
    await ir(page, '#/restaurantes');
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia' });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.getByRole('button').first().click();
    await visita.getByRole('button', { name: 'Ver todo el ticket', exact: true }).click();
    await expect(visita.getByRole('alert')).toContainText('No pudimos cargar el detalle');
    await visita.getByRole('button', { name: 'Reintentar' }).click();
    await expect(visita.locator('.est-consumo.otro')).toHaveCount(3);
  });

  test('una visita de viaje sigue abriendo el ticket del viaje', async ({ page }) => {
    await preparar(page);
    await page.evaluate(async () => {
      const { api } = await import(/* @vite-ignore */ ('/src/api/index.ts' as string)) as typeof import('../src/api');
      const original = api.getStatsRestaurants.bind(api);
      api.getStatsRestaurants = async (p) => {
        const d = await original(p);
        const [r0, ...resto] = d.restaurants;
        return { ...d, restaurants: [{ ...r0!, visits: r0!.visits.map((v, i) => (i === 0 ? { ...v, viajeId: 'd1000000-0000-4000-8000-000000000001' } : v)) }, ...resto] };
      };
    });
    await ir(page, '#/restaurantes');
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia' });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.getByRole('button').first().click();
    // El viaje de la fixture no existe en el mock y su pantalla redirige: se mira a dónde se navegó.
    await page.evaluate(() => {
      const w = window as unknown as { navegado: string[] };
      w.navegado = [];
      const push = history.pushState.bind(history);
      history.pushState = (d, u, url) => { w.navegado.push(String(url)); push(d, u, url); };
    });
    await visita.getByRole('button', { name: 'Ver todo el ticket', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { navegado: string[] }).navegado.join(' '))).toMatch(/viaje-ticket/);
  });
});

test.describe('D479/D482 · Qué comes y Evolución', () => {
  test('AF-2 · platos agrupados: la fila no lleva restaurante y el desplegable dice dónde se pidió', async ({ page }) => {
    await preparar(page);
    await page.evaluate(async () => {
      const { api } = await import(/* @vite-ignore */ ('/src/api/index.ts' as string)) as typeof import('../src/api');
      const original = api.getStatsDishes.bind(api);
      api.getStatsDishes = async (p) => {
        const d = await original(p);
        return { ...d, agrupados: true, distinctDishes: 6, dishes: [
          { name: 'Vino tinto', times: 3, amountCents: 67000, restaurants: [
            { id: 'r-1', name: 'La Parolaccia', category: 'italian', times: 2, amountCents: 54000 },
            { id: 'r-2', name: 'Café Nube', category: 'cafe', times: 1, amountCents: 13000 },
          ] },
          ...d.dishes.slice(1),
        ] };
      };
    });
    await ir(page, '#/platos');
    await expect(page.getByRole('heading', { level: 1, name: 'Qué comes' })).toBeVisible();
    const platos = page.getByRole('region', { name: 'Tus platos más pedidos' });
    await expect(platos).toContainText('6 platos distintos este mes');
    const fila = platos.getByRole('button', { name: /^Vino tinto/ });
    await expect(fila).toHaveText('Vino tinto3 veces$670');
    await fila.click();
    await expect(fila).toHaveAttribute('aria-expanded', 'true');
    await expect(platos.locator('.est-plato-lugar')).toHaveText(['La Parolaccia2 veces$540', 'Café Nube1 vez$130']);
    await capturar(page, '1l-platos-es');
  });

  test('pestañas segmentadas; los momentos en cero se muestran; Ingredientes con «Clasificado por el nombre del plato»', async ({ page }) => {
    await preparar(page);
    await ir(page, '#/platos');
    const pestanas = page.getByRole('tablist', { name: 'Qué comes' }).getByRole('tab');
    await expect(pestanas).toHaveText(['Platos', 'Ingredientes', 'Momento']);
    await pestanas.nth(2).click();
    const momentos = page.getByRole('region', { name: 'Por momento del día' }).getByRole('listitem');
    await expect(momentos).toHaveCount(4);
    await expect(page.getByRole('region', { name: 'Por momento del día' })).toContainText('6 visitas este mes');
    // Los cuatro momentos van siempre, también en cero (D482): «$0» y «0 visitas».
    const visitas = await momentos.locator('.est-fila-abajo > span:last-child').allTextContents();
    const montos = await momentos.locator('.est-fila-monto').allTextContents();
    expect(visitas.filter((v, i) => v === '0 visitas' && montos[i] === '$0').length).toBeGreaterThan(0);
    await capturar(page, '1n-momento-es');
    await pestanas.nth(1).click();
    const ingredientes = page.getByRole('region', { name: 'Por ingrediente principal' });
    await expect(ingredientes).toContainText('Clasificado por el nombre del plato');
    await expect(ingredientes.getByRole('listitem').first()).toContainText(/\d+ platos?/);
    await capturar(page, '1m-ingredientes-es');
  });

  test('1o · Evolución: rango fijo, Total y Promedio con su nota, sin comparar el mes en curso', async ({ page }) => {
    await preparar(page);
    await ir(page, '#/evolucion');
    await expect(page.getByRole('heading', { level: 1, name: 'Evolución' })).toBeVisible();
    await expect(page.locator('.est-rango')).toHaveText('Mayo a octubre · 6 meses');
    await expect(page.locator('.evo-celdas')).toHaveText('Total$4,915Promedio por mes$819.16');
    await expect(page.getByText('El promedio divide el total entre seis meses, incluidos el mes en curso y los meses sin consumos.')).toBeVisible();
    // K2 (D482) · la frase que comparaba el mes en curso se fue.
    await expect(page.getByText(/está .* (arriba|abajo) de|está igual que/)).toHaveCount(0);
    await expect(page.locator('.evo-barra')).toHaveCount(6);
    const mezcla = page.getByRole('region', { name: 'Por tipo de cocina, mes a mes' });
    await expect(mezcla.locator('.evo-mes')).toHaveCount(6);
    await expect(mezcla).toContainText('Sin consumos');
    await capturar(page, '1o-evolucion-es');
  });
});

test.describe('D479/D482 · letra', () => {
  test('🔴 ningún botón de las cinco pantallas sale en Arial: heredan la letra (T3)', async ({ page }) => {
    await preparar(page);
    const sinArial = async (conBotones = true) => {
      const fuentes = await page.locator('.est-cabecera button, .est-scroll button').evaluateAll((bs) => bs.map((b) => getComputedStyle(b).fontFamily));
      // Evolución no tiene botones propios: el rango es texto fijo.
      if (conBotones) expect(fuentes.length).toBeGreaterThan(0);
      for (const f of fuentes) expect(f).not.toMatch(/^"?Arial/i);
    };
    await expect(page.locator('.est-accesos')).toBeVisible();
    await sinArial();
    for (const [ruta, listo] of [['#/restaurantes', '.rest-card'], ['#/platos', '.est-platos'], ['#/evolucion', '.evo-celdas']] as const) {
      await ir(page, ruta);
      await expect(page.locator(listo).first()).toBeVisible();
      await sinArial(ruta !== '#/evolucion');
    }
  });
});

// Corren siempre (la guarda del repo no admite skips); sin PAYME_E2E_CAPTURAS, `capturar` no guarda nada.
test.describe('D479/D482 · capturas para Mati (1a–1p)', () => {

  for (const ingles of [false, true]) {
    const sufijo = ingles ? 'en' : 'es';
    test(`principal, desplegable, restaurantes, qué comes y evolución · ${sufijo}`, async ({ page }) => {
      await preparar(page, { ingles });
      await expect(page.locator('.est-resumen')).toBeVisible();
      await capturar(page, `1a-principal-${sufijo}`);
      await periodo(page).click();
      await capturar(page, `1d-desplegable-${sufijo}`);
      await page.getByRole('radio').nth(1).click();
      await expect(page.locator('.est-periodo-estado')).toBeVisible();
      await capturar(page, `1b-mes-pasado-${sufijo}`);
      await periodo(page).click();
      await page.getByRole('radio').nth(3).click();
      await capturar(page, `1c-este-anio-${sufijo}`);
      await periodo(page).click();
      await page.getByRole('radio').nth(0).click();
      await conTicketDeLaMesa(page);
      await conCantidades(page);
      await ir(page, '#/restaurantes');
      await expect(page.locator('.rest-card').first()).toBeVisible();
      await capturar(page, `1j-restaurantes-${sufijo}`);
      const primera = page.locator('.rest-card').first();
      await primera.locator('.rest-fila').click();
      await primera.locator('.rest-visita-fila').first().click();
      await capturar(page, `1k-visita-${sufijo}`);
      await primera.locator('.est-ticket-boton').click();
      await expect(primera.locator('.est-consumo.otro').first()).toBeVisible();
      await capturar(page, `1p-ticket-${sufijo}`);
      await ir(page, '#/platos');
      await expect(page.locator('.est-platos')).toBeVisible();
      await page.locator('.est-plato-fila').first().click();
      await capturar(page, `1l-platos-${sufijo}`);
      await page.getByRole('tab').nth(1).click();
      await capturar(page, `1m-ingredientes-${sufijo}`);
      await page.getByRole('tab').nth(2).click();
      await capturar(page, `1n-momento-${sufijo}`);
      await ir(page, '#/evolucion');
      await expect(page.locator('.evo-celdas')).toBeVisible();
      await capturar(page, `1o-evolucion-${sufijo}`);
    });

    test(`estados: cargando, error, vacío, comparación caída y referencia en $0 · ${sufijo}`, async ({ page }) => {
      await preparar(page, { ingles });
      await conStats(page, 'cargando');
      await expect(page.locator('.est-esqueleto')).toBeVisible();
      await capturar(page, `1e-cargando-${sufijo}`);
      await conStats(page, 'error');
      await expect(page.locator('.state-error')).toBeVisible();
      await capturar(page, `1f-error-${sufijo}`);
      await conCostura(page, 'stats', 'vacio');
      await expect(page.locator('.est-vacio')).toBeVisible();
      await capturar(page, `1g-vacio-${sufijo}`);
      await conCostura(page, 'stats', null);
      await conCostura(page, 'evolucion', 'error');
      await expect(page.locator('.est-sin-comparacion')).toBeVisible();
      await capturar(page, `1h-comparacion-caida-${sufijo}`);
      await conCostura(page, 'evolucion', null);
      await expect(page.locator('.est-resumen')).toBeVisible();
      await page.evaluate(async () => {
        const { api } = await import(/* @vite-ignore */ ('/src/api/index.ts' as string)) as typeof import('../src/api');
        const original = api.getStatsEvolution.bind(api);
        api.getStatsEvolution = async () => {
          const d = await original();
          const months = d.months.map((m, i) => (i === 3 ? { ...m, totalCents: 0, visits: 0, categories: [] } : m));
          const totalCents = months.reduce((n, m) => n + m.totalCents, 0);
          return { ...d, months, totalCents, avgPerMonthCents: Math.floor(totalCents / 6) };
        };
      });
      await ir(page, '#/evolucion');
      await ir(page, '#/estadisticas');
      await expect(page.locator('.est-comparacion')).toContainText(/\$0/);
      await capturar(page, `1i-referencia-cero-${sufijo}`);
    });
  }
});
