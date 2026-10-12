import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aplicarConfigViajes,
  assertViajesHabilitado,
  COLORES_VIAJE,
  decodeCapacidadViajes,
  decodeDetalleViaje,
  decodeFotoDeViaje,
  decodeGastoCargado,
  decodeListaDeViajes,
  decodeMarcaDeTransferencia,
  decodeRevisionDeTicket,
  decodeTicketCorregido,
  decodeTicketDelViaje,
  errorAlCorregir,
  errorAlEliminar,
  errorDeViaje,
  reiniciarViajesParaTests,
  viajesHabilitado,
} from './viajes';
import { MockApiError } from './mock/mockApi';
import { HttpError } from './http';

/**
 * AF-VIAJES · la capacidad y los decodificadores de Viajes, contra el contrato
 * del dueño (`contract-mirror/contract/viajes-v1.json`, App Backend 2.172.0).
 */
const CONTRATO = JSON.parse(readFileSync(new URL('../../contract-mirror/contract/viajes-v1.json', import.meta.url), 'utf8')) as {
  id: string;
  capacidad: { path: string; valor: Record<string, unknown> };
  rutas: Record<string, { respuestas: Record<string, Record<string, unknown>> }>;
  negociaciones: {
    viaje_version_2: { parametro: string; miembro: string[]; ticket: string[] };
    viaje_version_3: { parametro: string; detalle_suma: string[]; lista_suma: string[] };
    viaje_version_4: { parametro: string; ticket_suma: string[] };
    viaje_version_5: { parametro: string; ticket_suma: string[]; detalle_de_ticket_suma: string[] };
    viaje_version_6: { parametro: string; ticket_suma: string[]; detalle_de_ticket_suma: string[] };
    viaje_version_7: { since: string; parametro: string; regla: string; cerrado: string; uso: string };
    viaje_version_8: { since: string; parametro: string; regla: string; detalle_suma: string[]; lista_suma: string[] };
    viaje_version_9: { since: string; parametro: string; regla: string; ticket_suma: string[]; detalle_de_ticket_suma: string[] };
    viaje_version_10: { since: string; parametro: string; regla: string; detalle_de_ticket_suma: string[]; puedo_corregir: string };
    viaje_version_11: { since: string; parametro: string; regla: string; detalle_suma: string[]; notas: string };
  };
  colores: Record<string, string>;
};
const V2 = CONTRATO.negociaciones.viaje_version_2;
/** D255 · App Backend 2.174.0: la 2 más `color` y `has_photo`, en el detalle y en la lista. */
const V3 = CONTRATO.negociaciones.viaje_version_3;
/** D256 · App Backend 2.175.0: la 3 más `puede_eliminar` en cada ticket del detalle. */
const V4 = CONTRATO.negociaciones.viaje_version_4;
/** D263 · App Backend 2.177.0: la 4 más `pagadores`, en los tickets del detalle y en el detalle de un ticket. */
const V5 = CONTRATO.negociaciones.viaje_version_5;
/** D276 · App Backend 2.179.0: la 5 más `presentes` y `personal` en cada ticket, y `personal` en el detalle de un ticket. */
const V6 = CONTRATO.negociaciones.viaje_version_6;
/** D279 · App Backend 2.180.0: la 7 más `hora_cierre`, `puedo_cerrar` y `se_cierra_en` en el viaje, y `hora_cierre` en la lista. */
const V8 = CONTRATO.negociaciones.viaje_version_8;
/** D278-2 · D284 · App Backend 2.181.0: la 8 más los ajustes y el total impreso en cada ticket, y `te_toca_platos_cents`. */
const V9 = CONTRATO.negociaciones.viaje_version_9;
/** D278-3 · App Backend 2.182.0: la 9 más `puedo_corregir` en el detalle de un ticket. */
const V10 = CONTRATO.negociaciones.viaje_version_10;
/** D290 · App Backend 2.183.0: la 10 más `notas` en el detalle del viaje. */
const V11 = CONTRATO.negociaciones.viaje_version_11;

const conf = (viajes: unknown) => ({ features: { viajes } });

describe('la capacidad `features.viajes`', () => {
  afterEach(() => reiniciarViajesParaTests());

  it('encendida sólo con {supported: true, enabled: true}, claves exactas', () => {
    expect(decodeCapacidadViajes(conf({ supported: true, enabled: true }))).toBe(true);
    // La que el dueño sirve desde 2.171.2: encendida.
    expect(CONTRATO.capacidad.path).toBe('features.viajes');
    expect(decodeCapacidadViajes(conf(CONTRATO.capacidad.valor))).toBe(true);
    for (const raro of [
      undefined, null, true, 'true', [], {},
      { supported: true }, { enabled: true },
      { supported: true, enabled: 'true' }, { supported: false, enabled: true },
      { supported: true, enabled: true, por_cuenta: true },
    ]) {
      expect(decodeCapacidadViajes(conf(raro)), JSON.stringify(raro)).toBe(false);
    }
    expect(decodeCapacidadViajes({})).toBe(false);
    expect(decodeCapacidadViajes(null)).toBe(false);
  });

  it('🔴 la fachada no pide nada sin saber o con la capacidad apagada', () => {
    expect(() => assertViajesHabilitado()).toThrow('viajes_not_available');
    aplicarConfigViajes(conf({ supported: true, enabled: false }));
    expect(() => assertViajesHabilitado()).toThrow('viajes_not_available');
    aplicarConfigViajes(conf({ supported: true, enabled: true }));
    expect(() => assertViajesHabilitado()).not.toThrow();
    expect(viajesHabilitado()).toBe(true);
    aplicarConfigViajes({});
    expect(viajesHabilitado()).toBe(false);
  });
});

const persona = (first: string, extra: Record<string, unknown> = {}) =>
  ({ first_name: first, last_name: 'X', username: null, eliminada: false, ...extra });

/** D245 · lo que suma `viaje_version=2` a cada miembro. */
const v2m = (extra: Record<string, unknown> = {}) => ({ has_avatar: false, pagado_cents: 0, ...extra });

const detalle = (cambios: Record<string, unknown> = {}) => ({
  id: 'v1', nombre: 'Cancún', fecha_desde: '2026-10-05', fecha_hasta: null, estado: 'abierto',
  creado_en: '2026-10-01T15:00:00.000Z', mi_miembro_id: 'm1',
  miembros: [
    { id: 'm1', ...persona('Yo'), ...v2m(), es_yo: true, balance_cents: -100, falta_elegir: 0 },
    { id: 'm2', ...persona('Luis'), ...v2m({ has_avatar: true, pagado_cents: 200 }), es_yo: false, balance_cents: 100, falta_elegir: 1 },
  ],
  invitados: [], mi_balance_cents: -100, gasto_del_grupo_cents: 200,
  tickets: [{ id: 't1', lugar: null, tipo_lugar: 'bar', fecha_ticket: null, hora_ticket: null,
    cargado_en: '2026-10-02T00:00:00.000Z', forma: 'consumo', pagado_por: 'm2', pagaste_tu: false,
    te_toca_cents: 100, falta_que_elija: 1, sin_repartir_cents: 0, monto_cents: 200, origen: 'escaneo', puede_eliminar: false,
    pagadores: [{ miembro_id: 'm2', monto_cents: 200 }], presentes: ['m1', 'm2'], personal: false, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 200 }],
  sin_repartir: [], transferencias: [], transferencias_pendientes: 0,
  color: null, has_photo: false,
  // D279 · v8: cierra quien lo creó, sólo abierto.
  hora_cierre: '23:59', puedo_cerrar: (cambios.estado ?? 'abierto') === 'abierto', se_cierra_en: null,
  // D290 · v11: el resumen del pizarrón de notas.
  notas: { escribieron: 1, total: 2, nuevo: false },
  ...cambios,
});

describe('decodificadores · claves exactas, `contract` exacto, falla cerrado', () => {
  it('el detalle de un viaje: las claves del contrato con `viaje_version=11`, ni una más', () => {
    const claves = CONTRATO.rutas['GET /api/viajes/:id']!.respuestas['200']!.viaje as string[];
    expect(Object.keys(detalle()).sort()).toEqual([...claves, ...V3.detalle_suma, ...V8.detalle_suma, ...V11.detalle_suma].sort());
    expect(V8.parametro).toBe('viaje_version=8');
    expect(V2.parametro).toBe('viaje_version=2');
    expect(V3.parametro).toBe('viaje_version=3');
    expect(V4.parametro).toBe('viaje_version=4');
    expect(Object.keys(detalle().miembros[0]!).sort()).toEqual([...V2.miembro].sort());
    expect(V5.parametro).toBe('viaje_version=5');
    expect(V6.parametro).toBe('viaje_version=6');
    expect(Object.keys(detalle().tickets[0]!).sort())
      .toEqual([...V2.ticket, ...V4.ticket_suma, ...V5.ticket_suma, ...V6.ticket_suma, ...V9.ticket_suma].sort());
    expect(V9.parametro).toBe('viaje_version=9');
    const v = decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle() });
    expect(v.miembros.map((m) => m.first_name)).toEqual(['Yo', 'Luis']);
    expect(() => decodeDetalleViaje({ contract: 'otro/v1', viaje: detalle() })).toThrow();
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: { ...detalle(), saldo: 0 } })).toThrow();
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle(), extra: 1 })).toThrow();
    // Un importe con decimales no es un importe del dueño.
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({ mi_balance_cents: -1.5 }) })).toThrow();
  });

  it('🔴 cerrado: el balance de los demás llega en null, y uno ajeno con número es otra semántica (D240-17)', () => {
    const cerrado = detalle({
      estado: 'cerrado',
      miembros: [
        { id: 'm1', ...persona('Yo'), ...v2m(), es_yo: true, balance_cents: 0, falta_elegir: 0 },
        { id: 'm2', ...persona('Luis'), ...v2m({ pagado_cents: null }), es_yo: false, balance_cents: null, falta_elegir: 0 },
      ],
    });
    expect(decodeDetalleViaje({ contract: CONTRATO.id, viaje: cerrado }).miembros[1]!.balance_cents).toBeNull();
    expect(decodeDetalleViaje({ contract: CONTRATO.id, viaje: cerrado }).miembros[1]!.pagado_cents).toBeNull();
    // Abierto, un balance en null no vale.
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: { ...cerrado, estado: 'abierto' } })).toThrow();
    // D245 · lo que pagó sigue al balance: nulo donde el balance es nulo, y en ningún otro lado.
    const conPagado = { ...cerrado, miembros: [cerrado.miembros[0], { ...cerrado.miembros[1], pagado_cents: 500 }] };
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: conPagado })).toThrow();
    const sinPagadoPropio = { ...cerrado, miembros: [{ ...cerrado.miembros[0], pagado_cents: null }, cerrado.miembros[1]] };
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: sinPagadoPropio })).toThrow();
  });

  it('una cuenta eliminada nunca muestra su @', () => {
    const v = decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({
      miembros: [
        { id: 'm1', ...persona('Yo'), ...v2m(), es_yo: true, balance_cents: 0, falta_elegir: 0 },
        { id: 'm2', ...persona('Luis', { eliminada: true, username: 'luis' }), ...v2m(), es_yo: false, balance_cents: 0, falta_elegir: 0 },
      ],
    }) });
    expect(v.miembros[1]!.username).toBeNull();
  });

  it('la lista: Abiertos no trae cerrados y lo que no aplica llega en null', () => {
    const item = { id: 'v', nombre: 'A', fecha_desde: null, fecha_hasta: null, estado: 'abierto', personas: 2,
      mi_balance_cents: 0, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null,
      color: null, has_photo: false, hora_cierre: '23:59' };
    const claves = CONTRATO.rutas['GET /api/viajes']!.respuestas['200']!.viaje as string[];
    expect(Object.keys(item).sort()).toEqual([...claves, ...V3.lista_suma, ...V8.lista_suma].sort());
    const r = decodeListaDeViajes({ contract: CONTRATO.id, viajes: [item], counts: { abiertos: 1, cerrados: 0 } }, 'abiertos');
    expect(r.counts).toEqual({ abiertos: 1, cerrados: 0 });
    expect(() => decodeListaDeViajes({ contract: CONTRATO.id, viajes: [item], counts: { abiertos: 1, cerrados: 0 } }, 'cerrados')).toThrow();
    expect(() => decodeListaDeViajes({ contract: CONTRATO.id, viajes: [{ ...item, consumiste_cents: 5 }], counts: { abiertos: 1, cerrados: 0 } }, 'abiertos')).toThrow();
  });

  it('el ticket: nunca un plato con más del entero ni lo mío por encima de la línea', () => {
    const ticket = { id: 't', lugar: 'X', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
      cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', monto_cents: 1000, pagado_por: 'm2', pagaste_tu: false,
      items: [{ id: 'i', name: 'Taco', price_cents: 500, quantity: 2, line_cents: 1000, remaining_bps: 5000, my_bps: 5000, my_amount_cents: 500 }],
      personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }],
      te_toca_cents: 500, sin_repartir_cents: 500, puedo_elegir: true, puedo_marcar_presentes: false,
      pagadores: [{ miembro_id: 'm2', monto_cents: 1000 }], personal: false, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 1000, te_toca_platos_cents: 500, puedo_corregir: false };
    const claves = CONTRATO.rutas['GET /api/viajes/:id/tickets/:tid']!.respuestas['200']!.ticket as string[];
    expect(Object.keys(ticket).sort())
      .toEqual([...claves, ...V5.detalle_de_ticket_suma, ...V6.detalle_de_ticket_suma, ...V9.detalle_de_ticket_suma,
        ...V10.detalle_de_ticket_suma].sort());
    expect(decodeTicketDelViaje({ contract: CONTRATO.id, ticket }).items[0]!.my_amount_cents).toBe(500);
    const malo = { ...ticket, items: [{ ...ticket.items[0]!, remaining_bps: 10001 }] };
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: malo })).toThrow();
    const hora = { ...ticket, hora_ticket: '25:00' };
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: hora })).toThrow();
  });

  it('el duplicado (1k) y la marca de una transferencia', () => {
    expect(decodeRevisionDeTicket({ contract: CONTRATO.id, duplicado: null })).toBeNull();
    const d = decodeRevisionDeTicket({ contract: CONTRATO.id, duplicado: {
      ticket_id: 't', por: 'm2', ...persona('Luis'), en: '2026-10-09T03:40:00.000Z' } });
    expect(d).toMatchObject({ ticket_id: 't', por: 'm2', first_name: 'Luis' });
    const tr = { id: 'tr', de: 'm1', a: 'm2', monto_cents: 54200, estado: 'marcada', mia: 'debo' };
    expect(decodeMarcaDeTransferencia({ contract: CONTRATO.id, transferencia: tr, viaje_estado: 'esperando_pagos',
      transferencias_pendientes: 3 }, 'tr').transferencia.estado).toBe('marcada');
    expect(() => decodeMarcaDeTransferencia({ contract: CONTRATO.id, transferencia: tr, viaje_estado: 'esperando_pagos',
      transferencias_pendientes: 3 }, 'otra')).toThrow();
  });
});

describe('D245 · `viaje_version=2`: las claves nuevas sólo con la negociación', () => {
  const sinClave = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

  it('🔴 la forma de siempre (sin la negociación) no se acepta: la app la pide siempre', () => {
    const v = detalle();
    for (const k of ['has_avatar', 'pagado_cents']) {
      const sin = { ...v, miembros: v.miembros.map((x) => sinClave(x, k)) };
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: sin }), k).toThrow();
    }
    for (const k of ['monto_cents', 'origen']) {
      const sin = { ...v, tickets: v.tickets.map((x) => sinClave(x, k)) };
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: sin }), k).toThrow();
    }
  });

  it('cada clave nueva con su tipo: foto booleana, montos enteros no negativos y el origen del contrato', () => {
    const v = detalle();
    const conMiembro = (cambios: Record<string, unknown>) =>
      ({ ...v, miembros: [{ ...v.miembros[0], ...cambios }, v.miembros[1]] });
    const conTicket = (cambios: Record<string, unknown>) => ({ ...v, tickets: [{ ...v.tickets[0], ...cambios }] });
    for (const malo of [conMiembro({ has_avatar: 'true' }), conMiembro({ has_avatar: null }), conMiembro({ pagado_cents: -1 }),
      conMiembro({ pagado_cents: 1.5 }), conTicket({ monto_cents: -1 }), conTicket({ monto_cents: '200' }),
      conTicket({ origen: 'ocr' }), conTicket({ origen: null })]) {
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: malo })).toThrow();
    }
    // D278-2 · con la 9 el total impreso es positivo (`totalDelTicket` del dueño lanza con 0): un ticket de $0 no llega.
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: conTicket({ origen: 'manual', monto_cents: 0, total_cents: 0,
      pagadores: [{ miembro_id: 'm2', monto_cents: 0 }] }) })).toThrow();
    const d = decodeDetalleViaje({ contract: CONTRATO.id, viaje: conTicket({ origen: 'manual', monto_cents: 1, total_cents: 1,
      pagadores: [{ miembro_id: 'm2', monto_cents: 1 }] }) });
    expect(d.tickets[0]).toMatchObject({ origen: 'manual', monto_cents: 1 });
    expect(d.miembros[1]).toMatchObject({ has_avatar: true, pagado_cents: 200 });
  });
});

describe('D244 · el gasto a mano: `POST …/gastos`', () => {
  const ticket = {
    id: 't', lugar: 'Gasolina', tipo_lugar: 'otro', fecha_ticket: null, hora_ticket: null,
    cargado_en: '2026-10-09T17:00:00.000Z', forma: 'iguales', monto_cents: 90000, pagado_por: 'm1', pagaste_tu: true,
    items: [{ id: 'i', name: 'Gasolina', price_cents: 90000, quantity: 1, line_cents: 90000, remaining_bps: 0, my_bps: 0, my_amount_cents: 0 }],
    personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }, { miembro_id: 'm2', ya_eligio: true, presente: true }],
    te_toca_cents: 45000, sin_repartir_cents: 0, puedo_elegir: false, puedo_marcar_presentes: true,
    pagadores: [{ miembro_id: 'm1', monto_cents: 90000 }], personal: false, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 90000, te_toca_platos_cents: 45000, puedo_corregir: true,
  };

  it('responde como un ticket, con `ya_cargado` nulo: el pedido y la respuesta del contrato', () => {
    const ruta = CONTRATO.rutas['POST /api/viajes/:id/gastos'] as unknown as {
      request: Record<string, string>; respuestas: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(ruta.request).sort()).toEqual(['descripcion', 'idempotency_key', 'monto_cents', 'pagado_por', 'pagadores', 'presentes']);
    expect(ruta.respuestas['201']!.claves).toEqual(['contract', 'ticket', 'ya_cargado']);
    expect(decodeGastoCargado({ contract: CONTRATO.id, ticket, ya_cargado: null })).toMatchObject({ id: 't', monto_cents: 90000 });
  });

  it('🔴 D255-6 · con «pagó otro», el gasto vuelve con ese miembro y no conmigo; sin pedirlo, conmigo', () => {
    const deLuis = { ...ticket, pagado_por: 'm2', pagaste_tu: false, pagadores: [{ miembro_id: 'm2', monto_cents: 90000 }] };
    expect(decodeGastoCargado({ contract: CONTRATO.id, ticket: deLuis, ya_cargado: null }, { pagado_por: 'm2' })).toMatchObject({ pagado_por: 'm2' });
    // Lo pedido manda: si vuelve otro pagador, o yo, no es lo que se pidió.
    expect(() => decodeGastoCargado({ contract: CONTRATO.id, ticket: deLuis, ya_cargado: null }, { pagado_por: 'm3' })).toThrow();
    expect(() => decodeGastoCargado({ contract: CONTRATO.id, ticket, ya_cargado: null }, { pagado_por: 'm2' })).toThrow();
    expect(() => decodeGastoCargado({ contract: CONTRATO.id, ticket: deLuis, ya_cargado: null })).toThrow();
  });

  it('🔴 falla cerrado ante lo que un gasto a mano no es', () => {
    for (const malo of [
      { contract: CONTRATO.id, ticket, ya_cargado: { por: 'm1', en: null } },
      { contract: CONTRATO.id, ticket },
      { contract: CONTRATO.id, ticket: { ...ticket, forma: 'consumo' }, ya_cargado: null },
      { contract: CONTRATO.id, ticket: { ...ticket, tipo_lugar: 'bar' }, ya_cargado: null },
      { contract: CONTRATO.id, ticket: { ...ticket, pagaste_tu: false }, ya_cargado: null },
      { contract: 'otro/v1', ticket, ya_cargado: null },
    ]) {
      expect(() => decodeGastoCargado(malo)).toThrow();
    }
  });

  it('alguien de los elegidos que ya no está: 422 propio; la clave repetida con otro pedido: reintentar', () => {
    expect(errorDeViaje(new HttpError(422, { error: 'viaje_ticket_persona_unknown', miembro_id: 'm9' })))
      .toEqual({ tipo: 'persona_desconocida' });
    expect(errorDeViaje(new MockApiError(422, 'viaje_ticket_persona_unknown', { miembro_id: 'm9' })))
      .toEqual({ tipo: 'persona_desconocida' });
    expect(errorDeViaje(new MockApiError(409, 'idempotency_key_conflict'))).toEqual({ tipo: 'reintentar' });
  });
});

describe('H02 · salir después de pagar (App Backend 2.172.1)', () => {
  it('409 `viaje_member_transfers_pending` dice cuántas faltan; sin un número válido, reintentar', () => {
    expect(errorDeViaje(new HttpError(409, { error: 'viaje_member_transfers_pending', pendientes: 2 })))
      .toEqual({ tipo: 'transferencias_pendientes', pendientes: 2 });
    expect(errorDeViaje(new MockApiError(409, 'viaje_member_transfers_pending', { pendientes: 1 })))
      .toEqual({ tipo: 'transferencias_pendientes', pendientes: 1 });
    for (const malo of [undefined, 0, -1, 1.5, '2']) {
      expect(errorDeViaje(new MockApiError(409, 'viaje_member_transfers_pending', { pendientes: malo })), String(malo))
        .toEqual({ tipo: 'reintentar' });
    }
  });

  it('el contrato: los dos errores de salir y la nota de D242-1', () => {
    const r = CONTRATO.rutas['POST /api/viajes/:id/salir'] as unknown as { respuestas: Record<string, Record<string, unknown>> };
    expect(r.respuestas['409']!.errores).toEqual(['viaje_member_cannot_leave', 'viaje_member_transfers_pending']);
    expect(r.respuestas['409']!.viaje_member_transfers_pending).toEqual(['error', 'pendientes']);
  });
});

describe('errorDeViaje · lo que dice la pantalla', () => {
  it('el 404 es uno solo (n325), en el mock y en el real', () => {
    expect(errorDeViaje(new MockApiError(404, 'viaje_not_found'))).toEqual({ tipo: 'no_disponible' });
    expect(errorDeViaje(new HttpError(404, { error: 'viaje_not_found' }))).toEqual({ tipo: 'no_disponible' });
  });

  it('salir con consumos dice por qué; un motivo desconocido no se inventa', () => {
    expect(errorDeViaje(new MockApiError(409, 'viaje_member_cannot_leave', { reason: 'selection' })))
      .toEqual({ tipo: 'no_puede_salir', motivo: 'selection' });
    expect(errorDeViaje(new MockApiError(409, 'viaje_member_cannot_leave', { reason: 'otro' }))).toEqual({ tipo: 'reintentar' });
  });

  it('el @ que no se encontró viene tal como se pidió', () => {
    expect(errorDeViaje(new HttpError(422, { error: 'viaje_member_not_found', member: { username: 'ana' } })))
      .toEqual({ tipo: 'miembro_no_encontrado', username: 'ana' });
    expect(errorDeViaje(new MockApiError(422, 'viaje_member_not_found', { member: { user_id: 'x' } })))
      .toEqual({ tipo: 'miembro_no_encontrado', username: null });
    expect(errorDeViaje(new MockApiError(429, 'viajes_rate_limited'))).toEqual({ tipo: 'demasiadas_invitaciones' });
    expect(errorDeViaje(new Error('red'))).toEqual({ tipo: 'reintentar' });
  });
});

describe('una cuenta sin apellido', () => {
  it('el apellido vacío del dueño se lee como «sin dato», no rompe el viaje', () => {
    const v = decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({
      miembros: [
        { id: 'm1', ...persona('Mati', { last_name: '' }), ...v2m(), es_yo: true, balance_cents: -100, falta_elegir: 0 },
        { id: 'm2', ...persona('Luis'), ...v2m(), es_yo: false, balance_cents: 100, falta_elegir: 1 },
      ],
    }) });
    expect(v.miembros[0]!.last_name).toBeNull();
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({
      miembros: [{ id: 'm1', ...persona('Mati', { last_name: 7 }), ...v2m(), es_yo: true, balance_cents: -100, falta_elegir: 0 }],
    }) })).toThrow();
  });
});

describe('🔴 D255 · `viaje_version=3`: color y foto del viaje (App Backend 2.174.0)', () => {
  const sinClave = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
  const item = (cambios: Record<string, unknown> = {}) => ({ id: 'v', nombre: 'A', fecha_desde: null, fecha_hasta: null,
    estado: 'abierto', personas: 2, mi_balance_cents: 0, transferencias_pendientes: null, consumiste_cents: null,
    terminado_en: null, color: null, has_photo: false, hora_cierre: '23:59', ...cambios });
  const lista = (i: Record<string, unknown>) => ({ contract: CONTRATO.id, viajes: [i], counts: { abiertos: 1, cerrados: 0 } });

  it('la paleta es la del contrato, con sus hex', () => {
    expect(COLORES_VIAJE).toEqual(CONTRATO.colores);
  });

  it('sin `color` o sin `has_photo` (la forma de la 2) no se acepta: la app pide la 3 siempre', () => {
    for (const k of V3.detalle_suma) {
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: sinClave(detalle(), k) }), k).toThrow();
    }
    for (const k of V3.lista_suma) {
      expect(() => decodeListaDeViajes(lista(sinClave(item(), k)), 'abiertos'), k).toThrow();
    }
  });

  it('el color es una clave de la paleta o null; la foto, un booleano', () => {
    for (const c of Object.keys(CONTRATO.colores)) {
      expect(decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({ color: c }) }).color).toBe(c);
      expect(decodeListaDeViajes(lista(item({ color: c })), 'abiertos').viajes[0]!.color).toBe(c);
    }
    expect(decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({ has_photo: true }) }).has_photo).toBe(true);
    for (const malo of [{ color: 'fucsia' }, { color: '#1D4ED8' }, { color: '' }, { has_photo: 'true' }, { has_photo: null }]) {
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle(malo) }), JSON.stringify(malo)).toThrow();
      expect(() => decodeListaDeViajes(lista(item(malo)), 'abiertos'), JSON.stringify(malo)).toThrow();
    }
  });

  it('la foto subida: `{ foto: { revision, width, height, updated_at } }`, claves exactas', () => {
    const ruta = CONTRATO.rutas['PUT /api/viajes/:id/foto']!.respuestas['201']! as { foto: string[] };
    const foto = { revision: 1, width: 512, height: 384, updated_at: '2026-10-10T03:00:00.000Z' };
    expect(Object.keys(foto).sort()).toEqual([...ruta.foto].sort());
    expect(decodeFotoDeViaje({ foto })).toEqual(foto);
    for (const malo of [{}, { foto, contract: CONTRATO.id }, { foto: { ...foto, extra: 1 } }, { foto: { ...foto, revision: -1 } },
      { foto: { ...foto, updated_at: 'ayer' } }]) {
      expect(() => decodeFotoDeViaje(malo), JSON.stringify(malo)).toThrow();
    }
  });

  it('los errores nuevos: quién pagó no vale, la foto ocupada o inválida', () => {
    const err = (status: number, code: string, extra: Record<string, unknown> = {}) => new MockApiError(status, code, extra);
    expect(errorDeViaje(err(422, 'viaje_ticket_payer_unknown', { miembro_id: 'm9' }))).toEqual({ tipo: 'pagador_desconocido' });
    expect(errorDeViaje(err(429, 'viaje_photo_rate_limited'))).toEqual({ tipo: 'foto_ocupada' });
    expect(errorDeViaje(err(429, 'avatar_processing_busy'))).toEqual({ tipo: 'foto_ocupada' });
    for (const [s, c] of [[413, 'avatar_input_too_large'], [415, 'avatar_media_type_unsupported'], [400, 'avatar_file_required'],
      [422, 'avatar_dimensions_exceeded']] as const) {
      expect(errorDeViaje(err(s, c))).toEqual({ tipo: 'foto_invalida' });
    }
  });
});

describe('🔴 D256 · `viaje_version=4`: eliminar un ticket o un gasto (App Backend 2.175.0)', () => {
  const sinClave = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
  const conTicket = (cambios: Record<string, unknown>) => {
    const v = detalle();
    return { ...v, tickets: [{ ...v.tickets[0], ...cambios }] };
  };

  it('lo que suma la 4 es `puede_eliminar`, sólo en los tickets del detalle', () => {
    expect(V4.ticket_suma).toEqual(['puede_eliminar']);
  });

  it('sin `puede_eliminar` (la forma de la 3) no se acepta: la app pide la 4 siempre', () => {
    const v = detalle();
    const sin = { ...v, tickets: v.tickets.map((x) => sinClave(x, 'puede_eliminar')) };
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: sin })).toThrow();
  });

  it('`puede_eliminar` es un booleano', () => {
    for (const malo of ['true', 1, null]) {
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: conTicket({ puede_eliminar: malo }) }), String(malo)).toThrow();
    }
    expect(decodeDetalleViaje({ contract: CONTRATO.id, viaje: conTicket({ puede_eliminar: true }) }).tickets[0]!.puede_eliminar).toBe(true);
    expect(decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle() }).tickets[0]!.puede_eliminar).toBe(false);
  });

  it('las respuestas de `DELETE …/tickets/:tid` son las del contrato', () => {
    const r = (CONTRATO.rutas['DELETE /api/viajes/:id/tickets/:tid'] as unknown as { respuestas: Record<string, { errores?: string[] }> }).respuestas;
    expect(r['403']!.errores).toEqual(['viaje_ticket_delete_forbidden', 'user_suspended']);
    expect(r['404']!.errores).toEqual(['viaje_not_found', 'viaje_ticket_not_found']);
    expect(r['409']!.errores).toEqual(['viaje_not_open']);
  });

  it('🔴 errorAlEliminar: el 403 y el 404 del ticket son propios; el 404 del viaje y el 409, los de siempre', () => {
    const e = (status: number, error: string, extra: Record<string, unknown> = {}) => new HttpError(status, { error, ...extra });
    expect(errorAlEliminar(e(403, 'viaje_ticket_delete_forbidden'))).toEqual({ tipo: 'eliminar_prohibido' });
    expect(errorAlEliminar(e(404, 'viaje_ticket_not_found'))).toEqual({ tipo: 'ticket_no_encontrado' });
    expect(errorAlEliminar(e(404, 'viaje_not_found'))).toEqual({ tipo: 'no_disponible' });
    expect(errorAlEliminar(e(409, 'viaje_not_open', { estado: 'esperando_pagos' }))).toEqual({ tipo: 'no_abierto' });
    expect(errorAlEliminar(e(503, 'service_unavailable'))).toEqual({ tipo: 'reintentar' });
    // En las demás pantallas, el 404 del ticket sigue siendo «no disponible».
    expect(errorDeViaje(e(404, 'viaje_ticket_not_found'))).toEqual({ tipo: 'no_disponible' });
  });
});

describe('🔴 D263 · `viaje_version=5`: varios pagadores (App Backend 2.177.0)', () => {
  const conPagadores = (pagadores: unknown, extra: Record<string, unknown> = {}) => {
    const v = detalle();
    return { ...v, tickets: [{ ...v.tickets[0], pagadores, ...extra }] };
  };
  const decode = (viaje: unknown) => decodeDetalleViaje({ contract: CONTRATO.id, viaje });

  it('lo que suma la 5 es `pagadores`, en la lista del detalle y en el detalle de un ticket', () => {
    expect(V5.ticket_suma).toEqual(['pagadores']);
    expect(V5.detalle_de_ticket_suma).toEqual(['pagadores']);
  });

  it('varios: cada uno con su monto, suman el total y el primero es `pagado_por`', () => {
    const t = decode(conPagadores([{ miembro_id: 'm2', monto_cents: 150 }, { miembro_id: 'm1', monto_cents: 50 }])).tickets[0]!;
    expect(t.pagadores).toEqual([{ miembro_id: 'm2', monto_cents: 150 }, { miembro_id: 'm1', monto_cents: 50 }]);
    // Una cuenta que ya no está: `null`, como `pagado_por`.
    expect(decode(conPagadores([{ miembro_id: null, monto_cents: 200 }], { pagado_por: null })).tickets[0]!.pagadores[0]!.miembro_id).toBeNull();
  });

  it('🔴 lo que no es del dueño no entra', () => {
    for (const malo of [
      undefined, [], {}, null,
      [{ miembro_id: 'm2', monto_cents: 100 }],
      [{ miembro_id: 'm2', monto_cents: 150 }, { miembro_id: 'm1', monto_cents: 60 }],
      [{ miembro_id: 'm1', monto_cents: 100 }, { miembro_id: 'm2', monto_cents: 100 }],
      [{ miembro_id: 'm2', monto_cents: 200, extra: 1 }],
      [{ miembro_id: 'm2' }],
      [{ miembro_id: 'm2', monto_cents: 200.5 }],
      [{ miembro_id: 'm2', monto_cents: -1 }, { miembro_id: 'm1', monto_cents: 201 }],
      Array.from({ length: 21 }, (_, i) => ({ miembro_id: i === 0 ? 'm2' : `x${i}`, monto_cents: i === 0 ? 180 : 1 })),
    ]) {
      const v = malo === undefined ? (() => { const d = detalle(); const { pagadores: _, ...t } = d.tickets[0]!; return { ...d, tickets: [t] }; })()
        : conPagadores(malo);
      expect(() => decode(v), JSON.stringify(malo)).toThrow();
    }
  });

  it('🔴 el gasto cargado con varios: los mismos, en el mismo orden, con los montos pedidos', () => {
    const gasto = (pagadores: unknown, pagaste_tu = true) => ({
      contract: CONTRATO.id, ya_cargado: null,
      ticket: {
        id: 't', lugar: 'Gasolina', tipo_lugar: 'otro', fecha_ticket: null, hora_ticket: null, cargado_en: null,
        forma: 'iguales', monto_cents: 90000, pagado_por: 'm1', pagaste_tu,
        items: [{ id: 'i', name: 'Gasolina', price_cents: 90000, quantity: 1, line_cents: 90000, remaining_bps: 0, my_bps: 0, my_amount_cents: 0 }],
        personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }], te_toca_cents: 0, sin_repartir_cents: 0,
        puedo_elegir: false, puedo_marcar_presentes: true, pagadores, personal: false, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 90000, te_toca_platos_cents: 0, puedo_corregir: true,
      },
    });
    const dos = [{ miembro_id: 'm1', monto_cents: 45000 }, { miembro_id: 'm2', monto_cents: 45000 }];
    expect(decodeGastoCargado(gasto(dos), { pagadores: [{ miembro_id: 'm1' }, { miembro_id: 'm2' }] }).pagadores).toEqual(dos);
    // Otro orden u otros: no es lo pedido.
    expect(() => decodeGastoCargado(gasto(dos), { pagadores: [{ miembro_id: 'm2' }, { miembro_id: 'm1' }] })).toThrow();
    expect(() => decodeGastoCargado(gasto(dos), { pagadores: [{ miembro_id: 'm1' }, { miembro_id: 'm3' }] })).toThrow();
    expect(() => decodeGastoCargado(gasto(dos), { pagadores: [{ miembro_id: 'm1' }] })).toThrow();
    // Con montos pedidos, los mismos montos.
    const ajustados = [{ miembro_id: 'm1', monto_cents: 60000 }, { miembro_id: 'm2', monto_cents: 30000 }];
    expect(decodeGastoCargado(gasto(ajustados), { pagadores: ajustados }).pagadores).toEqual(ajustados);
    expect(() => decodeGastoCargado(gasto(dos), { pagadores: ajustados })).toThrow();
  });

  it('🔴 errorDeViaje · el 422 de montos que no suman, con el total del dueño', () => {
    expect(errorDeViaje(new HttpError(422, { error: 'viaje_ticket_payers_total_mismatch', monto_cents: 90000 })))
      .toEqual({ tipo: 'pagadores_no_suman', totalCents: 90000 });
    expect(errorDeViaje(new HttpError(422, { error: 'viaje_ticket_payers_total_mismatch' })))
      .toEqual({ tipo: 'pagadores_no_suman', totalCents: null });
  });
});

describe('🔴 D276 · `viaje_version=6`: quiénes estuvieron y el gasto personal (App Backend 2.179.0)', () => {
  const decode = (viaje: unknown) => decodeDetalleViaje({ contract: CONTRATO.id, viaje });
  const conTicket = (extra: Record<string, unknown>) => {
    const v = detalle();
    return { ...v, tickets: [{ ...v.tickets[0], ...extra }] };
  };
  const ticket = (extra: Record<string, unknown> = {}) => ({
    id: 't', lugar: 'X', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', monto_cents: 1000, pagado_por: 'm1', pagaste_tu: true,
    items: [{ id: 'i', name: 'Taco', price_cents: 1000, quantity: 1, line_cents: 1000, remaining_bps: 10000, my_bps: 0, my_amount_cents: 0 }],
    personas: [{ miembro_id: 'm1', ya_eligio: false, presente: true }],
    te_toca_cents: 1000, sin_repartir_cents: 0, puedo_elegir: false, puedo_marcar_presentes: true,
    pagadores: [{ miembro_id: 'm1', monto_cents: 1000 }], personal: true, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 1000, te_toca_platos_cents: 1000, puedo_corregir: true, ...extra,
  });

  it('lo que suma la 6: `presentes` y `personal` en cada ticket del detalle, `personal` en el de un ticket', () => {
    expect(V6.ticket_suma).toEqual(['presentes', 'personal']);
    expect(V6.detalle_de_ticket_suma).toEqual(['personal']);
  });

  it('`presentes`: ids de miembro en orden, y una cuenta que ya no está (`null`) no se cuenta', () => {
    expect(decode(conTicket({ presentes: ['m2', null, 'm1'] })).tickets[0]!.presentes).toEqual(['m2', 'm1']);
    expect(decode(conTicket({ presentes: [] })).tickets[0]!.presentes).toEqual([]);
  });

  it('🔴 lo que no es del dueño no entra: un id repetido, de más de 40, no texto, o `personal` que no es booleano', () => {
    for (const malo of [
      { presentes: ['m1', 'm1'] },
      { presentes: Array.from({ length: 41 }, (_, i) => `m${i}`) },
      { presentes: [1] },
      { presentes: 'm1' },
      { personal: 'no' },
      { personal: null },
    ]) expect(() => decode(conTicket(malo)), JSON.stringify(malo)).toThrow();
  });

  it('🔴 el detalle de un personal nunca se elige: `personal` con `puedo_elegir` es otra semántica', () => {
    expect(decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket() }).personal).toBe(true);
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ puedo_elegir: true }) })).toThrow();
    // Compartido y elegible, como siempre.
    expect(decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ personal: false, puedo_elegir: true }) }).puedo_elegir)
      .toBe(true);
  });

  it('🔴 errorDeViaje · los 409 nuevos: quién ya eligió (con su `miembro_id`), el no presente y el personal', () => {
    expect(errorDeViaje(new HttpError(409, { error: 'viaje_ticket_persona_ya_eligio', miembro_id: 'm2' })))
      .toEqual({ tipo: 'persona_ya_eligio', miembroId: 'm2' });
    expect(errorDeViaje(new MockApiError(409, 'viaje_ticket_persona_ya_eligio', { miembro_id: 'm2' })))
      .toEqual({ tipo: 'persona_ya_eligio', miembroId: 'm2' });
    expect(errorDeViaje(new HttpError(409, { error: 'viaje_ticket_persona_ya_eligio', miembro_id: null })))
      .toEqual({ tipo: 'persona_ya_eligio', miembroId: null });
    expect(errorDeViaje(new HttpError(409, { error: 'viaje_ticket_not_present' }))).toEqual({ tipo: 'no_presente' });
    expect(errorDeViaje(new MockApiError(409, 'viaje_ticket_personal'))).toEqual({ tipo: 'personal' });
    // Con otro status, no es lo mismo.
    expect(errorDeViaje(new HttpError(422, { error: 'viaje_ticket_not_present' }))).toEqual({ tipo: 'reintentar' });
  });
});

describe('🔴 V-02 · `viaje_version=7` (App Backend 2.179.2): la 6 sin claves nuevas', () => {
  const V7 = CONTRATO.negociaciones.viaje_version_7;

  it('el parámetro exacto y lo que cambia: el detalle de un ticket con el viaje en Cerrados, en sólo lectura', () => {
    expect(V7.parametro).toBe('viaje_version=7');
    expect(V7.since).toBe('2.179.2');
    expect(V7.regla).toContain('sin claves nuevas');
    expect(V7.cerrado).toContain('`puedo_elegir` y `puedo_marcar_presentes` en false');
    expect(V7.uso).toContain('stats_version=2');
  });

  it('el detalle en sólo lectura se decodifica con la forma de la 6, tal cual', () => {
    const ticket = {
      id: 't', lugar: 'Mariscos', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
      cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', monto_cents: 1000, pagado_por: 'm2', pagaste_tu: false,
      items: [{ id: 'i', name: 'Taco', price_cents: 1000, quantity: 1, line_cents: 1000, remaining_bps: 0, my_bps: 10000, my_amount_cents: 1000 }],
      personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }],
      te_toca_cents: 1000, sin_repartir_cents: 0, puedo_elegir: false, puedo_marcar_presentes: false,
      pagadores: [{ miembro_id: 'm2', monto_cents: 1000 }], personal: false, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 1000, te_toca_platos_cents: 1000, puedo_corregir: false,
    };
    expect(decodeTicketDelViaje({ contract: CONTRATO.id, ticket })).toMatchObject({ puedo_elegir: false, te_toca_cents: 1000 });
    // Una clave de más sigue siendo otra forma: «sin claves nuevas» de verdad.
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: { ...ticket, solo_lectura: true } })).toThrow();
  });
});

describe('🔴 D279 · `viaje_version=8`: la hora de cierre, quién cierra y cuándo se cierra solo (App Backend 2.180.0)', () => {
  const sinClave = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
  const item = (cambios: Record<string, unknown> = {}) => ({ id: 'v', nombre: 'A', fecha_desde: null, fecha_hasta: null,
    estado: 'abierto', personas: 2, mi_balance_cents: 0, transferencias_pendientes: null, consumiste_cents: null,
    terminado_en: null, color: null, has_photo: false, hora_cierre: '23:59', ...cambios });
  const lista = (i: Record<string, unknown>) => ({ contract: CONTRATO.id, viajes: [i], counts: { abiertos: 1, cerrados: 0 } });
  const viaje = (cambios: Record<string, unknown>) => decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle(cambios) });

  it('las claves del contrato: tres en el viaje y una en la lista', () => {
    expect(V8.detalle_suma).toEqual(['hora_cierre', 'puedo_cerrar', 'se_cierra_en']);
    expect(V8.lista_suma).toEqual(['hora_cierre']);
  });

  it('sin cualquiera de ellas (la forma de la 7) no se acepta: la app pide la 8 siempre', () => {
    for (const k of V8.detalle_suma) {
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: sinClave(detalle(), k) }), k).toThrow();
    }
    expect(() => decodeListaDeViajes(lista(sinClave(item(), 'hora_cierre')), 'abiertos')).toThrow();
  });

  it('`hora_cierre` es «HH:MM» de 00:00 a 23:59, en el viaje y en la lista', () => {
    for (const ok of ['00:00', '07:30', '23:59']) {
      expect(viaje({ hora_cierre: ok }).hora_cierre).toBe(ok);
      expect(decodeListaDeViajes(lista(item({ hora_cierre: ok })), 'abiertos').viajes[0]!.hora_cierre).toBe(ok);
    }
    for (const malo of ['24:00', '7:30', '23:60', '23:59:00', '', null, 2359]) {
      expect(() => viaje({ hora_cierre: malo }), String(malo)).toThrow();
      expect(() => decodeListaDeViajes(lista(item({ hora_cierre: malo })), 'abiertos'), String(malo)).toThrow();
    }
  });

  it('`puedo_cerrar` es un booleano, y sólo puede ser `true` con el viaje abierto', () => {
    expect(viaje({ puedo_cerrar: true }).puedo_cerrar).toBe(true);
    expect(viaje({ puedo_cerrar: false }).puedo_cerrar).toBe(false);
    for (const malo of ['true', 1, null]) expect(() => viaje({ puedo_cerrar: malo }), String(malo)).toThrow();
    expect(viaje({ estado: 'esperando_pagos', puedo_cerrar: false }).puedo_cerrar).toBe(false);
    expect(() => viaje({ estado: 'esperando_pagos', puedo_cerrar: true })).toThrow();
  });

  it('`se_cierra_en` es un instante o null, y sólo abierto y con fecha hasta', () => {
    const en = '2026-10-16T05:59:00.000Z';
    expect(viaje({ fecha_hasta: '2026-10-15', se_cierra_en: en }).se_cierra_en).toBe(en);
    expect(viaje({ fecha_hasta: '2026-10-15', se_cierra_en: null }).se_cierra_en).toBeNull();
    for (const malo of ['mañana', '', 0]) {
      expect(() => viaje({ fecha_hasta: '2026-10-15', se_cierra_en: malo }), String(malo)).toThrow();
    }
    expect(() => viaje({ fecha_hasta: null, se_cierra_en: en })).toThrow();
    expect(() => viaje({ estado: 'esperando_pagos', puedo_cerrar: false, fecha_hasta: '2026-10-15', se_cierra_en: en })).toThrow();
  });

  it('el 403 `viaje_not_creator` es «no_creador»; otro 403 no', () => {
    expect(errorDeViaje(new HttpError(403, { error: 'viaje_not_creator' }))).toEqual({ tipo: 'no_creador' });
    expect(errorDeViaje(new MockApiError(403, 'viaje_not_creator'))).toEqual({ tipo: 'no_creador' });
    expect(errorDeViaje(new MockApiError(403, 'forbidden'))).toEqual({ tipo: 'reintentar' });
    expect(errorDeViaje(new MockApiError(409, 'viaje_not_creator'))).toEqual({ tipo: 'reintentar' });
  });
});

describe('🔴 D278-2 · D284 · `viaje_version=9`: el servicio, los descuentos, el IVA aparte y el total impreso (App Backend 2.181.0)', () => {
  const ajustes = { servicio_cents: 1000, descuentos_cents: 500, iva_aparte_cents: 1600, total_cents: 12100 };
  const enDetalle = (cambios: Record<string, unknown>) => {
    const v = detalle();
    return { ...v, tickets: [{ ...v.tickets[0], monto_cents: 10000, ...ajustes,
      pagadores: [{ miembro_id: 'm2', monto_cents: 12100 }], ...cambios }] };
  };
  const ticket = (cambios: Record<string, unknown> = {}) => ({
    id: 't', lugar: 'Mariscos', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', monto_cents: 10000, pagado_por: 'm2', pagaste_tu: false,
    items: [{ id: 'i', name: 'Taco', price_cents: 10000, quantity: 1, line_cents: 10000, remaining_bps: 0, my_bps: 5000, my_amount_cents: 5000 }],
    personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }],
    te_toca_cents: 6050, sin_repartir_cents: 0, puedo_elegir: false, puedo_marcar_presentes: false,
    pagadores: [{ miembro_id: 'm2', monto_cents: 12100 }], personal: false, ...ajustes, te_toca_platos_cents: 5000, puedo_corregir: false, ...cambios,
  });

  it('las claves del contrato: cuatro en cada ticket y cinco en el detalle de un ticket', () => {
    expect(V9.ticket_suma).toEqual(['servicio_cents', 'descuentos_cents', 'iva_aparte_cents', 'total_cents']);
    expect(V9.detalle_de_ticket_suma).toEqual(['servicio_cents', 'descuentos_cents', 'iva_aparte_cents', 'total_cents', 'te_toca_platos_cents']);
  });

  it('con ajustes: el total es la identidad del contrato y los pagadores suman el total, no los renglones', () => {
    const v = decodeDetalleViaje({ contract: CONTRATO.id, viaje: enDetalle({}) });
    expect(v.tickets[0]).toMatchObject({ monto_cents: 10000, ...ajustes });
    const t = decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket() });
    expect(t).toMatchObject({ total_cents: 12100, te_toca_cents: 6050, te_toca_platos_cents: 5000 });
    // Los pagadores con la suma de los renglones (la forma de la 8) no cuadran con un ticket con ajustes.
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: enDetalle({ pagadores: [{ miembro_id: 'm2', monto_cents: 10000 }] }) })).toThrow();
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ pagadores: [{ miembro_id: 'm2', monto_cents: 10000 }] }) })).toThrow();
  });

  it('un total que no es renglones + servicio + IVA aparte − descuentos, o no positivo, es otra semántica', () => {
    for (const malo of [{ total_cents: 12000 }, { total_cents: 10000 }, { servicio_cents: -1, total_cents: 12099 },
      { iva_aparte_cents: 1.5 }, { descuentos_cents: '500' }, { total_cents: null }]) {
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: enDetalle(malo) }), JSON.stringify(malo)).toThrow();
      expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket(malo) }), JSON.stringify(malo)).toThrow();
    }
    // Descuentos mayores que los renglones: el total impreso queda en 0 o menos, y el dueño no lo publica.
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ servicio_cents: 0, iva_aparte_cents: 0,
      descuentos_cents: 10000, total_cents: 0, pagadores: [{ miembro_id: 'm2', monto_cents: 0 }] }) })).toThrow();
  });

  it('sin cualquiera de las claves (la forma de la 8) no se acepta; `te_toca_platos_cents` es un entero ≥ 0', () => {
    const sin = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));
    for (const k of V9.ticket_suma) {
      const v = enDetalle({});
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: { ...v, tickets: [sin(v.tickets[0]!, k)] } }), k).toThrow();
    }
    for (const k of V9.detalle_de_ticket_suma) expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: sin(ticket(), k) }), k).toThrow();
    for (const malo of [-1, 1.5, null]) {
      expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ te_toca_platos_cents: malo }) }), String(malo)).toThrow();
    }
  });

  it('un gasto a mano no tiene recibo: su total es su monto', () => {
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: enDetalle({ origen: 'manual' }) })).toThrow();
    const gasto = { contract: CONTRATO.id, ya_cargado: null, ticket: ticket({ forma: 'iguales', tipo_lugar: 'otro', pagaste_tu: true,
      pagado_por: 'm1', pagadores: [{ miembro_id: 'm1', monto_cents: 12100 }] }) };
    expect(() => decodeGastoCargado(gasto)).toThrow();
    const limpio = { ...gasto, ticket: ticket({ forma: 'iguales', tipo_lugar: 'otro', pagaste_tu: true, pagado_por: 'm1',
      servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 10000, pagadores: [{ miembro_id: 'm1', monto_cents: 10000 }] }) };
    expect(decodeGastoCargado(limpio).total_cents).toBe(10000);
  });
});

describe('🔴 D290 · `viaje_version=11`: el resumen del pizarrón de notas en el detalle (App Backend 2.183.0)', () => {
  const sin = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

  it('el contrato: la 11 suma sólo `notas`, y sólo en el detalle del viaje', () => {
    expect(V11.parametro).toBe('viaje_version=11');
    expect(V11.detalle_suma).toEqual(['notas']);
    expect(V11.regla).toContain('en el detalle de un ticket y en la lista de viajes, la 11 responde como la 10');
    expect(V11.notas).toContain('{escribieron, total, nuevo}');
  });

  it('el detalle trae `notas` con sus tres claves; sin ella, o con otra forma, no se acepta', () => {
    const v = decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({ notas: { escribieron: 2, total: 2, nuevo: true } }) });
    expect(v.notas).toEqual({ escribieron: 2, total: 2, nuevo: true });
    expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: sin(detalle(), 'notas') })).toThrow();
    for (const malo of [
      null, {}, { escribieron: 0, total: 2 }, { escribieron: 0, total: 2, nuevo: false, saldo: 0 },
      { escribieron: 3, total: 2, nuevo: false }, { escribieron: -1, total: 2, nuevo: false },
      { escribieron: 1.5, total: 2, nuevo: false }, { escribieron: 0, total: 2, nuevo: 'no' },
    ]) {
      expect(() => decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({ notas: malo }) }), JSON.stringify(malo)).toThrow();
    }
  });

  it('con el viaje cerrado también llega (las notas quedan para leer)', () => {
    const v = decodeDetalleViaje({ contract: CONTRATO.id, viaje: detalle({ estado: 'cerrado', puedo_cerrar: false,
      notas: { escribieron: 0, total: 2, nuevo: false } }) });
    expect(v.notas.total).toBe(2);
  });
});

describe('🔴 D278-3 · `viaje_version=10`: corregir un ticket ya cargado (App Backend 2.182.0)', () => {
  const ticket = (cambios: Record<string, unknown> = {}) => ({
    id: 't', lugar: 'NATAMBRE', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', monto_cents: 10000, pagado_por: 'm2', pagaste_tu: false,
    items: [{ id: 'i', name: 'Taco', price_cents: 10000, quantity: 1, line_cents: 10000, remaining_bps: 0, my_bps: 5000, my_amount_cents: 5000 }],
    personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }],
    te_toca_cents: 5000, sin_repartir_cents: 0, puedo_elegir: true, puedo_marcar_presentes: true,
    pagadores: [{ miembro_id: 'm2', monto_cents: 10000 }], personal: false, servicio_cents: 0, descuentos_cents: 0,
    iva_aparte_cents: 0, total_cents: 10000, te_toca_platos_cents: 5000, puedo_corregir: true, ...cambios,
  });
  const sin = (o: Record<string, unknown>, k: string) => Object.fromEntries(Object.entries(o).filter(([x]) => x !== k));

  it('el contrato: la 10 suma sólo `puedo_corregir`, y sólo en el detalle de un ticket', () => {
    expect(V10.parametro).toBe('viaje_version=10');
    expect(V10.detalle_de_ticket_suma).toEqual(['puedo_corregir']);
    expect(V10.regla).toContain('fuera de ese detalle, la 10 responde como la 9');
  });

  it('el detalle de un ticket trae `puedo_corregir` booleano; sin él, o con otra forma, no se acepta', () => {
    expect(decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket() }).puedo_corregir).toBe(true);
    expect(decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ puedo_corregir: false, puedo_marcar_presentes: false }) })
      .puedo_corregir).toBe(false);
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: sin(ticket(), 'puedo_corregir') })).toThrow();
    for (const malo of ['true', 1, null]) {
      expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ puedo_corregir: malo }) }), String(malo)).toThrow();
    }
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ puedo_editar: true }) })).toThrow();
  });

  it('`puedo_corregir` es la misma condición que `puedo_marcar_presentes` (el dueño: abierto y cargó o pagó)', () => {
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ puedo_marcar_presentes: false }) })).toThrow();
    expect(() => decodeTicketDelViaje({ contract: CONTRATO.id, ticket: ticket({ puedo_corregir: false }) })).toThrow();
  });

  it('`PATCH …/tickets/:tid` responde `{contract, ticket}`: ni `ya_cargado` ni otra clave', () => {
    expect(decodeTicketCorregido({ contract: CONTRATO.id, ticket: ticket({ lugar: 'Matambre' }) }).lugar).toBe('Matambre');
    expect(() => decodeTicketCorregido({ contract: CONTRATO.id, ticket: ticket(), ya_cargado: null })).toThrow();
    expect(() => decodeTicketCorregido({ ticket: ticket() })).toThrow();
    expect(() => decodeTicketCorregido({ contract: 'otro/v1', ticket: ticket() })).toThrow();
    expect(() => decodeTicketCorregido({ contract: CONTRATO.id, ticket: sin(ticket(), 'puedo_corregir') })).toThrow();
  });

  it('🔴 errorAlCorregir: los propios de corregir, y el resto como siempre', () => {
    const e = (status: number, error: string, extra: Record<string, unknown> = {}) => new HttpError(status, { error, ...extra });
    expect(errorAlCorregir(e(403, 'viaje_ticket_edit_forbidden'))).toEqual({ tipo: 'corregir_prohibido' });
    expect(errorAlCorregir(e(404, 'viaje_ticket_not_found'))).toEqual({ tipo: 'ticket_no_encontrado' });
    expect(errorAlCorregir(e(422, 'viaje_ticket_amount_invalid'))).toEqual({ tipo: 'monto_invalido' });
    expect(errorAlCorregir(e(409, 'viaje_total_limit', { limit: 20000000000 }))).toEqual({ tipo: 'tope_del_viaje' });
    expect(errorAlCorregir(e(422, 'viaje_ticket_item_unknown', { item_id: 'x' }))).toEqual({ tipo: 'renglon_desconocido' });
    expect(errorAlCorregir(e(422, 'viaje_ticket_payers_total_mismatch', { monto_cents: 12000 })))
      .toEqual({ tipo: 'pagadores_no_suman', totalCents: 12000 });
    expect(errorAlCorregir(e(422, 'viaje_ticket_payer_unknown', { miembro_id: 'm9' }))).toEqual({ tipo: 'pagador_desconocido' });
    expect(errorAlCorregir(e(409, 'viaje_not_open', { estado: 'esperando_pagos' }))).toEqual({ tipo: 'no_abierto' });
    expect(errorAlCorregir(e(404, 'viaje_not_found'))).toEqual({ tipo: 'no_disponible' });
    expect(errorAlCorregir(e(403, 'user_suspended'))).toEqual({ tipo: 'reintentar' });
    expect(errorAlCorregir(e(400, 'validation_error'))).toEqual({ tipo: 'reintentar' });
    // El mismo código con otro status no es el caso propio.
    expect(errorAlCorregir(e(409, 'viaje_ticket_amount_invalid'))).toEqual({ tipo: 'reintentar' });
    expect(errorAlCorregir(e(422, 'viaje_total_limit'))).toEqual({ tipo: 'reintentar' });
  });
});
