import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D245 · D244 · la fachada real contra App Backend 2.172.0: `viaje_version=2`
 * en TODAS las rutas que devuelven `viaje` (el decodificador sólo acepta esa
 * forma), el gasto a mano y la foto de un miembro, con sus rutas exactas.
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
  transferencias_pendientes: 0,
};
const ticket = {
  id: 't', lugar: 'Taxi', tipo_lugar: 'otro', fecha_ticket: null, hora_ticket: null, cargado_en: null, forma: 'iguales',
  monto_cents: 5000, pagado_por: 'm1', pagaste_tu: true,
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
    access_token: 'access-viajes', refresh_token: 'refresh-viajes', family_id: 'family-viajes', principal_id: 'user-viajes',
    user: { id: 'user-viajes', payme_id: 'payme_mx_viajes', email: 'viajes@example.com', first_name: 'Yo', last_name: 'Prueba' },
  });
  aplicarConfigViajes({ features: { viajes: { supported: true, enabled: true } } });
  pedidos = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidos.push({ method: init?.method ?? 'GET', url, body });
    if (url.pathname.endsWith('/gastos')) return json({ contract: CONTRATO_VIAJES, ticket, ya_cargado: null }, 201);
    if (url.pathname.endsWith('/avatar')) return json({ error: 'avatar_not_found' }, 404);
    return json({ contract: CONTRATO_VIAJES, viaje });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  reiniciarViajesParaTests();
});

describe('fachada real · Viajes con App Backend 2.172.0', () => {
  it('🔴 las cuatro rutas que devuelven `viaje` piden `viaje_version=2`, una sola vez y exacta', async () => {
    await api.getViaje(VIAJE);
    await api.crearViaje({ nombre: 'Cancún', fecha_desde: null, fecha_hasta: null, miembros: [], idempotency_key: 'clave-de-prueba-1' });
    await api.aceptarViaje(VIAJE);
    await api.cerrarViaje(VIAJE);
    expect(pedidos.map((p) => `${p.method} ${p.url.pathname}`)).toEqual([
      `GET /api/viajes/${VIAJE}`, 'POST /api/viajes', `POST /api/viajes/${VIAJE}/aceptar`, `POST /api/viajes/${VIAJE}/cerrar`,
    ]);
    for (const p of pedidos) expect(p.url.searchParams.getAll('viaje_version'), p.url.pathname).toEqual(['2']);
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

  it('con Viajes apagado no se pide nada', async () => {
    aplicarConfigViajes({ features: { viajes: { supported: true, enabled: false } } });
    await expect(api.cargarGastoDeViaje(VIAJE, { descripcion: 'x', monto_cents: 1, presentes: ['m1'], idempotency_key: 'gasto-de-prueba-2' }))
      .rejects.toThrow('viajes_not_available');
    await expect(api.getAvatarDeMiembroDeViaje(VIAJE, 'm1', loadSession()!)).rejects.toThrow('viajes_not_available');
    expect(pedidos).toHaveLength(0);
  });
});
