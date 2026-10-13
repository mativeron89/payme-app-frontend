import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * AF-BOTON-GASTO-Y-MONTO-20261012 (0.243.0) · D291, del paquete de Claude Design (`PANTALLA-burbuja-del-viaje.md`):
 * - §1 bis, opción 2a: «+ Gasto» es un cuadrado de 76 unido a la burbuja del viaje, a la derecha, con un divisor de 1 px.
 *   Son dos blancos de toque separados (la zona del viaje entra al viaje; el cuadrado abre la Carga manual). No va en un
 *   viaje esperando pagos.
 * - §1, opción 3a: el monto en Plus Jakarta Sans 26/600, alto de línea 1.2, interletra −0.01em y cifras tabulares.
 * - Adenda del Bibliotecario (2026-10-12T03:09:12Z, opción a): el monto nunca se parte, nunca se corta y nunca se mete en
 *   el padding. Si a 26 no entra en una línea, baja sólo lo necesario, con un mínimo de 16.
 *
 * La semilla: «Cancún 2026» abierto (debes $542, con Mariscos El Faro pendiente) y «Monterrey fin de semana» esperando
 * pagos (te deben $1,050).
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const TULUM = 'd1000000-0000-4000-8000-0000000000f1';
const ESTADO = 'payme.app.mock.viajes.estado.v1';

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

const tarjeta = (page: Page, nombre: string) => page.locator('.viaje-tarjeta').filter({ hasText: nombre });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/d291-${page.viewportSize()!.width}-${nombre}.png` });
}

/** Lo que importa de una tarjeta: sus cajas, sin redondear, y a quién le llega el toque en el centro de cada blanco. */
async function medirTarjeta(page: Page, nombre: string) {
  // `elementFromPoint` sólo ve lo que está en la ventana: la tarjeta se trae a la vista antes.
  await tarjeta(page, nombre).scrollIntoViewIfNeeded();
  return tarjeta(page, nombre).evaluate((t) => {
    const caja = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const b = t.querySelector('.viaje-burbuja')!;
    const g = t.querySelector('.viaje-gasto');
    const centro = (el: Element) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') ?? null;
    };
    return {
      t: caja(t)!, b: caja(b)!, d: caja(t.querySelector('.viaje-tarjeta-divisor')), g: caja(g),
      // Dos botones hermanos, ninguno dentro del otro.
      hijosBoton: [...t.children].filter((c) => c.tagName === 'BUTTON').map((c) => c.className),
      anidados: t.querySelectorAll('button button').length,
      // Cada blanco recibe su propio toque en su centro (nada lo tapa).
      tocaB: centro(b) === b, tocaG: g ? centro(g) === g : null,
      divisorColor: t.querySelector('.viaje-tarjeta-divisor') ? getComputedStyle(t.querySelector('.viaje-tarjeta-divisor')!).backgroundColor : null,
      doc: document.documentElement.scrollWidth,
    };
  });
}

/**
 * Le pone al viaje un monto y un nombre por la fachada (sólo en el navegador de la prueba) y vuelve a Inicio a pedir la
 * lista de nuevo.
 */
async function conMonto(page: Page, viaje: string, cents: number, nombre: string): Promise<void> {
  await page.evaluate(async ({ viaje: v, cents: c, nombre: n }) => {
    const r = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ r);
    const real = api.getViajes.bind(api);
    api.getViajes = async (...a: unknown[]) => {
      const x = await real(...a);
      return { ...x, viajes: x.viajes.map((o: { id: string }) => (o.id === v ? { ...o, mi_balance_cents: c, nombre: n } : o)) };
    };
    const u = '/src/api/ultimoVisto.ts';
    (await import(/* @vite-ignore */ u)).olvidarLoDeViajes();
  }, { viaje, cents, nombre });
  await irEnLaApp(page, '/mas');
  await irEnLaApp(page, '/');
}

/** El monto de una tarjeta: su letra y si entra entero en una línea, adentro del padding de la zona del viaje. */
function medirMonto(page: Page, nombre: string) {
  return tarjeta(page, nombre).evaluate(async (t) => {
    await document.fonts.ready;
    const m = t.querySelector('.viaje-burbuja-monto') as HTMLElement;
    const b = t.querySelector('.viaje-burbuja') as HTMLElement;
    const cs = getComputedStyle(m);
    const mr = m.getBoundingClientRect();
    const rango = document.createRange();
    rango.selectNodeContents(m);
    const lineas = rango.getClientRects().length;
    const tinta = rango.getBoundingClientRect();
    return {
      texto: m.textContent,
      fontSize: parseFloat(cs.fontSize), fontWeight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
      numerica: cs.fontVariantNumeric, familia: cs.fontFamily, blanco: cs.whiteSpace, color: cs.color,
      lineas, cabe: m.scrollWidth <= m.clientWidth,
      // El borde derecho del contenido de la zona del viaje (sin su padding).
      limite: b.getBoundingClientRect().right - parseFloat(getComputedStyle(b).paddingRight),
      tintaDerecha: tinta.right, cajaDerecha: mr.right,
    };
  });
}

for (const ancho of [375, 390]) {
  test.describe(`🔴 D291 · «+ Gasto» unido y el monto, a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: 844 } });

    test('un viaje abierto: dos blancos separados de 44 × 44 o más, el divisor de 1 px, y sin desborde', async ({ page }) => {
      await conViajes(page);
      await expect(tarjeta(page, 'Cancún 2026').locator('button.viaje-gasto')).toBeVisible();
      const m = await medirTarjeta(page, 'Cancún 2026');
      expect(m.hijosBoton).toEqual(['viaje-burbuja', 'viaje-gasto']);
      expect(m.anidados).toBe(0);
      // El cuadrado: 76 de ancho y todo el alto de la tarjeta (adentro de su borde de 1 px), a la derecha.
      expect(Math.round(m.g!.width)).toBe(76);
      expect(Math.round(m.g!.height)).toBe(Math.round(m.t.height - 2));
      expect(Math.round(m.t.right - m.g!.right)).toBe(1);
      // Los dos blancos, de 44 × 44 o más, uno al lado del otro con el divisor en el medio.
      for (const c of [m.b, m.g!]) {
        expect(c.width).toBeGreaterThanOrEqual(44);
        expect(c.height).toBeGreaterThanOrEqual(44);
      }
      expect(Math.round(m.d!.width)).toBe(1);
      expect(Math.round(m.d!.height)).toBe(Math.round(m.t.height - 2));
      expect(Math.round(m.d!.left - m.b.right)).toBe(0);
      expect(Math.round(m.g!.left - m.d!.right)).toBe(0);
      expect(m.divisorColor).toBe('rgb(227, 233, 240)');
      expect(m.tocaB).toBe(true);
      expect(m.tocaG).toBe(true);
      // La tarjeta conserva lo de la burbuja: 16 a los costados, 96 de alto como mínimo, sin desborde.
      expect(Math.round(m.t.left)).toBe(16);
      expect(Math.round(ancho - m.t.right)).toBe(16);
      expect(m.t.height).toBeGreaterThanOrEqual(96);
      expect(m.doc).toBeLessThanOrEqual(ancho);
      // El cuadrado por dentro: el «+» de 22 con trazo 2.2 y «Gasto» en Plus Jakarta Sans 14/700.
      const gasto = tarjeta(page, 'Cancún 2026').getByRole('button', { name: 'Cargar un gasto a mano en Cancún 2026', exact: true });
      await expect(gasto).toHaveText('Gasto');
      await expect(gasto.locator('svg')).toHaveAttribute('width', '22');
      await expect(gasto.locator('svg path').first()).toHaveCSS('stroke-width', '2.2px');
      await expect(gasto.locator('span')).toHaveCSS('font-size', '14px');
      await expect(gasto.locator('span')).toHaveCSS('font-weight', '700');
      await expect(gasto).toHaveCSS('font-family', /Plus Jakarta Sans/);
      await expect(gasto).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await capturar(page, 'un-viaje');
    });

    test('esperando pagos: sin divisor ni botón, la burbuja ocupa toda la tarjeta', async ({ page }) => {
      await conViajes(page);
      await expect(tarjeta(page, 'Monterrey fin de semana')).toBeVisible();
      const m = await medirTarjeta(page, 'Monterrey fin de semana');
      expect(m.g).toBeNull();
      expect(m.d).toBeNull();
      expect(m.hijosBoton).toEqual(['viaje-burbuja']);
      expect(Math.round(m.b.width)).toBe(Math.round(m.t.width - 2));
      expect(m.tocaB).toBe(true);
    });

    test('cada blanco va a su lugar: la zona del viaje al viaje, el cuadrado a la Carga manual de ESE viaje', async ({ page }) => {
      await conViajes(page);
      await tarjeta(page, 'Cancún 2026').getByRole('button', { name: 'Cargar un gasto a mano en Cancún 2026', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/viaje-gasto/${CANCUN}$`));
      await expect(page.getByRole('heading', { name: 'Carga manual', level: 1 })).toBeVisible();
      await irEnLaApp(page, '/');
      await tarjeta(page, 'Cancún 2026').locator('button.viaje-burbuja').click();
      await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
      await expect(page.getByRole('heading', { name: 'Cancún 2026', level: 1 })).toBeVisible();
    });

    test('dos viajes abiertos: cada uno con su cuadrado, y el de Tulum abre la carga de Tulum', async ({ page }) => {
      await conViajes(page);
      await page.evaluate(({ k, cancun, tulum }) => {
        const e = JSON.parse(localStorage.getItem(k)!) as { viajes: Array<Record<string, unknown> & { id: string }> };
        e.viajes.push({ ...structuredClone(e.viajes.find((v) => v.id === cancun)!), id: tulum, nombre: 'Tulum 2026', tickets: [], transferencias: [] });
        localStorage.setItem(k, JSON.stringify(e));
      }, { k: ESTADO, cancun: CANCUN, tulum: TULUM });
      await page.reload();
      await expect(tarjeta(page, 'Tulum 2026')).toBeVisible();
      await expect(page.locator('.viaje-tarjeta .viaje-gasto')).toHaveCount(2);
      for (const nombre of ['Tulum 2026', 'Cancún 2026']) {
        const m = await medirTarjeta(page, nombre);
        expect(Math.round(m.g!.width), nombre).toBe(76);
        expect(m.tocaG, nombre).toBe(true);
      }
      await capturar(page, 'dos-viajes');
      await tarjeta(page, 'Tulum 2026').getByRole('button', { name: 'Cargar un gasto a mano en Tulum 2026', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/viaje-gasto/${TULUM}$`));
    });

    test('el monto (3a): 26/600, alto de línea 1.2, −0.01em, cifras tabulares, en una línea; los colores no cambian', async ({ page }) => {
      await conViajes(page);
      await expect(tarjeta(page, 'Monterrey fin de semana')).toBeVisible();
      const debes = await medirMonto(page, 'Cancún 2026');
      expect(debes.texto).toBe('−$542');
      expect(debes.fontSize).toBe(26);
      expect(debes.fontWeight).toBe('600');
      expect(debes.lineHeight).toBe('31.2px');
      expect(debes.letterSpacing).toBe('-0.26px');
      expect(debes.numerica).toBe('tabular-nums');
      expect(debes.familia).toMatch(/Plus Jakarta Sans/);
      expect(debes.blanco).toBe('nowrap');
      expect(debes.lineas).toBe(1);
      expect(debes.color).toBe('rgb(180, 70, 47)');
      const teDeben = await medirMonto(page, 'Monterrey fin de semana');
      expect(teDeben.fontSize).toBe(26);
      expect(teDeben.color).toBe('rgb(4, 120, 87)');
    });
  });
}

/**
 * Adenda 03:09:12Z: un monto grande baja lo necesario y nunca se parte, se corta ni se mete en el padding. Los casos que
 * pidió el Bibliotecario: −$10,565.68 con nombre largo a 320; −$100,565.68 a 375; un monto chico a 390, que queda en 26.
 */
for (const [ancho, cents, texto, achica] of [
  [320, -1056568, '−$10,565.68', true],
  [375, -10056568, '−$100,565.68', true],
  [390, -54200, '−$542', false],
] as const) {
  test.describe(`🔴 D291 · adenda · el monto a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: 844 } });

    test(`${texto}: en una línea, entero y adentro del padding${achica ? ', más chico que 26 y no menos de 16' : ', en 26'}`, async ({ page }) => {
      await conViajes(page);
      await conMonto(page, CANCUN, cents, 'Holbox con amigos de la facultad 2026');
      await expect(tarjeta(page, 'Holbox').locator('.viaje-burbuja-monto')).toHaveText(texto);
      // La medida corre al montar y cuando cargan las fuentes: se espera el tamaño final.
      await expect.poll(async () => (await medirMonto(page, 'Holbox')).cabe).toBe(true);
      const m = await medirMonto(page, 'Holbox');
      expect(m.lineas, JSON.stringify(m)).toBe(1);
      expect(m.tintaDerecha, JSON.stringify(m)).toBeLessThanOrEqual(m.limite + 0.5);
      if (achica) {
        expect(m.fontSize).toBeLessThan(26);
        expect(m.fontSize).toBeGreaterThanOrEqual(16);
      } else {
        expect(m.fontSize).toBe(26);
      }
      // El cuadrado y la foto no cambian.
      const t = await medirTarjeta(page, 'Holbox');
      expect(Math.round(t.g!.width)).toBe(76);
      expect(t.doc).toBeLessThanOrEqual(ancho);
      await expect(tarjeta(page, 'Holbox').locator('.vj-insignia')).toHaveCSS('width', '64px');
      await capturar(page, `monto-${cents}`);
    });
  });
}

/**
 * La medida también corre cuando terminan de cargar las fuentes: antes, el ancho es el de la letra de reemplazo. Se arma
 * un monto grande de verdad (un gasto que pagó Luis), se demora Plus Jakarta Sans y se recarga Inicio a 320: el monto se
 * ve antes que la fuente, y cuando la fuente llega tiene que seguir entrando en una línea.
 */
test.describe('🔴 D291 · adenda · el monto se vuelve a medir cuando llega la fuente', () => {
  test.use({ viewport: { width: 320, height: 844 } });

  test('−$10,565.68 a 320, con Plus Jakarta Sans tarde: en una línea y adentro del padding después de que llega', async ({ page }) => {
    await conViajes(page);
    await page.evaluate(async (cancun) => {
      const r = '/src/api/index.ts';
      const { api, newIdempotencyKey } = await import(/* @vite-ignore */ r);
      await api.getConfig();
      const d = await api.getViaje(cancun);
      const luis = d.miembros.find((m: { first_name: string }) => m.first_name === 'Luis').id;
      // Un gasto de $40,094.72 entre los cuatro, que pagó Luis: a mí me tocan $10,023.68 más (−$542 → −$10,565.68).
      await api.cargarGastoDeViaje(cancun, {
        descripcion: 'Hotel', monto_cents: 4009472, presentes: d.miembros.map((m: { id: string }) => m.id), pagado_por: luis,
        idempotency_key: newIdempotencyKey(),
      });
    }, CANCUN);
    let demoradas = 0;
    await page.route(/PlusJakartaSans-variable\.ttf/, async (ruta) => {
      demoradas += 1;
      await new Promise((listo) => setTimeout(listo, 2_500));
      await ruta.continue();
    });
    await page.reload();
    const monto = tarjeta(page, 'Cancún 2026').locator('.viaje-burbuja-monto');
    await expect(monto).toHaveText('\u2212$10,565.68');
    // La premisa: el monto ya se ve y la fuente todavía no llegó.
    expect(await page.evaluate(() => document.fonts.check('600 26px "Plus Jakarta Sans"'))).toBe(false);
    expect(demoradas).toBeGreaterThan(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    expect(await page.evaluate(() => document.fonts.check('600 26px "Plus Jakarta Sans"'))).toBe(true);
    await expect.poll(async () => (await medirMonto(page, 'Cancún 2026')).cabe).toBe(true);
    const m = await medirMonto(page, 'Cancún 2026');
    expect(m.lineas, JSON.stringify(m)).toBe(1);
    expect(m.tintaDerecha, JSON.stringify(m)).toBeLessThanOrEqual(m.limite + 0.5);
    expect(m.fontSize).toBeLessThan(26);
    expect(m.fontSize).toBeGreaterThanOrEqual(16);
  });
});
