import { describe, expect, it } from 'vitest';
import type { OcrResponse } from '../../api/types';
import type { ItemDelTicket, MiembroViaje, PersonaDelTicket, TicketDelViaje } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import {
  alternarPresente,
  ausentesDelTicket,
  ayudaDePresentes,
  candidatosDelTicket,
  candidatosDelViaje,
  chipsDeEleccion,
  conAjustes,
  esGastoPersonal,
  filasDelTotal,
  fechaDelEscaneo,
  fechaYHoraLocal,
  idsPresentes,
  llaveParaPedido,
  montoDelPlato,
  nombresPresentes,
  pedidoDeCarga,
  pedidoDeSeleccion,
  porcionInicial,
  porcionesDelPlato,
  seleccionGuardada,
  subtituloDelTicket,
  teTocaConSeleccion,
  textoDelPago,
  topeDelPlato,
  sumaDeRenglones,
  totalDelEscaneo,
} from './ticketView';

const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const tEn = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);

const miembro = (id: string, first: string, last: string, extra: Partial<MiembroViaje> = {}): MiembroViaje => ({
  id, first_name: first, last_name: last, username: `${first.toLowerCase()}.${last.toLowerCase()}`, eliminada: false,
  es_yo: false, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra,
});
const YO = miembro('m-ana', 'Ana', 'López', { es_yo: true, username: 'ana.lopez' });
const LUIS = miembro('m-luis', 'Luis', 'Pérez', { username: 'luis.perez' });
const SOFIA = miembro('m-sofia', 'Sofía', 'Ramírez', { username: 'sofia.ramirez' });
const DIEGO = miembro('m-diego', 'Diego', 'Torres', { username: 'diego.torres' });
const MIEMBROS = [LUIS, YO, SOFIA, DIEGO];

const persona = (miembro_id: string | null, ya_eligio = true, presente = true): PersonaDelTicket => ({ miembro_id, ya_eligio, presente });

const item = (id: string, line: number, extra: Partial<ItemDelTicket> = {}): ItemDelTicket => ({
  id, name: id, price_cents: line, quantity: 1, line_cents: line, remaining_bps: 10000, my_bps: 0, my_amount_cents: 0, ...extra,
});

function ticket(extra: Partial<TicketDelViaje> = {}): TicketDelViaje {
  const t = {
    id: 'tk', lugar: 'Mariscos El Faro', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', monto_cents: 220000, pagado_por: 'm-luis', pagaste_tu: false,
    items: [], personas: [persona('m-luis'), persona('m-ana'), persona('m-sofia'), persona('m-diego', false)],
    te_toca_cents: 53000, sin_repartir_cents: 56500, puedo_elegir: true, puedo_marcar_presentes: false, personal: false,
    servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, te_toca_platos_cents: 53000, ...extra,
  } as const;
  // D278-2 · el total impreso, con la identidad del contrato.
  const total = extra.total_cents ?? t.monto_cents + t.servicio_cents + t.iva_aparte_cents - t.descuentos_cents;
  // D263 · con un solo pagador, uno con el total.
  return { ...t, total_cents: total, pagadores: extra.pagadores ?? [{ miembro_id: t.pagado_por, monto_cents: total }] };
}

const ocr = (extra: Partial<OcrResponse> = {}): OcrResponse => ({
  items: [
    { name: 'Tacos', category: 'mexican', price_cents: 28500, quantity: 1 },
    { name: 'Margarita', category: 'mexican', price_cents: 14000, quantity: 4 },
  ],
  total_cents: 84500,
  warnings: [],
  mock: true,
  receipt: 'or1.x.y',
  merchant: { name: 'Mariscos El Faro', rfc: 'XAXX010101000' },
  ticket_datetime: { date: '2026-10-09', time: '14:20' },
  ...extra,
});

describe('AF-VIAJES · Ticket nuevo (1h) · lo leído', () => {
  it('la suma de los renglones es Σ precio × cantidad, en centavos enteros; sin ajustes, es el total', () => {
    expect(sumaDeRenglones(ocr().items)).toBe(28500 + 14000 * 4);
    expect(sumaDeRenglones([])).toBe(0);
    expect(totalDelEscaneo(ocr())).toEqual({ monto_cents: 84500, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: 84500 });
  });

  it('«9 oct · 14:20»; sin hora sólo la fecha; sin fecha nada', () => {
    expect(fechaDelEscaneo({ date: '2026-10-09', time: '14:20' }, 'es')).toBe('9 oct · 14:20');
    expect(fechaDelEscaneo({ date: '2026-10-09', time: null }, 'es')).toBe('9 oct');
    expect(fechaDelEscaneo({ date: '2026-10-09', time: '14:20' }, 'en')).toBe('Oct 9 · 14:20');
    expect(fechaDelEscaneo(undefined, 'es')).toBeNull();
  });

  it('el pedido lleva lo leído tal cual: comercio, fecha, hora y renglones sin categoría', () => {
    const p = pedidoDeCarga(ocr(), 'iguales', 'bar');
    expect(p).toEqual({
      ocr_receipt: 'or1.x.y', forma: 'iguales', tipo_lugar: 'bar', lugar: 'Mariscos El Faro',
      fecha_ticket: '2026-10-09', hora_ticket: '14:20',
      items: [{ name: 'Tacos', price_cents: 28500, quantity: 1 }, { name: 'Margarita', price_cents: 14000, quantity: 4 }],
    });
    expect(p).not.toHaveProperty('idempotency_key');
  });

  it('🔴 sin comercio ni fecha: `null`, y la hora nunca viaja sin la fecha', () => {
    const p = pedidoDeCarga(ocr({ merchant: undefined, ticket_datetime: undefined }), 'consumo', 'restaurante');
    expect(p.lugar).toBeNull();
    expect(p.fecha_ticket).toBeNull();
    expect(p.hora_ticket).toBeNull();
  });

  it('🔴 la llave es la misma para el mismo pedido y nueva si cambió', () => {
    let n = 0;
    const nueva = () => `k${++n}`;
    const a = llaveParaPedido(null, pedidoDeCarga(ocr(), 'consumo', 'restaurante'), nueva);
    const b = llaveParaPedido(a, pedidoDeCarga(ocr(), 'consumo', 'restaurante'), nueva);
    expect(b.key).toBe(a.key);
    const c = llaveParaPedido(b, pedidoDeCarga(ocr(), 'total', 'restaurante'), nueva);
    expect(c.key).not.toBe(a.key);
    const d = llaveParaPedido(c, pedidoDeCarga(ocr(), 'total', 'bar'), nueva);
    expect(new Set([a.key, c.key, d.key]).size).toBe(3);
  });
});

describe('AF-VIAJES · ¿Quiénes estuvieron?', () => {
  it('candidatos: «Tú» primero con tu @, después el resto en el orden del dueño; sin las cuentas eliminadas', () => {
    const baja = miembro('m-baja', 'X', 'Y', { eliminada: true, first_name: null, last_name: null, username: null });
    const c = candidatosDelViaje([...MIEMBROS, baja], t);
    expect(c.map((x) => x.nombre)).toEqual(['Tú', 'Luis Pérez', 'Sofía Ramírez', 'Diego Torres']);
    expect(c[0]).toMatchObject({ id: 'm-ana', es_yo: true, arroba: 'ana.lopez' });
  });

  it('todos marcados de entrada; desmarcar y volver a marcar', () => {
    const c = candidatosDelViaje(MIEMBROS, t);
    let aus = new Set<string>();
    expect(idsPresentes(c, aus)).toEqual(['m-ana', 'm-luis', 'm-sofia', 'm-diego']);
    aus = alternarPresente(aus, 'm-diego', c);
    expect(idsPresentes(c, aus)).toEqual(['m-ana', 'm-luis', 'm-sofia']);
    aus = alternarPresente(aus, 'm-diego', c);
    expect(aus.size).toBe(0);
  });

  it('🔴 el último marcado no se desmarca', () => {
    const c = candidatosDelViaje(MIEMBROS, t);
    let aus = new Set<string>();
    for (const id of ['m-luis', 'm-sofia', 'm-diego']) aus = alternarPresente(aus, id, c);
    expect(idsPresentes(c, aus)).toEqual(['m-ana']);
    const otra = alternarPresente(aus, 'm-ana', c);
    expect(idsPresentes(c, otra)).toEqual(['m-ana']);
  });

  it('del ticket: los desmarcados y los nombres de los presentes («Tú, Luis y Sofía»)', () => {
    const personas = [persona('m-luis'), persona('m-ana'), persona('m-sofia'), persona('m-diego', true, false)];
    expect([...ausentesDelTicket(personas)]).toEqual(['m-diego']);
    expect(nombresPresentes(personas, MIEMBROS, t)).toBe('Tú, Luis y Sofía');
    const c = candidatosDelTicket(personas, MIEMBROS, t);
    expect(c.map((x) => x.nombre)).toEqual(['Tú', 'Luis Pérez', 'Sofía Ramírez', 'Diego Torres']);
  });
});

describe('AF-VIAJES · el ticket del viaje · textos', () => {
  it('«8 oct · Pagó Luis Pérez · Por lo que pidió cada uno», y «Pagaste tú»', () => {
    expect(subtituloDelTicket(ticket(), MIEMBROS, 'es', t)).toBe('8 oct · Pagó Luis Pérez · Por lo que pidió cada uno');
    expect(subtituloDelTicket(ticket({ pagaste_tu: true, pagado_por: 'm-ana', forma: 'iguales' }), MIEMBROS, 'es', t))
      .toBe('8 oct · Pagaste tú · En partes iguales');
    expect(subtituloDelTicket(ticket({ forma: 'total' }), MIEMBROS, 'es', t, false)).toBe('8 oct · Pagó Luis Pérez');
    expect(subtituloDelTicket(ticket({ fecha_ticket: null, forma: 'total' }), MIEMBROS, 'es', t)).toBe('Pagó Luis Pérez · Pagar el total');
  });

  it('quien pagó fuera de los miembros: «Cuenta eliminada», nunca un id', () => {
    expect(textoDelPago(ticket({ pagado_por: 'otro' }), MIEMBROS, t)).toBe('Pagó Cuenta eliminada');
    expect(textoDelPago(ticket(), MIEMBROS, tEn)).toBe('Paid by Luis Pérez');
  });

  it('«Quién ya eligió»: «Tú» primero, nombre de pila, y quién falta (nunca qué eligió)', () => {
    const chips = chipsDeEleccion(ticket().personas, MIEMBROS, t);
    expect(chips.map((c) => [c.nombre, c.ya_eligio])).toEqual([
      ['Tú', true], ['Luis', true], ['Sofía', true], ['Diego', false],
    ]);
  });
});

describe('AF-VIAJES · elegir lo que consumí (1i)', () => {
  it('🔴 el tope es lo que queda más lo mío, hasta el entero', () => {
    expect(topeDelPlato({ remaining_bps: 0, my_bps: 5000 })).toBe(5000);
    expect(topeDelPlato({ remaining_bps: 5000, my_bps: 5000 })).toBe(10000);
    expect(topeDelPlato({ remaining_bps: 10000, my_bps: 0 })).toBe(10000);
    expect(topeDelPlato({ remaining_bps: 0, my_bps: 0 })).toBe(0);
  });

  it('las porciones: con 4 personas Entero, ½, ⅓, ¼; con «queda ½» no hay Entero; sin nada, ninguna', () => {
    expect(porcionesDelPlato({ remaining_bps: 10000, my_bps: 0 }, 4)).toEqual([1, 2, 3, 4]);
    expect(porcionesDelPlato({ remaining_bps: 10000, my_bps: 0 }, 2)).toEqual([1, 2]);
    expect(porcionesDelPlato({ remaining_bps: 5000, my_bps: 0 }, 4)).toEqual([2, 3, 4]);
    expect(porcionesDelPlato({ remaining_bps: 0, my_bps: 0 }, 4)).toEqual([]);
    expect(porcionInicial({ remaining_bps: 5000, my_bps: 0 }, 4)).toBe(5000);
    expect(porcionInicial({ remaining_bps: 0, my_bps: 0 }, 4)).toBeNull();
  });

  it('arranca de lo guardado (my_bps) y «Listo» manda sólo lo elegido, en el orden del ticket', () => {
    const items = [item('a', 32000), item('b', 31000, { my_bps: 10000, my_amount_cents: 31000, remaining_bps: 0 }),
      item('c', 16000, { my_bps: 5000, my_amount_cents: 8000, remaining_bps: 0 })];
    const sel = seleccionGuardada(items);
    expect([...sel]).toEqual([['b', 10000], ['c', 5000]]);
    sel.set('a', 2500);
    expect(pedidoDeSeleccion(items, sel)).toEqual([
      { item_id: 'a', fraction_bps: 2500 }, { item_id: 'b', fraction_bps: 10000 }, { item_id: 'c', fraction_bps: 5000 },
    ]);
  });

  it('🔴 «Te toca»: sin cambios lo del dueño; eligiendo, la vista previa (lo no tocado conserva el monto del dueño)', () => {
    const items = [item('a', 32000), item('b', 31000, { my_bps: 10000, my_amount_cents: 31000, remaining_bps: 0 }),
      item('m', 56000, { quantity: 4, price_cents: 14000, my_bps: 2500, my_amount_cents: 14000, remaining_bps: 5000 })];
    const tk = ticket({ items, te_toca_cents: 45000 });
    const sel = seleccionGuardada(items);
    expect(teTocaConSeleccion(tk, sel)).toBe(45000);
    sel.set('a', 5000);
    expect(montoDelPlato(items[0]!, 5000)).toBe(16000);
    expect(teTocaConSeleccion(tk, sel)).toBe(31000 + 14000 + 16000);
    sel.delete('b');
    expect(teTocaConSeleccion(tk, sel)).toBe(14000 + 16000);
  });

  it('la porción que completa el plato paga lo que queda (como la mesa)', () => {
    // Quedaba ⅔ (otro tomó ⅓): mi ⅔ paga la línea menos el ⅓ ajeno.
    const i = item('x', 10001, { remaining_bps: 6667 });
    expect(montoDelPlato(i, 6667)).toBe(10001 - Math.round(10001 * 3333 / 10000));
  });
});

describe('AF-VIAJES · 1k · la hora del teléfono', () => {
  it('fecha y hora locales de un instante; sin instante, nada', () => {
    const d = new Date(2026, 9, 8, 21, 40);
    expect(fechaYHoraLocal(d.toISOString(), 'es')).toEqual({ fecha: '8 oct', hora: '21:40' });
    expect(fechaYHoraLocal(d.toISOString(), 'en')).toEqual({ fecha: 'Oct 8', hora: '21:40' });
    expect(fechaYHoraLocal(null, 'es')).toBeNull();
    expect(fechaYHoraLocal('no', 'es')).toBeNull();
  });
});

describe('🔴 D276-3 · ¿es un gasto personal? (visto desde quien carga)', () => {
  const C = [{ id: 'yo', es_yo: true }, { id: 'luis', es_yo: false }, { id: 'sofia', es_yo: false }];
  const YO = { es_yo: true };
  const LUIS = { es_yo: false };
  const soloYo = new Set(['luis', 'sofia']);

  it('sólo yo marcado y pagué yo solo: sí', () => {
    expect(esGastoPersonal(C, soloYo, [YO])).toBe(true);
  });

  it('sólo yo marcado, pero pagó otro: no (es una deuda)', () => {
    expect(esGastoPersonal(C, soloYo, [LUIS])).toBe(false);
  });

  it('sólo yo marcado, pero pagamos dos: no', () => {
    expect(esGastoPersonal(C, soloYo, [YO, LUIS])).toBe(false);
  });

  it('con alguien más marcado: no', () => {
    expect(esGastoPersonal(C, new Set(['sofia']), [YO])).toBe(false);
    expect(esGastoPersonal(C, new Set(), [YO])).toBe(false);
  });

  it('sólo otro marcado (no yo) y pagué yo: no', () => {
    expect(esGastoPersonal(C, new Set(['yo', 'sofia']), [YO])).toBe(false);
  });
});

describe('D276-2 · la ayuda de «¿Quiénes estuvieron?»', () => {
  it('cada forma la suya; «Pagar el total», ninguna', () => {
    expect(ayudaDePresentes('consumo', t)).toBe('Sólo eligen los que estuvieron. Desmarca a quien no estuvo.');
    expect(ayudaDePresentes('iguales', t)).toBe('Se divide entre los marcados. Desmarca a quien no estuvo.');
    expect(ayudaDePresentes('total', t)).toBeNull();
  });
});

describe('🔴 D278-2 · D284 · el total impreso (servicio, descuentos e IVA aparte)', () => {
  // Renglones: 28500 + 14000 × 4 = 84500.
  const conTotales = (extra: Partial<OcrResponse>) => totalDelEscaneo(ocr(extra));

  it('el escaneo, con la regla de `ajustesDeRecibo` del dueño', () => {
    // IVA aparte: los renglones suman el subtotal.
    expect(conTotales({ ticket_totals: { subtotal_cents: 84500, tax_cents: 13520 } }))
      .toEqual({ monto_cents: 84500, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 13520, total_cents: 98020 });
    // IVA incluido: los renglones suman el subtotal más el IVA; no se agrega.
    expect(conTotales({ ticket_totals: { subtotal_cents: 72845, tax_cents: 11655 } }).total_cents).toBe(84500);
    // Servicio y descuento, con el subtotal ya descontado e IVA aparte.
    expect(conTotales({ ticket_totals: { subtotal_cents: 79500, tax_cents: 12720 },
      ticket_adjustments: [{ kind: 'discount', amount_cents: 5000 }, { kind: 'service_charge', amount_cents: 8500 }] }))
      .toEqual({ monto_cents: 84500, servicio_cents: 8500, descuentos_cents: 5000, iva_aparte_cents: 12720, total_cents: 100720 });
    // Subtotal sin descontar (igual a los renglones) con un descuento igual al IVA: no es ambiguo, el IVA es aparte.
    expect(conTotales({ ticket_totals: { subtotal_cents: 84500, tax_cents: 5000 },
      ticket_adjustments: [{ kind: 'discount', amount_cents: 5000 }] })).toMatchObject({ iva_aparte_cents: 5000, total_cents: 84500 });
    // Ambiguo: el descuento es igual al IVA; no se agrega el IVA.
    expect(conTotales({ ticket_totals: { subtotal_cents: 79500, tax_cents: 5000 },
      ticket_adjustments: [{ kind: 'discount', amount_cents: 5000 }] }).iva_aparte_cents).toBe(0);
    // Sin IVA impreso: sólo los ajustes.
    expect(conTotales({ ticket_totals: { subtotal_cents: 84500 }, ticket_adjustments: [{ kind: 'service_charge', amount_cents: 1000 }] }).total_cents)
      .toBe(85500);
    // Sin nada: los renglones, como antes.
    expect(conTotales({}).total_cents).toBe(84500);
  });

  it('las filas: sólo con algún ajuste, en el orden de la cuenta y sólo lo mayor que 0', () => {
    const base = { monto_cents: 1000, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0 };
    expect(conAjustes(base)).toBe(false);
    expect(filasDelTotal(base)).toEqual([]);
    expect(filasDelTotal({ ...base, servicio_cents: 100, descuentos_cents: 50, iva_aparte_cents: 160 })).toEqual([
      { clave: 'platos', cents: 1000 }, { clave: 'iva', cents: 160 }, { clave: 'servicio', cents: 100 }, { clave: 'descuento', cents: 50 }]);
    expect(filasDelTotal({ ...base, descuentos_cents: 50 })).toEqual([{ clave: 'platos', cents: 1000 }, { clave: 'descuento', cents: 50 }]);
    expect(conAjustes({ ...base, iva_aparte_cents: 1 })).toBe(true);
  });

  it('la vista previa de «Te toca»: sin cambios, la del dueño; con ajustes, tus platos en proporción al total', () => {
    const t = ticket({ monto_cents: 10000, servicio_cents: 1000, items: [
      { id: 'i1', name: 'A', price_cents: 6000, quantity: 1, line_cents: 6000, remaining_bps: 10000, my_bps: 0, my_amount_cents: 0 },
      { id: 'i2', name: 'B', price_cents: 4000, quantity: 1, line_cents: 4000, remaining_bps: 10000, my_bps: 0, my_amount_cents: 0 },
    ], te_toca_cents: 0 });
    expect(t.total_cents).toBe(11000);
    expect(teTocaConSeleccion(t, new Map())).toBe(0);
    // 6000 de platos sobre 10000 de renglones: 6600 de 11000.
    expect(teTocaConSeleccion(t, new Map([['i1', 10000]]))).toBe(6600);
    // Un tercio de A: 2000 de platos, 2200 del total.
    expect(teTocaConSeleccion(t, new Map([['i1', 3333]]))).toBe(2200);
    // Sin ajustes, sólo los platos (como antes).
    const sin = ticket({ monto_cents: 10000, items: t.items, te_toca_cents: 0 });
    expect(teTocaConSeleccion(sin, new Map([['i1', 10000]]))).toBe(6000);
  });
});
