import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 D293 · el mock de `GET /api/viajes/visitas` (App Backend 2.184.0, `services/viajesVisitas.js`): la regla de
 * Estadísticas sobre la semilla de Viajes, el monto igual al del ticket, el instante, el orden, el cursor y los 400. Pasa
 * por el decodificador de la app, como en la pantalla.
 */

const CLAVE_ESTADO = 'payme.app.mock.viajes.estado.v1';
const LUIS = 'c1000000-0000-4000-8000-000000000001';
const AHORA = new Date('2026-10-13T18:00:00.000Z');

function storage(extra: Record<string, string> = {}) {
  const values = new Map<string, string>([
    ['payme.app.mock.latencia.v1', '0'],
    ['payme.app.mock.viajes.v1', 'encendido'],
    ...Object.entries(extra),
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  return values;
}

async function rechazo(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    const e = err as { status: number; message: string };
    return { status: e.status, error: e.message };
  }
  throw new Error('se esperaba un rechazo');
}

interface TicketCrudo { id: string; lugar: string | null; fecha_ticket: string | null; hora_ticket: string | null; created_at: string; recibo_jti: string }
interface Crudo { viajes: Array<{ id: string; miembros: Array<{ user_id: string; estado: string }>; tickets: TicketCrudo[] }> }

async function visitas(values: Map<string, string>) {
  const m = await import('./viajes');
  const d = await import('../viajesVisitas');
  const v = await import('../viajes');
  const { state } = await import('./store');
  const yo = state.user.id;
  const pagina = async (query: Record<string, unknown> = {}) => d.decodeVisitasDeViajes(await m.mockVisitasDeViajes(query));
  /** Todas, de página en página con el cursor del dueño. */
  const todas = async (limit?: string) => {
    const vistas: Array<Awaited<ReturnType<typeof pagina>>['visitas'][number]> = [];
    let cursor: string | null = null;
    for (let i = 0; i < 50; i += 1) {
      const p = await pagina({ ...(limit && { limit }), ...(cursor && { cursor }) });
      vistas.push(...p.visitas);
      cursor = p.nextCursor;
      if (!cursor) return vistas;
    }
    throw new Error('el cursor no termina');
  };
  const verTicket = async (viaje: string, ticket: string) =>
    v.decodeTicketDelViaje(await m.mockVerTicket(viaje, ticket, { version: 11 }));
  const como = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    const antes = state.user;
    state.user = { ...antes, id: userId };
    try {
      return await fn();
    } finally {
      state.user = antes;
    }
  };
  /** Cambia el estado crudo del dueño en el mock (lo siembra primero). */
  const editar = async (fn: (e: Crudo) => void) => {
    await pagina();
    const e = JSON.parse(values.get(CLAVE_ESTADO)!) as Crudo;
    fn(e);
    values.set(CLAVE_ESTADO, JSON.stringify(e));
    m.olvidarViajesMockParaTests();
  };
  const ticket = (e: Crudo, lugar: string) => e.viajes.flatMap((x) => x.tickets).find((t) => t.lugar === lugar)!;
  return { m, yo, pagina, todas, verTicket, como, editar, ticket };
}

describe('🔴 mock · D293 · mis restaurantes de viaje para Mesas (App Backend 2.184.0)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AHORA);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('la semilla: mis tickets de restaurante, bar o café de mis viajes, de la más reciente a la más vieja, con lo que me toca', async () => {
    const c = await visitas(storage());
    const todas = await c.todas();
    expect(todas.map((v) => [v.lugar, v.tipo_lugar, v.viaje.nombre, v.instante, v.te_toca_cents])).toEqual([
      ['Mariscos El Faro', 'restaurante', 'Cancún 2026', '2026-10-09T03:40:00.000Z', 53000],
      ['Bar La Ola', 'bar', 'Cancún 2026', '2026-10-07T05:50:00.000Z', 24000],
      ['Fonda Doña Mary', 'restaurante', 'Cancún 2026', '2026-10-07T03:30:00.000Z', 41200],
      ['Café Barrio Antiguo', 'cafe', 'Monterrey fin de semana', '2026-09-20T16:30:00.000Z', 15000],
      ['El Rey del Cabrito', 'restaurante', 'Monterrey fin de semana', '2026-09-20T03:10:00.000Z', 60000],
      ['Café Brújula Bar', 'bar', 'Oaxaca puente', '2026-08-17T02:00:00.000Z', 32000],
      ['Tlayudas Libres', 'restaurante', 'Oaxaca puente', '2026-08-16T05:15:00.000Z', 61000],
      ['Mezcalería Los Amantes', 'bar', 'Oaxaca puente', '2026-08-15T04:00:00.000Z', 32000],
      ['La Olla', 'restaurante', 'Oaxaca puente', '2026-08-14T21:00:00.000Z', 48000],
      ['Los Pericos', 'restaurante', 'Valle de Bravo', '2026-07-05T20:30:00.000Z', 44000],
    ]);
    // Fuera: el súper (Súper del Caribe, Súper Oaxaca), Café Caribe («pagar el total» que pagó Diego: no consumí nada)
    // y Mazatlán (sólo invitado).
    expect(todas.map((v) => v.lugar)).not.toContain('Café Caribe');
    expect(todas.some((v) => v.viaje.nombre === 'Mazatlán diciembre')).toBe(false);
  });

  it('🔴 lo que me toca es el `te_toca_cents` del ticket del viaje: abierto, esperando pagos y cerrado', async () => {
    const c = await visitas(storage());
    for (const v of await c.todas()) {
      expect((await c.verTicket(v.viaje.id, v.ticket_id)).te_toca_cents, v.lugar!).toBe(v.te_toca_cents);
    }
  });

  it('el instante: la fecha y la hora impresas en México; sin hora, las 12:00; sin fecha, cuando se cargó', async () => {
    const c = await visitas(storage());
    await c.editar((e) => {
      c.ticket(e, 'Fonda Doña Mary').hora_ticket = null;
      const ola = c.ticket(e, 'Bar La Ola');
      ola.fecha_ticket = null;
      ola.hora_ticket = null;
    });
    const todas = await c.todas();
    expect(todas.find((v) => v.lugar === 'Fonda Doña Mary')!.instante).toBe('2026-10-06T18:00:00.000Z');
    expect(todas.find((v) => v.lugar === 'Bar La Ola')!.instante).toBe('2026-10-07T05:50:00.000Z');
  });

  it('nada de un viaje del que ya no soy miembro; ni un gasto a mano, aunque diga restaurante', async () => {
    const c = await visitas(storage());
    await c.editar((e) => {
      e.viajes.find((v) => v.miembros.some((x) => x.estado === 'activo') && v.tickets.some((t) => t.lugar === 'La Olla'))!
        .miembros.find((x) => x.user_id === c.yo)!.estado = 'salio';
      c.ticket(e, 'Fonda Doña Mary').recibo_jti = 'm~0123456789abcdef0123';
    });
    const lugares = (await c.todas()).map((v) => v.lugar);
    expect(lugares).not.toContain('La Olla');
    expect(lugares).not.toContain('Tlayudas Libres');
    expect(lugares).not.toContain('Fonda Doña Mary');
    expect(lugares).toContain('Mariscos El Faro');
  });

  it('sólo lo mío: otra persona ve sus visitas, con lo que le toca a ella', async () => {
    const c = await visitas(storage());
    // La semilla se siembra con la cuenta de quien pide primero: primero la mía.
    await c.pagina();
    const deLuis = await c.como(LUIS, () => c.todas());
    expect(deLuis.find((v) => v.lugar === 'Mariscos El Faro')!.te_toca_cents).toBe(32000 + 52500 + 14000);
    expect(deLuis.find((v) => v.lugar === 'Fonda Doña Mary')!.te_toca_cents).toBe(11100);
  });

  it('🔴 el cursor no repite ni saltea: con 3 por página, las mismas 10 y en el mismo orden', async () => {
    const c = await visitas(storage());
    const enteras = await c.todas();
    const p1 = await c.pagina({ limit: '3' });
    expect(p1.visitas).toHaveLength(3);
    expect(p1.nextCursor).not.toBeNull();
    expect((await c.todas('3')).map((v) => v.ticket_id)).toEqual(enteras.map((v) => v.ticket_id));
    expect((await c.todas('10')).map((v) => v.ticket_id)).toEqual(enteras.map((v) => v.ticket_id));
    // La página justa: 10 de 10, sin cursor.
    expect((await c.pagina({ limit: '10' })).nextCursor).toBeNull();
  });

  it('en un empate de instante, `ticket_id` DESC, y el cursor separa los dos', async () => {
    const c = await visitas(storage());
    await c.editar((e) => {
      const ola = c.ticket(e, 'Bar La Ola');
      const fonda = c.ticket(e, 'Fonda Doña Mary');
      fonda.fecha_ticket = ola.fecha_ticket;
      fonda.hora_ticket = ola.hora_ticket;
    });
    const enteras = await c.todas();
    const empatadas = enteras.filter((v) => v.instante === '2026-10-07T05:50:00.000Z').map((v) => v.ticket_id);
    expect(empatadas).toHaveLength(2);
    expect(empatadas).toEqual([...empatadas].sort().reverse());
    expect((await c.todas('1')).map((v) => v.ticket_id)).toEqual(enteras.map((v) => v.ticket_id));
  });

  it('los 400 del dueño: una clave de más, un `limit` fuera de 1..50, un cursor que no emitió', async () => {
    const c = await visitas(storage());
    for (const query of [{ otra: '1' }, { limit: '0' }, { limit: '51' }, { limit: 'diez' }, { limit: '05' }, { cursor: 'no es base64!' }, { cursor: 'eyJ0Ijo1fQ' }]) {
      expect(await rechazo(c.m.mockVisitasDeViajes(query)), JSON.stringify(query)).toMatchObject({ status: 400, error: 'validation_error' });
    }
    expect((await c.pagina({ limit: '50' })).visitas).toHaveLength(10);
  });

  it('con Viajes apagado, el 404 de siempre; el seam `error`, un 500', async () => {
    const apagado = await visitas(storage({ 'payme.app.mock.viajes.v1': 'apagado' }));
    expect(await rechazo(apagado.m.mockVisitasDeViajes())).toMatchObject({ status: 404 });
    vi.resetModules();
    const conError = await visitas(storage({ 'payme.app.mock.viajes.visitas.v1': 'error' }));
    expect(await rechazo(conError.m.mockVisitasDeViajes())).toMatchObject({ status: 500 });
  });

  it('el seam `muchas`: 25 visitas más, una cada hora desde hace media hora, antes de la semilla', async () => {
    const c = await visitas(storage({ 'payme.app.mock.viajes.visitas.v1': 'muchas' }));
    const p1 = await c.pagina();
    expect(p1.visitas).toHaveLength(20);
    expect(p1.visitas[0]!.instante).toBe(new Date(AHORA.getTime() - 30 * 60_000).toISOString());
    expect(p1.visitas[19]!.instante).toBe(new Date(AHORA.getTime() - 19.5 * 3_600_000).toISOString());
    const todas = await c.todas();
    expect(todas).toHaveLength(35);
    expect(todas[25]!.lugar).toBe('Mariscos El Faro');
  });
});
