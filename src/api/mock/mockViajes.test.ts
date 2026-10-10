import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-VIAJES · el mock de Viajes responde como App Backend 2.171.0: las claves,
 * los errores, y los números del prototipo de Mati («Datos del ejemplo»).
 * Pasa por los decodificadores de la app, como en la pantalla.
 */

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

/** D255 · la fachada pide siempre `viaje_version=3` (la 2 más color y foto), y el decodificador sólo acepta esa forma. */
const V3 = { version: 3 } as const;

async function subject() {
  const m = await import('./viajes');
  const d = await import('../viajes');
  const { state } = await import('./store');
  return { m, d, state };
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

describe('mock · Viajes (App Backend 2.171.0)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('🔴 apagado: todas las rutas contestan el 404 de siempre', async () => {
    storage({ 'payme.app.mock.viajes.v1': 'apagado' });
    const { m } = await subject();
    expect(await rechazo(m.mockListarViajes('abiertos'))).toEqual({ status: 404, error: 'not_found', extra: {} });
    expect(await rechazo(m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun))).toMatchObject({ status: 404, error: 'not_found' });
  });

  it('Cancún 2026: los números del prototipo en vivo (1g, 1l)', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    expect(v.gasto_del_grupo_cents).toBe(666000);
    expect(v.mi_balance_cents).toBe(-54200);
    const porNombre = new Map(v.miembros.map((x) => [x.first_name, x]));
    expect(porNombre.get('Luis')!.balance_cents).toBe(181900);
    expect(porNombre.get('Sofía')!.balance_cents).toBe(-23000);
    expect(porNombre.get('Diego')!.balance_cents).toBe(-104700);
    expect(porNombre.get('Diego')!.falta_elegir).toBe(1);
    expect(v.tickets.map((t) => t.te_toca_cents)).toEqual([53000, 0, 32000, 24000, 41200]);
    expect(v.sin_repartir).toEqual([expect.objectContaining({ monto_cents: 56500, faltan: [porNombre.get('Diego')!.id] })]);
  });

  it('el ticket del 8 oct: lo mío plato por plato, nunca lo de otro (1i)', async () => {
    storage();
    const { m, d } = await subject();
    const t = d.decodeTicketDelViaje(await m.mockVerTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos));
    expect(t.monto_cents).toBe(220000);
    expect(t.te_toca_cents).toBe(53000);
    const margarita = t.items.find((i) => i.name === 'Margarita')!;
    expect(margarita).toMatchObject({ line_cents: 56000, my_bps: 2500, my_amount_cents: 14000, remaining_bps: 5000 });
    expect(t.puedo_elegir).toBe(true);
    expect(t.personas.filter((p) => !p.ya_eligio)).toHaveLength(1);
  });

  it('cerrar con alguien sin elegir: se le asigna lo que falta y las tres transferencias van a Luis (1m, 1n)', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const previa = d.decodeVistaPreviaCierre(await m.mockVistaPreviaCierre(id));
    expect(previa.todos_eligieron).toBe(false);
    expect(previa.asignaciones).toEqual([expect.objectContaining({ lugar: 'Mariscos El Faro', monto_cents: 56500 })]);
    const v = d.decodeDetalleViaje(await m.mockCerrarViaje(id, V3), 'viajes.cerrar');
    expect(v.estado).toBe('esperando_pagos');
    expect(v.transferencias.map((x) => x.monto_cents).sort((a, b) => a - b)).toEqual([23000, 54200, 161200]);
    const luis = v.miembros.find((x) => x.first_name === 'Luis')!.id;
    expect(v.transferencias.every((x) => x.a === luis)).toBe(true);
    const mia = v.transferencias.find((x) => x.mia === 'debo')!;
    expect(mia.monto_cents).toBe(54200);
    // El ida y vuelta: «Ya pagué» y «Deshacer» son míos; «Recibí» no.
    const marcada = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, mia.id, 'pague'), mia.id);
    expect(marcada.transferencia.estado).toBe('marcada');
    expect(await rechazo(m.mockMarcarTransferencia(id, mia.id, 'recibi'))).toMatchObject({ status: 409, error: 'viaje_transfer_not_yours' });
    const deshecha = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, mia.id, 'deshacer'), mia.id);
    expect(deshecha.transferencia.estado).toBe('pendiente');
  });

  it('Monterrey: recibir las dos pasa el viaje a Cerrados y me avisa (1o, 1p)', async () => {
    storage();
    const { m, d, state } = await subject();
    const id = m.VIAJES_SEMILLA.monterrey;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, V3));
    const meDeben = v.transferencias.filter((x) => x.mia === 'me_deben');
    expect(meDeben.map((x) => [x.monto_cents, x.estado])).toEqual([[75000, 'marcada'], [30000, 'pendiente']]);
    const noLlego = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, meDeben[0]!.id, 'no-llego'), meDeben[0]!.id);
    expect(noLlego.transferencia.estado).toBe('pendiente');
    await m.mockMarcarTransferencia(id, meDeben[0]!.id, 'recibi');
    const fin = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, meDeben[1]!.id, 'recibi'), meDeben[1]!.id);
    expect(fin.viaje_estado).toBe('cerrado');
    expect(fin.transferencias_pendientes).toBe(0);
    expect(state.notifications[0]).toMatchObject({ type: 'viaje_finished', payload: { viaje_id: id } });
    const cerrados = d.decodeListaDeViajes(await m.mockListarViajes('cerrados', V3), 'cerrados');
    expect(cerrados.viajes.map((x) => x.nombre)).toContain('Monterrey fin de semana');
  });

  it('🔴 nunca por encima del entero: lo de los demás más lo mío no pasa del plato (decisión 81)', async () => {
    storage();
    const { m, d } = await subject();
    const t = d.decodeTicketDelViaje(await m.mockVerTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos));
    const margarita = t.items.find((i) => i.name === 'Margarita')!;
    // Luis ya tiene 1/4: subir lo mío a entero pasa del plato.
    expect(await rechazo(m.mockElegirEnTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos,
      { items: [{ item_id: margarita.id, fraction_bps: 10000 }], listo: true })))
      .toEqual({ status: 409, error: 'viaje_fraction_exceeds_item', extra: { item_id: margarita.id, remaining_bps: 7500 } });
    // Tres cuartos sí entran.
    const r = d.decodeTicketDelViaje(await m.mockElegirEnTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos,
      { items: [{ item_id: margarita.id, fraction_bps: 7500 }], listo: true }), 'viajes.seleccion');
    expect(r.items.find((i) => i.name === 'Margarita')!.my_bps).toBe(7500);
  });

  it('Cerrados: sólo lo propio (1s, D240-17)', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, V3));
    expect(v.estado).toBe('cerrado');
    expect(v.miembros.filter((x) => !x.es_yo).every((x) => x.balance_cents === null)).toBe(true);
    const r = d.decodeResumenDeViaje(await m.mockResumenDeViaje(m.VIAJES_SEMILLA.oaxaca), m.VIAJES_SEMILLA.oaxaca);
    expect(r.consumiste_cents).toBe(48000 + 32000 + 61000 + 50000 + 32000);
    const tlayudas = r.lugares.find((l) => l.lugar === 'Tlayudas Libres')!;
    expect(tlayudas.pagaste_tu).toBe(true);
    expect(tlayudas.items.map((i) => [i.name, i.fraction_bps, i.amount_cents])).toEqual([
      ['Tlayuda', 10000, 21000], ['Mezcal', 10000, 26000], ['Chapulines', 5000, 14000],
    ]);
  });

  it('invitación: aceptar suma al viaje, rechazar no; salir sin consumos sí, con consumos no (D242-2)', async () => {
    storage();
    const { m, d } = await subject();
    const inv = d.decodeInvitacionesAViajes(await m.mockInvitacionesAViajes());
    expect(inv.map((x) => x.nombre)).toEqual(['Mazatlán diciembre']);
    expect(await rechazo(m.mockDetalleViaje(m.VIAJES_SEMILLA.mazatlan))).toEqual({ status: 404, error: 'viaje_not_found', extra: {} });
    const v = d.decodeDetalleViaje(await m.mockAceptarViaje(m.VIAJES_SEMILLA.mazatlan, V3), 'viajes.aceptar');
    expect(v.miembros.some((x) => x.es_yo)).toBe(true);
    d.decodeRespuestaDeSalida(await m.mockSalirDeViaje(m.VIAJES_SEMILLA.mazatlan), m.VIAJES_SEMILLA.mazatlan, 'salio');
    expect(await rechazo(m.mockSalirDeViaje(m.VIAJES_SEMILLA.cancun)))
      .toEqual({ status: 409, error: 'viaje_member_cannot_leave', extra: { reason: 'selection' } });
  });

  it('crear: un @ que la búsqueda no muestra es 422 con el pedido tal como vino; el seam 429', async () => {
    storage();
    const { m, d, state } = await subject();
    const amigo = state.friends[0]!;
    const body = { nombre: '  Puebla   2026 ', fecha_desde: null, fecha_hasta: null, miembros: [{ user_id: amigo.id }], idempotency_key: 'clave-de-prueba-1' };
    const v = d.decodeDetalleViaje(await m.mockCrearViaje(body, V3), 'viajes.crear');
    expect(v.nombre).toBe('Puebla 2026');
    expect(v.miembros).toHaveLength(1);
    expect(v.invitados).toHaveLength(1);
    expect(d.decodeDetalleViaje(await m.mockCrearViaje(body, V3), 'viajes.crear').id).toBe(v.id);
    expect(await rechazo(m.mockCrearViaje({ ...body, nombre: 'Otro' }))).toMatchObject({ status: 409, error: 'idempotency_key_conflict' });
    expect(await rechazo(m.mockCrearViaje({ ...body, idempotency_key: 'clave-de-prueba-2', miembros: [{ username: 'nadie.aca' }] })))
      .toEqual({ status: 422, error: 'viaje_member_not_found', extra: { member: { username: 'nadie.aca' } } });
  });

  it('cargar un ticket: quien escanea pagó; el mismo recibo no se carga dos veces', async () => {
    storage({ 'payme.app.mock.viajes.huella.v1': 'huella-1' });
    const mock = await import('./mockApi');
    const { m, d } = await subject();
    const ocr = await mock.mockScanTicket({ viaje: true });
    const pedido = {
      ocr_receipt: ocr.receipt!, idempotency_key: 'clave-ticket-001', forma: 'iguales', tipo_lugar: 'restaurante',
      lugar: 'Tacos El Güero', fecha_ticket: null, hora_ticket: null,
      items: ocr.items.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
    };
    const r = d.decodeTicketCargado(await m.mockCargarTicket(m.VIAJES_SEMILLA.cancun, pedido));
    expect(r.ya_cargado).toBeNull();
    expect(r.ticket.pagaste_tu).toBe(true);
    expect(r.ticket.monto_cents).toBe(ocr.total_cents);
    expect(r.ticket.puedo_marcar_presentes).toBe(true);
    // Un segundo escaneo del mismo ticket (la misma huella): el ya cargado, con quién y cuándo (1k).
    const otro = await mock.mockScanTicket({ viaje: true });
    expect(d.decodeRevisionDeTicket(await m.mockRevisarTicket(m.VIAJES_SEMILLA.cancun, { ocr_receipt: otro.receipt })))
      .toMatchObject({ ticket_id: r.ticket.id });
    // En otro viaje, el mismo recibo ya está usado.
    expect(await rechazo(m.mockRevisarTicket(m.VIAJES_SEMILLA.monterrey, { ocr_receipt: ocr.receipt })))
      .toMatchObject({ status: 409, error: 'viaje_ticket_receipt_used' });
  });
});

describe('mock · Viajes (App Backend 2.172.0): `viaje_version=2`, el gasto a mano y la foto', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('sin la negociación, el detalle de siempre; con ella, foto, lo que pagó y el total de cada ticket', async () => {
    storage();
    const { m, d } = await subject();
    const crudo = (await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun)) as { viaje: { miembros: object[]; tickets: object[] } };
    expect(Object.keys(crudo.viaje.miembros[0]!)).not.toContain('pagado_cents');
    expect(Object.keys(crudo.viaje.miembros[0]!)).not.toContain('has_avatar');
    expect(Object.keys(crudo.viaje.tickets[0]!)).not.toContain('monto_cents');
    // La forma de siempre no pasa por el decodificador: la app negocia siempre.
    expect(() => d.decodeDetalleViaje(crudo)).toThrow();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    const porNombre = new Map(v.miembros.map((x) => [x.first_name, x]));
    expect(porNombre.get('Luis')!.pagado_cents).toBe(404000);
    expect(porNombre.get('Sofía')!.pagado_cents).toBe(128000);
    expect(porNombre.get('Diego')!.pagado_cents).toBe(38000);
    expect(v.miembros.find((x) => x.es_yo)!.pagado_cents).toBe(96000);
    expect(v.miembros.reduce((s, x) => s + (x.pagado_cents ?? 0), 0)).toBe(v.gasto_del_grupo_cents);
    expect(v.miembros.map((x) => x.has_avatar)).toEqual([false, true, true, false]);
    // El más nuevo arriba: Mariscos, Café, Súper, Bar y Fonda.
    expect(v.tickets.map((t) => t.monto_cents)).toEqual([220000, 38000, 128000, 96000, 184000]);
    expect(new Set(v.tickets.map((t) => t.origen))).toEqual(new Set(['escaneo']));
  });

  it('🔴 cerrado: lo que pagaron los demás llega en null, como el balance (D240-17)', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, V3));
    expect(v.estado).toBe('cerrado');
    for (const x of v.miembros) expect(x.pagado_cents === null).toBe(!x.es_yo);
  });

  it('D244 · el gasto a mano: lo pagó quien lo carga, en partes iguales entre los elegidos, el más nuevo arriba', async () => {
    storage();
    const { m, d } = await subject();
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    const yoM = antes.miembros.find((x) => x.es_yo)!;
    const luis = antes.miembros.find((x) => x.first_name === 'Luis')!;
    const diego = antes.miembros.find((x) => x.first_name === 'Diego')!;
    const pedido = { descripcion: '  Gasolina   del  jueves ', monto_cents: 100001, presentes: [yoM.id, luis.id, diego.id], idempotency_key: 'gasto-de-prueba-1' };
    const t = d.decodeGastoCargado(await m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, pedido));
    expect(t).toMatchObject({ lugar: 'Gasolina del jueves', tipo_lugar: 'otro', forma: 'iguales', monto_cents: 100001,
      fecha_ticket: null, hora_ticket: null, pagaste_tu: true, puedo_elegir: false, puedo_marcar_presentes: true });
    expect(t.items).toEqual([expect.objectContaining({ name: 'Gasolina del jueves', price_cents: 100001, quantity: 1 })]);
    expect(t.personas.filter((p) => p.presente).map((p) => p.miembro_id)).toEqual([yoM.id, luis.id, diego.id]);
    // $1,000.01 entre tres: $333.34, $333.34 y $333.33; el residuo va a los primeros en el orden de los miembros (yo, Luis).
    expect(t.te_toca_cents).toBe(33334);
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    expect(despues.tickets[0]).toMatchObject({ id: t.id, origen: 'manual', monto_cents: 100001, lugar: 'Gasolina del jueves' });
    expect(despues.miembros.find((x) => x.es_yo)!.pagado_cents).toBe(96000 + 100001);
    expect(despues.mi_balance_cents).toBe(antes.mi_balance_cents + 100001 - 33334);
    // El mismo pedido con la misma clave es el mismo gasto; otro pedido con esa clave, 409.
    expect(d.decodeGastoCargado(await m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, pedido)).id).toBe(t.id);
    expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, { ...pedido, monto_cents: 5 })))
      .toMatchObject({ status: 409, error: 'idempotency_key_conflict' });
    const otra = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    expect(otra.tickets.filter((x) => x.origen === 'manual')).toHaveLength(1);
  });

  it('D244 · lo que el dueño rechaza: cuerpo inválido 400, alguien que no es miembro 422, cerrado 409', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    const base = { descripcion: 'Taxi', monto_cents: 5000, presentes: [v.mi_miembro_id], idempotency_key: 'gasto-de-prueba-2' };
    for (const malo of [
      { ...base, descripcion: '   ' },
      { ...base, descripcion: 'x'.repeat(121) },
      { ...base, monto_cents: 0 },
      { ...base, monto_cents: 100_000_001 },
      { ...base, monto_cents: 12.5 },
      { ...base, presentes: [] },
      { ...base, presentes: [v.mi_miembro_id, v.mi_miembro_id] },
      { ...base, idempotency_key: 'corta' },
      { ...base, extra: 1 },
      { descripcion: 'Taxi', monto_cents: 5000, presentes: [v.mi_miembro_id] },
    ]) {
      expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, malo)), JSON.stringify(malo))
        .toMatchObject({ status: 400, error: 'validation_error' });
    }
    const ajeno = 'e9000000-0000-4000-8000-000000000001';
    expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, { ...base, presentes: [ajeno] })))
      .toEqual({ status: 422, error: 'viaje_ticket_persona_unknown', extra: { miembro_id: ajeno } });
    const cerrado = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, V3));
    expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.oaxaca, { ...base, presentes: [cerrado.mi_miembro_id] })))
      .toMatchObject({ status: 409, error: 'viaje_not_open' });
  });

  it('D245 · la foto: toda negativa es el mismo 404, y cada pedido se cuenta', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    const diego = v.miembros.find((x) => x.first_name === 'Diego')!;
    const antes = m.pedidosDeFotosDeViajeMock();
    expect(await rechazo(m.mockAvatarDeMiembro(m.VIAJES_SEMILLA.cancun, diego.id))).toMatchObject({ status: 404, error: 'avatar_not_found' });
    expect(await rechazo(m.mockAvatarDeMiembro(m.VIAJES_SEMILLA.cancun, 'e9000000-0000-4000-8000-000000000001')))
      .toMatchObject({ status: 404, error: 'avatar_not_found' });
    expect(await rechazo(m.mockAvatarDeMiembro('e9000000-0000-4000-8000-000000000002', diego.id)))
      .toMatchObject({ status: 404, error: 'avatar_not_found' });
    expect(m.pedidosDeFotosDeViajeMock() - antes).toBe(3);
  });
});

describe('mock · Viajes (App Backend 2.172.1): salir después de pagar (H02, D242-2)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('🔴 esperando pagos con transferencias mías sin confirmar: 409 con cuántas faltan («Ya pagué» no alcanza)', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.monterrey, V3));
    expect(v.estado).toBe('esperando_pagos');
    // Luis marcó «Ya pagué» y Sofía no: las dos me faltan confirmar.
    expect(v.transferencias.filter((t) => t.mia === 'me_deben').map((t) => t.estado).sort()).toEqual(['marcada', 'pendiente']);
    expect(await rechazo(m.mockSalirDeViaje(m.VIAJES_SEMILLA.monterrey)))
      .toEqual({ status: 409, error: 'viaje_member_transfers_pending', extra: { pendientes: 2 } });
    // Confirmo una: falta una.
    const [una, otra] = v.transferencias.filter((t) => t.mia === 'me_deben');
    await m.mockMarcarTransferencia(m.VIAJES_SEMILLA.monterrey, una!.id, 'recibi');
    expect(await rechazo(m.mockSalirDeViaje(m.VIAJES_SEMILLA.monterrey)))
      .toEqual({ status: 409, error: 'viaje_member_transfers_pending', extra: { pendientes: 1 } });
    // Confirmo la otra: el viaje se cierra y salgo.
    await m.mockMarcarTransferencia(m.VIAJES_SEMILLA.monterrey, otra!.id, 'recibi');
    d.decodeRespuestaDeSalida(await m.mockSalirDeViaje(m.VIAJES_SEMILLA.monterrey), m.VIAJES_SEMILLA.monterrey, 'salio');
  });

  it('🔴 cerrado con todo confirmado: salgo, y el viaje deja de estar para mí (lista, detalle y resumen)', async () => {
    storage();
    const { m, d } = await subject();
    const antes = d.decodeListaDeViajes(await m.mockListarViajes('cerrados', V3), 'cerrados');
    expect(antes.viajes.map((x) => x.nombre)).toContain('Oaxaca puente');
    d.decodeRespuestaDeSalida(await m.mockSalirDeViaje(m.VIAJES_SEMILLA.oaxaca), m.VIAJES_SEMILLA.oaxaca, 'salio');
    const despues = d.decodeListaDeViajes(await m.mockListarViajes('cerrados', V3), 'cerrados');
    expect(despues.viajes.map((x) => x.nombre)).not.toContain('Oaxaca puente');
    expect(despues.counts.cerrados).toBe(antes.counts.cerrados - 1);
    expect(await rechazo(m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, V3))).toMatchObject({ status: 404, error: 'viaje_not_found' });
    expect(await rechazo(m.mockResumenDeViaje(m.VIAJES_SEMILLA.oaxaca))).toMatchObject({ status: 404, error: 'viaje_not_found' });
  });

  it('salir no borra nada: los montos y las transferencias quedan para los demás', async () => {
    const valores = storage();
    const { m } = await subject();
    await m.mockSalirDeViaje(m.VIAJES_SEMILLA.oaxaca);
    const estado = JSON.parse(valores.get('payme.app.mock.viajes.estado.v1')!) as {
      viajes: Array<{ id: string; tickets: Array<{ personas: unknown[] }>; transferencias: unknown[]; miembros: Array<{ estado: string }> }>;
    };
    const oax = estado.viajes.find((x) => x.id === m.VIAJES_SEMILLA.oaxaca)!;
    expect(oax.miembros.filter((x) => x.estado === 'salio')).toHaveLength(1);
    expect(oax.tickets.every((t) => t.personas.length === 5)).toBe(true);
    expect(oax.transferencias.length).toBeGreaterThan(0);
  });
});

describe('🔴 mock · D255-8 · «Agregar miembros» (`POST /api/viajes/:id/miembros`, como el dueño)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('invita a un amigo: queda entre los invitados; repetirlo no lo duplica (el dueño lo ignora)', async () => {
    storage();
    const { m, d, state } = await subject();
    const amigo = state.friends[0]!;
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    const v = d.decodeDetalleViaje(await m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [{ user_id: amigo.id }] }, V3), 'viajes.invitar');
    expect(v.invitados).toHaveLength(antes.invitados.length + 1);
    expect(v.invitados.at(-1)).toMatchObject({ first_name: amigo.first_name });
    expect(v.miembros).toHaveLength(antes.miembros.length);
    const otraVez = d.decodeDetalleViaje(await m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [{ user_id: amigo.id }] }, V3), 'viajes.invitar');
    expect(otraVez.invitados).toHaveLength(v.invitados.length);
  });

  it('lo que el dueño rechaza: cuerpo con otra clave 400, @ desconocido 422, viaje no abierto 409, el seam 429', async () => {
    storage();
    const { m, state } = await subject();
    const amigo = state.friends[0]!;
    expect(await rechazo(m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [{ user_id: amigo.id }], idempotency_key: 'x-12345678' })))
      .toMatchObject({ status: 400 });
    expect(await rechazo(m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [] }))).toMatchObject({ status: 400 });
    expect(await rechazo(m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [{ username: 'nadie.aca' }] })))
      .toEqual({ status: 422, error: 'viaje_member_not_found', extra: { member: { username: 'nadie.aca' } } });
    expect(await rechazo(m.mockInvitarAlViaje(m.VIAJES_SEMILLA.monterrey, { miembros: [{ user_id: amigo.id }] })))
      .toMatchObject({ status: 409, error: 'viaje_not_open' });
    expect(await rechazo(m.mockInvitarAlViaje('d1000000-0000-4000-8000-0000000000ff', { miembros: [{ user_id: amigo.id }] })))
      .toMatchObject({ status: 404 });
  });

  it('🔴 quien ya está invitado no cuenta dos veces para el tope de 20 (el dueño sólo suma a los nuevos)', async () => {
    storage();
    const { m, d, state } = await subject();
    const arrobas = ['valentina.rios', 'nicolas.salas', 'mariana', 'marcos_d', 'mario.g', 'marcelo', 'marta.s', 'sofi.fernandez', 'juan.lopez', 'maria.ruiz'];
    const miembros = [...state.friends.map((f) => ({ user_id: f.id })), ...arrobas.map((username) => ({ username }))].slice(0, 19);
    const creado = d.decodeDetalleViaje(await m.mockCrearViaje(
      { nombre: 'Tope', fecha_desde: null, fecha_hasta: null, miembros, idempotency_key: 'clave-tope-0001' }, V3), 'viajes.crear');
    // Hacen falta 10 o más para que contarlos dos veces pase de 20.
    expect(creado.invitados.length).toBeGreaterThanOrEqual(10);
    const otraVez = d.decodeDetalleViaje(await m.mockInvitarAlViaje(creado.id, { miembros }, V3), 'viajes.invitar');
    expect(otraVez.invitados).toHaveLength(creado.invitados.length);
  });

  it('el seam de límite: 429 `viajes_rate_limited`', async () => {
    storage({ 'payme.app.mock.viajes.limite.v1': '429' });
    const { m, state } = await subject();
    expect(await rechazo(m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [{ user_id: state.friends[0]!.id }] })))
      .toMatchObject({ status: 429, error: 'viajes_rate_limited' });
  });
});

describe('🔴 mock · D255 · App Backend 2.174.0: quién pagó, configuración, color y foto', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('la 3 suma `color` y `has_photo` al detalle y a la lista; la 2 queda igual, byte por byte', async () => {
    storage();
    const { m, d } = await subject();
    const v2 = (await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, { version: 2 })) as { viaje: Record<string, unknown> };
    expect(Object.keys(v2.viaje)).not.toContain('color');
    expect(Object.keys(v2.viaje)).not.toContain('has_photo');
    const v3 = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, V3));
    expect(v3).toMatchObject({ color: null, has_photo: false });
    const l1 = (await m.mockListarViajes('abiertos')) as { viajes: Array<Record<string, unknown>> };
    expect(Object.keys(l1.viajes[0]!)).not.toContain('color');
    expect(d.decodeListaDeViajes(await m.mockListarViajes('abiertos', V3), 'abiertos').viajes[0]).toMatchObject({ color: null, has_photo: false });
  });

  it('editar: nombre, fechas y color; `null` borra; lo que el dueño rechaza', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockEditarViaje(id, { nombre: '  Cancún   2027 ', color: 'violeta', fecha_hasta: null }, V3), 'viajes.editar');
    expect(v).toMatchObject({ nombre: 'Cancún 2027', color: 'violeta', fecha_hasta: null });
    expect(d.decodeListaDeViajes(await m.mockListarViajes('abiertos', V3), 'abiertos').viajes.find((x) => x.id === id)).toMatchObject({ color: 'violeta' });
    expect(d.decodeDetalleViaje(await m.mockEditarViaje(id, { color: null }, V3), 'viajes.editar').color).toBeNull();
    for (const malo of [{}, { color: 'fucsia' }, { nombre: '   ' }, { fecha_desde: '2026-13-40' }, { saldo: 1 },
      { fecha_desde: '2026-12-01', fecha_hasta: '2026-11-01' }]) {
      expect(await rechazo(m.mockEditarViaje(id, malo)), JSON.stringify(malo)).toMatchObject({ status: 400 });
    }
    expect(await rechazo(m.mockEditarViaje(m.VIAJES_SEMILLA.monterrey, { color: 'azul' }))).toMatchObject({ status: 409, error: 'viaje_not_open' });
  });

  it('la foto: subir (201, después 200), verla, quitar (204) y el 404 uniforme', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    expect(await rechazo(m.mockFotoDeViaje(id))).toMatchObject({ status: 404, error: 'viaje_photo_not_found' });
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' });
    const r1 = await m.mockSubirFotoDeViaje(id, jpeg);
    expect(r1.status).toBe(201);
    expect(d.decodeFotoDeViaje(r1.cuerpo).revision).toBe(1);
    expect((await m.mockSubirFotoDeViaje(id, jpeg)).status).toBe(200);
    expect(d.decodeDetalleViaje(await m.mockDetalleViaje(id, V3)).has_photo).toBe(true);
    expect((await m.mockFotoDeViaje(id)).blob).toBe(jpeg);
    expect(await rechazo(m.mockSubirFotoDeViaje(id, new Blob(['x'], { type: 'image/gif' })))).toMatchObject({ status: 415 });
    expect(await rechazo(m.mockSubirFotoDeViaje(id, new Blob([], { type: 'image/jpeg' })))).toMatchObject({ status: 400 });
    await m.mockQuitarFotoDeViaje(id);
    expect(d.decodeDetalleViaje(await m.mockDetalleViaje(id, V3)).has_photo).toBe(false);
    expect(await rechazo(m.mockFotoDeViaje(id))).toMatchObject({ status: 404, error: 'viaje_photo_not_found' });
    // Un viaje ajeno o inexistente: el mismo 404.
    expect(await rechazo(m.mockFotoDeViaje('d1000000-0000-4000-8000-0000000000ff'))).toMatchObject({ status: 404, error: 'viaje_photo_not_found' });
  });

  it('🔴 quién pagó en el gasto: otro miembro activo; el 422 con el id tal como vino; la idempotencia es de quien carga', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, V3));
    const luis = v.miembros.find((x) => x.first_name === 'Luis')!;
    const pedido = { descripcion: 'Gasolina', monto_cents: 90000, presentes: v.miembros.map((x) => x.id), idempotency_key: 'gasto-quien-pago-1', pagado_por: luis.id };
    const t = d.decodeGastoCargado(await m.mockCargarGasto(id, pedido), luis.id);
    expect(t).toMatchObject({ pagado_por: luis.id, pagaste_tu: false, puedo_marcar_presentes: true });
    // El mismo pedido de nuevo: el mismo gasto (lo cargué yo, aunque pagó Luis).
    expect(d.decodeGastoCargado(await m.mockCargarGasto(id, pedido), luis.id).id).toBe(t.id);
    // Lo que pagó Luis sube en «Lo que pagó».
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(id, V3));
    expect(despues.miembros.find((x) => x.id === luis.id)!.pagado_cents).toBe(luis.pagado_cents! + 90000);
    const desconocido = 'd9000000-0000-4000-8000-000000000999';
    expect(await rechazo(m.mockCargarGasto(id, { ...pedido, idempotency_key: 'gasto-quien-pago-2', pagado_por: desconocido })))
      .toEqual({ status: 422, error: 'viaje_ticket_payer_unknown', extra: { miembro_id: desconocido } });
    expect(await rechazo(m.mockCargarGasto(id, { ...pedido, idempotency_key: 'gasto-quien-pago-3', pagado_por: 'no-es-uuid' })))
      .toMatchObject({ status: 400 });
  });

  it('🔴 quién pagó en el ticket escaneado: lo cargo yo, pagó otro', async () => {
    storage({ 'payme.app.mock.viajes.huella.v1': 'huella-quien-pago' });
    const mock = await import('./mockApi');
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, V3));
    const sofia = v.miembros.find((x) => x.first_name === 'Sofía')!;
    const ocr = await mock.mockScanTicket({ viaje: true });
    const pedido = {
      ocr_receipt: ocr.receipt!, idempotency_key: 'ticket-quien-pago', forma: 'iguales', tipo_lugar: 'restaurante',
      lugar: 'Tacos', fecha_ticket: null, hora_ticket: null, pagado_por: sofia.id,
      items: ocr.items.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
    };
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido));
    expect(r.ticket).toMatchObject({ pagado_por: sofia.id, pagaste_tu: false });
  });
});
