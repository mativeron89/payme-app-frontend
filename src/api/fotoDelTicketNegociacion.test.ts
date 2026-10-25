import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D464 · D466 · la fachada REAL contra el dueño 2.193.0 (PR72, apagado):
 *
 * - 🔴 sin la capacidad (el backend de hoy), ni un byte distinto: ningún pedido
 *   negocia `ticket_image_version=1`, ni se pide ninguna foto, y una clave
 *   `ticket_image` que llegara sin negociar rompe el decodificador estricto;
 * - con la capacidad, la lista de Mesas y el ticket de un viaje la negocian, y
 *   las fotos se piden por su transporte privado: `image/webp`, `private`,
 *   `Vary: Authorization`, con su firma, y `cache: 'no-store'`.
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
const { aplicarConfigViajes, CONTRATO_VIAJES } = await import('./viajes');
const { aplicarConfigFotoDelTicket, reiniciarFotoDelTicketParaTests } = await import('./fotoDelTicket');
const { pedirFotoDelTicket, claveDeFotoDelTicket } = await import('./fotosDeTickets');
const { ocrResponse } = await import('./contractResponses');
const { extractApiError } = await import('./errors');

const ENCENDIDA = {
  features: {
    ticket_image: {
      supported: true, enabled: true, mode: 'full_retained', stores_thumb: true, stores_full: true,
      full_retention_days: 90, negotiation_param: 'ticket_image_version', negotiation_value: '1',
      accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp'], thumb_max_side_px: 320, full_max_side_px: 1600,
    },
  },
};

const VIAJE = '0e000000-0000-4000-8000-000000000001';
const TICKET = '0e000000-0000-4000-8000-0000000000t1';
const ticket = {
  id: TICKET, lugar: 'Mariscos', tipo_lugar: 'restaurante', fecha_ticket: null, hora_ticket: null, cargado_en: null, forma: 'consumo',
  monto_cents: 5000, pagado_por: 'm1', pagaste_tu: true, pagadores: [{ miembro_id: 'm1', monto_cents: 5000 }],
  items: [{ id: 'i', name: 'Ceviche', price_cents: 5000, quantity: 1, line_cents: 5000, remaining_bps: 10000, my_bps: 0, my_amount_cents: 0 }],
  personas: [{ miembro_id: 'm1', ya_eligio: false, presente: true }],
  te_toca_cents: 0, sin_repartir_cents: 5000, puedo_elegir: true, puedo_marcar_presentes: true, personal: false,
  servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 5000, te_toca_platos_cents: 0, puedo_corregir: true,
};
const mesa = (extra: Record<string, unknown> = {}) => ({
  id: 'm-1', code: 'PA-6604', restaurant: { name: 'Café Tacuba', category: 'cafe' }, status: 'expired',
  division_mode: 'igual', guarantee_mode: false, closure_reason: 'time', created_at: '2026-10-20T15:00:00.000Z',
  mine: { items_count: 1, amount_cents: 18000 }, ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Un WebP mínimo: la firma `RIFF····WEBP` y unos bytes. */
function webp(n = 64): Uint8Array {
  const b = new Uint8Array(n);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
}
const foto = (bytes: Uint8Array, headers: Record<string, string> = {}) => new Response(bytes, {
  status: 200,
  headers: {
    'Content-Type': 'image/webp', 'Content-Length': String(bytes.length),
    'Cache-Control': 'private, max-age=0, must-revalidate', Vary: 'Authorization', ETag: '"x"', ...headers,
  },
});

let pedidos: Array<{ url: URL; init: RequestInit | undefined }> = [];
let respuesta: (url: URL) => Response = () => json({});

beforeEach(() => {
  expect(IS_MOCK).toBe(false);
  saveSession({
    access_token: 'a', refresh_token: 'r', family_id: 'family-foto', principal_id: 'user-foto',
    user: { id: 'user-foto', payme_id: 'payme_mx_foto', email: 'foto@example.com', first_name: 'Yo', last_name: 'Prueba' },
  });
  aplicarConfigViajes({ features: { viajes: { supported: true, enabled: true } } });
  pedidos = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    pedidos.push({ url, init });
    return respuesta(url);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  reiniciarFotoDelTicketParaTests();
});

describe('🔴 sin la capacidad (el backend de hoy): la app de siempre, byte por byte', () => {
  it('«Tus mesas» no negocia la foto, y la fila no trae foto', async () => {
    aplicarConfigFotoDelTicket({ features: {} });
    respuesta = () => json({ mesas: [mesa()], page: { limit: 20, next_cursor: null } });
    const r = await api.getMyMesas({ detail: 'items' });
    expect(pedidos[0]!.url.pathname).toBe('/api/mesas/mine');
    expect(pedidos[0]!.url.searchParams.has('ticket_image_version')).toBe(false);
    expect(pedidos[0]!.url.search).toBe('?detail=items');
    expect('fotoDelTicket' in r.mesas[0]!).toBe(false);
  });

  it('el ticket de un viaje no la negocia, y una `ticket_image` sin negociar rompe el decodificador estricto', async () => {
    aplicarConfigFotoDelTicket({ features: {} });
    respuesta = () => json({ contract: CONTRATO_VIAJES, ticket });
    const t = await api.getTicketDeViaje(VIAJE, TICKET);
    expect(pedidos[0]!.url.search).toBe('?viaje_version=11');
    expect('ticket_image' in t).toBe(false);
    respuesta = () => json({ contract: CONTRATO_VIAJES, ticket: { ...ticket, ticket_image: { thumb: true, full: true } } });
    await expect(api.getTicketDeViaje(VIAJE, TICKET)).rejects.toThrow();
  });

  it('con el valor apagado del dueño (su constante en false), tampoco', async () => {
    aplicarConfigFotoDelTicket({ features: { ticket_image: { ...ENCENDIDA.features.ticket_image, enabled: false, mode: 'off', stores_thumb: false, stores_full: false, full_retention_days: null } } });
    respuesta = () => json({ mesas: [], page: { limit: 20, next_cursor: null } });
    await api.getMyMesas();
    expect(pedidos[0]!.url.searchParams.has('ticket_image_version')).toBe(false);
  });

  it('no se pide ninguna foto: la puerta falla antes de la red', async () => {
    aplicarConfigFotoDelTicket({ features: {} });
    const sesion = loadSession()!;
    await expect(pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'thumb', sesion)).rejects.toThrow('ticket_image_not_available');
    await expect(pedirFotoDelTicket({ tipo: 'viaje', viajeId: VIAJE, ticketId: TICKET }, 'full', sesion))
      .rejects.toThrow('ticket_image_not_available');
    expect(pedidos).toHaveLength(0);
  });

  it('el escaneo: sin negociar, `ticket_image` es una clave de más', () => {
    const lectura = { contract_version: 2, items: [], total_cents: 0, warnings: ['no_items_found'], mock: false };
    expect(() => ocrResponse({ ...lectura, ticket_image: { stored: false, reason: 'no_receipt' } })).toThrow();
    expect(ocrResponse(lectura)).not.toHaveProperty('ticket_image');
  });
});

describe('D466 · con la capacidad encendida', () => {
  beforeEach(() => {
    aplicarConfigFotoDelTicket(ENCENDIDA);
  });

  it('«Tus mesas» negocia `ticket_image_version=1` y decodifica `{ thumb, full }`', async () => {
    respuesta = () => json({
      mesas: [mesa({ ticket_image: { thumb: true, full: false } }), mesa({ id: 'm-2', code: 'PA-7310', ticket_image: { thumb: false, full: false } })],
      page: { limit: 20, next_cursor: null },
    });
    const r = await api.getMyMesas({ detail: 'items' });
    expect(pedidos[0]!.url.searchParams.get('ticket_image_version')).toBe('1');
    expect(pedidos[0]!.url.searchParams.get('detail')).toBe('items');
    expect(r.mesas.map((m) => m.fotoDelTicket)).toEqual([{ thumb: true, full: false }, { thumb: false, full: false }]);
  });

  it('una `ticket_image` rara en una fila no se lleva la lista: esa fila queda sin foto', async () => {
    respuesta = () => json({ mesas: [mesa({ ticket_image: { thumb: 'si' } })], page: { limit: 20, next_cursor: null } });
    const r = await api.getMyMesas();
    expect(r.mesas).toHaveLength(1);
    expect('fotoDelTicket' in r.mesas[0]!).toBe(false);
  });

  it('el ticket de un viaje la negocia; ausente se tolera, mal formada rompe', async () => {
    respuesta = () => json({ contract: CONTRATO_VIAJES, ticket: { ...ticket, ticket_image: { thumb: true, full: true } } });
    const t = await api.getTicketDeViaje(VIAJE, TICKET);
    expect(pedidos[0]!.url.search).toBe('?viaje_version=11&ticket_image_version=1');
    expect(t.ticket_image).toEqual({ thumb: true, full: true });
    respuesta = () => json({ contract: CONTRATO_VIAJES, ticket });
    expect('ticket_image' in await api.getTicketDeViaje(VIAJE, TICKET)).toBe(false);
    respuesta = () => json({ contract: CONTRATO_VIAJES, ticket: { ...ticket, ticket_image: { thumb: true } } });
    await expect(api.getTicketDeViaje(VIAJE, TICKET)).rejects.toThrow();
  });

  it('el escaneo negociado acepta la foto guardada o su motivo, y nada más', () => {
    const lectura = { contract_version: 2, items: [], total_cents: 0, warnings: ['no_items_found'], mock: false };
    expect(ocrResponse({ ...lectura, ticket_image: { stored: false, reason: 'no_receipt' } }, { fotoDelTicket: true }).ticket_image)
      .toEqual({ stored: false, reason: 'no_receipt' });
    expect(ocrResponse(lectura, { fotoDelTicket: true })).not.toHaveProperty('ticket_image');
    expect(() => ocrResponse({ ...lectura, ticket_image: { stored: true } }, { fotoDelTicket: true })).toThrow();
  });

  it('la foto de una mesa: la ruta del dueño, `image/webp`, sin guardarla en el navegador', async () => {
    const bytes = webp();
    respuesta = () => foto(bytes);
    const blob = await pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'thumb', loadSession()!);
    expect(pedidos[0]!.url.pathname).toBe('/api/mesas/PA-6604/ticket-image/thumb');
    expect(pedidos[0]!.init?.cache).toBe('no-store');
    expect((pedidos[0]!.init?.headers as Record<string, string>).Accept).toBe('image/webp');
    expect((pedidos[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer a');
    expect(blob.type).toBe('image/webp');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });

  it('la foto de un ticket de viaje: su ruta, con los ids escapados', async () => {
    respuesta = () => foto(webp());
    await pedirFotoDelTicket({ tipo: 'viaje', viajeId: VIAJE, ticketId: TICKET }, 'full', loadSession()!);
    expect(pedidos[0]!.url.pathname).toBe(`/api/viajes/${VIAJE}/tickets/${TICKET}/ticket-image/full`);
  });

  it('🔴 se rechaza lo que no es la respuesta del dueño: otro tipo, sin `private`, sin `Vary`, sin firma, de más', async () => {
    const sesion = loadSession()!;
    const origen = { tipo: 'mesa', code: 'PA-6604' } as const;
    for (const [nombre, r] of [
      ['jpeg', foto(webp(), { 'Content-Type': 'image/jpeg' })],
      ['public', foto(webp(), { 'Cache-Control': 'public, max-age=600' })],
      ['sin vary', foto(webp(), { Vary: 'Accept' })],
      ['sin firma', foto(new Uint8Array(64))],
      ['largo distinto', foto(webp(), { 'Content-Length': '65' })],
    ] as const) {
      respuesta = () => r;
      await expect(pedirFotoDelTicket(origen, 'thumb', sesion), nombre).rejects.toThrow(/ticket_image_/);
    }
    const grande = webp(64 * 1024 + 1);
    respuesta = () => foto(grande);
    await expect(pedirFotoDelTicket(origen, 'thumb', sesion)).rejects.toThrow('ticket_image_size_invalid');
    respuesta = () => foto(grande);
    await expect(pedirFotoDelTicket(origen, 'full', sesion)).resolves.toBeInstanceOf(Blob);
  });

  it('un 404 es «sin foto»', async () => {
    respuesta = () => json({ error: 'ticket_image_not_found' }, 404);
    const err = await pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'full', loadSession()!).catch((e: unknown) => e);
    expect(extractApiError(err).status).toBe(404);
  });

  it('🔴 la mesa de ejemplo del tutorial nunca sale a la red', async () => {
    await expect(pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-1224' }, 'thumb', loadSession()!)).rejects.toThrow('ejemplo_sin_red');
    expect(pedidos).toHaveLength(0);
  });

  it('cada foto tiene su clave: por origen y tamaño', () => {
    const claves = new Set([
      claveDeFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'thumb'),
      claveDeFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'full'),
      claveDeFotoDelTicket({ tipo: 'mesa', code: 'PA-7310' }, 'thumb'),
      claveDeFotoDelTicket({ tipo: 'viaje', viajeId: VIAJE, ticketId: TICKET }, 'thumb'),
    ]);
    expect(claves.size).toBe(4);
  });
});
