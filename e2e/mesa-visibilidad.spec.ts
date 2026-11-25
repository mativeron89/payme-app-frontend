import { expect, test, type Page } from '@playwright/test';
import { CODIGO, detalle, type Escenario } from './fixtures/detalle-visibilidad';

// Servidor local de Vite del proyecto de fachada HTTP. Sólo salen módulos de Vite
// al loopback. Cada respuesta de API, incluso las imágenes, la fabrica este test.
test.use({ serviceWorkers: 'block' });
const foto = (page: Page) => page.getByRole('button', { name: 'Ver la foto del ticket', exact: true });
const finalizar = (page: Page) => page.getByRole('button', { name: 'Finalizar', exact: true });
const miniatura = '/api/mesas/' + CODIGO + '/ticket-image/thumb';

async function montar(page: Page, e: Escenario) {
  const proyecto = test.info().config.projects.find(p => p.name === 'mesa-recuperacion-http');
  const origen = proyecto?.use.baseURL;
  if (!origen || new URL(origen).hostname !== '127.0.0.1') throw new Error('Falta el servidor HTTP de pruebas');
  const mesa = detalle(e);
  const fotos: string[] = [];
  const versiones: (string | null)[] = [];
  const rechazos: number[] = [];
  // Cada montaje arranca en otro documento: sin miniaturas cacheadas ni listeners anteriores.
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origen) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.fallback();
    const path = url.pathname;
    const method = route.request().method();
    if (method === 'GET' && path === '/api/config') return route.fulfill({ json: { features: {
      money_rail: { mode: e.pagos ? 'test' : 'disabled', payments_enabled: !!e.pagos, real_money: false },
      ...(e.foto === 'varias' && { ocr_pages: { supported: true, enabled: true, max_pages: 4,
        max_total_bytes: 25165824, negotiation_param: 'pages_version', negotiation_value: '1' } }),
      ticket_image: { supported: true, enabled: !e.sinCapacidadFoto, mode: 'full_retained', stores_thumb: true,
        stores_full: true, full_retention_days: 90, negotiation_param: 'ticket_image_version', negotiation_value: '1',
        accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp'], thumb_max_side_px: 320, full_max_side_px: 1600 },
    } } });
    if (method === 'GET' && path === '/api/mesas/' + CODIGO) {
      versiones.push(url.searchParams.get('ticket_image_version'));
      return route.fulfill({ json: { mesa } });
    }
    if (method === 'GET' && path.endsWith('/informative-selection')) return route.fulfill({ json: {
      contract: 'payme.app.informative-selections/v2', mesa: { code: mesa.code, division_mode: 'igual',
        status: mesa.status, closure_reason: mesa.closure_reason, mutable: mesa.informative_selection_capability?.mutable },
      selection: { source: 'informative', items: [], updated_at: null }, coverage: { all_items_selected: false },
    } });
    if (method === 'GET' && path.includes('/ticket-image/')) {
      fotos.push(path);
      if (e.foto === 'retirada') return route.fulfill({ status: 404, json: { error: 'ticket_image_not_found' } });
      // Un píxel WebP, sin foto del disco.
      return route.fulfill({ contentType: 'image/webp', headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
        body: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64') });
    }
    if (e.pendiente && method === 'POST' && path.endsWith('/items/lock')) {
      rechazos.push(403);
      return route.fulfill({ status: 403, json: { error: 'invitation_not_accepted' } });
    }
    return route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
  await page.goto(origen + '/e2e/fixtures/mesa-visibilidad.html');
  await page.evaluate(async escenario => {
    const ruta = '/e2e/fixtures/mesa-visibilidad.tsx';
    const app = await import(/* @vite-ignore */ ruta) as typeof import('./fixtures/mesa-visibilidad');
    await app.montar(escenario);
  }, e);
  await expect(page.locator('.qc-renglon[data-plato="Plato de prueba"]').first()).toBeAttached();
  // El efecto que pide la miniatura corre después del render. Esperar dos cuadros
  // impide aceptar un cero contado antes de que React monte la fila.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return { fotos, versiones, rechazos };
}

async function positivo(page: Page, e: Escenario = {}) {
  const registro = await montar(page, e);
  await expect(foto(page)).toBeVisible();
  await expect.poll(() => registro.fotos).toEqual([miniatura]);
  await expect.poll(() => foto(page).locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1);
  await expect(finalizar(page)).toBeVisible();
  expect(registro.versiones).toContain('1');
  return registro;
}

const casos: { nombre: string; control?: Escenario; entrada: Escenario; sinFoto?: boolean; sinFinalizar?: boolean }[] = [
  { nombre: 'rol nulo', entrada: { rol: null }, sinFoto: true },
  { nombre: 'rol guest', entrada: { rol: 'guest' }, sinFoto: true },
  { nombre: 'invitado con token', entrada: { invitado: true }, sinFoto: true, sinFinalizar: true },
  { nombre: 'mesa cerrada de lectura', control: { igual: true }, entrada: { igual: true, estado: 'expired' }, sinFoto: true, sinFinalizar: true },
  { nombre: 'mesa pagada', control: { igual: true }, entrada: { igual: true, estado: 'fully_paid' }, sinFoto: true, sinFinalizar: true },
  { nombre: 'mesa pendiente de autorización', control: { igual: true }, entrada: { igual: true, estado: 'pending_auth' }, sinFoto: true, sinFinalizar: true },
  { nombre: 'capacidad de foto apagada con foto en el detalle', entrada: { sinCapacidadFoto: true }, sinFoto: true },
  { nombre: 'capacidad encendida sin foto', entrada: { foto: 'ausente' }, sinFoto: true },
  { nombre: 'mesa del tutorial', entrada: { ejemplo: true }, sinFoto: true, sinFinalizar: true },
  { nombre: 'código distinto del detalle', entrada: { otroCodigo: true }, sinFoto: true },
  { nombre: 'riel de pagos simulado', entrada: { pagos: true }, sinFinalizar: true },
];

for (const caso of casos) {
  test('Visibilidad · ' + caso.nombre, async ({ page }) => {
    await positivo(page, caso.control);
    const r = await montar(page, caso.entrada);
    if (caso.entrada.estado === 'expired') await expect(page.getByText('Esta mesa ya cerró. Lo guardado es sólo de lectura.')).toBeVisible();
    if (caso.sinFoto) {
      await expect(foto(page)).toHaveCount(0);
      expect(r.fotos).toEqual([]);
    } else {
      await expect(foto(page)).toBeVisible();
      await expect.poll(() => r.fotos).toEqual([miniatura]);
    }
    if (caso.sinFinalizar) await expect(finalizar(page)).toHaveCount(0);
    else await expect(finalizar(page)).toBeVisible();
    if (caso.entrada.invitado || caso.entrada.sinCapacidadFoto) expect(r.versiones).toEqual([null]);
  });
}

test('Visibilidad · dueño abierto y participante con pago parcial', async ({ page }) => {
  await positivo(page, { rol: 'opener' });
  await positivo(page, { rol: 'participant', estado: 'partially_paid' });
});

test('Visibilidad · invitación pendiente antes y después del 403 simulado', async ({ page }) => {
  const r = await positivo(page, { pendiente: true });
  await page.locator('.qc-renglon[data-plato="Plato de prueba"] .qc-libre').click();
  await finalizar(page).click();
  await expect(page.getByText('Primero acepta la invitación a esta mesa.')).toBeVisible();
  expect(r.rechazos).toEqual([403]);
  await expect(foto(page)).toHaveCount(0);
  await expect(finalizar(page)).toHaveCount(0);
  expect(r.fotos).toEqual([miniatura]);
});

test('La mesa con varias páginas negocia la segunda versión y muestra su miniatura', async ({ page }) => {
  const r = await montar(page, { foto: 'varias' });
  await expect(foto(page).locator('img')).toBeVisible();
  expect(r.versiones).toContain('2');
  expect(r.fotos).toEqual([miniatura]);
});

test('La mesa retira la fila cuando el servidor ya no tiene la miniatura', async ({ page }) => {
  const r = await montar(page, { foto: 'retirada' });
  await expect.poll(() => r.fotos).toEqual([miniatura]);
  await expect(foto(page)).toHaveCount(0);
  await expect(finalizar(page)).toBeVisible();
});
