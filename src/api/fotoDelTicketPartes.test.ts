import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D484 · D486 · la fachada REAL contra el dueño 2.196.0 (PR77): la v2 de la foto
 * y las partes. Mismo arnés que `fotoDelTicketNegociacion.test.ts`.
 *
 * Lo de abajo es el arnés de ese archivo; su comentario original:
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
const { aplicarConfigOcrPaginas, reiniciarOcrPaginasParaTests } = await import('./ocrPaginas');
const { pedirFotoDelTicket, claveDeFotoDelTicket } = await import('./fotosDeTickets');

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
  reiniciarOcrPaginasParaTests();
});

const PAGINAS = {
  features: {
    ocr_pages: {
      supported: true, enabled: true, max_pages: 4, max_total_bytes: 25165824,
      negotiation_param: 'pages_version', negotiation_value: '1',
    },
  },
};

describe('D484 · con la foto Y las varias fotos encendidas', () => {
  beforeEach(() => {
    aplicarConfigFotoDelTicket(ENCENDIDA);
    aplicarConfigOcrPaginas(PAGINAS);
  });

  it('«Tus mesas» negocia `ticket_image_version=2` y decodifica `{ thumb, full, pages }`', async () => {
    respuesta = () => json({
      mesas: [
        mesa({ ticket_image: { thumb: true, full: true, pages: 3 } }),
        mesa({ id: 'm-2', code: 'PA-7310', ticket_image: { thumb: false, full: false, pages: 0 } }),
        // La forma v1 con la v2 negociada no es la del dueño: esa fila queda sin foto.
        mesa({ id: 'm-3', code: 'PA-1000', ticket_image: { thumb: true, full: true } }),
      ],
      page: { limit: 20, next_cursor: null },
    });
    const r = await api.getMyMesas({ detail: 'items' });
    expect(pedidos[0]!.url.searchParams.getAll('ticket_image_version')).toEqual(['2']);
    expect(r.mesas.map((m) => m.fotoDelTicket ?? null)).toEqual([
      { thumb: true, full: true, pages: 3 }, { thumb: false, full: false, pages: 0 }, null,
    ]);
  });

  it('el ticket y el detalle de un viaje negocian la v2', async () => {
    respuesta = () => json({ contract: CONTRATO_VIAJES, ticket: { ...ticket, ticket_image: { thumb: true, full: true, pages: 2 } } });
    const t = await api.getTicketDeViaje(VIAJE, TICKET);
    expect(pedidos[0]!.url.search).toBe('?viaje_version=11&ticket_image_version=2');
    expect(t.ticket_image).toEqual({ thumb: true, full: true, pages: 2 });
    respuesta = () => json({ contract: CONTRATO_VIAJES, ticket: { ...ticket, ticket_image: { thumb: true, full: true } } });
    await expect(api.getTicketDeViaje(VIAJE, TICKET)).rejects.toThrow();
  });

  it('cada parte con `?page=`; la primera, el pedido de siempre, byte por byte', async () => {
    respuesta = () => foto(webp());
    const sesion = loadSession()!;
    await pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'full', sesion, 0);
    await pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'full', sesion, 2);
    await pedirFotoDelTicket({ tipo: 'viaje', viajeId: VIAJE, ticketId: TICKET }, 'thumb', sesion, 3);
    expect(pedidos.map((p) => `${p.url.pathname}${p.url.search}`)).toEqual([
      '/api/mesas/PA-6604/ticket-image/full',
      '/api/mesas/PA-6604/ticket-image/full?page=2',
      `/api/viajes/${VIAJE}/tickets/${TICKET}/ticket-image/thumb?page=3`,
    ]);
    await expect(pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'full', sesion, 4)).rejects.toThrow('ticket_image_page_invalid');
    expect(pedidos).toHaveLength(3);
  });

  it('la clave de memoria: la parte 0 conserva la de siempre; las demás, la suya', () => {
    const o = { tipo: 'mesa', code: 'PA-6604' } as const;
    expect(claveDeFotoDelTicket(o, 'thumb', 0)).toBe(claveDeFotoDelTicket(o, 'thumb'));
    expect(claveDeFotoDelTicket(o, 'thumb', 1)).not.toBe(claveDeFotoDelTicket(o, 'thumb'));
    expect(claveDeFotoDelTicket(o, 'thumb', 1)).not.toBe(claveDeFotoDelTicket(o, 'full', 1));
  });
});

describe('D484 · sin las varias fotos, la foto sigue como antes', () => {
  it('con sólo la foto encendida: la v1, y ninguna parte de después de la primera', async () => {
    aplicarConfigFotoDelTicket(ENCENDIDA);
    respuesta = () => json({ mesas: [], page: { limit: 20, next_cursor: null } });
    await api.getMyMesas();
    expect(pedidos[0]!.url.searchParams.getAll('ticket_image_version')).toEqual(['1']);
    await expect(pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'thumb', loadSession()!, 1))
      .rejects.toThrow('ocr_pages_not_available');
    expect(pedidos).toHaveLength(1);
  });

  it('🔴 con sólo las varias fotos encendidas (O3): ningún pedido negocia la foto', async () => {
    aplicarConfigOcrPaginas(PAGINAS);
    respuesta = () => json({ mesas: [], page: { limit: 20, next_cursor: null } });
    await api.getMyMesas();
    expect(pedidos[0]!.url.searchParams.has('ticket_image_version')).toBe(false);
    await expect(pedirFotoDelTicket({ tipo: 'mesa', code: 'PA-6604' }, 'thumb', loadSession()!))
      .rejects.toThrow('ticket_image_not_available');
  });
});
