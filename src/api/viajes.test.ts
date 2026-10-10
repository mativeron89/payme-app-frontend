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
  decodeTicketDelViaje,
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
  };
  colores: Record<string, string>;
};
const V2 = CONTRATO.negociaciones.viaje_version_2;
/** D255 · App Backend 2.174.0: la 2 más `color` y `has_photo`, en el detalle y en la lista. */
const V3 = CONTRATO.negociaciones.viaje_version_3;
/** D256 · App Backend 2.175.0: la 3 más `puede_eliminar` en cada ticket del detalle. */
const V4 = CONTRATO.negociaciones.viaje_version_4;

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
    te_toca_cents: 100, falta_que_elija: 1, sin_repartir_cents: 0, monto_cents: 200, origen: 'escaneo', puede_eliminar: false }],
  sin_repartir: [], transferencias: [], transferencias_pendientes: 0,
  color: null, has_photo: false,
  ...cambios,
});

describe('decodificadores · claves exactas, `contract` exacto, falla cerrado', () => {
  it('el detalle de un viaje: las claves del contrato con `viaje_version=4`, ni una más', () => {
    const claves = CONTRATO.rutas['GET /api/viajes/:id']!.respuestas['200']!.viaje as string[];
    expect(Object.keys(detalle()).sort()).toEqual([...claves, ...V3.detalle_suma].sort());
    expect(V2.parametro).toBe('viaje_version=2');
    expect(V3.parametro).toBe('viaje_version=3');
    expect(V4.parametro).toBe('viaje_version=4');
    expect(Object.keys(detalle().miembros[0]!).sort()).toEqual([...V2.miembro].sort());
    expect(Object.keys(detalle().tickets[0]!).sort()).toEqual([...V2.ticket, ...V4.ticket_suma].sort());
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
      color: null, has_photo: false };
    const claves = CONTRATO.rutas['GET /api/viajes']!.respuestas['200']!.viaje as string[];
    expect(Object.keys(item).sort()).toEqual([...claves, ...V3.lista_suma].sort());
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
      te_toca_cents: 500, sin_repartir_cents: 500, puedo_elegir: true, puedo_marcar_presentes: false };
    const claves = CONTRATO.rutas['GET /api/viajes/:id/tickets/:tid']!.respuestas['200']!.ticket as string[];
    expect(Object.keys(ticket).sort()).toEqual([...claves].sort());
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
    const d = decodeDetalleViaje({ contract: CONTRATO.id, viaje: conTicket({ origen: 'manual', monto_cents: 0 }) });
    expect(d.tickets[0]).toMatchObject({ origen: 'manual', monto_cents: 0 });
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
  };

  it('responde como un ticket, con `ya_cargado` nulo: el pedido y la respuesta del contrato', () => {
    const ruta = CONTRATO.rutas['POST /api/viajes/:id/gastos'] as unknown as {
      request: Record<string, string>; respuestas: Record<string, Record<string, unknown>>;
    };
    expect(Object.keys(ruta.request).sort()).toEqual(['descripcion', 'idempotency_key', 'monto_cents', 'pagado_por', 'presentes']);
    expect(ruta.respuestas['201']!.claves).toEqual(['contract', 'ticket', 'ya_cargado']);
    expect(decodeGastoCargado({ contract: CONTRATO.id, ticket, ya_cargado: null })).toMatchObject({ id: 't', monto_cents: 90000 });
  });

  it('🔴 D255-6 · con «pagó otro», el gasto vuelve con ese miembro y no conmigo; sin pedirlo, conmigo', () => {
    const deLuis = { ...ticket, pagado_por: 'm2', pagaste_tu: false };
    expect(decodeGastoCargado({ contract: CONTRATO.id, ticket: deLuis, ya_cargado: null }, 'm2')).toMatchObject({ pagado_por: 'm2' });
    // Lo pedido manda: si vuelve otro pagador, o yo, no es lo que se pidió.
    expect(() => decodeGastoCargado({ contract: CONTRATO.id, ticket: deLuis, ya_cargado: null }, 'm3')).toThrow();
    expect(() => decodeGastoCargado({ contract: CONTRATO.id, ticket, ya_cargado: null }, 'm2')).toThrow();
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
    terminado_en: null, color: null, has_photo: false, ...cambios });
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
