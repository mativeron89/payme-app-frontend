import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { createServer } from 'vite';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { abrirTusConsumos } from './_mesa';

const test = base.extend<{}, { mockLocal: string }>({
  mockLocal: [async ({}, use) => {
    const servidor = await createServer({
      envDir: false,
      cacheDir: `node_modules/.vite-recortes-mock-${process.pid}`,
      define: {
        'import.meta.env.VITE_MOCK': JSON.stringify('1'),
        'import.meta.env.VITE_TICKET_CROP_ENABLED': JSON.stringify('1'),
      },
      plugins: [{
        name: 'foto-sintetica-de-los-tres-renglones',
        enforce: 'pre',
        resolveId(id, importer) {
          if (id === './mock/fotoDelTicketMock' && importer?.endsWith('/src/api/fotosDeTickets.ts')) return '\0foto-del-grupo';
        },
        load(id) {
          if (id !== '\0foto-del-grupo') return;
          return `import { dibujarTicket, mockFotoDelTicketDeMesa as foto } from '/src/api/mock/fotoDelTicketMock.ts';
            export { mockFotoDelTicketDeViaje } from '/src/api/mock/fotoDelTicketMock.ts';
            export function mockFotoDelTicketDeMesa(code, tamano, parte) {
              if (code !== 'PA-7310' || tamano !== 'full') return foto(code, tamano, parte);
              return dibujarTicket({ lugar: 'CAFÉ DE PRUEBA', renglones: Array.from({length: 3},
                () => ({ nombre: 'AGUA MINERAL', cents: 1500 })) }, false);
            }`;
        },
      }],
      server: { host: '127.0.0.1', port: 0, hmr: false },
    });
    try { await servidor.listen(); await use(servidor.resolvedUrls!.local[0]!); }
    finally { await servidor.close(); }
  }, { scope: 'worker' }],
  baseURL: async ({ mockLocal }, use) => use(mockLocal),
});

test.describe.configure({ mode: 'default' });
test.use({ serviceWorkers: 'block' });

const cancun = 'd1000000-0000-4000-8000-000000000001';
const mariscos = 'd2000000-0000-4000-8000-000000000105';

async function preparar(page: Page, corte = true, grupo: 'parcial' | 'completo' | 'solo' = 'parcial') {
  await page.addInitScript(sinCobro => {
    localStorage.setItem('payme.app.mock.ticket_image.v1', 'encendido');
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    if (sinCobro) localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro');
  }, corte);
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
  await page.evaluate(async tipo => {
    const ruta = '/src/api/index.ts';
    const { api, IS_MOCK } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/index');
    if (!IS_MOCK) throw new Error('Se requiere el mock local');
    const cajas = [0.425, 0.531, 0.637].map(y => ({ page: 0, x: 0.04, w: 0.92, y, h: 0.09 }));
    const filas = tipo === 'solo' ? [cajas[0]] : [cajas[2], tipo === 'completo' ? cajas[1] : undefined, cajas[0]];
    const getMyMesas = api.getMyMesas;
    api.getMyMesas = async (...args) => {
      const r = await getMyMesas(...args);
      return { ...r, mesas: r.mesas.map(m => m.code !== 'PA-7310' ? m : {
        ...m, createdAt: new Date().toISOString(), amountCents: 1500 * filas.length, itemsCount: filas.length,
        items: filas.map((ticket_crop, i) => ({
          itemId: 'agua-' + i, name: tipo === 'solo' ? 'Agua mineral con una descripción extensa en el ticket de prueba' : 'Agua mineral', quantity: 1, amountCents: 1500, fractionBps: 10000, ticket_crop,
        })),
      }) };
    };
    const getMesa = api.getMesa;
    api.getMesa = async (...args) => {
      const r = await getMesa(...args);
      return { ...r, mesa: { ...r.mesa, items: r.mesa.items.map((i, n) => ({ ...i, ticket_crop: cajas[n] })) } };
    };
    const getMovement = api.getMovement;
    api.getMovement = async (...args) => {
      const r = await getMovement(...args);
      return { ...r, date: new Date().toISOString(), items: r.items.map((i, n) => ({ ...i, ticket_crop: cajas[n] })) };
    };
    const getTicket = api.getTicketDeViaje;
    api.getTicketDeViaje = async (...args) => {
      const t = await getTicket(...args);
      return { ...t, cargado_en: new Date().toISOString(), items: t.items.map((i, n) => ({ ...i, ticket_crop: cajas[n] })) };
    };
    const resumen = api.getResumenDeViaje;
    api.getResumenDeViaje = async (...args) => {
      const r = await resumen(...args);
      return { ...r, lugares: r.lugares.map(l => ({ ...l, items: l.items.map((i, n) => ({ ...i, ticket_crop: cajas[n] })) })) };
    };
  }, grupo);
}

async function medirControl(boton: Locator, ancho: number) {
  await expect(boton).toBeVisible();
  await boton.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const rect = await boton.boundingBox();
  expect(rect!.width).toBeGreaterThanOrEqual(44);
  expect(rect!.height).toBeGreaterThanOrEqual(44);
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(ancho + 1);
  await expect(boton).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  await expect.poll(() => boton.evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
}

for (const ancho of [320, 375, 390]) {
  test('una fila, recortes en orden y un renglón sin caja · ' + ancho, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: ancho === 320 ? 568 : 812 });
    await preparar(page);
    await irEnLaApp(page, '/mesas');
    await page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' }).locator('button.fila-ticket').click();
    const filas = page.locator('.eleccion-fila');
    await expect(filas).toHaveCount(1);
    await expect(filas).toContainText('3 × Agua mineral');
    await expect(filas).toContainText('$45');
    const boton = filas.getByRole('button', { name: 'Ver renglón de Agua mineral en el ticket' });
    await medirControl(boton, ancho);
    await boton.click();
    const hoja = page.getByRole('dialog', { name: 'Renglones del ticket' });
    await expect(hoja.locator('figcaption')).toHaveText(['Renglón 1', 'Renglón 2', 'Renglón 3']);
    await expect(hoja.locator('figure').nth(1)).toHaveText('Renglón 2Recorte no disponible');
    await expect(hoja.getByRole('img')).toHaveCount(2);
    const lienzos = hoja.locator('canvas:visible');
    const borde = (await hoja.boundingBox())!;
    for (const c of await lienzos.all()) {
      const r = (await c.boundingBox())!;
      expect(r.x - borde.x).toBeGreaterThanOrEqual(15);
      expect(borde.x + borde.width - r.x - r.width).toBeGreaterThanOrEqual(15);
      expect(r.y + r.height).toBeLessThanOrEqual(page.viewportSize()!.height - 15);
    }
    if (ancho === 320 && process.env.PAYME_E2E_CAPTURAS) {
      await page.screenshot({ path: process.env.PAYME_E2E_CAPTURAS + '/grupo-320.png' });
    }
    await page.keyboard.press('Escape');
    await expect(boton).toBeFocused();
    await expect(boton).toHaveCSS('outline-style', 'solid');
    await page.getByRole('button', { name: 'Ver detalle digital', exact: true }).click();
    await medirControl(page.locator('.ticket-digital-items .info-consumo').first(), ancho);
  });

  test('movimiento y ticket abierto de viaje · ' + ancho, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 812 });
    await preparar(page, false);
    await irEnLaApp(page, '/mesas');
    await page.getByRole('button', { name: /\$224\.25/ }).click();
    await medirControl(page.locator('.hist-detail-row .info-consumo').first(), ancho);
    await irEnLaApp(page, '/viaje-ticket/' + cancun + '.' + mariscos);
    await medirControl(page.locator('.qc-renglon .info-consumo').first(), ancho);
  });

  test('mesa, Mi parte y las dos vistas del viaje cerrado · ' + ancho, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 812 });
    await preparar(page);
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/index');
      const anterior = api.getMesa;
      api.getMesa = async (...args) => {
        const r = await anterior(...args);
        return { ...r, mesa: { ...r.mesa, division_mode: 'consumo', guarantee_mode: false, my_role: 'opener',
          total_cents: 100 * r.mesa.items.length, tip_setting: null, ticket_totals: undefined, ticket_adjustments: undefined,
          share_totals: { items_cents: 100 * r.mesa.items.length, discounts_cents: 0, service_cents: 0,
            tax_added_cents: 0, adjustments_cents: 0, tip_basis_cents: 100 * r.mesa.items.length,
            tip_cents: 0, total_cents: 100 * r.mesa.items.length, adjustments_omitted: false, adjustments_omitted_reason: null },
          my_share: { items_cents: 100, adjustments_cents: 0, tip_cents: 0, total_cents: 100 },
          items: r.mesa.items.map((item, i) => ({ ...item, price_cents: 100, quantity: 1,
            my_bps: i === 0 ? 10000 : 0, my_releasable_bps: i === 0 ? 10000 : 0 })),
        } };
      };
    });
    await irEnLaApp(page, '/mesa/PA-2847');
    await abrirTusConsumos(page);
    await medirControl(page.locator('.qc-renglon .info-consumo').first(), ancho);
    const parte = page.locator('.mi-parte-desglose');
    await parte.locator('.desplegable-cabecera').click();
    await medirControl(parte.locator('.info-consumo').first(), ancho);
    const oaxaca = 'd1000000-0000-4000-8000-000000000003';
    await irEnLaApp(page, '/viaje-cerrado/' + oaxaca);
    const lugar = page.locator('button[aria-controls^="vjd-items-"]').first();
    await lugar.click();
    await medirControl(page.locator('.vjd-items:not([hidden]) .info-consumo').first(), ancho);
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/index');
      const viaje = api.getViaje;
      api.getViaje = async (...args) => ({ ...await viaje(...args), estado: 'cerrado' });
      const ticket = api.getTicketDeViaje;
      api.getTicketDeViaje = async (...args) => {
        const t = await ticket(...args);
        return { ...t, personal: false, puedo_elegir: false,
          items: t.items.map(i => ({ ...i, my_bps: 5000, my_amount_cents: 100 })) };
      };
    });
    await irEnLaApp(page, '/viaje-ticket/' + cancun + '.' + mariscos);
    await medirControl(page.locator('.eleccion-fila .info-consumo').first(), ancho);
  });
}

for (const tipo of ['solo', 'completo'] as const) {
  test('hoja de un grupo ' + tipo + ' a 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await preparar(page, true, tipo);
    await irEnLaApp(page, '/mesas');
    await page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' }).locator('button.fila-ticket').click();
    await expect(page.locator('.eleccion-fila')).toHaveCount(1);
    await page.locator('.eleccion-fila .info-consumo').click();
    const hoja = page.getByRole('dialog');
    await expect(hoja.getByRole('img')).toHaveCount(tipo === 'solo' ? 1 : 3);
    await expect(hoja.getByText('Recorte no disponible')).toHaveCount(0);
    if (tipo === 'solo') {
      await expect(hoja.getByRole('heading')).toHaveText('Renglón del ticket');
      const titulo = hoja.locator('.ticket-digital-head p');
      expect(await titulo.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    }
    if (process.env.PAYME_E2E_CAPTURAS) await page.screenshot({ path: process.env.PAYME_E2E_CAPTURAS + '/' + tipo + '-320.png' });
  });
}
