import { describe, expect, it } from 'vitest';
import type { TicketEnViaje } from '../../api/viajes';
import { agruparConsumos, claveDelLugar, instanteDeLaVisita, ordenarPorVisita } from './consumosPorLugar';

/**
 * Cada ticket se carga un minuto ANTES que el anterior: la lista llega como la manda el dueño, la última carga primero.
 * Todos con el mismo día impreso y sin hora: con la visita empatada, desempata la carga (W-01), y las pruebas de agrupar
 * no dependen del orden.
 */
let cargas = 0;
function tk(id: string, lugar: string | null, monto_cents: number, extra: Partial<TicketEnViaje> = {}): TicketEnViaje {
  cargas += 1;
  return {
    id, lugar, tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: null,
    cargado_en: new Date(Date.parse('2026-10-09T03:40:00.000Z') - cargas * 60_000).toISOString(),
    forma: 'iguales', pagado_por: 'm1', pagaste_tu: true, te_toca_cents: 0, falta_que_elija: 0, sin_repartir_cents: 0,
    monto_cents, origen: 'escaneo', puede_eliminar: true, pagadores: [{ miembro_id: 'm1', monto_cents }], presentes: [],
    personal: false, servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0, total_cents: monto_cents, ...extra,
  };
}

const ids = (xs: ReturnType<typeof agruparConsumos>) => xs.map((g) => g.tickets.map((t) => t.id));

describe('🔴 D281 · la clave del lugar', () => {
  it('sin mayúsculas, sin espacios de más, sin tilde, acento grave ni diéresis', () => {
    expect(claveDelLugar('  Bar   La Ola ')).toBe('bar la ola');
    expect(claveDelLugar('BAR LA OLA')).toBe(claveDelLugar('bar la ola'));
    expect(claveDelLugar('Café Caribe')).toBe(claveDelLugar('CAFE CARIBE'));
    expect(claveDelLugar('Tacos El Güero')).toBe(claveDelLugar('tacos el guero'));
    expect(claveDelLugar('Crêperie')).not.toBe(claveDelLugar('creperie'));
    expect(claveDelLugar('Bar\tLa Ola')).toBe('bar la ola');
  });

  it('la ñ se conserva: «Peña» no es «Pena»', () => {
    expect(claveDelLugar('La Peña')).toBe('la peña');
    expect(claveDelLugar('LA PEÑA')).toBe('la peña');
    expect(claveDelLugar('La Peña')).not.toBe(claveDelLugar('La Pena'));
    // Escrita ya separada (n + virgulilla), sigue siendo ñ.
    expect(claveDelLugar('La Peña')).toBe('la peña');
  });

  it('sin lugar, o sólo espacios, no hay clave: no se agrupa', () => {
    expect(claveDelLugar(null)).toBeNull();
    expect(claveDelLugar('   ')).toBeNull();
  });
});

describe('🔴 D281 · agrupar los consumos por lugar', () => {
  it('una visita queda sola; el mismo lugar escrito distinto se junta, con su total', () => {
    const g = agruparConsumos([
      tk('a', 'Bar La Ola', 30000),
      tk('b', 'Fonda Doña Mary', 184000),
      tk('c', 'bar  la ola ', 15000),
      tk('d', 'BAR LA OLA', 96000),
    ]);
    expect(ids(g)).toEqual([['a', 'c', 'd'], ['b']]);
    expect(g.map((x) => x.total_cents)).toEqual([141000, 184000]);
  });

  it('con la visita empatada (el mismo día, sin hora), desempata la carga: cada lugar donde está su más reciente', () => {
    const g = agruparConsumos([tk('1', 'Café', 1), tk('2', 'Bar', 2), tk('3', 'Café', 3), tk('4', 'Súper', 4), tk('5', 'Bar', 5)]);
    expect(ids(g)).toEqual([['1', '3'], ['2', '5'], ['4']]);
  });

  it('sin lugar, cada uno es su fila, aunque compartan el rótulo', () => {
    const g = agruparConsumos([tk('x', null, 100), tk('y', null, 200), tk('z', '   ', 300)]);
    expect(ids(g)).toEqual([['x'], ['y'], ['z']]);
  });

  it('el personal no se mezcla con lo del viaje: se junta sólo con otros personales del mismo lugar', () => {
    const g = agruparConsumos([
      tk('p1', 'Oxxo', 5000, { personal: true }),
      tk('v1', 'Oxxo', 20000),
      tk('p2', 'OXXO', 7000, { personal: true }),
      tk('v2', 'oxxo', 10000),
    ]);
    expect(ids(g)).toEqual([['p1', 'p2'], ['v1', 'v2']]);
    expect(g.map((x) => x.total_cents)).toEqual([12000, 30000]);
  });

  it('ticket y gasto se juntan si se llaman igual, aunque el tipo de lugar sea otro', () => {
    const g = agruparConsumos([tk('g', 'Bar La Ola', 300, { origen: 'manual', tipo_lugar: 'otro' }), tk('t', 'Bar La Ola', 900, { tipo_lugar: 'bar' })]);
    expect(ids(g)).toEqual([['g', 't']]);
  });

  it('la clave de la fila es estable: no depende de qué ticket es el más reciente', () => {
    const antes = agruparConsumos([tk('a', 'Bar', 1), tk('b', 'bar', 2)]);
    const despues = agruparConsumos([tk('b', 'bar', 2)]);
    const conOtro = agruparConsumos([tk('n', 'BAR ', 3), tk('a', 'Bar', 1), tk('b', 'bar', 2)]);
    expect(conOtro[0]!.clave).toBe(antes[0]!.clave);
    expect(despues[0]!.clave).toBe(antes[0]!.clave);
  });

  it('sin tickets, nada', () => {
    expect(agruparConsumos([])).toEqual([]);
  });
});

/** Un ticket con su fecha impresa, su hora y su carga, para el orden de la visita. */
function visita(id: string, lugar: string | null, fecha: string | null, hora: string | null, carga: string | null,
  extra: Partial<TicketEnViaje> = {}): TicketEnViaje {
  return tk(id, lugar, 100, { fecha_ticket: fecha, hora_ticket: hora, cargado_en: carga, ...extra });
}

describe('🔴 W-01 · Balance ordena por la visita, no por la carga (D281, D278-1)', () => {
  it('el instante: la fecha y la hora impresas en hora de México; sin hora, las 12:00; sin fecha, la carga', () => {
    expect(instanteDeLaVisita(visita('a', 'X', '2026-10-09', '13:30', '2026-10-01T00:00:00Z'))).toBe(Date.parse('2026-10-09T19:30:00Z'));
    expect(instanteDeLaVisita(visita('b', 'X', '2026-10-09', null, '2026-10-01T00:00:00Z'))).toBe(Date.parse('2026-10-09T18:00:00Z'));
    expect(instanteDeLaVisita(visita('c', 'X', null, null, '2026-10-03T15:20:00.000Z'))).toBe(Date.parse('2026-10-03T15:20:00.000Z'));
    // Una hora sin fecha no alcanza: va por la carga.
    expect(instanteDeLaVisita(visita('d', 'X', null, '21:00', '2026-10-03T15:20:00.000Z'))).toBe(Date.parse('2026-10-03T15:20:00.000Z'));
    expect(instanteDeLaVisita(visita('e', 'X', null, null, null))).toBeNull();
    // Un ticket de las 23:30 en México ya es el día siguiente en UTC, y sigue siendo de su día.
    expect(new Date(instanteDeLaVisita(visita('f', 'X', '2026-10-09', '23:30', null))!).toISOString()).toBe('2026-10-10T05:30:00.000Z');
  });

  it('dos lugares con la fecha impresa y la carga opuestas: primero el de la visita más reciente', () => {
    // Lo de la auditoría: «Lugar reciente» del 09/10 cargado a las 10:00; «Lugar antiguo» del 01/10 cargado a las 11:00.
    // El dueño los manda por la carga (el antiguo primero).
    const g = agruparConsumos([
      visita('antiguo', 'Lugar antiguo', '2026-10-01', null, '2026-10-09T17:00:00Z'),
      visita('reciente', 'Lugar reciente', '2026-10-09', null, '2026-10-09T16:00:00Z'),
    ]);
    expect(ids(g)).toEqual([['reciente'], ['antiguo']]);
  });

  it('un solo lugar: adentro, de la visita más reciente a la más vieja, aunque se hayan cargado en el orden contrario', () => {
    const g = agruparConsumos([
      visita('v1', 'Bar La Ola', '2026-10-02', '21:00', '2026-10-09T18:00:00Z'),
      visita('v3', 'bar la ola', '2026-10-06', null, '2026-10-09T17:00:00Z'),
      visita('v2', 'BAR LA OLA', '2026-10-04', '14:00', '2026-10-09T16:00:00Z'),
    ]);
    expect(ids(g)).toEqual([['v3', 'v2', 'v1']]);
  });

  it('el mismo día, con y sin hora: las 13:00 van antes que la que no tiene (las 12:00), y ésa antes que las 11:00', () => {
    const g = agruparConsumos([
      visita('once', 'A', '2026-10-05', '11:00', '2026-10-09T18:00:00Z'),
      visita('sin-hora', 'B', '2026-10-05', null, '2026-10-09T17:00:00Z'),
      visita('trece', 'C', '2026-10-05', '13:00', '2026-10-09T16:00:00Z'),
    ]);
    expect(ids(g)).toEqual([['trece'], ['sin-hora'], ['once']]);
  });

  it('los gastos a mano (sin fecha) van por su carga, mezclados con los tickets por su visita', () => {
    const gasto = (id: string, lugar: string, carga: string) => visita(id, lugar, null, null, carga, { origen: 'manual', tipo_lugar: 'otro' });
    const g = agruparConsumos([
      gasto('taxi', 'Taxi', '2026-10-09T20:00:00Z'),
      visita('cena', 'Fonda Doña Mary', '2026-10-08', '21:00', '2026-10-09T19:00:00Z'),
      gasto('fonda-propina', 'Fonda Doña Mary', '2026-10-06T22:00:00Z'),
      visita('desayuno', 'Café Caribe', '2026-10-07', '09:00', '2026-10-09T18:00:00Z'),
    ]);
    // taxi (carga 09/10 20:00) > cena (08/10 21:00 México) > desayuno (07/10 09:00) > la propina de la fonda (06/10 22:00 UTC).
    expect(ids(g)).toEqual([['taxi'], ['cena', 'fonda-propina'], ['desayuno']]);
    expect(g[1]!.tickets[0]!.id).toBe('cena');
  });

  it('desempate estable: con la misma visita, la carga más reciente; con la misma carga, el id mayor. Sin nada, al final', () => {
    const lista = [
      visita('b', 'X1', '2026-10-05', '20:00', '2026-10-09T10:00:00Z'),
      visita('nada', 'X2', null, null, null),
      visita('a', 'X3', '2026-10-05', '20:00', '2026-10-09T10:00:00Z'),
      visita('c', 'X4', '2026-10-05', '20:00', '2026-10-09T11:00:00Z'),
    ];
    const copia = [...lista];
    expect(ordenarPorVisita(lista).map((x) => x.id)).toEqual(['c', 'b', 'a', 'nada']);
    // No cambia la lista que recibe.
    expect(lista).toEqual(copia);
  });
});
