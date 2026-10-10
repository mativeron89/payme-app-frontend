import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D245 · D244 · la fachada real contra el dueño: `viaje_version` en TODAS las
 * rutas que devuelven `viaje` (el decodificador sólo acepta esa forma; hoy la 5,
 * App Backend 2.177.0, también en las de ticket), el gasto a mano y la foto de un miembro, con sus rutas exactas.
 */
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });

const { saveSession, loadSession } = await import('./storage');
const { api, IS_MOCK } = await import('./index');
const { aplicarConfigViajes, reiniciarViajesParaTests, CONTRATO_VIAJES } = await import('./viajes');

const VIAJE = '0e000000-0000-4000-8000-000000000001';
const persona = { first_name: 'Yo', last_name: null, username: null, eliminada: false };
const viaje = {
  id: VIAJE, nombre: 'Cancún', fecha_desde: null, fecha_hasta: null, estado: 'abierto', creado_en: null, mi_miembro_id: 'm1',
  miembros: [{ id: 'm1', ...persona, es_yo: true, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0 }],
  invitados: [], mi_balance_cents: 0, gasto_del_grupo_cents: 0, tickets: [], sin_repartir: [], transferencias: [],
  transferencias_pendientes: 0, color: 'azul', has_photo: true,
};
const enLista = { id: VIAJE, nombre: 'Cancún', fecha_desde: null, fecha_hasta: null, estado: 'abierto', personas: 1,
  mi_balance_cents: 0, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null, color: null, has_photo: false };
const foto = { revision: 2, width: 512, height: 512, updated_at: '2026-10-10T03:00:00.000Z' };
const ticket = {
  id: 't', lugar: 'Taxi', tipo_lugar: 'otro', fecha_ticket: null, hora_ticket: null, cargado_en: null, forma: 'iguales',
  monto_cents: 5000, pagado_por: 'm1', pagaste_tu: true, pagadores: [{ miembro_id: 'm1', monto_cents: 5000 }],
  items: [{ id: 'i', name: 'Taxi', price_cents: 5000, quantity: 1, line_cents: 5000, remaining_bps: 0, my_bps: 0, my_amount_cents: 0 }],
  personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }],
  te_toca_cents: 5000, sin_repartir_cents: 0, puedo_elegir: false, puedo_marcar_presentes: true,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let pedidos: Array<{ method: string; url: URL; body: unknown }> = [];

beforeEach(() => {
  expect(IS_MOCK).toBe(false);
  saveSession({
    access_token: 'a', refresh_token: 'r', family_id: 'family-viajes', principal_id: 'user-viajes',
    user: { id: 'user-viajes', payme_id: 'payme_mx_viajes', email: 'viajes@example.com', first_name: 'Yo', last_name: 'Prueba' },
  });
  aplicarConfigViajes({ features: { viajes: { supported: true, enabled: true } } });
  pedidos = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    pedidos.push({ method: init?.method ?? 'GET', url, body });
    if (url.pathname.endsWith('/gastos')) return json({ contract: CONTRATO_VIAJES, ticket, ya_cargado: null }, 201);
    // D263 · las rutas de ticket (menos eliminar, que devuelve el viaje).
    if (url.pathname.endsWith('/tickets') && init?.method === 'POST') return json({ contract: CONTRATO_VIAJES, ticket, ya_cargado: null }, 201);
    if (/\/tickets\/[^/]+(\/(seleccion|presentes))?$/.test(url.pathname) && init?.method !== 'DELETE') {
      return json({ contract: CONTRATO_VIAJES, ticket });
    }
    if (url.pathname.endsWith('/avatar')) return json({ error: 'avatar_not_found' }, 404);
    if (url.pathname.endsWith('/foto') && init?.method === 'PUT') return json({ foto }, 201);
    if (url.pathname.endsWith('/foto') && init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/foto')) return json({ error: 'viaje_photo_not_found' }, 404);
    if (url.pathname === '/api/viajes' && (init?.method ?? 'GET') === 'GET') {
      return json({ contract: CONTRATO_VIAJES, viajes: [enLista], counts: { abiertos: 1, cerrados: 0 } });
    }
    return json({ contract: CONTRATO_VIAJES, viaje });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  reiniciarViajesParaTests();
});

describe('fachada real · Viajes con App Backend 2.177.0', () => {
  it('🔴 D256 · las rutas que devuelven `viaje`, y la lista, piden `viaje_version=5`, una sola vez y exacta', async () => {
    const v = await api.getViaje(VIAJE);
    expect(v).toMatchObject({ color: 'azul', has_photo: true });
    await api.crearViaje({ nombre: 'Cancún', fecha_desde: null, fecha_hasta: null, miembros: [], idempotency_key: 'clave-de-prueba-1' });
    await api.aceptarViaje(VIAJE);
    await api.cerrarViaje(VIAJE);
    await api.editarViaje(VIAJE, { color: 'verde' });
    const l = await api.getViajes('abiertos');
    expect(l.viajes[0]).toMatchObject({ color: null, has_photo: false });
    expect(pedidos.map((p) => `${p.method} ${p.url.pathname}`)).toEqual([
      `GET /api/viajes/${VIAJE}`, 'POST /api/viajes', `POST /api/viajes/${VIAJE}/aceptar`, `POST /api/viajes/${VIAJE}/cerrar`,
      `PATCH /api/viajes/${VIAJE}`, 'GET /api/viajes',
    ]);
    for (const p of pedidos) expect(p.url.searchParams.getAll('viaje_version'), p.url.pathname).toEqual(['5']);
    expect(pedidos.at(-1)!.url.searchParams.getAll('estado')).toEqual(['abiertos']);
  });

  it('🔴 D255 · editar manda sólo lo que cambia, con `null` para borrar', async () => {
    await api.editarViaje(VIAJE, { nombre: 'Cancún 2027', fecha_hasta: null, color: null });
    expect(pedidos[0]!.method).toBe('PATCH');
    expect(pedidos[0]!.body).toEqual({ nombre: 'Cancún 2027', fecha_hasta: null, color: null });
  });

  it('🔴 D255 · la foto: PUT multipart con el campo `foto`, DELETE y GET por su ruta', async () => {
    const archivo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    await expect(api.subirFotoDeViaje('a/b', archivo)).resolves.toEqual(foto);
    expect(pedidos[0]!.method).toBe('PUT');
    expect(pedidos[0]!.url.pathname).toBe('/api/viajes/a%2Fb/foto');
    const form = pedidos[0]!.body as FormData;
    expect([...form.keys()]).toEqual(['foto']);
    await api.quitarFotoDeViaje(VIAJE, loadSession()!);
    expect(`${pedidos[1]!.method} ${pedidos[1]!.url.pathname}`).toBe(`DELETE /api/viajes/${VIAJE}/foto`);
    await expect(api.getFotoDeViaje(VIAJE, loadSession()!)).rejects.toThrow();
    expect(`${pedidos[2]!.method} ${pedidos[2]!.url.pathname}`).toBe(`GET /api/viajes/${VIAJE}/foto`);
    // Un tipo que el dueño no acepta no sale de la app.
    await expect(api.subirFotoDeViaje(VIAJE, new Blob(['x'], { type: 'image/gif' }))).rejects.toThrow('avatar_media_type_unsupported');
    expect(pedidos).toHaveLength(3);
  });

  it('🔴 D255-6 · quién pagó: sin pedirlo, el gasto no lleva `pagado_por`', async () => {
    const pedido = { descripcion: 'Taxi', monto_cents: 5000, presentes: ['m1'], idempotency_key: 'gasto-de-prueba-9' };
    await api.cargarGastoDeViaje(VIAJE, pedido);
    expect(pedidos[0]!.body).toEqual(pedido);
    expect(pedidos[0]!.body).not.toHaveProperty('pagado_por');
  });

  it('🔴 D263 · las rutas de ticket también piden `viaje_version=5`, una sola vez y exacta', async () => {
    await api.cargarTicketDeViaje(VIAJE, {
      ocr_receipt: 'or1.x.y', idempotency_key: 'ticket-de-prueba-1', forma: 'iguales', tipo_lugar: 'otro', lugar: 'Taxi',
      fecha_ticket: null, hora_ticket: null, items: [{ name: 'Taxi', price_cents: 5000, quantity: 1 }],
    });
    await api.cargarGastoDeViaje(VIAJE, { descripcion: 'Taxi', monto_cents: 5000, presentes: ['m1'], idempotency_key: 'gasto-de-prueba-5' });
    const t = await api.getTicketDeViaje(VIAJE, 't');
    expect(t.pagadores).toEqual([{ miembro_id: 'm1', monto_cents: 5000 }]);
    await api.elegirEnTicketDeViaje(VIAJE, 't', { items: [], listo: true });
    await api.marcarPresentesEnTicket(VIAJE, 't', ['m1']);
    expect(pedidos.map((p) => `${p.method} ${p.url.pathname}`)).toEqual([
      `POST /api/viajes/${VIAJE}/tickets`, `POST /api/viajes/${VIAJE}/gastos`, `GET /api/viajes/${VIAJE}/tickets/t`,
      `PUT /api/viajes/${VIAJE}/tickets/t/seleccion`, `PUT /api/viajes/${VIAJE}/tickets/t/presentes`,
    ]);
    for (const p of pedidos) expect(p.url.searchParams.getAll('viaje_version'), p.url.pathname).toEqual(['5']);
  });

  it('🔴 D263 · el gasto con varios lleva `pagadores` tal cual, sin `pagado_por`', async () => {
    const otro = { ...ticket, pagadores: [{ miembro_id: 'm1', monto_cents: 3000 }, { miembro_id: 'm2', monto_cents: 2000 }] };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      pedidos.push({ method: init?.method ?? 'GET', url: new URL(String(input), 'http://localhost'), body: JSON.parse(String(init?.body)) });
      return json({ contract: CONTRATO_VIAJES, ticket: otro, ya_cargado: null }, 201);
    }));
    const pedido = { descripcion: 'Taxi', monto_cents: 5000, presentes: ['m1'], idempotency_key: 'gasto-de-prueba-6',
      pagadores: [{ miembro_id: 'm1', monto_cents: 3000 }, { miembro_id: 'm2', monto_cents: 2000 }] };
    expect((await api.cargarGastoDeViaje(VIAJE, pedido)).pagadores).toEqual(otro.pagadores);
    expect(pedidos[0]!.body).toEqual(pedido);
    expect(pedidos[0]!.body).not.toHaveProperty('pagado_por');
  });

  it('D244 · el gasto a mano va a `POST /api/viajes/:id/gastos` con el cuerpo exacto', async () => {
    const pedido = { descripcion: 'Taxi', monto_cents: 5000, presentes: ['m1'], idempotency_key: 'gasto-de-prueba-1' };
    const t = await api.cargarGastoDeViaje(VIAJE, pedido);
    expect(t.monto_cents).toBe(5000);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.method).toBe('POST');
    expect(pedidos[0]!.url.pathname).toBe(`/api/viajes/${VIAJE}/gastos`);
    expect(pedidos[0]!.body).toEqual(pedido);
  });

  it('D245 · la foto de un miembro, por su ruta, y el 404 no se convierte en foto', async () => {
    const sesion = loadSession()!;
    await expect(api.getAvatarDeMiembroDeViaje(VIAJE, 'm/1', sesion)).rejects.toThrow();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.url.pathname).toBe(`/api/viajes/${VIAJE}/miembros/m%2F1/avatar`);
  });

  it('🔴 D255-8 · «Agregar miembros» va a `POST /api/viajes/:id/miembros?viaje_version=5` con sólo `{ miembros }`', async () => {
    const v = await api.invitarAlViaje(VIAJE, [{ user_id: 'c1000000-0000-4000-8000-000000000001' }, { username: 'leo.paz' }]);
    expect(v.id).toBe(VIAJE);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.method).toBe('POST');
    expect(pedidos[0]!.url.pathname).toBe(`/api/viajes/${VIAJE}/miembros`);
    expect(pedidos[0]!.url.searchParams.getAll('viaje_version')).toEqual(['5']);
    expect(pedidos[0]!.body).toEqual({ miembros: [{ user_id: 'c1000000-0000-4000-8000-000000000001' }, { username: 'leo.paz' }] });
  });

  it('🔴 D256 · eliminar va a `DELETE /api/viajes/:id/tickets/:tid?viaje_version=5`, sin cuerpo, y devuelve el viaje', async () => {
    const v = await api.eliminarTicketDeViaje('a/b', 't/1');
    expect(v.id).toBe(VIAJE);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.method).toBe('DELETE');
    expect(pedidos[0]!.url.pathname).toBe('/api/viajes/a%2Fb/tickets/t%2F1');
    expect(pedidos[0]!.url.searchParams.getAll('viaje_version')).toEqual(['5']);
    expect([...pedidos[0]!.url.searchParams.keys()]).toEqual(['viaje_version']);
    expect(pedidos[0]!.body).toBeUndefined();
  });

  it('D255-8 · el id del viaje va codificado en la ruta de «Agregar miembros»', async () => {
    await api.invitarAlViaje('a/b', [{ username: 'leo.paz' }]);
    expect(pedidos[0]!.url.pathname).toBe('/api/viajes/a%2Fb/miembros');
  });

  it('con Viajes apagado no se pide nada', async () => {
    aplicarConfigViajes({ features: { viajes: { supported: true, enabled: false } } });
    await expect(api.cargarGastoDeViaje(VIAJE, { descripcion: 'x', monto_cents: 1, presentes: ['m1'], idempotency_key: 'gasto-de-prueba-2' }))
      .rejects.toThrow('viajes_not_available');
    await expect(api.getAvatarDeMiembroDeViaje(VIAJE, 'm1', loadSession()!)).rejects.toThrow('viajes_not_available');
    await expect(api.invitarAlViaje(VIAJE, [{ username: 'leo.paz' }])).rejects.toThrow('viajes_not_available');
    await expect(api.editarViaje(VIAJE, { color: 'azul' })).rejects.toThrow('viajes_not_available');
    await expect(api.subirFotoDeViaje(VIAJE, new Blob(['x'], { type: 'image/jpeg' }))).rejects.toThrow('viajes_not_available');
    await expect(api.quitarFotoDeViaje(VIAJE, loadSession()!)).rejects.toThrow('viajes_not_available');
    await expect(api.getFotoDeViaje(VIAJE, loadSession()!)).rejects.toThrow('viajes_not_available');
    await expect(api.eliminarTicketDeViaje(VIAJE, 't')).rejects.toThrow('viajes_not_available');
    expect(pedidos).toHaveLength(0);
  });
});
