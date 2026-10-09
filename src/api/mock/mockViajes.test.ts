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
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun));
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
    const v = d.decodeDetalleViaje(await m.mockCerrarViaje(id), 'viajes.cerrar');
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
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id));
    const meDeben = v.transferencias.filter((x) => x.mia === 'me_deben');
    expect(meDeben.map((x) => [x.monto_cents, x.estado])).toEqual([[75000, 'marcada'], [30000, 'pendiente']]);
    const noLlego = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, meDeben[0]!.id, 'no-llego'), meDeben[0]!.id);
    expect(noLlego.transferencia.estado).toBe('pendiente');
    await m.mockMarcarTransferencia(id, meDeben[0]!.id, 'recibi');
    const fin = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, meDeben[1]!.id, 'recibi'), meDeben[1]!.id);
    expect(fin.viaje_estado).toBe('cerrado');
    expect(fin.transferencias_pendientes).toBe(0);
    expect(state.notifications[0]).toMatchObject({ type: 'viaje_finished', payload: { viaje_id: id } });
    const cerrados = d.decodeListaDeViajes(await m.mockListarViajes('cerrados'), 'cerrados');
    expect(cerrados.viajes.map((x) => x.nombre)).toContain('Monterrey fin de semana');
  });

  it('Cerrados: sólo lo propio (1s, D240-17)', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca));
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
    const v = d.decodeDetalleViaje(await m.mockAceptarViaje(m.VIAJES_SEMILLA.mazatlan), 'viajes.aceptar');
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
    const v = d.decodeDetalleViaje(await m.mockCrearViaje(body), 'viajes.crear');
    expect(v.nombre).toBe('Puebla 2026');
    expect(v.miembros).toHaveLength(1);
    expect(v.invitados).toHaveLength(1);
    expect(d.decodeDetalleViaje(await m.mockCrearViaje(body), 'viajes.crear').id).toBe(v.id);
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
