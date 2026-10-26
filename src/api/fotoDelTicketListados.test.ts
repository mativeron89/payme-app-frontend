import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D481 · 7 · 8 · la foto del ticket en los listados de Viajes, del lado del front
 * (el dueño ya la publica: `listados` de `contract-mirror/contract/ticket-image-v1.json`):
 * `GET /api/viajes/:id → viaje.tickets[].ticket_image` (Balance › Consumos) y
 * `GET /api/viajes/visitas → visitas[].ticket_image` (las visitas de viaje en Mesas).
 *
 * - 🔴 sin la capacidad, ni un byte distinto: ningún pedido negocia
 *   `ticket_image_version=1`, y una `ticket_image` que llegara sin negociar
 *   rompe el decodificador estricto, como cualquier clave de más;
 * - con la capacidad, los dos pedidos la negocian y el decodificador acepta la
 *   forma exacta `{ thumb, full }`; ausente se tolera y rara queda en `null`
 *   (la fila lleva el ícono).
 */
class MemoryStorage {
  values = new Map<string, string>([
    ['payme.app.mock.latencia.v1', '0'],
    ['payme.app.mock.viajes.v1', 'encendido'],
  ]);
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const almacen = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: almacen });

const { saveSession } = await import('./storage');
const { api, IS_MOCK } = await import('./index');
const { aplicarConfigViajes, decodeDetalleViaje, CONTRATO_VIAJES } = await import('./viajes');
const { decodeVisitasDeViajes } = await import('./viajesVisitas');
const { aplicarConfigFotoDelTicket, reiniciarFotoDelTicketParaTests } = await import('./fotoDelTicket');
const mockViajes = await import('./mock/viajes');
const { conFotoEnLosTicketsDelViajeMock, conFotoEnLasVisitasMock } = await import('./mock/fotoDelTicketMock');

const ENCENDIDA = {
  features: {
    ticket_image: {
      supported: true, enabled: true, mode: 'full_retained', stores_thumb: true, stores_full: true,
      full_retention_days: 90, negotiation_param: 'ticket_image_version', negotiation_value: '1',
      accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp'], thumb_max_side_px: 320, full_max_side_px: 1600,
    },
  },
};

/** Un viaje con la forma exacta del dueño (`viaje_version=11`): el del mock, que pasa por el mismo decodificador. */
const viajeCrudo = async () => mockViajes.mockDetalleViaje(mockViajes.VIAJES_SEMILLA.cancun, { version: 11 }) as Promise<{
  contract: string;
  viaje: { tickets: Array<Record<string, unknown>> } & Record<string, unknown>;
}>;

const conFotoEnCadaTicket = (raw: Awaited<ReturnType<typeof viajeCrudo>>, foto: unknown) => ({
  ...raw,
  viaje: { ...raw.viaje, tickets: raw.viaje.tickets.map((tk) => ({ ...tk, ticket_image: foto })) },
});

const visita = (n: number, extra: Record<string, unknown> = {}) => ({
  ticket_id: `d2000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  viaje: { id: 'd1000000-0000-4000-8000-000000000001', nombre: 'Cancún 2026', color: 'violeta', has_photo: false },
  lugar: `Lugar ${n}`,
  tipo_lugar: 'restaurante',
  instante: new Date(Date.UTC(2026, 9, 10) - n * 3_600_000).toISOString(),
  te_toca_cents: 1000 + n,
  ...extra,
});
const pagina = (visitas: unknown[]) => ({ contract: CONTRATO_VIAJES, visitas, page: { limit: 20, next_cursor: null } });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let pedidos: URL[] = [];
let respuesta: (url: URL) => Response = () => json({});

beforeEach(() => {
  expect(IS_MOCK).toBe(false);
  saveSession({
    access_token: 'a', refresh_token: 'r', family_id: 'family-foto', principal_id: 'user-foto',
    user: { id: 'user-foto', payme_id: 'payme_mx_foto', email: 'foto@example.com', first_name: 'Yo', last_name: 'Prueba' },
  });
  aplicarConfigViajes({ features: { viajes: { supported: true, enabled: true } } });
  pedidos = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    pedidos.push(url);
    return respuesta(url);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  reiniciarFotoDelTicketParaTests();
  almacen.removeItem('payme.app.mock.ticket_image.v1');
});

describe('🔴 D481 · sin la capacidad (el backend de hoy): los listados de siempre, byte por byte', () => {
  it('el detalle del viaje no negocia la foto, y una `ticket_image` sin negociar rompe el decodificador', async () => {
    aplicarConfigFotoDelTicket({ features: {} });
    const raw = await viajeCrudo();
    respuesta = () => json(raw);
    const v = await api.getViaje(mockViajes.VIAJES_SEMILLA.cancun);
    expect(pedidos[0]!.search).toBe('?viaje_version=11');
    expect(v.tickets.length).toBeGreaterThan(0);
    expect(v.tickets.every((tk) => !('ticket_image' in tk))).toBe(true);
    respuesta = () => json(conFotoEnCadaTicket(raw, { thumb: true, full: true }));
    await expect(api.getViaje(mockViajes.VIAJES_SEMILLA.cancun)).rejects.toThrow();
  });

  it('las visitas no negocian la foto, y una `ticket_image` sin negociar rompe la página', async () => {
    aplicarConfigFotoDelTicket({ features: {} });
    respuesta = () => json(pagina([visita(1)]));
    const p = await api.getVisitasDeViajes();
    expect(pedidos[0]!.searchParams.has('ticket_image_version')).toBe(false);
    expect('ticket_image' in p.visitas[0]!).toBe(false);
    respuesta = () => json(pagina([visita(1, { ticket_image: { thumb: true, full: false } })]));
    await expect(api.getVisitasDeViajes()).rejects.toThrow(/viajes_response_invalid/);
  });
});

describe('D481 · con la capacidad encendida', () => {
  beforeEach(() => {
    aplicarConfigFotoDelTicket(ENCENDIDA);
  });

  it('el detalle del viaje negocia la foto (strings fijos) y decodifica `{ thumb, full }` en cada ticket', async () => {
    const raw = await viajeCrudo();
    respuesta = () => json(conFotoEnCadaTicket(raw, { thumb: true, full: false }));
    const v = await api.getViaje(mockViajes.VIAJES_SEMILLA.cancun);
    expect(pedidos[0]!.search).toBe('?viaje_version=11&ticket_image_version=1');
    expect(v.tickets.every((tk) => tk.ticket_image?.thumb === true && tk.ticket_image.full === false)).toBe(true);
  });

  it('ausente se tolera; rara queda en `null` sin llevarse el viaje; otra clave de más sigue rompiendo', async () => {
    const raw = await viajeCrudo();
    respuesta = () => json(raw);
    expect((await api.getViaje(mockViajes.VIAJES_SEMILLA.cancun)).tickets.every((tk) => !('ticket_image' in tk))).toBe(true);
    respuesta = () => json(conFotoEnCadaTicket(raw, { thumb: 'si' }));
    expect((await api.getViaje(mockViajes.VIAJES_SEMILLA.cancun)).tickets.every((tk) => tk.ticket_image === null)).toBe(true);
    respuesta = () => json({ ...raw, viaje: { ...raw.viaje, tickets: raw.viaje.tickets.map((tk) => ({ ...tk, foto: true })) } });
    await expect(api.getViaje(mockViajes.VIAJES_SEMILLA.cancun)).rejects.toThrow();
  });

  it('las visitas negocian la foto y decodifican `{ thumb, full }`; el cursor sigue escapado', async () => {
    respuesta = () => json(pagina([visita(1, { ticket_image: { thumb: true, full: true } }), visita(2)]));
    const p = await api.getVisitasDeViajes({ cursor: 'a b' });
    expect(pedidos[0]!.searchParams.get('ticket_image_version')).toBe('1');
    expect(pedidos[0]!.searchParams.get('cursor')).toBe('a b');
    expect(p.visitas[0]!.ticket_image).toEqual({ thumb: true, full: true });
    expect('ticket_image' in p.visitas[1]!).toBe(false);
  });
});

describe('D481 · los decodificadores, directo', () => {
  it('el detalle: sólo con `conFoto` se admite la clave', async () => {
    const raw = conFotoEnCadaTicket(await viajeCrudo(), { thumb: false, full: false });
    expect(() => decodeDetalleViaje(raw)).toThrow();
    expect(decodeDetalleViaje(raw, 'viajes.detalle', true).tickets[0]!.ticket_image).toEqual({ thumb: false, full: false });
  });

  it('las visitas: sólo con `conFoto` se admite la clave', () => {
    const raw = pagina([visita(1, { ticket_image: { thumb: true, full: false } })]);
    expect(() => decodeVisitasDeViajes(raw)).toThrow(/viajes_response_invalid/);
    expect(decodeVisitasDeViajes(raw, true).visitas[0]!.ticket_image).toEqual({ thumb: true, full: false });
  });
});

describe('D481 · el mock, como el dueño con el modo encendido', () => {
  it('sin el seam no suma nada; con `encendido`, los escaneados con foto y el gasto a mano sin', async () => {
    const raw = await viajeCrudo();
    expect(conFotoEnLosTicketsDelViajeMock(raw)).toBe(raw);
    almacen.setItem('payme.app.mock.ticket_image.v1', 'encendido');
    const con = conFotoEnLosTicketsDelViajeMock(raw) as typeof raw;
    for (const tk of con.viaje.tickets) {
      const tiene = tk.origen !== 'manual';
      expect(tk.ticket_image, String(tk.id)).toEqual({ thumb: tiene, full: tiene });
    }
    // Pasa por el decodificador negociado.
    expect(decodeDetalleViaje(con, 'viajes.detalle', true).tickets.length).toBe(raw.viaje.tickets.length);
  });

  it('las visitas del mock suman la foto con la regla del detalle del ticket, y pasan por el decodificador', async () => {
    almacen.setItem('payme.app.mock.ticket_image.v1', 'encendido');
    const raw = await mockViajes.mockVisitasDeViajes({});
    const con = await conFotoEnLasVisitasMock(raw) as { visitas: Array<{ ticket_image: unknown }> };
    expect(con.visitas.length).toBeGreaterThan(0);
    for (const v of con.visitas) expect(v.ticket_image).toMatchObject({ thumb: expect.any(Boolean), full: expect.any(Boolean) });
    expect(decodeVisitasDeViajes(con, true).visitas.length).toBe(con.visitas.length);
  });
});
