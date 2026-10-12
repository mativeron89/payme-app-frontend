import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GastoManualPedido } from '../viajes';

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

/** D263 · la fachada pide siempre `viaje_version=5` (la 4 más `pagadores`, también en las rutas de ticket), y el
 *  decodificador sólo acepta esa forma. */
/** La versión que negocia la fachada (D290, 2.183.0: la 11, la 10 más `notas` en el detalle del viaje). */
const VF = { version: 11 } as const;

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
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
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
    const t = d.decodeTicketDelViaje(await m.mockVerTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos, VF));
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
    const v = d.decodeDetalleViaje(await m.mockCerrarViaje(id, VF), 'viajes.cerrar');
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
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const meDeben = v.transferencias.filter((x) => x.mia === 'me_deben');
    expect(meDeben.map((x) => [x.monto_cents, x.estado])).toEqual([[75000, 'marcada'], [30000, 'pendiente']]);
    const noLlego = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, meDeben[0]!.id, 'no-llego'), meDeben[0]!.id);
    expect(noLlego.transferencia.estado).toBe('pendiente');
    await m.mockMarcarTransferencia(id, meDeben[0]!.id, 'recibi');
    const fin = d.decodeMarcaDeTransferencia(await m.mockMarcarTransferencia(id, meDeben[1]!.id, 'recibi'), meDeben[1]!.id);
    expect(fin.viaje_estado).toBe('cerrado');
    expect(fin.transferencias_pendientes).toBe(0);
    expect(state.notifications[0]).toMatchObject({ type: 'viaje_finished', payload: { viaje_id: id } });
    const cerrados = d.decodeListaDeViajes(await m.mockListarViajes('cerrados', VF), 'cerrados');
    expect(cerrados.viajes.map((x) => x.nombre)).toContain('Monterrey fin de semana');
  });

  it('🔴 nunca por encima del entero: lo de los demás más lo mío no pasa del plato (decisión 81)', async () => {
    storage();
    const { m, d } = await subject();
    const t = d.decodeTicketDelViaje(await m.mockVerTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos, VF));
    const margarita = t.items.find((i) => i.name === 'Margarita')!;
    // Luis ya tiene 1/4: subir lo mío a entero pasa del plato.
    expect(await rechazo(m.mockElegirEnTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos,
      { items: [{ item_id: margarita.id, fraction_bps: 10000 }], listo: true }, VF)))
      .toEqual({ status: 409, error: 'viaje_fraction_exceeds_item', extra: { item_id: margarita.id, remaining_bps: 7500 } });
    // Tres cuartos sí entran.
    const r = d.decodeTicketDelViaje(await m.mockElegirEnTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos,
      { items: [{ item_id: margarita.id, fraction_bps: 7500 }], listo: true }, VF), 'viajes.seleccion');
    expect(r.items.find((i) => i.name === 'Margarita')!.my_bps).toBe(7500);
  });

  it('Cerrados: sólo lo propio (1s, D240-17)', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, VF));
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
    const v = d.decodeDetalleViaje(await m.mockAceptarViaje(m.VIAJES_SEMILLA.mazatlan, VF), 'viajes.aceptar');
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
    const v = d.decodeDetalleViaje(await m.mockCrearViaje(body, VF), 'viajes.crear');
    expect(v.nombre).toBe('Puebla 2026');
    expect(v.miembros).toHaveLength(1);
    expect(v.invitados).toHaveLength(1);
    expect(d.decodeDetalleViaje(await m.mockCrearViaje(body, VF), 'viajes.crear').id).toBe(v.id);
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
    const r = d.decodeTicketCargado(await m.mockCargarTicket(m.VIAJES_SEMILLA.cancun, pedido, VF));
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
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
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
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, VF));
    expect(v.estado).toBe('cerrado');
    for (const x of v.miembros) expect(x.pagado_cents === null).toBe(!x.es_yo);
  });

  it('D244 · el gasto a mano: lo pagó quien lo carga, en partes iguales entre los elegidos, el más nuevo arriba', async () => {
    storage();
    const { m, d } = await subject();
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    const yoM = antes.miembros.find((x) => x.es_yo)!;
    const luis = antes.miembros.find((x) => x.first_name === 'Luis')!;
    const diego = antes.miembros.find((x) => x.first_name === 'Diego')!;
    const pedido = { descripcion: '  Gasolina   del  jueves ', monto_cents: 100001, presentes: [yoM.id, luis.id, diego.id], idempotency_key: 'gasto-de-prueba-1' };
    const t = d.decodeGastoCargado(await m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, pedido, VF));
    expect(t).toMatchObject({ lugar: 'Gasolina del jueves', tipo_lugar: 'otro', forma: 'iguales', monto_cents: 100001,
      fecha_ticket: null, hora_ticket: null, pagaste_tu: true, puedo_elegir: false, puedo_marcar_presentes: true });
    expect(t.items).toEqual([expect.objectContaining({ name: 'Gasolina del jueves', price_cents: 100001, quantity: 1 })]);
    expect(t.personas.filter((p) => p.presente).map((p) => p.miembro_id)).toEqual([yoM.id, luis.id, diego.id]);
    // $1,000.01 entre tres: $333.34, $333.34 y $333.33; el residuo va a los primeros en el orden de los miembros (yo, Luis).
    expect(t.te_toca_cents).toBe(33334);
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    expect(despues.tickets[0]).toMatchObject({ id: t.id, origen: 'manual', monto_cents: 100001, lugar: 'Gasolina del jueves' });
    expect(despues.miembros.find((x) => x.es_yo)!.pagado_cents).toBe(96000 + 100001);
    expect(despues.mi_balance_cents).toBe(antes.mi_balance_cents + 100001 - 33334);
    // El mismo pedido con la misma clave es el mismo gasto; otro pedido con esa clave, 409.
    expect(d.decodeGastoCargado(await m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, pedido, VF)).id).toBe(t.id);
    expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, { ...pedido, monto_cents: 5 }, VF)))
      .toMatchObject({ status: 409, error: 'idempotency_key_conflict' });
    const otra = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    expect(otra.tickets.filter((x) => x.origen === 'manual')).toHaveLength(1);
  });

  it('D244 · lo que el dueño rechaza: cuerpo inválido 400, alguien que no es miembro 422, cerrado 409', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
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
      expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, malo, VF)), JSON.stringify(malo))
        .toMatchObject({ status: 400, error: 'validation_error' });
    }
    const ajeno = 'e9000000-0000-4000-8000-000000000001';
    expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.cancun, { ...base, presentes: [ajeno] }, VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_persona_unknown', extra: { miembro_id: ajeno } });
    const cerrado = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, VF));
    expect(await rechazo(m.mockCargarGasto(m.VIAJES_SEMILLA.oaxaca, { ...base, presentes: [cerrado.mi_miembro_id] }, VF)))
      .toMatchObject({ status: 409, error: 'viaje_not_open' });
  });

  it('D245 · la foto: toda negativa es el mismo 404, y cada pedido se cuenta', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
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
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.monterrey, VF));
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
    const antes = d.decodeListaDeViajes(await m.mockListarViajes('cerrados', VF), 'cerrados');
    expect(antes.viajes.map((x) => x.nombre)).toContain('Oaxaca puente');
    d.decodeRespuestaDeSalida(await m.mockSalirDeViaje(m.VIAJES_SEMILLA.oaxaca), m.VIAJES_SEMILLA.oaxaca, 'salio');
    const despues = d.decodeListaDeViajes(await m.mockListarViajes('cerrados', VF), 'cerrados');
    expect(despues.viajes.map((x) => x.nombre)).not.toContain('Oaxaca puente');
    expect(despues.counts.cerrados).toBe(antes.counts.cerrados - 1);
    expect(await rechazo(m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, VF))).toMatchObject({ status: 404, error: 'viaje_not_found' });
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
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    const v = d.decodeDetalleViaje(await m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [{ user_id: amigo.id }] }, VF), 'viajes.invitar');
    expect(v.invitados).toHaveLength(antes.invitados.length + 1);
    expect(v.invitados.at(-1)).toMatchObject({ first_name: amigo.first_name });
    expect(v.miembros).toHaveLength(antes.miembros.length);
    const otraVez = d.decodeDetalleViaje(await m.mockInvitarAlViaje(m.VIAJES_SEMILLA.cancun, { miembros: [{ user_id: amigo.id }] }, VF), 'viajes.invitar');
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
      { nombre: 'Tope', fecha_desde: null, fecha_hasta: null, miembros, idempotency_key: 'clave-tope-0001' }, VF), 'viajes.crear');
    // Hacen falta 10 o más para que contarlos dos veces pase de 20.
    expect(creado.invitados.length).toBeGreaterThanOrEqual(10);
    const otraVez = d.decodeDetalleViaje(await m.mockInvitarAlViaje(creado.id, { miembros }, VF), 'viajes.invitar');
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
    const v3 = (await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, { version: 3 })) as { viaje: Record<string, unknown> };
    expect(v3.viaje).toMatchObject({ color: null, has_photo: false });
    const l1 = (await m.mockListarViajes('abiertos')) as { viajes: Array<Record<string, unknown>> };
    expect(Object.keys(l1.viajes[0]!)).not.toContain('color');
    const l3 = (await m.mockListarViajes('abiertos', { version: 3 })) as { viajes: Array<Record<string, unknown>> };
    expect(l3.viajes[0]).toMatchObject({ color: null, has_photo: false });
    // El decodificador acepta sólo la forma que pide la fachada (la 8): la de la 3 llega sin `hora_cierre`.
    expect(Object.keys(l3.viajes[0]!)).not.toContain('hora_cierre');
    expect(d.decodeListaDeViajes(await m.mockListarViajes('abiertos', VF), 'abiertos').viajes[0]).toMatchObject({ color: null, has_photo: false });
  });

  it('editar: nombre, fechas y color; `null` borra; lo que el dueño rechaza', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockEditarViaje(id, { nombre: '  Cancún   2027 ', color: 'violeta', fecha_hasta: null }, VF), 'viajes.editar');
    expect(v).toMatchObject({ nombre: 'Cancún 2027', color: 'violeta', fecha_hasta: null });
    expect(d.decodeListaDeViajes(await m.mockListarViajes('abiertos', VF), 'abiertos').viajes.find((x) => x.id === id)).toMatchObject({ color: 'violeta' });
    expect(d.decodeDetalleViaje(await m.mockEditarViaje(id, { color: null }, VF), 'viajes.editar').color).toBeNull();
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
    expect(d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).has_photo).toBe(true);
    expect((await m.mockFotoDeViaje(id)).blob).toBe(jpeg);
    expect(await rechazo(m.mockSubirFotoDeViaje(id, new Blob(['x'], { type: 'image/gif' })))).toMatchObject({ status: 415 });
    expect(await rechazo(m.mockSubirFotoDeViaje(id, new Blob([], { type: 'image/jpeg' })))).toMatchObject({ status: 400 });
    await m.mockQuitarFotoDeViaje(id);
    expect(d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).has_photo).toBe(false);
    expect(await rechazo(m.mockFotoDeViaje(id))).toMatchObject({ status: 404, error: 'viaje_photo_not_found' });
    // Un viaje ajeno o inexistente: el mismo 404.
    expect(await rechazo(m.mockFotoDeViaje('d1000000-0000-4000-8000-0000000000ff'))).toMatchObject({ status: 404, error: 'viaje_photo_not_found' });
  });

  it('🔴 quién pagó en el gasto: otro miembro activo; el 422 con el id tal como vino; la idempotencia es de quien carga', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const luis = v.miembros.find((x) => x.first_name === 'Luis')!;
    const pedido = { descripcion: 'Gasolina', monto_cents: 90000, presentes: v.miembros.map((x) => x.id), idempotency_key: 'gasto-quien-pago-1', pagado_por: luis.id };
    const t = d.decodeGastoCargado(await m.mockCargarGasto(id, pedido, VF), pedido);
    expect(t).toMatchObject({ pagado_por: luis.id, pagaste_tu: false, puedo_marcar_presentes: true });
    // El mismo pedido de nuevo: el mismo gasto (lo cargué yo, aunque pagó Luis).
    expect(d.decodeGastoCargado(await m.mockCargarGasto(id, pedido, VF), pedido).id).toBe(t.id);
    // Lo que pagó Luis sube en «Lo que pagó».
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    expect(despues.miembros.find((x) => x.id === luis.id)!.pagado_cents).toBe(luis.pagado_cents! + 90000);
    const desconocido = 'd9000000-0000-4000-8000-000000000999';
    expect(await rechazo(m.mockCargarGasto(id, { ...pedido, idempotency_key: 'gasto-quien-pago-2', pagado_por: desconocido }, VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_payer_unknown', extra: { miembro_id: desconocido } });
    expect(await rechazo(m.mockCargarGasto(id, { ...pedido, idempotency_key: 'gasto-quien-pago-3', pagado_por: 'no-es-uuid' }, VF)))
      .toMatchObject({ status: 400 });
  });

  it('🔴 quién pagó en el ticket escaneado: lo cargo yo, pagó otro', async () => {
    storage({ 'payme.app.mock.viajes.huella.v1': 'huella-quien-pago' });
    const mock = await import('./mockApi');
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const sofia = v.miembros.find((x) => x.first_name === 'Sofía')!;
    const ocr = await mock.mockScanTicket({ viaje: true });
    const pedido = {
      ocr_receipt: ocr.receipt!, idempotency_key: 'ticket-quien-pago', forma: 'iguales', tipo_lugar: 'restaurante',
      lugar: 'Tacos', fecha_ticket: null, hora_ticket: null, pagado_por: sofia.id,
      items: ocr.items.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
    };
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido, VF));
    expect(r.ticket).toMatchObject({ pagado_por: sofia.id, pagaste_tu: false });
  });
});

describe('🔴 mock · D256 · App Backend 2.175.0: eliminar un ticket o un gasto', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  const tickets = (r: unknown) => (r as { viaje: { tickets: Array<Record<string, unknown>> } }).viaje.tickets;

  it('la 4 suma `puede_eliminar` a cada ticket del detalle: quien lo cargó o quien pagó; la 3 queda igual, y la lista es la de la 3', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    expect(tickets(await m.mockDetalleViaje(id, { version: 3 })).every((t) => !('puede_eliminar' in t))).toBe(true);
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    // En la semilla, Mati pagó sólo «Bar La Ola».
    expect(v.tickets.filter((t) => t.puede_eliminar).map((t) => t.lugar)).toEqual(['Bar La Ola']);
    expect(v.tickets.filter((t) => t.pagaste_tu).map((t) => t.lugar)).toEqual(['Bar La Ola']);
    expect(await m.mockListarViajes('abiertos', { version: 7 })).toEqual(await m.mockListarViajes('abiertos', { version: 3 }));
  });

  it('lo cargado por quien mira, aunque haya pagado otro, también se puede eliminar', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const luis = antes.miembros.find((x) => x.first_name === 'Luis')!.id;
    await m.mockCargarGasto(id, { descripcion: 'Taxi', monto_cents: 30000, presentes: antes.miembros.map((x) => x.id),
      pagado_por: luis, idempotency_key: 'gasto-de-prueba-d256' });
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    expect(v.tickets.find((t) => t.lugar === 'Taxi')).toMatchObject({ pagaste_tu: false, puede_eliminar: true, origen: 'manual' });
  });

  it('eliminar lo propio: 200 con el viaje, sin el ticket y con la cuenta recalculada', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const bar = antes.tickets.find((t) => t.lugar === 'Bar La Ola')!;
    const v = d.decodeDetalleViaje(await m.mockEliminarTicket(id, bar.id, VF), 'viajes.eliminarTicket');
    expect(v.tickets.map((t) => t.id)).not.toContain(bar.id);
    expect(v.tickets).toHaveLength(antes.tickets.length - 1);
    expect(v.gasto_del_grupo_cents).toBe(antes.gasto_del_grupo_cents - bar.monto_cents);
    expect(v.mi_balance_cents).not.toBe(antes.mi_balance_cents);
    // Persiste: el detalle de después tampoco lo tiene.
    expect(d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).tickets.map((t) => t.id)).not.toContain(bar.id);
  });

  it('lo que el dueño rechaza, en su orden: 404 del viaje, 404 del ticket, 409 cerrado y 403 de otro', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const ajeno = v.tickets.find((t) => !t.puede_eliminar)!;
    expect(await rechazo(m.mockEliminarTicket(id, ajeno.id, VF))).toEqual({ status: 403, error: 'viaje_ticket_delete_forbidden', extra: {} });
    expect(await rechazo(m.mockEliminarTicket(id, 'no-existe', VF))).toMatchObject({ status: 404, error: 'viaje_ticket_not_found' });
    expect(await rechazo(m.mockEliminarTicket('no-es-mio', ajeno.id, VF))).toMatchObject({ status: 404, error: 'viaje_not_found' });
    const oaxaca = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.oaxaca, VF));
    expect(oaxaca.tickets.every((t) => !t.puede_eliminar)).toBe(true);
    const propio = oaxaca.tickets.find((t) => t.pagaste_tu) ?? oaxaca.tickets[0]!;
    expect(await rechazo(m.mockEliminarTicket(m.VIAJES_SEMILLA.oaxaca, propio.id, VF))).toMatchObject({ status: 409, error: 'viaje_not_open' });
  });

  it('los seams, una sola vez: ya no estaba (y se elimina), cerrado, prohibido y sin viaje', async () => {
    const valores = storage({ 'payme.app.mock.viajes.eliminar.v1': 'ya_no_estaba' });
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const bar = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).tickets.find((t) => t.lugar === 'Bar La Ola')!;
    expect(await rechazo(m.mockEliminarTicket(id, bar.id, VF))).toMatchObject({ status: 404, error: 'viaje_ticket_not_found' });
    expect(d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).tickets.map((t) => t.id)).not.toContain(bar.id);
    expect(valores.has('payme.app.mock.viajes.eliminar.v1')).toBe(false);
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const luis = v.miembros.find((x) => x.first_name === 'Luis')!.id;
    await m.mockCargarGasto(id, { descripcion: 'Taxi', monto_cents: 30000, presentes: [luis], idempotency_key: 'gasto-de-prueba-seam' }, VF);
    const taxi = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).tickets.find((t) => t.lugar === 'Taxi')!;
    valores.set('payme.app.mock.viajes.eliminar.v1', 'cerrado');
    expect(await rechazo(m.mockEliminarTicket(id, taxi.id, VF))).toMatchObject({ status: 409, error: 'viaje_not_open', extra: { estado: 'esperando_pagos' } });
    valores.set('payme.app.mock.viajes.eliminar.v1', 'prohibido');
    expect(await rechazo(m.mockEliminarTicket(id, taxi.id, VF))).toMatchObject({ status: 403, error: 'viaje_ticket_delete_forbidden' });
    valores.set('payme.app.mock.viajes.eliminar.v1', 'sin_viaje');
    expect(await rechazo(m.mockEliminarTicket(id, taxi.id, VF))).toMatchObject({ status: 404, error: 'viaje_not_found' });
    // Consumido: el siguiente se elimina.
    expect(d.decodeDetalleViaje(await m.mockEliminarTicket(id, taxi.id, VF), 'viajes.eliminarTicket').tickets.map((t) => t.id)).not.toContain(taxi.id);
  });

  it('el aviso `viaje_ticket_removed` se siembra sólo con su seam, con el texto del dueño y el viaje en el payload', async () => {
    storage({ 'payme.app.mock.viajes.aviso_eliminado.v1': 'encendido' });
    const { m, state } = await subject();
    m.sembrarViajesMock();
    const aviso = state.notifications.find((n) => n.type === 'viaje_ticket_removed');
    expect(aviso).toMatchObject({ title: 'Se eliminó un ticket de tu viaje', body: 'Luis Pérez eliminó un gasto de Cancún 2026: Taxi al aeropuerto.',
      payload: { viaje_id: m.VIAJES_SEMILLA.cancun } });
  });

  it('control · sin el seam, la bandeja de siempre: no hay aviso de eliminado', async () => {
    storage();
    const { m, state } = await subject();
    m.sembrarViajesMock();
    expect(state.notifications.some((n) => n.type === 'viaje_ticket_added')).toBe(true);
    expect(state.notifications.some((n) => n.type === 'viaje_ticket_removed')).toBe(false);
  });
});

describe('🔴 mock · D263 · App Backend 2.177.0: varios pagaron', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function cancun() {
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const quien = (nombre: string) => v.miembros.find((x) => x.first_name === nombre)!;
    return { m, d, id, v, yo: v.miembros.find((x) => x.es_yo)!, luis: quien('Luis'), sofia: quien('Sofía') };
  }
  /** El pedido de un gasto de $100.01 entre todos; `extra` puede traer lo que el dueño rechaza. */
  const gasto = (v: { miembros: ReadonlyArray<{ id: string }> }, extra: Record<string, unknown>) =>
    ({ descripcion: 'Hotel', monto_cents: 10001, presentes: v.miembros.map((x) => x.id), idempotency_key: 'gasto-varios-0001', ...extra }) as
      Record<string, unknown> & Pick<GastoManualPedido, 'pagado_por' | 'pagadores'>;

  it('tres, sin montos: partes iguales con el centavo de más a los primeros, en el orden pedido; el primero es `pagado_por`', async () => {
    storage();
    const { m, d, id, v, yo, luis, sofia } = await cancun();
    const pedido = gasto(v, { pagadores: [{ miembro_id: luis.id }, { miembro_id: yo.id }, { miembro_id: sofia.id }] });
    const t = d.decodeGastoCargado(await m.mockCargarGasto(id, pedido, VF), pedido);
    expect(t.pagadores).toEqual([
      { miembro_id: luis.id, monto_cents: 3334 }, { miembro_id: yo.id, monto_cents: 3334 }, { miembro_id: sofia.id, monto_cents: 3333 },
    ]);
    // Pagó Luis primero, pero también pagué yo: es mío para eliminar y para marcar presentes.
    expect(t).toMatchObject({ pagado_por: luis.id, pagaste_tu: true, puedo_marcar_presentes: true });
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    expect(despues.tickets.find((x) => x.id === t.id)).toMatchObject({ pagaste_tu: true, puede_eliminar: true, pagadores: t.pagadores });
    // «Lo que pagó» de cada uno sube en lo suyo.
    for (const [x, c] of [[yo, 3334], [luis, 3334], [sofia, 3333]] as const) {
      expect(despues.miembros.find((y) => y.id === x.id)!.pagado_cents, String(x.first_name)).toBe(x.pagado_cents! + c);
    }
    // La cuenta sigue cerrando en cero.
    expect(despues.miembros.reduce((s, x) => s + x.balance_cents!, 0)).toBe(0);
    // El detalle de ese ticket, con la 5, también.
    expect(d.decodeTicketDelViaje(await m.mockVerTicket(id, t.id, VF)).pagadores).toEqual(t.pagadores);
  });

  it('🔴 la cuenta: a cada uno se le acredita lo que pagó (lo consumió sólo Diego)', async () => {
    storage();
    const { m, d, id, v, yo, luis, sofia } = await cancun();
    const diego = v.miembros.find((x) => x.first_name === 'Diego')!;
    const pedido = gasto(v, { presentes: [diego.id], pagadores: [{ miembro_id: yo.id }, { miembro_id: luis.id }, { miembro_id: sofia.id }] });
    await m.mockCargarGasto(id, pedido, VF);
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const delta = (x: { id: string; balance_cents: number | null }) => despues.miembros.find((y) => y.id === x.id)!.balance_cents! - x.balance_cents!;
    expect([delta(yo), delta(luis), delta(sofia), delta(diego)]).toEqual([3334, 3334, 3333, -10001]);
    expect(despues.mi_balance_cents - v.mi_balance_cents).toBe(3334);
  });

  it('con montos: los que suman el total; si no suman, el 422 con el total del ticket', async () => {
    storage();
    const { m, d, id, v, luis, sofia } = await cancun();
    const ajustados = [{ miembro_id: luis.id, monto_cents: 7001 }, { miembro_id: sofia.id, monto_cents: 3000 }];
    const pedido = gasto(v, { pagadores: ajustados });
    const t = d.decodeGastoCargado(await m.mockCargarGasto(id, pedido, VF), pedido);
    expect(t).toMatchObject({ pagado_por: luis.id, pagaste_tu: false, pagadores: ajustados });
    expect(d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).tickets.find((x) => x.id === t.id)!.puede_eliminar).toBe(true);
    const noSuman = gasto(v, { idempotency_key: 'gasto-varios-0002', pagadores: [{ miembro_id: luis.id, monto_cents: 7000 }, { miembro_id: sofia.id, monto_cents: 3000 }] });
    expect(await rechazo(m.mockCargarGasto(id, noSuman, VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_payers_total_mismatch', extra: { monto_cents: 10001 } });
    const deMas = gasto(v, { idempotency_key: 'gasto-varios-0003', pagadores: [{ miembro_id: luis.id, monto_cents: 7001 }, { miembro_id: sofia.id, monto_cents: 3001 }] });
    expect(await rechazo(m.mockCargarGasto(id, deMas, VF))).toMatchObject({ status: 422, error: 'viaje_ticket_payers_total_mismatch' });
    // El mismo pedido de nuevo: el mismo gasto. Con otros pagadores y la misma llave: conflicto.
    expect(d.decodeGastoCargado(await m.mockCargarGasto(id, pedido, VF), pedido).id).toBe(t.id);
    expect(await rechazo(m.mockCargarGasto(id, { ...pedido, pagadores: [...ajustados].reverse() }, VF))).toMatchObject({ status: 409 });
  });

  it('lo que el dueño rechaza con 400: con `pagado_por`, vacío, repetidos, montos a medias, cero, de más de 20 y claves de más', async () => {
    storage();
    const { m, id, v, yo, luis, sofia } = await cancun();
    const otros = Array.from({ length: 21 }, (_, i) => ({ miembro_id: `d9000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    for (const [n, extra] of [
      { pagado_por: luis.id, pagadores: [{ miembro_id: sofia.id }] }, { pagadores: [] }, { pagadores: {} },
      { pagadores: [{ miembro_id: luis.id }, { miembro_id: luis.id }] },
      { pagadores: [{ miembro_id: luis.id, monto_cents: 10001 }, { miembro_id: sofia.id }] },
      { pagadores: [{ miembro_id: luis.id, monto_cents: 10001 }, { miembro_id: sofia.id, monto_cents: 0 }] },
      { pagadores: [{ miembro_id: luis.id, monto_cents: 10000.5 }, { miembro_id: sofia.id, monto_cents: 0.5 }] },
      { pagadores: [{ miembro_id: 'no-es-uuid' }] }, { pagadores: [{ miembro_id: yo.id, saldo: 1 }] }, { pagadores: otros },
    ].entries()) {
      expect(await rechazo(m.mockCargarGasto(id, gasto(v, { idempotency_key: `gasto-400-${n}-000`, ...extra }), VF)), JSON.stringify(extra))
        .toMatchObject({ status: 400 });
    }
    const desconocido = 'd9000000-0000-4000-8000-000000000999';
    expect(await rechazo(m.mockCargarGasto(id, gasto(v, { pagadores: [{ miembro_id: luis.id }, { miembro_id: desconocido }] }), VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_payer_unknown', extra: { miembro_id: desconocido } });
  });

  it('uno solo en `pagadores`: como `pagado_por`; y la 4 queda igual, sin `pagadores`', async () => {
    storage();
    const { m, d, id, v, luis } = await cancun();
    const pedido = gasto(v, { pagadores: [{ miembro_id: luis.id }] });
    const t = d.decodeGastoCargado(await m.mockCargarGasto(id, pedido, VF), pedido);
    expect(t).toMatchObject({ pagado_por: luis.id, pagaste_tu: false, pagadores: [{ miembro_id: luis.id, monto_cents: 10001 }] });
    const v4 = (await m.mockDetalleViaje(id, { version: 4 })) as { viaje: { tickets: Array<Record<string, unknown>> } };
    expect(v4.viaje.tickets.every((x) => !('pagadores' in x))).toBe(true);
    expect('pagadores' in ((await m.mockVerTicket(id, t.id, { version: 4 })) as { ticket: object }).ticket).toBe(false);
  });

  it('🔴 «Pagar el total» entre varios: cada uno consumió lo que pagó; a nadie más le toca nada', async () => {
    storage({ 'payme.app.mock.viajes.huella.v1': 'huella-total-varios' });
    const mock = await import('./mockApi');
    const { m, d, id, v, yo, sofia } = await cancun();
    const ajustados = [{ miembro_id: yo.id, monto_cents: 6001 }, { miembro_id: sofia.id, monto_cents: 4000 }];
    // «Pagar el total» es del ticket escaneado: un gasto a mano se guarda «En partes iguales».
    const ocr = await mock.mockScanTicket({ viaje: true });
    const items = [{ name: 'Cena', price_cents: 10001, quantity: 1 }];
    const pedido = { ocr_receipt: ocr.receipt!, idempotency_key: 'ticket-total-varios', forma: 'total', tipo_lugar: 'restaurante',
      lugar: 'Cena', fecha_ticket: null, hora_ticket: null, pagadores: ajustados, items };
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido, VF));
    expect(r.ticket.pagadores).toEqual(ajustados);
    expect(r.ticket.te_toca_cents).toBe(6001);
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    // Nadie le debe nada a nadie por este ticket.
    for (const x of v.miembros) expect(despues.miembros.find((y) => y.id === x.id)!.balance_cents, String(x.first_name)).toBe(x.balance_cents);
  });

  it('el ticket escaneado con dos: el mismo reparto', async () => {
    storage({ 'payme.app.mock.viajes.huella.v1': 'huella-varios-pagaron' });
    const mock = await import('./mockApi');
    const { m, d, id, yo, sofia } = await cancun();
    const ocr = await mock.mockScanTicket({ viaje: true });
    const pedido = {
      ocr_receipt: ocr.receipt!, idempotency_key: 'ticket-varios-pagaron', forma: 'iguales', tipo_lugar: 'restaurante',
      lugar: 'Tacos', fecha_ticket: null, hora_ticket: null, pagadores: [{ miembro_id: yo.id }, { miembro_id: sofia.id }],
      items: ocr.items.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
    };
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido, VF));
    const total = r.ticket.monto_cents;
    expect(r.ticket).toMatchObject({ pagado_por: yo.id, pagaste_tu: true });
    expect(r.ticket.pagadores).toEqual([
      { miembro_id: yo.id, monto_cents: Math.ceil(total / 2) }, { miembro_id: sofia.id, monto_cents: Math.floor(total / 2) },
    ]);
  });
});

describe('🔴 mock · D260 · App Backend 2.176.0: el ticket del viaje en «Tus restaurantes»', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  type Crudo = { restaurants: Array<{ name: string; visits: Array<Record<string, unknown>> }> };

  it('con `stats_version=2`, la visita de «Mariscos El Faro» abre su viaje; las mesas, `null`', async () => {
    storage();
    const mock = await import('./mockApi');
    const { m, d } = await subject();
    const { decodeTusRestaurantes } = await import('../tusRestaurantes');
    const r = decodeTusRestaurantes(await mock.mockStatsRestaurants(undefined, { statsVersion: 2 }));
    const mariscos = r.restaurants.find((x) => x.name === 'Mariscos El Faro')!;
    expect(mariscos.visits).toHaveLength(1);
    expect(mariscos.visits[0]).toMatchObject({ code: m.VIAJES_SEMILLA.cancunMariscos, viajeId: m.VIAJES_SEMILLA.cancun });
    // Lo que me toca en ese ticket del viaje es lo que suma la visita.
    const t = d.decodeTicketDelViaje(await m.mockVerTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos, VF));
    expect(mariscos.visits[0]!.amountCents).toBe(t.te_toca_cents);
    expect(r.restaurants.filter((x) => x !== mariscos).every((x) => x.visits.every((v) => v.viajeId === null))).toBe(true);
  });

  it('sin `stats_version=2`, la forma de siempre: sin `viaje_id`', async () => {
    storage();
    const mock = await import('./mockApi');
    const crudo = (await mock.mockStatsRestaurants()) as Crudo;
    expect(crudo.restaurants.flatMap((x) => x.visits).every((v) => !('viaje_id' in v))).toBe(true);
  });

  it('control · con Viajes apagado, no hay visita de viaje', async () => {
    storage({ 'payme.app.mock.viajes.v1': 'apagado' });
    const mock = await import('./mockApi');
    const crudo = (await mock.mockStatsRestaurants(undefined, { statsVersion: 2 })) as Crudo;
    expect(crudo.restaurants.some((x) => x.name === 'Mariscos El Faro')).toBe(false);
    expect(crudo.restaurants.flatMap((x) => x.visits).every((v) => v.viaje_id === null)).toBe(true);
  });
});

describe('🔴 mock · D276 · App Backend 2.179.0: quiénes estuvieron, el gasto personal y el no presente', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  const ID = '00000000-0000-4000-8000-000000000000';

  /** Escanea y carga un ticket en Cancún como la cuenta de ahora, con los presentes y quién pagó que se pidan. */
  async function cargarTicket(huella: string, forma: 'consumo' | 'iguales' | 'total', extra: Record<string, unknown> = {}) {
    storage({ 'payme.app.mock.viajes.huella.v1': huella });
    const mock = await import('./mockApi');
    const { m, d, state } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const miembro = (n: string) => v.miembros.find((x) => x.first_name === n)!;
    const yoM = v.miembros.find((x) => x.es_yo)!;
    const ocr = await mock.mockScanTicket({ viaje: true });
    const pedido = (presentes?: string[], mas: Record<string, unknown> = {}) => ({
      ocr_receipt: ocr.receipt!, idempotency_key: `ticket-${huella}`, forma, tipo_lugar: 'restaurante',
      lugar: 'Tacos', fecha_ticket: null, hora_ticket: null,
      items: ocr.items.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
      ...(presentes && { presentes }), ...extra, ...mas,
    });
    return { m, d, state, id, v, miembro, yoM, ocr, pedido };
  }

  it('`presentes` al cargar: sólo ellos quedan presentes, en el orden de los miembros; sin el campo, todos', async () => {
    const { m, d, id, v, miembro, yoM, pedido } = await cargarTicket('huella-presentes-1', 'consumo');
    const luis = miembro('Luis');
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido([luis.id, yoM.id]), VF));
    expect(r.ticket.personas.filter((p) => p.presente).map((p) => p.miembro_id)).toEqual([yoM.id, luis.id]);
    expect(r.ticket.personal).toBe(false);
    const lista = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF)).tickets.find((t) => t.id === r.ticket.id)!;
    expect(lista.presentes).toEqual([yoM.id, luis.id]);
    expect(lista.personal).toBe(false);
    // Sin el campo, todos los miembros activos.
    const { m: m2, d: d2, id: id2, pedido: p2 } = await cargarTicket('huella-presentes-2', 'consumo');
    const r2 = d2.decodeTicketCargado(await m2.mockCargarTicket(id2, p2(), VF));
    expect(r2.ticket.personas.every((p) => p.presente)).toBe(true);
    expect(r2.ticket.personas.map((p) => p.miembro_id)).toEqual(v.miembros.map((x) => x.id));
  });

  it('un id que no es miembro activo: 422 `viaje_ticket_persona_unknown` con su `miembro_id`; repetidos o vacío, 400', async () => {
    const { m, id, yoM, pedido } = await cargarTicket('huella-presentes-3', 'iguales');
    expect(await rechazo(m.mockCargarTicket(id, pedido([yoM.id, ID]), VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_persona_unknown', extra: { miembro_id: ID } });
    expect(await rechazo(m.mockCargarTicket(id, pedido([]), VF))).toMatchObject({ status: 400 });
    expect(await rechazo(m.mockCargarTicket(id, pedido([yoM.id, yoM.id]), VF))).toMatchObject({ status: 400 });
  });

  it('🔴 sólo yo y pagué yo: personal; no suma al grupo ni a lo pagado, me toca entero y no se elige', async () => {
    const { m, d, id, v, yoM, pedido, ocr } = await cargarTicket('huella-personal-1', 'consumo');
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido([yoM.id]), VF));
    expect(r.ticket).toMatchObject({ personal: true, puedo_elegir: false, te_toca_cents: ocr.total_cents, pagaste_tu: true });
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    expect(despues.gasto_del_grupo_cents).toBe(v.gasto_del_grupo_cents);
    expect(despues.miembros.find((x) => x.es_yo)!.pagado_cents).toBe(yoM.pagado_cents);
    expect(despues.mi_balance_cents).toBe(v.mi_balance_cents);
    // En mi lista sí está, marcado como personal.
    expect(despues.tickets.find((t) => t.id === r.ticket.id)).toMatchObject({ personal: true, presentes: [yoM.id] });
    // Elegir en un personal: 409 `viaje_ticket_personal`.
    expect(await rechazo(m.mockElegirEnTicket(id, r.ticket.id, { items: [], listo: true }, VF)))
      .toMatchObject({ status: 409, error: 'viaje_ticket_personal' });
    // No entra en la vista previa del cierre.
    expect(d.decodeVistaPreviaCierre(await m.mockVistaPreviaCierre(id)).tickets).toBe(v.tickets.length);
  });

  it('🔴 y tampoco suma después de cerrar el viaje (el balance congelado)', async () => {
    const { m, d, id, yoM, pedido } = await cargarTicket('huella-personal-cierre', 'consumo');
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido([yoM.id]), VF));
    const cerrado = d.decodeDetalleViaje(await m.mockCerrarViaje(id, VF), 'viajes.cerrar');
    expect(cerrado.estado).not.toBe('abierto');
    expect(cerrado.gasto_del_grupo_cents).toBe(antes.gasto_del_grupo_cents);
    expect(cerrado.miembros.find((x) => x.es_yo)!.pagado_cents).toBe(yoM.pagado_cents);
    expect(cerrado.tickets.find((t) => t.id === r.ticket.id)).toMatchObject({ personal: true });
  });

  it('🔴 el personal, para otra cuenta, no existe: fuera de su lista y su detalle es el 404 de siempre', async () => {
    const { m, d, state, id, yoM, pedido } = await cargarTicket('huella-personal-2', 'total');
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido([yoM.id]), VF));
    const ana = state.user;
    state.user = { ...state.user, id: m.PERSONAS_SEMILLA.luis.user_id };
    try {
      const deLuis = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
      expect(deLuis.tickets.some((t) => t.id === r.ticket.id)).toBe(false);
      expect(await rechazo(m.mockVerTicket(id, r.ticket.id, VF))).toMatchObject({ status: 404, error: 'viaje_ticket_not_found' });
    } finally {
      state.user = ana;
    }
  });

  it('sólo yo, pero pagó Luis: no es personal (es una deuda); y pagamos dos, tampoco', async () => {
    const { m, d, id, yoM, miembro, pedido } = await cargarTicket('huella-deuda-1', 'consumo');
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido([yoM.id], { pagado_por: miembro('Luis').id }), VF));
    expect(r.ticket.personal).toBe(false);
    const c = await cargarTicket('huella-deuda-2', 'iguales');
    const r2 = c.d.decodeTicketCargado(await c.m.mockCargarTicket(c.id, c.pedido([c.yoM.id],
      { pagadores: [{ miembro_id: c.yoM.id }, { miembro_id: c.miembro('Luis').id }] }), VF));
    expect(r2.ticket.personal).toBe(false);
  });

  it('🔴 PUT presentes en «consumo»: no se desmarca a quien ya eligió (409 con su `miembro_id`); a quien no eligió, sí', async () => {
    storage();
    const { m, d, state } = await subject();
    const id = m.VIAJES_SEMILLA.cancun;
    const tid = m.VIAJES_SEMILLA.cancunMariscos;
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
    const porNombre = new Map(v.miembros.map((x) => [x.first_name, x.id]));
    const ana = state.user;
    // Mariscos lo pagó Luis: él marca quiénes estuvieron.
    state.user = { ...state.user, id: m.PERSONAS_SEMILLA.luis.user_id };
    try {
      const sinAna = [porNombre.get('Luis')!, porNombre.get('Sofía')!, porNombre.get('Diego')!];
      expect(await rechazo(m.mockMarcarPresentes(id, tid, { presentes: sinAna }, VF)))
        .toEqual({ status: 409, error: 'viaje_ticket_persona_ya_eligio', extra: { miembro_id: v.miembros.find((x) => x.es_yo)!.id } });
      // Diego no eligió nada: se lo desmarca.
      const sinDiego = v.miembros.filter((x) => x.first_name !== 'Diego').map((x) => x.id);
      const t = d.decodeTicketDelViaje(await m.mockMarcarPresentes(id, tid, { presentes: sinDiego }, VF), 'viajes.presentes');
      expect(t.personas.find((p) => p.miembro_id === porNombre.get('Diego'))!.presente).toBe(false);
      expect(t.puedo_marcar_presentes).toBe(true);
      // Quien no estuvo ya no falta por elegir: ni en su cuenta ni en lo «sin repartir» de ese ticket.
      const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(id, VF));
      expect(despues.miembros.find((x) => x.first_name === 'Diego')!.falta_elegir).toBe(0);
      expect(despues.sin_repartir.flatMap((x) => x.faltan)).not.toContain(porNombre.get('Diego'));
      // 🔴 D276-4 · Diego, que no estuvo, lo ve pero no elige; y si lo intenta, 409.
      state.user = { ...state.user, id: m.PERSONAS_SEMILLA.diego.user_id };
      const deDiego = d.decodeTicketDelViaje(await m.mockVerTicket(id, tid, VF));
      expect(deDiego.puedo_elegir).toBe(false);
      expect(await rechazo(m.mockElegirEnTicket(id, tid, { items: [], listo: true }, VF)))
        .toMatchObject({ status: 409, error: 'viaje_ticket_not_present' });
    } finally {
      state.user = ana;
    }
  });

  it('con la 6, quien pagó marca presentes en «Pagar el total» (ya no sale `viaje_ticket_not_equal_split`)', async () => {
    const { m, d, id, yoM, miembro, pedido } = await cargarTicket('huella-total-presentes', 'total');
    const r = d.decodeTicketCargado(await m.mockCargarTicket(id, pedido(), VF));
    expect(r.ticket.puedo_marcar_presentes).toBe(true);
    const t = d.decodeTicketDelViaje(await m.mockMarcarPresentes(id, r.ticket.id, { presentes: [yoM.id, miembro('Luis').id] }, VF),
      'viajes.presentes');
    expect(t.personas.filter((p) => p.presente).map((p) => p.miembro_id)).toEqual([yoM.id, miembro('Luis').id]);
  });
});

describe('🔴 mock · V-02 · App Backend 2.179.2: el ticket de un viaje en Cerrados, en sólo lectura con la 7', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('con la 7, 200 y la vista congelada (sin elegir ni marcar, sin repartir 0); hasta la 6, el 409 de siempre', async () => {
    storage();
    const { m, d } = await subject();
    const id = m.VIAJES_SEMILLA.oaxaca;
    const resumen = d.decodeResumenDeViaje(await m.mockResumenDeViaje(id), id);
    expect(resumen.lugares.length).toBeGreaterThan(0);
    const tid = (resumen.lugares[0] as { ticket_id: string }).ticket_id;
    const t = d.decodeTicketDelViaje(await m.mockVerTicket(id, tid, VF));
    expect(t).toMatchObject({ id: tid, puedo_elegir: false, puedo_marcar_presentes: false, sin_repartir_cents: 0 });
    expect(await rechazo(m.mockVerTicket(id, tid, { version: 6 }))).toMatchObject({ status: 409, error: 'viaje_closed' });
    // Elegir sigue cerrado: 409 viaje_not_open.
    expect(await rechazo(m.mockElegirEnTicket(id, tid, { items: [], listo: true }, VF))).toMatchObject({ status: 409, error: 'viaje_not_open' });
  });
});

describe('🔴 D279 · mock con `viaje_version=8` (App Backend 2.180.0)', () => {
  // Sembrado a esta hora: la «publicación» del mock (D282). Sólo se finge el reloj; los `setTimeout` siguen reales.
  const SIEMBRA = new Date('2026-10-13T18:00:00.000Z');
  const DIAS = (n: number) => new Date(SIEMBRA.getTime() + n * 86_400_000);
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SIEMBRA);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('el detalle y la lista suman la hora de cierre; cierra quien lo creó, y sólo abierto', async () => {
    storage();
    const { m, d } = await subject();
    const cancun = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    expect(cancun).toMatchObject({ hora_cierre: '23:59', puedo_cerrar: true });
    // Cancún venció (11/10 a las 23:59 de México) antes de la publicación: no se cierra solo (D282).
    expect(cancun.se_cierra_en).toBeNull();
    const monterrey = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.monterrey, VF));
    expect(monterrey).toMatchObject({ estado: 'esperando_pagos', puedo_cerrar: false, se_cierra_en: null });
    const lista = d.decodeListaDeViajes(await m.mockListarViajes('abiertos', VF), 'abiertos');
    expect(lista.viajes.map((v) => v.hora_cierre)).toEqual(lista.viajes.map(() => '23:59'));
    // La 7 queda como estaba: sin las claves nuevas.
    const v7 = (await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, { version: 7 })) as { viaje: Record<string, unknown> };
    for (const k of ['hora_cierre', 'puedo_cerrar', 'se_cierra_en']) expect(Object.keys(v7.viaje)).not.toContain(k);
  });

  it('quien no lo creó: no cierra (403), no cambia la hora (403), pero ve cuándo se cierra solo y edita el nombre', async () => {
    storage();
    const { m, d } = await subject();
    const mazatlan = d.decodeDetalleViaje(await m.mockAceptarViaje(m.VIAJES_SEMILLA.mazatlan, VF), 'viajes.aceptar');
    expect(mazatlan.puedo_cerrar).toBe(false);
    // 22/12 a las 23:59 de México (UTC−6).
    expect(mazatlan.se_cierra_en).toBe('2026-12-23T05:59:00.000Z');
    expect(await rechazo(m.mockCerrarViaje(m.VIAJES_SEMILLA.mazatlan, VF))).toEqual({ status: 403, error: 'viaje_not_creator', extra: {} });
    expect(await rechazo(m.mockEditarViaje(m.VIAJES_SEMILLA.mazatlan, { hora_cierre: '20:00' }, VF)))
      .toEqual({ status: 403, error: 'viaje_not_creator', extra: {} });
    const editado = d.decodeDetalleViaje(await m.mockEditarViaje(m.VIAJES_SEMILLA.mazatlan, { nombre: 'Mazatlán 2026' }, VF));
    expect(editado).toMatchObject({ nombre: 'Mazatlán 2026', hora_cierre: '23:59' });
  });

  it('D-2 · una fecha hasta que lo dejaría vencido: 403 a quien no lo creó; quien lo creó lo cierra en el mismo pedido', async () => {
    storage();
    const { m, d } = await subject();
    await m.mockAceptarViaje(m.VIAJES_SEMILLA.mazatlan, VF);
    vi.setSystemTime(DIAS(3));
    // 14/10 a las 23:59 de México: después de la publicación (13/10) y antes de ahora (16/10).
    expect(await rechazo(m.mockEditarViaje(m.VIAJES_SEMILLA.mazatlan, { fecha_desde: null, fecha_hasta: '2026-10-14' }, VF)))
      .toEqual({ status: 403, error: 'viaje_not_creator', extra: {} });
    // Una fecha futura, sí.
    expect(d.decodeDetalleViaje(await m.mockEditarViaje(m.VIAJES_SEMILLA.mazatlan, { fecha_hasta: '2026-12-30' }, VF)).fecha_hasta)
      .toBe('2026-12-30');
    // D282 · vencida antes de la publicación (12/10 a las 23:59 de México, antes del 13/10): no lo cerraría, así que vale
    // para cualquiera y el viaje sigue abierto, sin cierre automático.
    const viejo = d.decodeDetalleViaje(await m.mockEditarViaje(m.VIAJES_SEMILLA.mazatlan, { fecha_desde: null, fecha_hasta: '2026-10-12' }, VF));
    expect(viejo).toMatchObject({ estado: 'abierto', fecha_hasta: '2026-10-12', se_cierra_en: null });
    expect(d.decodeDetalleViaje(await m.mockEditarViaje(m.VIAJES_SEMILLA.mazatlan, { fecha_hasta: '2026-12-30' }, VF)).fecha_hasta)
      .toBe('2026-12-30');
    const cancun = d.decodeDetalleViaje(await m.mockEditarViaje(m.VIAJES_SEMILLA.cancun, { fecha_hasta: '2026-10-14' }, VF));
    expect(cancun.estado).not.toBe('abierto');
    expect(cancun).toMatchObject({ puedo_cerrar: false, se_cierra_en: null });
  });

  it('crear con la hora; sin ella, 23:59; una hora mal escrita es 400; la hora entra al hash sólo si vino', async () => {
    storage();
    const { m, d, state } = await subject();
    const amigo = state.friends[0]!;
    const base = { nombre: 'Puebla', fecha_desde: '2026-10-20', fecha_hasta: '2026-10-23', miembros: [{ user_id: amigo.id }] };
    const v = d.decodeDetalleViaje(await m.mockCrearViaje({ ...base, idempotency_key: 'clave-hora-1', hora_cierre: '18:30' }, VF));
    // 23/10 a las 18:30 de México.
    expect(v).toMatchObject({ hora_cierre: '18:30', puedo_cerrar: true, se_cierra_en: '2026-10-24T00:30:00.000Z' });
    const sinHora = d.decodeDetalleViaje(await m.mockCrearViaje({ ...base, idempotency_key: 'clave-hora-2' }, VF));
    expect(sinHora).toMatchObject({ hora_cierre: '23:59', se_cierra_en: '2026-10-24T05:59:00.000Z' });
    const sinFin = d.decodeDetalleViaje(await m.mockCrearViaje({ ...base, fecha_hasta: null, idempotency_key: 'clave-hora-3' }, VF));
    expect(sinFin.se_cierra_en).toBeNull();
    for (const malo of ['24:00', '7:30', '', null]) {
      expect(await rechazo(m.mockCrearViaje({ ...base, idempotency_key: 'clave-hora-4', hora_cierre: malo }, VF)), String(malo))
        .toMatchObject({ status: 400, error: 'validation_error' });
    }
    expect(await rechazo(m.mockCrearViaje({ ...base, idempotency_key: 'clave-hora-2', hora_cierre: '23:59' }, VF)))
      .toMatchObject({ status: 409, error: 'idempotency_key_conflict' });
  });

  it('quien lo creó cambia la hora; null no vale; pasada la hora, el mock deja de anunciarlo (no cierra solo)', async () => {
    storage();
    const { m, d, state } = await subject();
    const amigo = state.friends[0]!;
    const v = d.decodeDetalleViaje(await m.mockCrearViaje({ nombre: 'Puebla', fecha_desde: null, fecha_hasta: '2026-10-14',
      miembros: [{ user_id: amigo.id }], idempotency_key: 'clave-hora-5' }, VF));
    const cambiado = d.decodeDetalleViaje(await m.mockEditarViaje(v.id, { hora_cierre: '20:00' }, VF));
    expect(cambiado).toMatchObject({ hora_cierre: '20:00', se_cierra_en: '2026-10-15T02:00:00.000Z' });
    expect(await rechazo(m.mockEditarViaje(v.id, { hora_cierre: null }, VF))).toMatchObject({ status: 400, error: 'validation_error' });
    vi.setSystemTime(DIAS(2));
    const despues = d.decodeDetalleViaje(await m.mockDetalleViaje(v.id, VF));
    expect(despues).toMatchObject({ estado: 'abierto', se_cierra_en: null });
  });
});

describe('🔴 D278-2 · D284 · mock con `viaje_version=9` (App Backend 2.181.0)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  async function escaneoConServicioEIva() {
    storage({ 'payme.app.mock.n179.ocr.v1': 'servicio_iva' });
    const mock = await import('./mockApi');
    const { m, d } = await subject();
    const ocr = await mock.mockScanTicket({ viaje: true });
    const renglones = ocr.items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
    const iva = ocr.ticket_totals!.tax_cents!;
    const pedido = (clave: string) => ({
      ocr_receipt: ocr.receipt!, idempotency_key: clave, forma: 'iguales', tipo_lugar: 'restaurante',
      lugar: 'Tacos El Güero', fecha_ticket: null, hora_ticket: null,
      items: ocr.items.map((i) => ({ name: i.name, price_cents: i.price_cents, quantity: i.quantity })),
    });
    return { m, d, ocr, renglones, iva, pedido };
  }

  it('un cliente 9 guarda el servicio y el IVA aparte del recibo, reparte el total impreso y lo publica', async () => {
    const { m, d, renglones, iva, pedido } = await escaneoConServicioEIva();
    const antes = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF)).gasto_del_grupo_cents;
    const r = d.decodeTicketCargado(await m.mockCargarTicket(m.VIAJES_SEMILLA.cancun, pedido('clave-ajustes-09'), VF));
    const total = renglones + 8500 + iva;
    expect(r.ticket).toMatchObject({ monto_cents: renglones, servicio_cents: 8500, descuentos_cents: 0, iva_aparte_cents: iva, total_cents: total });
    // Lo pagó quien cargó, el total; en partes iguales entre los cuatro: el total y los platos, por separado.
    expect(r.ticket.pagadores).toEqual([{ miembro_id: expect.any(String), monto_cents: total }]);
    expect(r.ticket.te_toca_cents).toBeGreaterThanOrEqual(Math.floor(total / 4));
    expect(r.ticket.te_toca_cents).toBeLessThanOrEqual(Math.ceil(total / 4));
    expect(r.ticket.te_toca_platos_cents).toBeGreaterThanOrEqual(Math.floor(renglones / 4));
    expect(r.ticket.te_toca_platos_cents).toBeLessThanOrEqual(Math.ceil(renglones / 4));
    // En el viaje, el ticket con su total, y el gasto del grupo lo suma.
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    expect(v.tickets.find((x) => x.id === r.ticket.id)).toMatchObject({ total_cents: total, servicio_cents: 8500 });
    expect(v.gasto_del_grupo_cents).toBe(antes + total);
  });

  it('un cliente 8 no guarda ajustes: el ticket es la suma de los renglones, como siempre', async () => {
    const { m, d, renglones, pedido } = await escaneoConServicioEIva();
    await m.mockCargarTicket(m.VIAJES_SEMILLA.cancun, pedido('clave-ajustes-08'), { version: 8 });
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    const t = v.tickets.find((x) => x.lugar === 'Tacos El Güero')!;
    expect(t).toMatchObject({ monto_cents: renglones, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: renglones });
  });

  it('un cliente 8 con varios pagadores: suman los renglones, como siempre (los ajustes no cuentan)', async () => {
    const { m, d, renglones, pedido } = await escaneoConServicioEIva();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    const [yo, otro] = [v.miembros.find((x) => x.es_yo)!, v.miembros.find((x) => !x.es_yo)!];
    const mitad = Math.floor(renglones / 2);
    await m.mockCargarTicket(m.VIAJES_SEMILLA.cancun, { ...pedido('clave-ajustes-12'),
      pagadores: [{ miembro_id: yo.id, monto_cents: mitad }, { miembro_id: otro.id, monto_cents: renglones - mitad }] }, { version: 8 });
    const t = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF)).tickets.find((x) => x.lugar === 'Tacos El Güero')!;
    expect(t).toMatchObject({ total_cents: renglones, servicio_cents: 0 });
    expect(t.pagadores.map((p) => p.monto_cents)).toEqual([mitad, renglones - mitad]);
  });

  it('con la 9, varios pagadores suman el total impreso; con la suma de los renglones, el 422 dice el total', async () => {
    const { m, d, renglones, iva, pedido } = await escaneoConServicioEIva();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    const [yo, otro] = [v.miembros.find((x) => x.es_yo)!, v.miembros.find((x) => !x.es_yo)!];
    const total = renglones + 8500 + iva;
    const mitad = Math.floor(renglones / 2);
    expect(await rechazo(m.mockCargarTicket(m.VIAJES_SEMILLA.cancun, { ...pedido('clave-ajustes-10'),
      pagadores: [{ miembro_id: yo.id, monto_cents: mitad }, { miembro_id: otro.id, monto_cents: renglones - mitad }] }, VF)))
      .toEqual({ status: 422, error: 'viaje_ticket_payers_total_mismatch', extra: { monto_cents: total } });
    const r = d.decodeTicketCargado(await m.mockCargarTicket(m.VIAJES_SEMILLA.cancun, { ...pedido('clave-ajustes-11'),
      pagadores: [{ miembro_id: yo.id, monto_cents: total - 1000 }, { miembro_id: otro.id, monto_cents: 1000 }] }, VF));
    expect(r.ticket.pagadores.map((p) => p.monto_cents)).toEqual([total - 1000, 1000]);
  });

  it('los tickets viejos, sin importes, se ven como hoy: total = renglones', async () => {
    storage();
    const { m, d } = await subject();
    const v = d.decodeDetalleViaje(await m.mockDetalleViaje(m.VIAJES_SEMILLA.cancun, VF));
    for (const t of v.tickets) {
      expect(t).toMatchObject({ servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: t.monto_cents });
    }
    const mariscos = d.decodeTicketDelViaje(await m.mockVerTicket(m.VIAJES_SEMILLA.cancun, m.VIAJES_SEMILLA.cancunMariscos, VF));
    expect(mariscos.te_toca_platos_cents).toBe(mariscos.te_toca_cents);
  });
});

describe('🔴 D278-2 · el cálculo del mock: el total impreso por mayor resto (port de `viajesCalculo.js` 2.181.0)', () => {
  it('`repartirPorMayorResto`: suma exacta, los centavos a los restos más grandes y, en empate, al primero', async () => {
    const c = await import('./viajesCalculo');
    expect(c.repartirPorMayorResto(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(c.repartirPorMayorResto(1000, [1, 2])).toEqual([333, 667]);
    expect(c.repartirPorMayorResto(10, [3, 0, 7])).toEqual([3, 0, 7]);
    expect(() => c.repartirPorMayorResto(10, [0, 0])).toThrow('viaje_reparto_sin_pesos');
  });

  it('`ajustesDeRecibo`: el IVA aparte sólo si los renglones suman el subtotal; ambiguo, no se agrega', async () => {
    const c = await import('./viajesCalculo');
    const items: Array<[string, number, number]> = [['h', 10000, 1]];
    expect(c.ajustesDeRecibo({ items, totales: { subtotal_cents: 10000, tax_cents: 1600 }, descuentos: null }))
      .toEqual({ servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 1600 });
    // Incluido: los renglones ya suman el subtotal más el IVA.
    expect(c.ajustesDeRecibo({ items, totales: { subtotal_cents: 8621, tax_cents: 1379 }, descuentos: null }).iva_aparte_cents).toBe(0);
    // Subtotal ya descontado.
    expect(c.ajustesDeRecibo({ items, totales: { subtotal_cents: 9500, tax_cents: 1520 }, descuentos: [500], servicios: [800] }))
      .toEqual({ servicio_cents: 800, descuentos_cents: 500, iva_aparte_cents: 1520 });
    // Ambiguo: el descuento es igual al IVA.
    expect(c.ajustesDeRecibo({ items, totales: { subtotal_cents: 8400, tax_cents: 1600 }, descuentos: [1600] }).iva_aparte_cents).toBe(0);
  });

  it('«por lo que pidió cada uno»: el total en proporción a lo elegido; abierto, lo no elegido guarda su parte', async () => {
    const c = await import('./viajesCalculo');
    const t = {
      id: 't', forma: 'consumo' as const, pagado_por: 'a', monto_cents: 10000, servicio_cents: 1000, descuentos_cents: 0, iva_aparte_cents: 0,
      items: [{ id: 'i1', line_cents: 6000 }, { id: 'i2', line_cents: 4000 }],
      personas: [{ user_id: 'a', presente: true, listo: true, vivo: true }, { user_id: 'b', presente: true, listo: false, vivo: true }],
      selecciones: [{ item_id: 'i1', user_id: 'a', fraction_bps: 10000 }],
    };
    const r = c.consumoDelTicket(t);
    expect(r.platos.get('a')).toBe(6000);
    expect(r.consumo.get('a')).toBe(6600);
    expect(r.sinRepartir).toBe(4400);
    const cierre = c.consumoDelTicket(t, { cierre: true });
    expect(cierre.consumo.get('a')! + cierre.consumo.get('b')!).toBe(11000);
    expect(cierre.platos.get('b')).toBe(4000);
  });
});
