import { expect, test, type Page } from '@playwright/test';
import { omitirGuiaEnFixture } from './_app';

test.use({ serviceWorkers: 'block' });

const viaje = '10000000-0000-4000-8000-000000000001';
const ticket = '20000000-0000-4000-8000-000000000002';
const mesa = 'PA-12345';
const imagen = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const sesion = {
  principal_id: 'persona-ficticia', family_id: 'familia-ficticia', access_token: 'fake-stats', refresh_token: 'fake-renovar',
  user: { id: 'persona-ficticia', email: 'prueba@example.invalid', first_name: 'Cuenta', last_name: 'Inventada', is_adult: true,
    birth_date: '1990-01-01', birth_date_set: true, payme_id: 'cuenta_prueba', avatar: null },
};

async function montar(page: Page, version: false | 1 | 2, caso: 'mesa' | 'viaje' | 'null' | '404' | 'viaje sin id' = 'mesa') {
  const origen = test.info().config.projects.find(p => p.name === 'mesa-recuperacion-http')?.use.baseURL;
  if (!origen || new URL(origen).hostname !== '127.0.0.1') throw new Error('Falta el servidor HTTP local');
  const pedidos: string[] = [];
  const consultas: string[] = [];
  await page.addInitScript(s => localStorage.setItem('payme_app_session', JSON.stringify(s)), sesion);
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin !== origen) return route.abort();
    if (!u.pathname.startsWith('/api/')) return route.continue();
    if (u.pathname === '/api/config') return route.fulfill({ json: { features: {
      viajes: { supported: true, enabled: true },
      ticket_image: { supported: true, enabled: !!version, mode: 'full_retained', stores_thumb: true, stores_full: true,
        full_retention_days: 90, negotiation_param: 'ticket_image_version', negotiation_value: '1',
        accepted_mime_types: ['image/webp'], thumb_max_side_px: 320, full_max_side_px: 1600 },
      ...(version === 2 && { ocr_pages: { supported: true, enabled: true, max_pages: 4, max_total_bytes: 25165824,
        negotiation_param: 'pages_version', negotiation_value: '1' } }),
    } } });
    if (u.pathname === '/api/legal/acceptance') return route.fulfill({ json: { required: false, aviso: null, terminos: null } });
    if (u.pathname === '/api/account/stats/restaurants') {
      consultas.push(u.search);
      // Incluso apagada, enviamos una foto en la respuesta para probar que se rechaza.
      const visita = { code: caso.startsWith('viaje') ? ticket : mesa, viaje_id: caso === 'viaje' ? viaje : null,
        created_at: '2026-11-02T18:00:00Z', division_mode: 'igual', amount_cents: 18000, items: [],
        ticket_image: caso === 'null' ? null : { thumb: true, full: true, ...(version === 2 && { pages: 1 }) } };
      return route.fulfill({ json: { basis: 'consumption', month_start: '2026-11-01T06:00:00Z', total_cents: 18000,
        restaurants: [{ id: 'local-ficticio', name: 'Café de prueba', category: 'cafe', amount_cents: 18000, visits_count: 1, visits: [visita] }] } });
    }
    if (u.pathname.includes('/ticket-image/')) {
      pedidos.push(u.pathname);
      expect(route.request().headers().authorization).toBe('Bearer ' + sesion.access_token);
      if (caso === '404') return route.fulfill({ status: 404, json: { error: 'ticket_image_not_found' } });
      return route.fulfill({ contentType: 'image/webp', headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }, body: imagen });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(origen + '/restaurantes');
  const prefijo = '?period=this_month&stats_version=3';
  if (version) {
    await page.getByRole('button', { name: /Café de prueba/ }).click();
    expect(consultas.at(-1)).toBe(prefijo + '&ticket_image_version=' + version);
  } else {
    await expect(page.getByText('No pudimos cargar tus restaurantes')).toBeVisible();
    expect(new Set(consultas)).toEqual(new Set([prefijo]));
  }
  return pedidos;
}

for (const [tipo, version, prefijo] of [
  ['mesa', 1, '/api/mesas/' + mesa], ['viaje', 2, '/api/viajes/' + viaje + '/tickets/' + ticket],
] as const) {
  test('Estadísticas · miniatura y visor autenticados de ' + tipo, async ({ page }) => {
    const pedidos = await montar(page, version, tipo);
    const boton = page.getByRole('button', { name: /Ver la foto del ticket/ });
    await expect(boton.locator('img')).toBeVisible();
    expect(pedidos).toEqual([prefijo + '/ticket-image/thumb']);
    await boton.click();
    const visor = page.getByRole('dialog', { name: 'Foto del ticket' });
    await expect(visor.locator('img').first()).toBeVisible();
    expect(pedidos).toContain(prefijo + '/ticket-image/full');
    expect(pedidos.every(p => p.startsWith(prefijo + '/ticket-image/'))).toBe(true);
    await visor.getByLabel('Cerrar', { exact: true }).click();
    await expect(boton).toBeFocused();
  });
}

for (const caso of ['null', '404', 'viaje sin id'] as const) {
  test('Estadísticas · conserva la fila ante ' + caso, async ({ page }) => {
    const pedidos = await montar(page, 1, caso);
    await page.locator('.rest-visita-fila').click();
    await expect(page.getByText('Tu parte, en partes iguales')).toBeVisible();
    await expect(page.locator('.fila-ticket-foto')).toHaveCount(0);
    expect(pedidos).toEqual(caso === '404' ? ['/api/mesas/' + mesa + '/ticket-image/thumb'] : []);
  });
}
test('Estadísticas · capacidad apagada con foto presente', async ({ page }) => {
  expect(await montar(page, false)).toEqual([]);
});

for (const ancho of [320, 390]) {
  test('Estadísticas · filas con y sin foto a ' + ancho, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 844 });
    await omitirGuiaEnFixture(page);
    await page.clock.setFixedTime(new Date('2026-11-18T18:00:00Z'));
    await page.addInitScript(() => {
      localStorage.setItem('payme.app.mock.ticket_image.v1', 'encendido');
      localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    });
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill('luna@example.invalid');
    await page.getByLabel('Contraseña', { exact: true }).fill('prueba-local');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    await page.goto('/restaurantes');
    await page.getByRole('button', { name: /^La Parolaccia/ }).click();
    const filas = page.locator('.rest-visita');
    const boton = filas.first().getByRole('button', { name: /Ver la foto/ });
    await expect(boton.locator('img')).toBeVisible();
    await expect(filas.nth(1).locator('.fila-ticket-foto')).toHaveCount(0);
    const dir = process.env.PAYME_E2E_CAPTURAS;
    if (dir) await page.screenshot({ path: dir + '/visitas-' + ancho + '.png' });
    await boton.click();
    const visor = page.getByRole('dialog', { name: 'Foto del ticket' });
    await expect(visor.locator('img').first()).toBeVisible();
    if (dir) await page.screenshot({ path: dir + '/visor-' + ancho + '.png' });
  });
}
