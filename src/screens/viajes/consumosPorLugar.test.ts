import { describe, expect, it } from 'vitest';
import type { TicketEnViaje } from '../../api/viajes';
import { agruparConsumos, claveDelLugar } from './consumosPorLugar';

function tk(id: string, lugar: string | null, monto_cents: number, extra: Partial<TicketEnViaje> = {}): TicketEnViaje {
  return {
    id, lugar, tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: null, cargado_en: '2026-10-09T03:40:00.000Z',
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

  it('el orden es el del dueño: cada lugar donde está su más reciente, y adentro en el mismo orden', () => {
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
