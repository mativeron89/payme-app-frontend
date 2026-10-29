import { createHash } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { AppConfig, InformativeSelectionResponse, LockItemsResponse, MesaDetail, MesaItem } from '../src/api/types';
import type { StoredSession } from '../src/api/storage';

// Fachada real seleccionada por el proyecto oficial mesa-recuperacion-http.
// Sólo HTTP/almacenamiento sintético debajo de la app; ningún método api.X sustituido.
// Verifica el consumidor n422; no acredita concurrencia SQL ni Safari físico.
test.describe.configure({ retries: 0 });
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const ORIGEN = 'http://127.0.0.1:5190';
const CODE = 'PA-3121';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const contrato = 'payme.app.informative-selections/v2' as const;
const SESION: StoredSession = {
  principal_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', family_id: 'familia-inventada-a',
  access_token: 'fake-a', refresh_token: 'fake-ra',
  user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', payme_id: 'payme_fixture_a',
    email: 'fixture-a@example.invalid', first_name: 'Cuenta', last_name: 'Inventada',
    birth_date: '1990-01-01', birth_date_set: true, is_adult: true, avatar: null },
};
const CONFIG: AppConfig = {
  version: 'fixture-n423', currency: 'MXN', stripe_publishable_key: undefined,
  mesa_hold_seconds: 18000, payment_hold_seconds: 600, invitation_expiry_seconds: 3600,
  item_lock_seconds: null,
  features: { stp_dispersal: false, ocr_real: false,
    money_rail: { mode: 'disabled', payments_enabled: false, real_money: false },
    wallet_rail: { enabled: false, account_activity: true },
    viajes: { supported: true, enabled: false }, username: { supported: true, enabled: false } },
};
interface LecturaObservada { body: number; checkpoint: number; render: number; restaurante: string | null }
type FixtureWindow = typeof window & {
  __n423Lecturas: Record<string, LecturaObservada>;
  __n423FachadaIntacta?: () => boolean;
};
interface ObservacionFixture { inesperadas: string[]; peticiones: string[] }
const observaciones = new WeakMap<Page, ObservacionFixture>();
const listo = (page: Page) => page.getByRole('button', { name: 'Listo', exact: true });
const hoja = (page: Page) => page.getByRole('dialog', { name: 'Con esto se cierra la mesa' });
const fila = (page: Page, nombre: string) => page.locator(`.qc-renglon[data-plato="${nombre}"]`);

function barrera() {
  let abrir!: () => void;
  const espera = new Promise<void>((resolve) => { abrir = resolve; });
  return { espera, abrir };
}
async function renderTerminado(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = () => {
      canal.port1.close(); canal.port2.close();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    canal.port2.postMessage(null);
  }));
}
test.afterEach(async ({ page }) => {
  const observacion = observaciones.get(page);
  if (!page.isClosed()) {
    await renderTerminado(page);
    const intacta = await page.evaluate(() => (window as FixtureWindow).__n423FachadaIntacta?.() ?? false);
    expect(intacta, 'las cuatro operaciones de la fachada conservan su identidad').toBe(true);
  }
  expect(observacion?.inesperadas ?? [], 'HTTP/WebSocket desconocido o externo abortado').toEqual([]);
});
function item(id: string, name: string): MesaItem {
  return { id, name, category: 'other', quantity: 1, price_cents: 10000,
    status: 'available', remaining_bps: 10000, my_bps: 0, my_releasable_bps: 0,
    informative_remaining_bps: 10000, locked_by_me: false, lock_expires_at: null };
}

async function fixture(page: Page, modo: 'igual' | 'consumo') {
  const observacion: ObservacionFixture = { inesperadas: [], peticiones: [] };
  observaciones.set(page, observacion);
  const mesa: MesaDetail = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', code: CODE, full_name: 'Mesa de ejemplo inventada',
    division_mode: modo, my_role: 'participant', status: 'open', guarantee_mode: false, closure_reason: null,
    restaurant: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', name: 'Cuenta A', category: 'other', address: null },
    total_cents: 30000, total_display: '$300', paid_amount_cents: 0, tip_amount_cents: 0, tip_base_cents: 15000,
    expected_participants: 2, original_participants: 2, expires_at: '2099-01-01T00:00:00Z', active_staff: [],
    informative_selection_capability: { contract: contrato, supported: modo === 'igual', mutable: true },
    items: [item(A, 'Plato A'), item(B, 'Plato B'), item(C, 'Plato C')] };
  let propia: InformativeSelectionResponse['selection']['items'] = [];
  let updated: string | null = null;
  let mesaGets = 0;
  let propiaGets = 0;
  let writes = 0;
  let mutations = 0;
  let invalidChallenge = false;
  let holdRejection: { entrada: ReturnType<typeof barrera>; salida: ReturnType<typeof barrera>; marca: string } | null = null;
  let barreras = 0;
  const cuerpos: unknown[] = [];
  const ordinalPorIdentidad = new Map<string, number>();
  let retenerMesa: {
    method: 'GET'; path: string; authorization: string; ordinal: number;
    marca: string; entrada: ReturnType<typeof barrera>; salida: ReturnType<typeof barrera>;
  } | null = null;
  let fallarLecturas = false;
  let contradictoria = false;
  let comportamiento: 'ok' | 'rechazo' | 'commit_perdido' | 'incierto' = 'ok';
  const responder = (route: Route, body: unknown, status = 200, extra: Record<string, string> = {}) => route.fulfill({
    status, headers: { 'cache-control': 'private, no-store', vary: 'Authorization', ...extra },
    contentType: 'application/json', body: JSON.stringify(body),
  });
  const respuestaPropia = (): InformativeSelectionResponse => ({ contract: contrato,
    mesa: { code: CODE, division_mode: 'igual', status: mesa.status, mutable: mesa.status === 'open',
      closure_reason: mesa.closure_reason ?? null },
    selection: { source: 'informative', items: structuredClone(propia), updated_at: updated },
    coverage: { all_items_selected: mesa.status === 'expired' } });

  // Antes de montar: sesión inventada, refresco de mesa suspendido y observación
  // PASANTE del body HTTP. No modifica JSON, status ni método de la fachada.
  await page.addInitScript(({ sesion, origen }) => {
    if (location.origin !== origen) return;
    localStorage.setItem('payme_app_session', JSON.stringify(sesion));
    localStorage.setItem('payme.app.idioma.v1', 'es');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const target = window as FixtureWindow;
    target.__n423Lecturas = {};
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof window.fetch>) => {
      const respuesta = await originalFetch(...args);
      const marca = respuesta.headers.get('x-fixture-n423-body');
      if (marca) {
        const leerJson = respuesta.json.bind(respuesta);
        respuesta.json = async () => {
          const body: unknown = await leerJson();
          const audit = target.__n423Lecturas[marca] ??= { body: 0, checkpoint: 0, render: 0, restaurante: null };
          audit.body += 1;
          // Una tarea posterior al checkpoint completo de awaits del body;
          // no un número arbitrario de microtareas ni waitForResponse solo.
          const canal = new MessageChannel();
          canal.port1.onmessage = () => {
            canal.port1.close(); canal.port2.close(); audit.checkpoint += 1;
            requestAnimationFrame(() => requestAnimationFrame(() => {
              audit.restaurante = document.querySelector('.mesa-selection-context-main')?.textContent ?? null;
              audit.render += 1;
            }));
          };
          canal.port2.postMessage(null);
          return body;
        };
      }
      return respuesta;
    };
  }, { sesion: SESION, origen: ORIGEN });
  await page.routeWebSocket('**/*', (socket) => {
    const url = new URL(socket.url());
    if (url.protocol === 'ws:' && url.host === new URL(ORIGEN).host) { socket.connectToServer(); return; }
    observacion.inesperadas.push(`WS ${url.origin}${url.pathname}`);
    socket.close({ code: 1008, reason: 'fixture_external_request' });
  });
  await page.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const method = req.method();
    const rechazar = async (motivo: string) => {
      observacion.inesperadas.push(`${motivo} ${method} ${url.origin}${path}`);
      await route.abort('blockedbyclient');
    };
    if (url.origin !== ORIGEN) { await rechazar('EXTERNO'); return; }
    if (!path.startsWith('/api/')) { await route.continue(); return; }
    observacion.peticiones.push(`${method} ${path}`);
    if (method === 'GET' && path === '/api/config') { await responder(route, CONFIG); return; }
    // Ruta pública de compatibilidad conocida; ningún método distinto de GET.
    if (method === 'GET' && path === '/api/legal/aviso_privacidad') {
      await responder(route, { error: 'not_found' }, 404); return;
    }
    const authorization = req.headers().authorization ?? '';
    if (![SESION.access_token, 'fake-b'].some((t) => authorization === `Bearer ${t}`)) {
      await rechazar('IDENTIDAD_NO_PREVISTA'); return;
    }
    if (method === 'GET') {
      if (path === '/api/legal/acceptance') { await responder(route, { required: false, aviso: null, terminos: null }); return; }
      if (path === '/api/payment-methods') { await responder(route, { payment_methods: [] }); return; }
      if (path === '/api/notifications/unread-count') { await responder(route, { unread_count: 0 }); return; }
      if (path === '/api/mesas/open') { await responder(route, { mesas: [] }); return; }
      if (path === '/api/invitations') { await responder(route, { invitations: [] }); return; }
      if (path === '/api/friends/avatar-notice') { await responder(route, { error: 'not_found' }, 404); return; }
      // D554 · Inicio lee el estado del agente (App Backend 2.208.0, publicado apagado): la forma servida hoy.
      if (path === '/api/agente/estado') {
        await responder(route, { recomendaciones: { enabled: false }, calificaciones: { enabled: false } }); return;
      }
      if (path === `/api/mesas/${CODE}/informative-selection`) {
        propiaGets += 1;
        if (fallarLecturas) { await responder(route, { error: 'unavailable' }, 503); return; }
        const r = respuestaPropia();
        if (contradictoria) r.selection.items = [];
        await responder(route, r); return;
      }
      if (path === `/api/mesas/${CODE}`) {
        mesaGets += 1;
        const ordinal = (ordinalPorIdentidad.get(authorization) ?? 0) + 1;
        ordinalPorIdentidad.set(authorization, ordinal);
        // Las negociaciones las agrega getMesa REAL, no la fixture.
        if (url.searchParams.get('adjustments_version') !== '2'
            || url.searchParams.get('totals_version') !== '2' || url.searchParams.get('share_version') !== '1') {
          await rechazar('FACHADA_SIN_NEGOCIACION'); return;
        }
        const foto = structuredClone(mesa);
        const retenida = retenerMesa;
        const cabeceraDeBarrera: Record<string, string> = {};
        if (retenida && retenida.method === method && retenida.path === path
            && retenida.authorization === authorization && retenida.ordinal === ordinal) {
          retenerMesa = null; retenida.entrada.abrir(); await retenida.salida.espera;
          cabeceraDeBarrera['x-fixture-n423-body'] = retenida.marca;
        }
        if (fallarLecturas) { await responder(route, { error: 'unavailable' }, 503); return; }
        await responder(route, { mesa: foto }, 200, cabeceraDeBarrera);
        return;
      }
    }
    if (!((method === 'PUT' && path === `/api/mesas/${CODE}/informative-selection`)
        || (method === 'POST' && path === `/api/mesas/${CODE}/items/lock`))) {
      await rechazar('API_DESCONOCIDA'); return;
    }
    writes += 1;
    const body: unknown = req.postDataJSON(); cuerpos.push(body);
    const selection = body as { items: Array<{ item_id: string; fraction_bps?: number;
      fraction_denominator?: number; declared_fraction_bps?: number }>;
      closure_confirmation?: { contract: string; revision: string; confirmed: boolean } };
    const revision = createHash('sha256').update(JSON.stringify({ mesa, propia, updated,
      items: selection.items, authorization })).digest('hex');
    const wouldClose = mesa.items.some((i) => i.price_cents > 0) && mesa.items.every((i) => {
      if (i.price_cents === 0) return true;
      const desired = selection.items.find((x) => x.item_id === i.id);
      if (modo === 'consumo') return desired
        ? (desired.fraction_bps ?? Math.floor(10000 / desired.fraction_denominator!))
          + 10000 - i.remaining_bps - i.my_bps >= 10000 : i.remaining_bps === 0;
      const own = propia.find((x) => x.item_id === i.id)?.declared_fraction_bps ?? 0;
      return (desired?.declared_fraction_bps ?? 0) + 10000 - Number(i.informative_remaining_bps) - own >= 10000;
    });
    const challenge = { contract: 'payme.app.selection-closure/v1', revision,
      mesa_code: invalidChallenge ? 'PA-ajena' : CODE, division_mode: modo,
      would_close: true, valid_until: mesa.expires_at };
    const confirmation = selection.closure_confirmation;
    const changed = !!confirmation && (confirmation.revision !== revision || !wouldClose);
    if (changed || (!confirmation && wouldClose)) {
      const rejected = { error: changed ? 'selection_closure_state_changed' : 'selection_closure_confirmation_required',
        ...(wouldClose && { closure_confirmation: challenge }) };
      const held = holdRejection; holdRejection = null;
      if (held) { held.entrada.abrir(); await held.salida.espera; }
      await responder(route, rejected, 409, held ? { 'x-fixture-n423-body': held.marca } : {}); return;
    }
    if (confirmation && (confirmation.contract !== 'payme.app.selection-closure/v1' || confirmation.confirmed !== true)) {
      await responder(route, { error: 'validation_error' }, 400); return;
    }
    if (comportamiento === 'rechazo') { await responder(route, { error: 'validation_error' }, 400); return; }
    if (comportamiento === 'incierto') { await responder(route, { error: 'unavailable' }, 503); return; }
    mutations += 1;
    if (method === 'PUT') {
      const request = body as { items: InformativeSelectionResponse['selection']['items'] };
      const previa = new Map(propia.map((i) => [i.item_id, i.declared_fraction_bps]));
      const ajenas = new Map(mesa.items.map((i) => [i.id,
        10000 - Number(i.informative_remaining_bps) - (previa.get(i.id) ?? 0)]));
      propia = structuredClone(request.items); updated = '2026-10-21T16:00:00Z';
      for (const i of mesa.items) i.informative_remaining_bps = Math.max(0,
        10000 - (ajenas.get(i.id) ?? 0) - (propia.find((x) => x.item_id === i.id)?.declared_fraction_bps ?? 0));
    } else {
      const request = body as { items: Array<{ item_id: string; fraction_bps?: number; fraction_denominator?: number }> };
      for (const r of request.items) {
        const i = mesa.items.find((x) => x.id === r.item_id)!;
        i.my_bps = r.fraction_bps ?? Math.floor(10000 / r.fraction_denominator!);
        i.my_releasable_bps = i.my_bps; i.remaining_bps = 10000 - i.my_bps;
        i.locked_by_me = true; i.status = 'locked';
      }
    }
    const completa = mesa.items.filter((i) => i.price_cents > 0).every((i) => (
      modo === 'igual' ? i.informative_remaining_bps === 0 : i.remaining_bps === 0));
    if (completa) { mesa.status = 'expired'; mesa.closure_reason = 'all_items_selected'; }
    if (comportamiento === 'commit_perdido') { await route.abort('failed'); return; }
    if (method === 'PUT') { await responder(route, respuestaPropia()); return; }
    const locked = (body as { items: Array<{ item_id: string }> }).items.map((i) => i.item_id);
    const response: LockItemsResponse = { locked, claims: locked.map((id) => ({ item_id: id,
      fraction_bps: mesa.items.find((i) => i.id === id)!.my_bps })),
      lock_token: 'fake-l', lock_expires_at: null,
      ...(mesa.status === 'expired' ? { mesa_status: mesa.status, closure_reason: mesa.closure_reason } : {}) };
    await responder(route, response);
  });
  return {
    mesa, cuerpos,
    get mutations() { return mutations; },
    malformarDesafio() { invalidChallenge = true; },
    retenerRechazo() {
      const entrada = barrera(); const salida = barrera(); const marca = `rechazo-${++barreras}`;
      holdRejection = { entrada, salida, marca };
      return { abrir: salida.abrir, entrado: entrada.espera, marca };
    },
    get mesaGets() { return mesaGets; }, get propiaGets() { return propiaGets; }, get writes() { return writes; },
    guardarEnOtraPestana(items: typeof propia) { propia = structuredClone(items); updated = '2026-10-21T15:00:00Z'; },
    retener(authorization = `Bearer ${SESION.access_token}`) {
      const salida = barrera(); const entrada = barrera(); const marca = `lectura-${++barreras}`;
      retenerMesa = { method: 'GET', path: `/api/mesas/${CODE}`, authorization,
        ordinal: (ordinalPorIdentidad.get(authorization) ?? 0) + 1, marca, entrada, salida };
      return { abrir: salida.abrir, entrado: entrada.espera, marca };
    },
    fallar(valor: boolean) { fallarLecturas = valor; },
    contradecir() { contradictoria = true; },
    comportamiento(valor: typeof comportamiento) { comportamiento = valor; },
  };
}
async function entrar(page: Page) {
  await page.goto(`/mesa/${CODE}`);
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Listo|Guardado)$/ })).toBeEnabled();
  const witness = await page.evaluate(async () => {
    const path = '/src/api/index.ts'; const railPath = '/src/api/moneyRail.ts';
    const cortePath = '/src/api/releaseGates.ts'; const ejemploPath = '/src/ayuda/ejemplo/estadoEjemplo.ts';
    const module = await import(/* @vite-ignore */ path) as typeof import('../src/api');
    const { readMoneyRail } = await import(/* @vite-ignore */ railPath) as typeof import('../src/api/moneyRail');
    const { corteDePagosView } = await import(/* @vite-ignore */ cortePath) as typeof import('../src/api/releaseGates');
    const { ejemploLocal } = await import(/* @vite-ignore */ ejemploPath) as typeof import('../src/ayuda/ejemplo/estadoEjemplo');
    const { api } = module;
    const originales = [api.getMesa, api.getInformativeSelection, api.replaceInformativeSelection, api.lockItems];
    (window as FixtureWindow).__n423FachadaIntacta = () => originales.every((f, i) => f === [
      api.getMesa, api.getInformativeSelection, api.replaceInformativeSelection, api.lockItems][i]);
    const config = await api.getConfig(); const rail = readMoneyRail(config);
    return { isMock: module.IS_MOCK, ejemplo: ejemploLocal.leer().activo, status: rail.status,
      mode: rail.mode, allowsPay: corteDePagosView(rail).allowsPay };
  });
  expect(witness).toEqual({ isMock: false, ejemplo: false, status: 'authoritative', mode: 'disabled', allowsPay: false });
}
async function elegir(page: Page, nombre = 'Plato A') {
  await fila(page, nombre).locator('.qc-libre').click();
}

// T1: las lecturas reales preceden al pedido; el desafío del servidor precede a la confirmación.
test('T1 · propia obsoleta de otra pestaña: lee antes de decidir hoja y no escribe sin confirmar', async ({ page }) => {
  const f = await fixture(page, 'igual');
  f.mesa.items = f.mesa.items.slice(0, 2);
  f.mesa.items[0]!.informative_remaining_bps = 0;
  f.guardarEnOtraPestana([{ item_id: A, declared_fraction_bps: 10000 }]);
  await entrar(page);
  await fila(page, 'Plato A').locator('.qc-pildora').click();
  await page.getByRole('radio', { name: '½', exact: true }).click();
  await elegir(page, 'Plato B');
  // La otra pestaña reduce lo propio y otra persona completa esa mitad.
  f.guardarEnOtraPestana([{ item_id: A, declared_fraction_bps: 5000 }]);
  const antesMesa = f.mesaGets; const antesPropia = f.propiaGets;
  await listo(page).click();
  await expect(hoja(page)).toBeVisible();
  expect(f.mesaGets).toBeGreaterThan(antesMesa); expect(f.propiaGets).toBeGreaterThan(antesPropia);
  expect(f.writes).toBe(1); expect(f.mutations).toBe(0);
  await hoja(page).getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
  await expect.poll(() => f.writes).toBe(2); await expect.poll(() => f.mutations).toBe(1);
});

test('GET atrasado conserva una edición posterior y usa el borrador vigente', async ({ page }) => {
  const f = await fixture(page, 'igual'); await entrar(page); await elegir(page);
  const b = f.retener(); const antes = f.mesaGets;
  await listo(page).click(); await b.entrado; await expect.poll(() => f.mesaGets).toBeGreaterThan(antes);
  await elegir(page, 'Plato B'); expect(f.writes).toBe(0);
  b.abrir();
  await expect.poll(() => f.writes).toBe(1);
  expect(f.cuerpos).toEqual([{ items: [
    { item_id: A, declared_fraction_bps: 10000 }, { item_id: B, declared_fraction_bps: 10000 },
  ], confirm_closure: true }]);
  await expect(page).toHaveURL(/\/home$/);
});

test('GET de otra identidad resuelto tarde no pisa la cuenta nueva ni dispara una mutación', async ({ page }) => {
  const f = await fixture(page, 'consumo'); await entrar(page); await elegir(page);
  const b = f.retener(); const antes = f.mesaGets;
  await listo(page).click(); await b.entrado; await expect.poll(() => f.mesaGets).toBeGreaterThan(antes);
  f.mesa.restaurant.name = 'Cuenta B';
  await page.evaluate(async () => {
    const path = '/src/api/storage.ts';
    const s = await import(/* @vite-ignore */ path) as typeof import('../src/api/storage');
    const actual = s.loadSession(); if (!actual) throw new Error('fixture sin sesión');
    s.saveSession({ ...actual, user: actual.user ? { ...actual.user, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } : undefined, principal_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      family_id: actual.family_id, access_token: 'fake-b', refresh_token: 'fake-rb' });
  });
  await expect(page.getByText('Cuenta B', { exact: true })).toBeVisible();
  b.abrir();
  await expect.poll(() => page.evaluate((marca) => (window as FixtureWindow).__n423Lecturas[marca] ?? null, b.marca))
    .toEqual({ body: 1, checkpoint: 1, render: 1, restaurante: 'Cuenta B' });
  await expect(page.getByText('Cuenta B', { exact: true })).toBeVisible();
  expect(f.writes).toBe(0);
});

test('lock guardado con respuesta perdida y GET fallido bloquea otra escritura hasta reconciliar', async ({ page }) => {
  const f = await fixture(page, 'consumo'); await entrar(page); await elegir(page);
  f.comportamiento('commit_perdido');
  // El preflight termina; el fallo de lectura se activa AL salir el POST.
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/items/lock')) f.fallar(true); });
  await listo(page).click();
  await expect(page.getByRole('button', { name: 'Actualizar estado', exact: true })).toBeEnabled();
  await expect(listo(page)).toBeDisabled(); expect(f.writes).toBe(1);
  await expect(fila(page, 'Plato B').locator('.qc-libre')).toBeDisabled();
  f.fallar(false);
  await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
  await expect(page).toHaveURL(/\/home$/); expect(f.writes).toBe(1);
});

test('rechazo definitivo sin commit conserva borrador y no navega ni reenvía automáticamente', async ({ page }) => {
  const f = await fixture(page, 'consumo'); await entrar(page); await elegir(page);
  f.comportamiento('rechazo'); await listo(page).click();
  await expect(page.getByRole('status').filter({ hasText: 'No pudimos reservar lo que elegiste' })).toBeVisible();
  await expect(listo(page)).toBeEnabled();
  await expect(fila(page, 'Plato A').locator('[data-estado="mio"]')).toBeVisible();
  expect(f.mesa.items[0]!.my_bps).toBe(0); expect(f.writes).toBe(1);
  await expect(page).toHaveURL(new RegExp(`/mesa/${CODE}$`));
});

test('PUT informativo guardado y cerrado con respuesta perdida converge al éxito normal', async ({ page }) => {
  const f = await fixture(page, 'igual'); f.mesa.items = [f.mesa.items[0]!];
  await entrar(page); await elegir(page); f.comportamiento('commit_perdido');
  await listo(page).click(); await expect(hoja(page)).toBeVisible();
  await hoja(page).getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
  await expect(page.getByText('La mesa se cerró', { exact: true })).toBeVisible();
  await expect(page.getByText('Se eligieron todos los consumos.')).toBeVisible();
  expect(f.writes).toBe(2); expect(f.mutations).toBe(1); await expect(page).toHaveURL(new RegExp(`/mesa/${CODE}$`));
});

test('selección contradictoria tras resultado ambiguo mantiene bloqueo aun tras otro GET exitoso', async ({ page }) => {
  const f = await fixture(page, 'igual'); await entrar(page); await elegir(page);
  f.comportamiento('incierto'); f.contradecir(); await listo(page).click();
  const actualizar = page.getByRole('button', { name: 'Actualizar estado', exact: true });
  await expect(actualizar).toBeEnabled(); await expect(listo(page)).toBeDisabled();
  const antes = f.propiaGets; await actualizar.click();
  await expect.poll(() => f.propiaGets).toBeGreaterThan(antes);
  await expect(actualizar).toBeEnabled(); await expect(listo(page)).toBeDisabled();
  expect(f.writes).toBe(1); await expect(page).toHaveURL(new RegExp(`/mesa/${CODE}$`));
});

test('T3 · A propio completo + agua $0 libre + borrador vacío: Listo no escribe ni abre hoja', async ({ page }) => {
  const f = await fixture(page, 'consumo');
  f.mesa.items = [{ ...item(A, 'Plato A'), remaining_bps: 0, my_bps: 10000,
    my_releasable_bps: 10000, locked_by_me: true, status: 'locked' }, { ...item(B, 'Agua'), price_cents: 0 }];
  await entrar(page); await listo(page).click();
  await expect(page).toHaveURL(/\/home$/); expect(f.writes).toBe(0); await expect(hoja(page)).toHaveCount(0);
});

test('consumo propio repetido: el servidor exige hoja antes de registrar otro lock', async ({ page }) => {
  const f = await fixture(page, 'consumo'); await entrar(page);
  await elegir(page, 'Plato A'); await elegir(page, 'Plato B'); await elegir(page, 'Plato C');
  // Otra pestaña registró A/B: el borrador local los repite y además pide C.
  for (const i of f.mesa.items.slice(0, 2)) {
    i.remaining_bps = 0; i.my_bps = 10000; i.my_releasable_bps = 10000;
    i.locked_by_me = true; i.status = 'locked';
  }
  const antes = f.mesaGets; await listo(page).click();
  await expect(hoja(page)).toBeVisible(); expect(f.mesaGets).toBeGreaterThan(antes);
  expect(f.writes).toBe(1); expect(f.mutations).toBe(0);
  // El desafío aún no registró A/B/C. Revisar no confirma ni modifica lo propio.
  await hoja(page).getByRole('button', { name: 'Revisar', exact: true }).click();
  await expect(hoja(page)).toHaveCount(0); expect(f.writes).toBe(1); expect(f.mutations).toBe(0);
});

for (const mode of ['consumo', 'igual'] as const) {
  test(`n422 ${mode}: desafío obsoleto exige otro gesto y conserva exactamente el pedido`, async ({ page }) => {
    const f = await fixture(page, mode); f.mesa.items = [f.mesa.items[0]!];
    await entrar(page); await elegir(page); await listo(page).click(); await expect(hoja(page)).toBeVisible();
    expect(f.writes).toBe(1); expect(f.mutations).toBe(0);
    const initial = f.cuerpos[0] as { items: unknown[] };
    f.mesa.restaurant.name = 'Mesa actualizada';
    await hoja(page).getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
    await expect(page.getByText('Mesa actualizada', { exact: true })).toBeVisible();
    await expect(hoja(page)).toBeVisible();
    expect(f.writes).toBe(2); expect(f.mutations).toBe(0);
    const previous = f.cuerpos[1] as { items: unknown[]; closure_confirmation: { revision: string; confirmed: boolean } };
    expect(previous.items).toEqual(initial.items); expect(previous.closure_confirmation.confirmed).toBe(true);
    await hoja(page).getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
    await expect(page.getByText('La mesa se cerró', { exact: true })).toBeVisible();
    expect(f.writes).toBe(3); expect(f.mutations).toBe(1);
    const current = f.cuerpos[2] as typeof previous;
    expect(current.items).toEqual(initial.items);
    expect(current.closure_confirmation.revision).not.toBe(previous.closure_confirmation.revision);
  });

  test(`n422 ${mode}: desafío malformado falla cerrado sin incertidumbre ni reenvío`, async ({ page }) => {
    const f = await fixture(page, mode); f.mesa.items = [f.mesa.items[0]!]; f.malformarDesafio();
    await entrar(page); await elegir(page); await listo(page).click();
    await expect(page.getByRole('status').filter({ hasText: 'No pudimos verificar la confirmación de cierre.' })).toBeVisible();
    await expect(hoja(page)).toHaveCount(0); await expect(listo(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Actualizar estado', exact: true })).toHaveCount(0);
    expect(f.writes).toBe(1); expect(f.mutations).toBe(0);
  });

  test(`n422 ${mode}: 503 tras confirmar se reconcilia sólo por lectura`, async ({ page }) => {
    const f = await fixture(page, mode); f.mesa.items = [f.mesa.items[0]!];
    await entrar(page); await elegir(page); await listo(page).click(); await expect(hoja(page)).toBeVisible();
    f.comportamiento('incierto');
    await hoja(page).getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
    const actualizar = page.getByRole('button', { name: 'Actualizar estado', exact: true });
    await expect(actualizar).toBeEnabled(); await expect(listo(page)).toBeDisabled();
    expect(f.writes).toBe(2); expect(f.mutations).toBe(0);
    await actualizar.click(); await expect(actualizar).toBeEnabled();
    expect(f.writes).toBe(2); expect(f.mutations).toBe(0); await expect(hoja(page)).toHaveCount(0);
  });
}

test('n422 changed sin desafío conserva borrador, no finge cierre ni reenvía', async ({ page }) => {
  const f = await fixture(page, 'consumo'); f.mesa.items = [f.mesa.items[0]!];
  await entrar(page); await elegir(page); await listo(page).click(); await expect(hoja(page)).toBeVisible();
  f.mesa.items.push(item(B, 'Plato B'));
  await hoja(page).getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
  await expect(fila(page, 'Plato B')).toBeVisible(); await expect(hoja(page)).toHaveCount(0);
  await expect(fila(page, 'Plato A').locator('[data-estado="mio"]')).toBeVisible();
  await expect(listo(page)).toBeEnabled(); expect(f.writes).toBe(2); expect(f.mutations).toBe(0);
});

test('n422 rechazo tardío de otra identidad no abre una hoja para la nueva cuenta', async ({ page }) => {
  const f = await fixture(page, 'consumo'); f.mesa.items = [f.mesa.items[0]!];
  await entrar(page); await elegir(page); const held = f.retenerRechazo();
  await listo(page).click(); await held.entrado;
  f.mesa.restaurant.name = 'Cuenta B';
  await page.evaluate(async () => {
    const path = '/src/api/storage.ts'; const storage = await import(/* @vite-ignore */ path) as typeof import('../src/api/storage');
    const actual = storage.loadSession(); if (!actual) throw new Error('fixture sin sesión');
    storage.saveSession({ ...actual, principal_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      user: actual.user ? { ...actual.user, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } : undefined,
      access_token: 'fake-b', refresh_token: 'fake-rb' });
  });
  await expect(page.getByText('Cuenta B', { exact: true })).toBeVisible(); held.abrir();
  await expect.poll(() => page.evaluate((marca) => (window as FixtureWindow).__n423Lecturas[marca] ?? null, held.marca))
    .toEqual({ body: 1, checkpoint: 1, render: 1, restaurante: 'Cuenta B' });
  await expect(hoja(page)).toHaveCount(0); expect(f.writes).toBe(1); expect(f.mutations).toBe(0);
});
