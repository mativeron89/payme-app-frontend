import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 D278-3 · D282-2 · el mock de `PATCH /api/viajes/:id/tickets/:tid` (App Backend 2.182.0, `corregirTicket`): el
 * pedido estricto por tipo de ticket, los topes, los pagadores con el total nuevo, las elecciones que se borran, la
 * idempotencia por contenido y el 404 del caso declarado. Pasa por los decodificadores de la app, como en la pantalla.
 */

const CLAVE_ESTADO = 'payme.app.mock.viajes.estado.v1';
/** La versión que negocia la fachada (D290: la 11; en el detalle de un ticket, como la 10). */
const VF = { version: 11 } as const;

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
    const e = err as { status: number; message: string; extra: Record<string, unknown> };
    return { status: e.status, error: e.message, extra: e.extra };
  }
  throw new Error('se esperaba un rechazo');
}

type EstadoCrudo = {
  viajes: Array<{
    id: string; creado_por: string; estado: string;
    miembros: Array<{ id: string; user_id: string; first_name: string }>;
    tickets: Array<Record<string, unknown> & {
      id: string; pagado_por: string; cargado_por?: string; lugar: string | null;
      pagadores?: Array<{ user_id: string; monto_cents: number }>;
      personas: Array<{ user_id: string; presente: boolean; listo_en: string | null }>;
      items: Array<{ id: string; nombre: string; price_cents: number; quantity: number }>;
      selecciones: Array<{ item_id: string; user_id: string; fraction_bps: number }>;
    }>;
  }>;
};

/**
 * Siembra el mock y deja Mariscos El Faro como «NATAMBRE», cargado por mí (lo pagó Luis): el caso del e2e. `cambiar`
 * toca el estado crudo antes de releerlo.
 */
async function natambre(values: Map<string, string>, cambiar: (e: EstadoCrudo, v: EstadoCrudo['viajes'][number]) => void = () => {}) {
  const m = await import('./viajes');
  const d = await import('../viajes');
  await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF);
  const e = JSON.parse(values.get(CLAVE_ESTADO)!) as EstadoCrudo;
  const v = e.viajes.find((x) => x.id === m.VIAJES_SEMILLA.cancun)!;
  const t = v.tickets.find((x) => x.id === m.VIAJES_SEMILLA.cancunMariscos)!;
  t.lugar = 'NATAMBRE';
  t.cargado_por = v.creado_por;
  cambiar(e, v);
  values.set(CLAVE_ESTADO, JSON.stringify(e));
  m.olvidarViajesMockParaTests();
  const id = m.VIAJES_SEMILLA.cancun;
  const tid = m.VIAJES_SEMILLA.cancunMariscos;
  const ver = async () => d.decodeTicketDelViaje(await m.mockVerTicket(id, tid, VF));
  const corregir = async (body: unknown) => d.decodeTicketCorregido(await m.mockCorregirTicket(id, tid, body, VF));
  const viaje = async () => d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
  const crudo = () => JSON.parse(values.get(CLAVE_ESTADO)!) as EstadoCrudo;
  const nombreDe = async (miembroId: string | null) => (await viaje()).miembros.find((x) => x.id === miembroId)?.first_name;
  return { m, d, id, tid, ver, corregir, viaje, crudo, nombreDe, yo: v.creado_por };
}

/** Los renglones del detalle como los manda la pantalla: la lista completa, con su id. */
const lista = (items: ReadonlyArray<{ id: string; name: string; price_cents: number; quantity: number }>) =>
  items.map((i) => ({ id: i.id, name: i.name, price_cents: i.price_cents, quantity: i.quantity }));

async function quienesEligieron(c: Awaited<ReturnType<typeof natambre>>) {
  const t = await c.ver();
  const salida: Record<string, boolean> = {};
  for (const p of t.personas) salida[(await c.nombreDe(p.miembro_id)) ?? '?'] = p.ya_eligio;
  return salida;
}

describe('🔴 mock · D278-3 · corregir un ticket (App Backend 2.182.0)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('`puedo_corregir`: con la 10, sólo quien lo cargó o pagó y con el viaje abierto; con la 9, no está', async () => {
    const values = storage();
    const c = await natambre(values);
    expect((await c.ver()).puedo_corregir).toBe(true);
    const de9 = (await c.m.mockVerTicket(c.id, c.tid, { version: 9 })) as { ticket: Record<string, unknown> };
    expect('puedo_corregir' in de9.ticket).toBe(false);
    // Fonda Doña Mary: lo cargó y lo pagó Luis.
    const v = await c.viaje();
    const fonda = v.tickets.find((x) => x.lugar === 'Fonda Doña Mary')!;
    expect(c.d.decodeTicketDelViaje(await c.m.mockVerTicket(c.id, fonda.id, VF)).puedo_corregir).toBe(false);
  });

  it('con el viaje esperando pagos o cerrado, `puedo_corregir` es false aunque lo haya pagado', async () => {
    storage();
    const m = await import('./viajes');
    const d = await import('../viajes');
    for (const [viaje, lugar] of [[m.VIAJES_SEMILLA.monterrey, 'El Rey del Cabrito'], [m.VIAJES_SEMILLA.oaxaca, 'Tlayudas Libres']] as const) {
      const v = d.decodeDetalleViaje(await m.mockDetalleViaje(viaje, VF));
      const tk = v.tickets.find((x) => x.lugar === lugar)!;
      expect(tk.pagaste_tu, lugar).toBe(true);
      const crudo = (await m.mockVerTicket(viaje, tk.id, VF)) as { ticket: Record<string, unknown> };
      expect(crudo.ticket, lugar).toMatchObject({ puedo_corregir: false, puedo_marcar_presentes: false });
    }
  });

  it('el nombre del lugar «NATAMBRE» → «Matambre»: no borra elecciones ni cambia montos', async () => {
    const values = storage();
    const c = await natambre(values);
    const antes = await c.ver();
    const eligieron = await quienesEligieron(c);
    const t = await c.corregir({ lugar: 'Matambre' });
    expect(t.lugar).toBe('Matambre');
    expect(t.items).toEqual(antes.items);
    expect(t.total_cents).toBe(antes.total_cents);
    expect(await quienesEligieron(c)).toEqual(eligieron);
    expect((await c.viaje()).tickets.find((x) => x.id === c.tid)!.lugar).toBe('Matambre');
  });

  it('el nombre o el orden de los renglones solos no borran nada', async () => {
    const values = storage();
    const c = await natambre(values);
    const antes = await c.ver();
    const eligieron = await quienesEligieron(c);
    const items = lista(antes.items).reverse().map((i, k) => (k === 0 ? { ...i, name: `${i.name} natural` } : i));
    const t = await c.corregir({ items });
    expect(t.items.map((i) => i.name)).toEqual(items.map((i) => i.name));
    expect(t.items.map((i) => i.remaining_bps)).toEqual([...antes.items].reverse().map((i) => i.remaining_bps));
    expect(await quienesEligieron(c)).toEqual(eligieron);
  });

  it('un precio distinto borra las elecciones de ESE renglón: quien lo eligió vuelve a «falta elegir»', async () => {
    const values = storage();
    const c = await natambre(values);
    const antes = await c.ver();
    expect(await quienesEligieron(c)).toMatchObject({ Luis: true, Sofía: true, Diego: false });
    const items = lista(antes.items).map((i) => (i.name === 'Pescado a la talla' ? { ...i, price_cents: 49500 } : i));
    const t = await c.corregir({ items });
    const pescado = t.items.find((i) => i.name === 'Pescado a la talla')!;
    expect(pescado).toMatchObject({ price_cents: 49500, remaining_bps: 10000 });
    // Luis eligió el pescado: vuelve a «falta elegir». Sofía no lo eligió: sigue lista. Lo demás de Luis, intacto.
    expect(await quienesEligieron(c)).toMatchObject({ Luis: false, Sofía: true });
    expect(t.items.find((i) => i.name === 'Ceviche de camarón')!.remaining_bps).toBe(0);
    expect(t.total_cents).toBe(antes.total_cents - 3000);
    expect(t.monto_cents).toBe(antes.monto_cents - 3000);
  });

  it('una cantidad distinta o un renglón sacado también borran; uno nuevo sin id se agrega', async () => {
    const values = storage();
    const c = await natambre(values);
    const antes = await c.ver();
    const items = lista(antes.items)
      .filter((i) => i.name !== 'Agua mineral')
      .map((i) => (i.name === 'Margarita' ? { ...i, quantity: 3 } : i));
    const t = await c.corregir({ items: [...items, { name: 'Postre', price_cents: 9000, quantity: 1 }] });
    expect(t.items.map((i) => i.name)).not.toContain('Agua mineral');
    expect(t.items.at(-1)).toMatchObject({ name: 'Postre', price_cents: 9000, quantity: 1, remaining_bps: 10000 });
    expect(t.items.find((i) => i.name === 'Margarita')).toMatchObject({ quantity: 3, remaining_bps: 10000, my_bps: 0 });
    // Sofía eligió el agua, Luis y yo la margarita: los tres vuelven a elegir.
    expect(await quienesEligieron(c)).toMatchObject({ Luis: false, Sofía: false });
    expect(t.personas.find((p) => p.miembro_id === (antes.personas[0]!.miembro_id))!.ya_eligio).toBe(false);
  });

  it('idempotencia por contenido: la misma corrección dos veces es un solo efecto, y un renglón nuevo no se duplica', async () => {
    const values = storage();
    const c = await natambre(values);
    const antes = await c.ver();
    const pedido = { lugar: 'Matambre', items: [...lista(antes.items), { name: 'Postre', price_cents: 9000, quantity: 1 }] };
    const uno = await c.corregir(pedido);
    const dos = await c.corregir(pedido);
    expect(dos).toEqual(uno);
    expect(dos.items.filter((i) => i.name === 'Postre')).toHaveLength(1);
    // Sin cambios: 200 con el mismo ticket.
    expect(await c.corregir({ lugar: 'Matambre' })).toEqual(uno);
  });

  it('el pedido es estricto: al menos un campo, sólo las claves de su tipo, y la hora pide una fecha', async () => {
    const values = storage();
    const c = await natambre(values);
    const t = await c.ver();
    for (const malo of [{}, { descripcion: 'x' }, { monto_cents: 100 }, { lugar: '' }, { lugar: 'x'.repeat(121) },
      { tipo_lugar: 'hotel' }, { fecha_ticket: '2026-13-01' }, { hora_ticket: '25:00' }, { items: [] },
      { items: [{ name: 'x', price_cents: -1, quantity: 1 }] }, { items: [{ name: 'x', price_cents: 1, quantity: 0 }] },
      { items: [{ id: t.items[0]!.id, name: 'a', price_cents: 1, quantity: 1 }, { id: t.items[0]!.id, name: 'b', price_cents: 1, quantity: 1 }] },
      { servicio_cents: -1 }, { descuentos_cents: 1.5 }, { otra: true }, { fecha_ticket: null }]) {
      // `fecha_ticket: null` con la hora guardada: la hora se queda sin fecha.
      expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, malo, VF)), JSON.stringify(malo)).toMatchObject({ status: 400, error: 'validation_error' });
    }
    expect((await c.corregir({ fecha_ticket: null, hora_ticket: null })).fecha_ticket).toBeNull();
  });

  it('un id de renglón ajeno: 422 `viaje_ticket_item_unknown` con su id', async () => {
    const values = storage();
    const c = await natambre(values);
    const ajeno = 'd3000000-0000-4000-8000-0000000000ff';
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { items: [{ id: ajeno, name: 'x', price_cents: 100, quantity: 1 }] }, VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_item_unknown', extra: { item_id: ajeno } });
  });

  it('los topes: el total tiene que ser mayor que 0 y de hasta $1,000,000 (422), y el viaje no pasa su tope (409)', async () => {
    const values = storage();
    const c = await natambre(values);
    const t = await c.ver();
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { descuentos_cents: t.monto_cents }, VF)))
      .toMatchObject({ status: 422, error: 'viaje_ticket_amount_invalid' });
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { items: [{ name: 'x', price_cents: 100_000_001, quantity: 1 }] }, VF)))
      .toMatchObject({ status: 422, error: 'viaje_ticket_amount_invalid' });
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { items: [{ name: 'x', price_cents: 60_000_000, quantity: 2 }] }, VF)))
      .toMatchObject({ status: 422, error: 'viaje_ticket_amount_invalid' });
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { servicio_cents: 100_000_000 }, VF)))
      .toMatchObject({ status: 422, error: 'viaje_ticket_amount_invalid' });

    // El viaje casi en su tope (200 tickets de $1,000,000): sólo lo que el ticket suma de más cuenta.
    const casi = storage();
    const k = await natambre(casi, (_, v) => { (v.tickets[1] as Record<string, unknown>).servicio_cents = 19_999_000_000; });
    expect(await rechazo(k.m.mockCorregirTicket(k.id, k.tid, { servicio_cents: 1_000_000 }, VF)))
      .toEqual({ status: 409, error: 'viaje_total_limit', extra: { limit: 20_000_000_000 } });
    // Bajar el total no pasa el tope.
    expect((await k.corregir({ descuentos_cents: 1000 })).descuentos_cents).toBe(1000);
  });

  it('con dos o más pagadores y otro total, `pagadores` es obligatorio y suma el total nuevo', async () => {
    const values = storage();
    const c = await natambre(values, (_, v) => {
      const t = v.tickets.find((x) => x.lugar === 'NATAMBRE')!;
      const sofia = v.miembros.find((x) => x.first_name === 'Sofía')!.user_id;
      const total = t.items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
      t.pagadores = [{ user_id: t.pagado_por, monto_cents: total - 100000 }, { user_id: sofia, monto_cents: 100000 }];
    });
    const t = await c.ver();
    const nuevo = t.total_cents + 5000;
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { servicio_cents: 5000 }, VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_payers_total_mismatch', extra: { monto_cents: nuevo } });
    const pagadores = t.pagadores.map((p, i) => ({ miembro_id: p.miembro_id!, monto_cents: p.monto_cents + (i === 0 ? 5000 : 0) }));
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { servicio_cents: 5000, pagadores: pagadores.map((p) => ({ ...p, monto_cents: p.monto_cents - 1 })) }, VF)))
      .toMatchObject({ status: 422, error: 'viaje_ticket_payers_total_mismatch' });
    const r = await c.corregir({ servicio_cents: 5000, pagadores });
    expect(r.pagadores).toEqual(pagadores);
    expect(r.total_cents).toBe(nuevo);
    // Sin cambiar el total no hacen falta.
    expect((await c.corregir({ lugar: 'Matambre' })).pagadores).toEqual(pagadores);
  });

  it('con un pagador, el total nuevo es suyo sin mandar `pagadores`', async () => {
    const values = storage();
    const c = await natambre(values);
    const r = await c.corregir({ servicio_cents: 5000 });
    expect(r.pagadores).toEqual([{ miembro_id: r.pagadores[0]!.miembro_id, monto_cents: r.total_cents }]);
  });

  it('el orden de errores: 404 del viaje, 404 del ticket, 409 del viaje no abierto, 403 de quien no lo cargó ni pagó', async () => {
    const values = storage();
    const c = await natambre(values);
    expect(await rechazo(c.m.mockCorregirTicket(c.id, 'd2000000-0000-4000-8000-0000000000ff', {}, VF)))
      .toMatchObject({ status: 404, error: 'viaje_ticket_not_found' });
    const fonda = (await c.viaje()).tickets.find((x) => x.lugar === 'Fonda Doña Mary')!;
    expect(await rechazo(c.m.mockCorregirTicket(c.id, fonda.id, { lugar: 'x' }, VF)))
      .toEqual({ status: 403, error: 'viaje_ticket_edit_forbidden', extra: {} });
    // Validación después del 403: un pedido vacío de quien no puede corregir sigue siendo 403.
    expect(await rechazo(c.m.mockCorregirTicket(c.id, fonda.id, {}, VF))).toMatchObject({ status: 403 });

    const cerrado = storage();
    let fondaId = '';
    const k = await natambre(cerrado, (_, v) => {
      v.estado = 'esperando_pagos';
      fondaId = v.tickets.find((x) => x.lugar === 'Fonda Doña Mary')!.id;
    });
    expect(await rechazo(k.m.mockCorregirTicket(k.id, k.tid, {}, VF))).toMatchObject({ status: 409, error: 'viaje_not_open' });
    // El 409 va antes que el 403: con el viaje cerrado, también para quien no podría corregirlo.
    expect(await rechazo(k.m.mockCorregirTicket(k.id, fondaId, { lugar: 'x' }, VF))).toMatchObject({ status: 409, error: 'viaje_not_open' });
  });

  it('cambiar quién pagó no cambia quién lo cargó: sigo pudiendo corregirlo', async () => {
    const values = storage();
    const { m, d } = await natambre(values);
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    // Bar La Ola lo cargué y lo pagué yo.
    const bar = v.tickets.find((x) => x.lugar === 'Bar La Ola')!;
    const luis = v.miembros.find((x) => x.first_name === 'Luis')!;
    const r = d.decodeTicketCorregido(await m.mockCorregirTicket(id, bar.id, { pagadores: [{ miembro_id: luis.id, monto_cents: bar.total_cents }] }, VF));
    expect(r).toMatchObject({ pagaste_tu: false, pagado_por: luis.id, puedo_corregir: true });
    expect(d.decodeTicketDelViaje(await m.mockVerTicket(id, bar.id, VF)).puedo_corregir).toBe(true);
  });

  it('un gasto a mano: descripción y monto; las claves de un escaneado dan 400', async () => {
    const values = storage();
    const { m, d } = await natambre(values);
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    const yo = v.miembros.find((x) => x.es_yo)!;
    const gasto = d.decodeGastoCargado(await m.mockCargarGasto(m.VIAJES_SEMILLA.cancun,
      { descripcion: 'Gasolina', monto_cents: 90000, presentes: [yo.id, v.miembros[1]!.id], idempotency_key: 'gasto-corregir-1' }, VF));
    expect(gasto.puedo_corregir).toBe(true);
    for (const malo of [{ lugar: 'x' }, { items: [] }, { servicio_cents: 1 }, { monto_cents: 0 }, { descripcion: ' ' }]) {
      expect(await rechazo(m.mockCorregirTicket(m.VIAJES_SEMILLA.cancun, gasto.id, malo, VF)), JSON.stringify(malo)).toMatchObject({ status: 400 });
    }
    const r = d.decodeTicketCorregido(await m.mockCorregirTicket(m.VIAJES_SEMILLA.cancun, gasto.id, { descripcion: 'Gasolina y peaje', monto_cents: 95000 }, VF));
    expect(r).toMatchObject({ lugar: 'Gasolina y peaje', monto_cents: 95000, total_cents: 95000 });
    expect(r.items).toEqual([expect.objectContaining({ name: 'Gasolina y peaje', price_cents: 95000, quantity: 1 })]);
    expect(r.pagadores).toEqual([{ miembro_id: yo.id, monto_cents: 95000 }]);
  });

  it('el caso declarado: quien pagó lo deja como el personal de quien lo cargó; se guarda y responde 404', async () => {
    const values = storage();
    let luisUser = '';
    const c = await natambre(values, (_, v) => {
      const t = v.tickets.find((x) => x.lugar === 'NATAMBRE')!;
      const luis = v.miembros.find((x) => x.first_name === 'Luis')!.user_id;
      luisUser = luis;
      const total = t.items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
      // Lo cargó Luis; pagamos Luis y yo; sólo estuvo Luis (sin elecciones).
      t.cargado_por = luis;
      t.pagado_por = luis;
      t.pagadores = [{ user_id: luis, monto_cents: total - 1000 }, { user_id: v.creado_por, monto_cents: 1000 }];
      t.personas = t.personas.map((p) => ({ ...p, presente: p.user_id === luis }));
      t.selecciones = [];
      t.forma = 'iguales';
    });
    const t = await c.ver();
    expect(t.puedo_corregir).toBe(true);
    const luis = t.pagadores[0]!.miembro_id!;
    expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { pagadores: [{ miembro_id: luis, monto_cents: t.total_cents }] }, VF)))
      .toEqual({ status: 404, error: 'viaje_ticket_not_found', extra: {} });
    const guardado = c.crudo().viajes.flatMap((v) => v.tickets).find((x) => x.id === c.tid)!;
    expect(guardado.pagado_por).toBe(luisUser);
    expect(guardado.pagadores ?? []).toEqual([]);
  });

  it('los seams del e2e, una sola vez cada uno', async () => {
    for (const [seam, esperado] of [
      ['ya_no_estaba', { status: 404, error: 'viaje_ticket_not_found' }],
      ['cerrado', { status: 409, error: 'viaje_not_open' }],
      ['prohibido', { status: 403, error: 'viaje_ticket_edit_forbidden' }],
      ['tope_del_viaje', { status: 409, error: 'viaje_total_limit' }],
      ['cambio_el_total', { status: 422, error: 'viaje_ticket_payers_total_mismatch' }],
    ] as const) {
      vi.resetModules();
      const values = storage({ 'payme.app.mock.viajes.corregir.v1': seam });
      const c = await natambre(values);
      expect(await rechazo(c.m.mockCorregirTicket(c.id, c.tid, { lugar: 'Matambre' }, VF)), seam).toMatchObject(esperado);
      expect(values.has('payme.app.mock.viajes.corregir.v1'), seam).toBe(false);
      if (seam !== 'ya_no_estaba') expect((await c.corregir({ lugar: 'Matambre' })).lugar, seam).toBe('Matambre');
    }
  });
});
