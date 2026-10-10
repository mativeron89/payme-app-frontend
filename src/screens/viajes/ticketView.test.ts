import { describe, expect, it } from 'vitest';
import type { OcrResponse } from '../../api/types';
import type { ItemDelTicket, MiembroViaje, PersonaDelTicket, TicketDelViaje } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import {
  alternarPresente,
  ausentesDelTicket,
  candidatosDelTicket,
  candidatosDelViaje,
  chipsDeEleccion,
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
    te_toca_cents: 53000, sin_repartir_cents: 56500, puedo_elegir: true, puedo_marcar_presentes: false, ...extra,
  } as const;
  // D263 · con un solo pagador, uno con el total.
  return { ...t, pagadores: extra.pagadores ?? [{ miembro_id: t.pagado_por, monto_cents: t.monto_cents }] };
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
  it('el total es Σ precio × cantidad, en centavos enteros', () => {
    expect(totalDelEscaneo(ocr().items)).toBe(28500 + 14000 * 4);
    expect(totalDelEscaneo([])).toBe(0);
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
