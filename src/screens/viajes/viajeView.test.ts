import { describe, expect, it } from 'vitest';
import type { DetalleViaje, MiembroViaje, TicketEnViaje, TransferenciaViaje, VistaPreviaCierre } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import { formatMXN } from '../../utils/format';
import {
  avisosDeCierre,
  estadoDeTransferencia,
  metaDelTicket,
  partirPlantilla,
  progresoDePagos,
  textoNoPuedeSalir,
  textoTransferenciasPendientes,
  tramosDeTransferencias,
  vistaDePagos,
} from './viajeView';

/**
 * AF-VIAJES · D242 · lo puro de 1g, 1l, 1m, 1n, 1o, 1p y 1q. Los textos son el
 * literal de la «Lista final de textos» (con los ajustes decididos de 1m). El
 * front no calcula montos: estos helpers sólo eligen la frase.
 */

const es = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);

const IDS = { yo: 'm-ana', luis: 'm-luis', sofia: 'm-sofia', diego: 'm-diego' } as const;

function miembro(id: string, first: string, last: string, extra: Partial<MiembroViaje> = {}): MiembroViaje {
  return { id, first_name: first, last_name: last, username: null, eliminada: false, es_yo: false, balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra };
}

const MIEMBROS: MiembroViaje[] = [
  miembro(IDS.yo, 'Ana', 'López', { es_yo: true, balance_cents: -54200 }),
  miembro(IDS.luis, 'Luis', 'Pérez', { balance_cents: 181900 }),
  miembro(IDS.sofia, 'Sofía', 'Ramírez', { balance_cents: -23000 }),
  miembro(IDS.diego, 'Diego', 'Torres', { balance_cents: -104700, falta_elegir: 1 }),
];

function ticket(extra: Partial<TicketEnViaje>): TicketEnViaje {
  return {
    id: 'tk-1', lugar: 'Mariscos El Faro', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', pagado_por: IDS.luis, pagaste_tu: false,
    te_toca_cents: 53000, falta_que_elija: 1, sin_repartir_cents: 56500, monto_cents: 159000, origen: 'escaneo', ...extra,
  };
}

function viaje(extra: Partial<DetalleViaje> = {}): DetalleViaje {
  return {
    id: 'v-1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto',
    creado_en: '2026-10-01T15:00:00.000Z', mi_miembro_id: IDS.yo, miembros: MIEMBROS, invitados: [],
    mi_balance_cents: -54200, gasto_del_grupo_cents: 666000,
    tickets: [ticket({}), ticket({ id: 'tk-2', lugar: null, tipo_lugar: 'bar', pagado_por: IDS.yo, pagaste_tu: true, fecha_ticket: '2026-10-06', forma: 'iguales', falta_que_elija: 0 })],
    sin_repartir: [], transferencias: [], transferencias_pendientes: 0, color: null, has_photo: false, ...extra,
  };
}

function tr(id: string, de: string, a: string, cents: number, estado: TransferenciaViaje['estado'], mia: TransferenciaViaje['mia']): TransferenciaViaje {
  return { id, de, a, monto_cents: cents, estado, mia };
}

describe('partirPlantilla · negritas sin perder la traducción', () => {
  it('parte texto e índices en orden', () => {
    expect(partirPlantilla('{0} le transfiere {1} a {2}')).toEqual([
      { indice: 0 }, { texto: ' le transfiere ' }, { indice: 1 }, { texto: ' a ' }, { indice: 2 },
    ]);
    expect(partirPlantilla('Tú le transfieres {0} a {1}')).toEqual([
      { texto: 'Tú le transfieres ' }, { indice: 0 }, { texto: ' a ' }, { indice: 1 },
    ]);
    expect(partirPlantilla('Sin nada')).toEqual([{ texto: 'Sin nada' }]);
  });

  it('la plantilla traducida se parte igual (t sin argumentos devuelve la plantilla)', () => {
    expect(partirPlantilla(en('Tú le transfieres {0} a {1}'))).toEqual([
      { texto: 'You transfer ' }, { indice: 0 }, { texto: ' to ' }, { indice: 1 },
    ]);
  });
});

describe('1g · la fila del ticket', () => {
  it('«8 oct · Pagó Luis Pérez» y «6 oct · Pagaste tú»', () => {
    const v = viaje();
    expect(metaDelTicket(v.tickets[0]!, MIEMBROS, es, 'es')).toBe('8 oct · Pagó Luis Pérez');
    expect(metaDelTicket(v.tickets[1]!, MIEMBROS, es, 'es')).toBe('6 oct · Pagaste tú');
    expect(metaDelTicket(v.tickets[0]!, MIEMBROS, en, 'en')).toBe('Oct 8 · Paid by Luis Pérez');
  });

  it('sin fecha impresa usa el día en que se cargó; sin quien pagó, «Cuenta eliminada»', () => {
    const sinFecha = ticket({ fecha_ticket: null, cargado_en: '2026-10-07T18:00:00.000Z' });
    expect(metaDelTicket(sinFecha, MIEMBROS, es, 'es')).toBe('7 oct · Pagó Luis Pérez');
    const sinPagador = ticket({ pagado_por: 'm-salio' });
    expect(metaDelTicket(sinPagador, MIEMBROS, es, 'es')).toBe('8 oct · Pagó Cuenta eliminada');
    const nada = ticket({ fecha_ticket: null, cargado_en: null });
    expect(metaDelTicket(nada, MIEMBROS, es, 'es')).toBe('Pagó Luis Pérez');
  });
});

describe('1q · por qué no puedo salir', () => {
  const consumo = (n: number) => Array.from({ length: n }, (_, i) => ticket({ id: `c${i}`, te_toca_cents: 1000 }));

  it('selection cuenta los tickets por consumo donde ya me tocó algo', () => {
    const tickets = [...consumo(4), ticket({ id: 'cero', te_toca_cents: 0 }), ticket({ id: 'ig', forma: 'iguales', te_toca_cents: 5000 })];
    expect(textoNoPuedeSalir('selection', tickets, es)).toBe(
      'Ya elegiste consumos en 4 tickets. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.');
    expect(textoNoPuedeSalir('selection', consumo(1), es)).toBe(
      'Ya elegiste consumos en 1 ticket. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.');
    expect(textoNoPuedeSalir('selection', [], es)).toBe(
      'Ya elegiste consumos en este viaje. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.');
  });

  it('paid_ticket y present_in_equal_split', () => {
    expect(textoNoPuedeSalir('paid_ticket', [], es)).toBe(
      'Pagaste un ticket de este viaje. Podrás salir cuando se cierre el viaje y quede todo pagado.');
    expect(textoNoPuedeSalir('present_in_equal_split', [], es)).toBe(
      'Estás entre los que estuvieron en un ticket en partes iguales. Podrás salir cuando se cierre el viaje y quede todo pagado.');
    expect(textoNoPuedeSalir('paid_ticket', [], en)).toMatch(/^You paid a ticket on this trip\./);
  });

  it('🔴 H02 · marcar «Ya pagué» solo no alcanza (D242-1): el texto pide las transferencias confirmadas', () => {
    for (const tk of [[], consumo(1), consumo(3)]) {
      expect(textoNoPuedeSalir('selection', tk, es)).not.toMatch(/marques|pagada/);
    }
  });

  it('H02 · con el viaje en esperando pagos o cerrado: cuántas transferencias tuyas faltan confirmar', () => {
    expect(textoTransferenciasPendientes(1, es)).toBe('Tienes 1 transferencia sin confirmar. Podrás salir cuando esté confirmada.');
    expect(textoTransferenciasPendientes(2, es))
      .toBe('Tienes 2 transferencias sin confirmar. Podrás salir cuando todas estén confirmadas.');
    expect(textoTransferenciasPendientes(2, en)).toBe('You have 2 unconfirmed transfers. You can leave once they are all confirmed.');
  });
});

describe('1m · la hoja de cierre', () => {
  function preview(extra: Partial<VistaPreviaCierre>): VistaPreviaCierre {
    return { todos_eligieron: false, tickets: 5, asignaciones: [], balances: [], transferencias: [], ...extra };
  }
  const fila = (miembro_id: string | null, monto_cents: number, ticket_id = 'tk-1', lugar: string | null = 'Mariscos El Faro') =>
    ({ ticket_id, lugar, fecha_ticket: '2026-10-08', miembro_id, monto_cents });

  it('una persona: «… se le asignan a {Nombre}» (ajuste decidido de 1m)', () => {
    const p = preview({ asignaciones: [fila(IDS.diego, 56500)] });
    expect(avisosDeCierre(p, viaje(), es, 'es', formatMXN)).toEqual([
      'Diego Torres todavía no eligió en Mariscos El Faro del 8 oct. Si cierras ahora, los $565 que faltan se le asignan a Diego.',
    ]);
  });

  it('si soy yo: «Todavía no elegiste… se te asignan a ti.»', () => {
    const p = preview({ asignaciones: [fila(IDS.yo, 12050)] });
    expect(avisosDeCierre(p, viaje(), es, 'es', formatMXN)).toEqual([
      'Todavía no elegiste en Mariscos El Faro del 8 oct. Si cierras ahora, los $120.50 que faltan se te asignan a ti.',
    ]);
  });

  it('varias en un ticket: suma sus filas y reparte en partes iguales; yo primero al empezar, al final adentro', () => {
    const p = preview({ asignaciones: [fila(IDS.diego, 30000), fila(IDS.yo, 30000), fila(IDS.sofia, 30000)] });
    expect(avisosDeCierre(p, viaje(), es, 'es', formatMXN)).toEqual([
      'Tú, Diego Torres y Sofía Ramírez todavía no eligieron en Mariscos El Faro del 8 oct. '
        + 'Si cierras ahora, los $900 que faltan se reparten en partes iguales entre Diego, Sofía y tú.',
    ]);
  });

  it('una frase por ticket, en el orden del dueño; sin comercio leído, el tipo de lugar del ticket', () => {
    const p = preview({ asignaciones: [fila(IDS.diego, 100, 'tk-1'), fila(IDS.diego, 200, 'tk-2', null)] });
    const out = avisosDeCierre(p, viaje(), es, 'es', formatMXN);
    expect(out).toHaveLength(2);
    expect(out[1]).toContain('en Bar del 8 oct');
  });

  it('todos eligieron: con el número de tickets; uno solo en singular; sin tickets, nada', () => {
    expect(avisosDeCierre(preview({ todos_eligieron: true, tickets: 5 }), viaje(), es, 'es', formatMXN))
      .toEqual(['Todos eligieron lo suyo en los 5 tickets.']);
    expect(avisosDeCierre(preview({ todos_eligieron: true, tickets: 1 }), viaje(), es, 'es', formatMXN))
      .toEqual(['Todos eligieron lo suyo en el ticket.']);
    expect(avisosDeCierre(preview({ todos_eligieron: true, tickets: 0 }), viaje(), es, 'es', formatMXN)).toEqual([]);
  });

  it('en EN', () => {
    const p = preview({ asignaciones: [fila(IDS.diego, 56500)] });
    expect(avisosDeCierre(p, viaje(), en, 'en', formatMXN)).toEqual([
      "Diego Torres hasn't chosen yet at Mariscos El Faro on Oct 8. If you close now, the remaining $565 is assigned to Diego.",
    ]);
  });
});

describe('1n · 1o · 1p · esperando pagos', () => {
  it('qué vista: debo (por hacer o por confirmar), me deben (falta confirmar) o el resto', () => {
    expect(vistaDePagos([tr('a', IDS.yo, IDS.luis, 1, 'pendiente', 'debo')])).toBe('debo');
    expect(vistaDePagos([tr('a', IDS.yo, IDS.luis, 1, 'marcada', 'debo')])).toBe('debo');
    expect(vistaDePagos([tr('a', IDS.yo, IDS.luis, 1, 'pagada', 'debo'), tr('b', IDS.luis, IDS.yo, 1, 'pendiente', 'me_deben')])).toBe('me_deben');
    expect(vistaDePagos([tr('a', IDS.yo, IDS.luis, 1, 'pagada', 'debo'), tr('b', IDS.sofia, IDS.luis, 1, 'pendiente', null)])).toBe('resto');
    expect(vistaDePagos([tr('a', IDS.yo, IDS.luis, 1, 'anulada_por_baja', 'debo')])).toBe('resto');
  });

  it('«Faltan {0} de {1}»: el número del dueño, sin contar la anulada por una baja', () => {
    const v = {
      transferencias: [
        tr('a', IDS.yo, IDS.luis, 54200, 'pagada', 'debo'),
        tr('b', IDS.sofia, IDS.luis, 23000, 'marcada', null),
        tr('c', IDS.diego, IDS.luis, 161200, 'pendiente', null),
        tr('d', 'm-baja', IDS.luis, 100, 'anulada_por_baja', null),
      ],
      transferencias_pendientes: 2,
    };
    expect(progresoDePagos(v)).toEqual({ faltan: 2, total: 3, partes: [true, false, false] });
  });

  it('el estado ajeno: marcada sigue «Pendiente» hasta que confirma quien recibe', () => {
    expect(estadoDeTransferencia(tr('a', IDS.sofia, IDS.luis, 1, 'pendiente', null), es)).toBe('Pendiente');
    expect(estadoDeTransferencia(tr('a', IDS.sofia, IDS.luis, 1, 'marcada', null), es)).toBe('Pendiente');
    expect(estadoDeTransferencia(tr('a', IDS.sofia, IDS.luis, 1, 'pagada', null), es)).toBe('Pagado');
    expect(estadoDeTransferencia(tr('a', IDS.sofia, IDS.luis, 1, 'anulada_por_baja', null), es))
      .toBe('Anulada: una de las cuentas se dio de baja.');
  });

  it('lo que me pagan: cada marcada sola, las demás seguidas juntas, en el orden del dueño', () => {
    const lista = [
      tr('a', IDS.yo, IDS.luis, 1, 'pendiente', 'me_deben'),
      tr('b', IDS.yo, IDS.luis, 1, 'marcada', 'me_deben'),
      tr('c', IDS.yo, IDS.luis, 1, 'pendiente', 'me_deben'),
      tr('d', IDS.yo, IDS.luis, 1, 'pagada', 'me_deben'),
    ];
    expect(tramosDeTransferencias(lista).map((x) => [x.destacada, x.filas.map((f) => f.id)])).toEqual([
      [false, ['a']], [true, ['b']], [false, ['c', 'd']],
    ]);
  });
});
