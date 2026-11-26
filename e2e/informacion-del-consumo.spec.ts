import { test, expect } from '@playwright/test';
import { conRecursoRetenido } from './_recursoRetenido';
import { createServer, type ViteDevServer } from 'vite';

// La bandera pertenece al build. Este servidor efímero permite probar la
// opción futura sin encenderla en los demás recorridos ni en producción.
test.describe.configure({ mode: 'default' });
let servidor: ViteDevServer;
let origen: string;
test.beforeAll(async () => {
  servidor = await createServer({
    envDir: false,
      cacheDir: `node_modules/.vite-recortes-http-${process.pid}`,
    define: {
      'import.meta.env.VITE_TICKET_CROP_ENABLED': JSON.stringify('1'),
      'import.meta.env.VITE_API_URL': JSON.stringify(''),
      'import.meta.env.VITE_MOCK': JSON.stringify('0'),
    },
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await servidor.listen();
  origen = servidor.resolvedUrls!.local[0]!;
});
test.afterAll(async () => { await servidor?.close(); });
test.use({ serviceWorkers: 'block' });

const escenarios = ['es', 'en', 'sin foto', 'sin páginas', 'identidad distinta', '403', '404',
  'sesión antes', 'sesión en vuelo', 'fecha vencida', 'visita completa 320', 'visita completa 375', 'visita completa 390'] as const;
for (const caso of escenarios) {
  const idioma = caso === 'en' ? 'en' : 'es';
  test('recorte del ticket · ' + caso, async ({ page }) => {
    const ancho = caso.startsWith('visita completa ') ? Number(caso.split(' ').at(-1)) : 0;
    if (ancho) await page.setViewportSize({ width: ancho, height: 812 });
    const ahora = new Date('2026-11-25T12:00:00Z');
    await page.clock.setFixedTime(ahora);
    await page.addInitScript(lang => {
      localStorage.setItem('payme.app.idioma.v1', lang);
      localStorage.setItem('payme_app_session', JSON.stringify({
        family_id: 'familia', principal_id: 'prueba', access_token: 'a', refresh_token: 'r',
        user: { id: 'prueba', first_name: 'Persona', last_name: 'Prueba', email: 'a@example.invalid', is_adult: true,
          birth_date: '1990-01-01', birth_date_set: true, payme_id: 'prueba', avatar: null },
      }));
    }, idioma);
    // Imagen sintética de cuatro cuadrantes. Sólo el inferior derecho es verde.
    const webp = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 80; c.height = 40;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 80, 40);
      ctx.fillStyle = '#00ff00'; ctx.fillRect(40, 20, 40, 20);
      return c.toDataURL('image/webp', 1).split(',')[1]!;
    });
    const esViaje = idioma === 'en';
    let vencida = caso === 'fecha vencida';
    let conCaja = true;
    const caja = { page: 1, x: 0.5, y: 0.5, w: 0.5, h: 0.5 };
    const pedidos: string[] = [];
    let relecturas = 0;
    const versiones: string[][] = [];
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(origen).origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      if (url.pathname === '/api/config') return route.fulfill({ json: { features: {
        viajes: { supported: true, enabled: true },
        ticket_image: { supported: true, enabled: caso !== 'sin foto', mode: 'full_retained', stores_thumb: true, stores_full: true,
          full_retention_days: 90, negotiation_param: 'ticket_image_version', negotiation_value: '1',
          accepted_mime_types: ['image/webp'], thumb_max_side_px: 320, full_max_side_px: 1600 },
        ocr_pages: { supported: true, enabled: caso !== 'sin páginas', max_pages: 4, max_total_bytes: 25165824,
          negotiation_param: 'pages_version', negotiation_value: '1' },
      } } });
      if (url.pathname === '/api/legal/acceptance') return route.fulfill({ json: { required: false, aviso: null, terminos: null } });
      if (url.pathname === '/api/account/stats/restaurants') {
        versiones.push(url.searchParams.getAll('ticket_crop_version'));
        return route.fulfill({ json: { basis: 'consumption', month_start: '2026-11-01T06:00:00Z', total_cents: 200,
          restaurants: [{ id: 'cafe', name: 'Café de prueba', category: 'cafe', amount_cents: 200, visits_count: 1,
            visits: [{ code: esViaje ? 'ticket-ficticio' : 'PA-12345', viaje_id: esViaje ? 'viaje-ficticio' : null,
              created_at: (vencida || esViaje) ? '2026-08-27T12:00:00Z' : ahora.toISOString(), division_mode: 'consumo', amount_cents: 200,
              items: [{ name: 'Sopa', quantity: 1, fraction_bps: 10000, amount_cents: 100,
                ticket_crop: esViaje && vencida ? null : caja },
              { name: 'Agua', quantity: 1, fraction_bps: 10000, amount_cents: 100, ticket_crop: null }] }] }] } });
      }
      if (url.pathname === '/api/mesas/PA-12345' || url.pathname === '/api/viajes/viaje-ficticio/tickets/ticket-ficticio') {
        relecturas++;
        expect(url.searchParams.getAll('ticket_crop_version')).toEqual(['1']);
        const items = [{ id: 'i', name: 'Sopa', price_cents: 100, quantity: 1, line_cents: 100,
          remaining_bps: 0, my_bps: 10000, my_amount_cents: 100, ticket_crop: conCaja ? caja : null }];
        if (!esViaje) return route.fulfill({ json: { mesa: { code: caso === 'identidad distinta' ? 'PA-99999' : 'PA-12345',
          items: ancho ? [...items, { ...items[0], id: 'otro', name: 'Arroz', my_bps: 0, remaining_bps: 10000 }] : items } } });
        return route.fulfill({ json: { contract: 'payme.app.viajes/v1', ticket: {
          id: 'ticket-ficticio', lugar: 'Café de prueba', tipo_lugar: 'restaurante', fecha_ticket: null, hora_ticket: null,
          cargado_en: ahora.toISOString(), forma: 'consumo', monto_cents: 100, pagado_por: 'm', pagaste_tu: true,
          items, personas: [{ miembro_id: 'm', ya_eligio: true, presente: true }], te_toca_cents: 100,
          sin_repartir_cents: 0, puedo_elegir: false, puedo_marcar_presentes: false, pagadores: [{ miembro_id: 'm', monto_cents: 100 }],
          personal: false, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 100, te_toca_platos_cents: 100,
          puedo_corregir: false,
        } } });
      }
      if (url.pathname.includes('/ticket-image/')) {
        pedidos.push(url.pathname + url.search);
        expect(route.request().headers().authorization).toBe('Bearer a');
        if (caso === '403' || caso === '404') return route.fulfill({ status: Number(caso), json: { error: 'not_found' } });
        return route.fulfill({ contentType: 'image/webp', headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
          body: Buffer.from(webp, 'base64') });
      }
      return route.fulfill({ status: 404, json: { error: 'not_found' } });
    });
    await page.goto(new URL('/restaurantes', origen).href);
    await page.getByRole('button', { name: /Café de prueba/ }).click();
    await page.locator('.rest-visita-fila').click();
    expect(versiones.length).toBeGreaterThan(0);
    expect(versiones.every(v => v.length === 1 && v[0] === '1')).toBe(true);
    const boton = page.getByRole('button', { name: idioma === 'es' ? 'Ver renglón de Sopa en el ticket' : 'View Sopa on the receipt' });
    await expect(page.getByText('Sopa', { exact: true })).toBeVisible();
    if (caso === 'sin foto' || caso === 'sin páginas' || caso === 'fecha vencida') {
      await expect(boton).toHaveCount(0);
      expect(pedidos).toEqual([]);
      return;
    }
    if (ancho) {
      const importes = page.locator('.est-consumo-monto');
      const derecha = await importes.evaluateAll(es => es.map(e => e.getBoundingClientRect().right));
      expect(derecha).toHaveLength(2);
      expect(Math.abs(derecha[0]! - derecha[1]!)).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: /Ver todo el ticket/ }).click();
      const segundo = page.locator('.est-consumo').filter({ hasText: 'Arroz' }).getByRole('button');
      await expect(segundo).toBeVisible();
      await segundo.click();
      await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
      return;
    }
    await expect(page.locator('.info-consumo')).toHaveCount(1);
    const cambiarSesion = () => page.evaluate(() => {
      const clave = 'payme_app_session';
      const previa = JSON.parse(localStorage.getItem(clave)!);
      localStorage.setItem(clave, JSON.stringify({ ...previa, family_id: 'otra-familia' }));
    });
    if (caso === 'sesión en vuelo') {
      const detalle = page.waitForRequest(r => new URL(r.url()).pathname === '/api/mesas/PA-12345');
      await conRecursoRetenido(page, '**/api/mesas/PA-12345?*', async () => {
        await boton.click();
        await detalle;
        await cambiarSesion();
      }, ruta => ruta.fallback());
      await expect(boton).toHaveCount(0);
      expect(pedidos).toEqual([]);
      return;
    }
    if (caso === 'sesión antes') await cambiarSesion();
    if (caso === '403' || caso === '404' || caso === 'identidad distinta' || caso === 'sesión antes') {
      await boton.click();
      await expect(boton).toHaveCount(0);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(relecturas).toBe(caso === 'sesión antes' ? 0 : 1);
      expect(pedidos).toHaveLength(caso === '403' || caso === '404' ? 1 : 0);
      return;
    }
    expect(pedidos).toEqual([]);
    await boton.click();
    const dialogo = page.getByRole('dialog');
    const canvas = dialogo.locator('canvas');
    await expect(canvas).toBeVisible();
    expect(pedidos).toEqual([esViaje ? '/api/viajes/viaje-ficticio/tickets/ticket-ficticio/ticket-image/full?page=1'
      : '/api/mesas/PA-12345/ticket-image/full?page=1']);
    const pixels = await canvas.evaluate(c => {
      if (!(c instanceof HTMLCanvasElement)) throw new Error('Falta el lienzo');
      const datos = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      return { ancho: c.width, alto: c.height, verde: datos.every((v, i) => i % 4 === 1 ? v > 220 : i % 4 === 3 || v < 40) };
    });
    expect(pixels).toEqual({ ancho: 40, alto: 20, verde: true });
    await expect(dialogo.locator('img')).toHaveCount(0);
    const cerrar = dialogo.getByRole('button', { name: idioma === 'es' ? 'Cerrar' : 'Close' });
    await expect(cerrar).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cerrar).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialogo).toHaveCount(0);
    await expect(boton).toBeFocused();
    // El renglón cambia en el servidor mientras la visita sigue abierta.
    conCaja = false;
    await boton.click();
    await expect(boton).toHaveCount(0);
    expect(pedidos).toHaveLength(1);
    vencida = true;
    await page.reload();
    await page.getByRole('button', { name: /Café de prueba/ }).click();
    await page.locator('.rest-visita-fila').click();
    await expect(page.getByText('Sopa', { exact: true })).toBeVisible();
    await expect(page.locator('.info-consumo')).toHaveCount(0);
    expect(pedidos).toHaveLength(1);
  });
}
