import { describe, expect, it } from 'vitest';
import type { TuMesa } from '../api/misMesas';
import type { VisitaDeViaje } from '../api/viajesVisitas';
import type { HistorialMesa } from './historialView';
import {
  agregarSinRepetir,
  agruparLineaPorMes,
  claveDeRenglon,
  estadoDeLasVisitas,
  fechaDeRenglon,
  instanteDeRenglon,
  mezclarPorFecha,
  type FuenteDeLinea,
  type RenglonDeMesas,
} from './mesasEnLinea';

/**
 * 🔴 D293 · la mezcla de Mesas: las mesas y las visitas llegan de a páginas, los pagos completos. Lo visible tiene que
 * ser siempre un PREFIJO de la mezcla completa: al cargar más, nada se saltea, nada se repite y nada aparece arriba de lo
 * que ya se veía.
 */

interface R { readonly lista: string; readonly n: number; readonly t: number | null }
const instante = (r: R) => r.t;

/** Un generador con semilla fija (mulberry32): las listas «al azar» son siempre las mismas. */
function azar(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Una lista ordenada de la más nueva a la más vieja, con empates. */
function listaAlAzar(rnd: () => number, lista: string, largo: number): R[] {
  let t = 1_000_000;
  return Array.from({ length: largo }, (_, n) => {
    t -= Math.floor(rnd() * 3); // 0 = empate con el anterior
    return { lista, n, t };
  });
}

/** La mezcla completa de referencia: por instante DESC; en un empate, la lista que va antes; dentro, su orden. */
function mezclaCompleta(listas: readonly R[][]): R[] {
  const todas = listas.flatMap((l, i) => l.map((r, k) => ({ r, i, k })));
  return todas
    .sort((a, b) => (b.r.t! - a.r.t!) || (a.i - b.i) || (a.k - b.k))
    .map((x) => x.r);
}

const fuente = (clave: string, renglones: readonly R[], hayMas: boolean, estado: FuenteDeLinea<string, R>['estado'] = 'lista') =>
  ({ clave, estado, renglones, hayMas });

describe('🔴 D293 · la mezcla por fecha: un prefijo de la mezcla completa', () => {
  it('sin más por pedir: todo, por fecha; en un empate, la lista que va antes', () => {
    const a = [{ lista: 'a', n: 0, t: 30 }, { lista: 'a', n: 1, t: 10 }];
    const b = [{ lista: 'b', n: 0, t: 30 }, { lista: 'b', n: 1, t: 20 }];
    const m = mezclarPorFecha([fuente('a', a, false), fuente('b', b, false)], instante);
    expect(m.renglones.map((r) => `${r.lista}${r.n}`)).toEqual(['a0', 'b0', 'b1', 'a1']);
    expect(m).toMatchObject({ conMas: [], cargando: false });
  });

  it('una lista con más frena donde se le acaban los renglones cargados: lo más viejo de las otras espera', () => {
    const mesas = [{ lista: 'm', n: 0, t: 50 }, { lista: 'm', n: 1, t: 40 }];
    const viajes = [{ lista: 'v', n: 0, t: 45 }, { lista: 'v', n: 1, t: 30 }, { lista: 'v', n: 2, t: 10 }];
    const m = mezclarPorFecha([fuente('m', mesas, true), fuente('v', viajes, false)], instante);
    // 30 y 10 esperan: la página siguiente de las mesas puede traer algo entre 40 y 10.
    expect(m.renglones.map((r) => `${r.lista}${r.n}`)).toEqual(['m0', 'v0', 'm1']);
    expect(m.conMas).toEqual(['m']);
  });

  it('una lista que todavía carga frena todo (no se sabe dónde caen sus renglones); una que falló o no existe, no participa', () => {
    const a = [{ lista: 'a', n: 0, t: 10 }];
    expect(mezclarPorFecha([fuente('a', a, false), fuente('b', [], false, 'cargando')], instante))
      .toEqual({ renglones: [], conMas: [], cargando: true });
    for (const estado of ['fallo', 'ausente'] as const) {
      const m = mezclarPorFecha([fuente('a', a, false), fuente('b', [{ lista: 'b', n: 0, t: 99 }], true, estado)], instante);
      expect(m, estado).toEqual({ renglones: a, conMas: [], cargando: false });
    }
  });

  it('un renglón sin fecha legible conserva su lugar en su lista (toma el instante del anterior)', () => {
    const a = [{ lista: 'a', n: 0, t: 50 }, { lista: 'a', n: 1, t: null }, { lista: 'a', n: 2, t: 20 }];
    const b = [{ lista: 'b', n: 0, t: 40 }];
    const m = mezclarPorFecha([fuente('a', a, false), fuente('b', b, false)], instante);
    expect(m.renglones.map((r) => `${r.lista}${r.n}`)).toEqual(['a0', 'a1', 'b0', 'a2']);
    // Primero de su lista y sin fecha: va primero.
    const c = [{ lista: 'c', n: 0, t: null }, { lista: 'c', n: 1, t: 5 }];
    expect(mezclarPorFecha([fuente('b', b, false), fuente('c', c, false)], instante).renglones.map((r) => `${r.lista}${r.n}`))
      .toEqual(['c0', 'b0', 'c1']);
  });

  it('🔴 con listas al azar (semilla fija) y «Ver más» hasta el final: cada paso es un prefijo, sólo crece por abajo, y al final es todo', () => {
    for (let semilla = 1; semilla <= 300; semilla += 1) {
      const rnd = azar(semilla);
      const completas = [
        listaAlAzar(rnd, 'mesas', Math.floor(rnd() * 30)),
        listaAlAzar(rnd, 'viajes', Math.floor(rnd() * 30)),
        listaAlAzar(rnd, 'pagos', Math.floor(rnd() * 8)),
      ];
      const referencia = mezclaCompleta(completas);
      const porPagina = [1 + Math.floor(rnd() * 5), 1 + Math.floor(rnd() * 5)];
      const cargadas = [porPagina[0]!, porPagina[1]!, completas[2]!.length];
      let antes: readonly R[] = [];
      for (let paso = 0; paso < 100; paso += 1) {
        const fuentes = completas.map((l, i) => fuente(['mesas', 'viajes', 'pagos'][i]!, l.slice(0, cargadas[i]), cargadas[i]! < l.length));
        const m = mezclarPorFecha(fuentes, instante);
        expect(m.renglones, `semilla ${semilla}, paso ${paso}`).toEqual(referencia.slice(0, m.renglones.length));
        expect(m.renglones.slice(0, antes.length), `semilla ${semilla}: lo que se veía no se mueve`).toEqual(antes);
        expect(new Set(m.renglones).size).toBe(m.renglones.length);
        antes = m.renglones;
        if (m.conMas.length === 0) {
          expect(m.renglones, `semilla ${semilla}: al final, todo`).toEqual(referencia);
          break;
        }
        // «Ver más»: la página siguiente de cada lista que frena.
        for (const clave of m.conMas) {
          const i = ['mesas', 'viajes'].indexOf(clave);
          cargadas[i] = Math.min(completas[i]!.length, cargadas[i]! + porPagina[i]!);
        }
      }
      expect(antes, `semilla ${semilla}`).toEqual(referencia);
    }
  });
});

const mesa = (id: string, createdAt: string | null): TuMesa => ({
  id, code: `PA-${id}`, restaurante: 'La Parolaccia', categoria: 'italian', status: 'expired', divisionMode: 'consumo',
  guaranteeMode: false, closureReason: 'time', createdAt, itemsCount: 1, amountCents: 100, items: null, eleccionInformativa: false,
});
const pago = (code: string, date: string): HistorialMesa => ({
  mesa_code: code, payment_ids: ['p1'], restaurant: 'Hanzo', category: 'japanese', amount_cents: 41800, date, mesa_status: 'completed',
});
const visita = (id: string, instanteIso: string): VisitaDeViaje => ({
  ticket_id: id, viaje: { id: 'v1', nombre: 'Holbox', color: 'azul', has_photo: false }, lugar: 'Mariscos', tipo_lugar: 'restaurante',
  instante: instanteIso, te_toca_cents: 53000,
});

describe('D293 · los renglones de Mesas y sus meses', () => {
  it('la fecha de cada renglón es la que muestra su fila: la de la mesa, la del pago y el instante de la visita', () => {
    const rs: RenglonDeMesas[] = [
      { tipo: 'mesa', mesa: mesa('m1', '2026-10-11T18:00:00.000Z') },
      { tipo: 'pago', mesa: pago('PA-1', '2026-10-10T18:00:00.000Z') },
      { tipo: 'viaje', visita: visita('t1', '2026-10-09T03:40:00.000Z') },
      { tipo: 'mesa', mesa: mesa('m2', null) },
    ];
    expect(rs.map(fechaDeRenglon)).toEqual(['2026-10-11T18:00:00.000Z', '2026-10-10T18:00:00.000Z', '2026-10-09T03:40:00.000Z', null]);
    expect(rs.map(instanteDeRenglon)).toEqual([Date.parse('2026-10-11T18:00:00.000Z'), Date.parse('2026-10-10T18:00:00.000Z'), Date.parse('2026-10-09T03:40:00.000Z'), null]);
    expect(rs.map(claveDeRenglon)).toEqual(['mesa:m1', 'pago:PA-1', 'viaje:t1', 'mesa:m2']);
    expect(instanteDeRenglon({ tipo: 'mesa', mesa: mesa('m3', 'ayer') })).toBeNull();
  });

  it('🔴 los grupos por mes: la regla del historial (el mes en la zona elegida), para los tres tipos de renglón', () => {
    const rs: RenglonDeMesas[] = [
      { tipo: 'mesa', mesa: mesa('m1', '2026-10-11T18:00:00.000Z') },
      // El 1 de octubre a las 03:40 UTC todavía es septiembre en México: va con septiembre.
      { tipo: 'viaje', visita: visita('t1', '2026-10-01T03:40:00.000Z') },
      { tipo: 'pago', mesa: pago('PA-1', '2026-09-20T18:00:00.000Z') },
      { tipo: 'viaje', visita: visita('t2', '2026-08-15T04:00:00.000Z') },
    ];
    const meses = agruparLineaPorMes(rs, 'es-MX', 'America/Mexico_City');
    expect(meses.map((g) => [g.key, g.label, g.renglones.map(claveDeRenglon)])).toEqual([
      ['2026-10', 'octubre de 2026', ['mesa:m1']],
      ['2026-09', 'septiembre de 2026', ['viaje:t1', 'pago:PA-1']],
      ['2026-08', 'agosto de 2026', ['viaje:t2']],
    ]);
    // En UTC, el mismo renglón de viaje es de octubre: la zona decide, como en el historial.
    expect(agruparLineaPorMes(rs.slice(0, 2), 'es-MX', 'UTC').map((g) => g.key)).toEqual(['2026-10']);
  });

  it('un renglón sin fecha va a «Sin fecha»', () => {
    const meses = agruparLineaPorMes([{ tipo: 'mesa', mesa: mesa('m1', null) }], 'es-MX', 'America/Mexico_City');
    expect(meses).toEqual([{ key: 'sin-fecha', label: 'Sin fecha', renglones: [{ tipo: 'mesa', mesa: mesa('m1', null) }] }]);
  });
});

describe('D293 · las visitas de viaje como fuente de la mezcla', () => {
  it('Viajes apagado: no participan y no hay aviso; sin saber todavía: frenan; sin config: no participan (Mesas no espera para siempre)', () => {
    const e = (capacidad: 'pendiente' | 'encendida' | 'apagada', extra: Partial<{ configFallo: boolean; fallo: boolean; cargadas: boolean }> = {}) =>
      estadoDeLasVisitas({ capacidad, configFallo: false, fallo: false, cargadas: false, ...extra });
    expect(e('apagada')).toBe('ausente');
    expect(e('apagada', { cargadas: true })).toBe('ausente');
    expect(e('pendiente')).toBe('cargando');
    expect(e('pendiente', { configFallo: true })).toBe('ausente');
    expect(e('encendida')).toBe('cargando');
    expect(e('encendida', { cargadas: true })).toBe('lista');
    expect(e('encendida', { fallo: true })).toBe('fallo');
    // La config que falló una vez no apaga los viajes si después llegó encendida.
    expect(e('encendida', { configFallo: true, cargadas: true })).toBe('lista');
  });

  it('la página siguiente va al final; un ticket que vuelve a venir (su fecha se corrigió) queda una sola vez, donde estaba', () => {
    const a = visita('t1', '2026-10-09T03:40:00.000Z');
    const b = visita('t2', '2026-10-08T03:40:00.000Z');
    const c = visita('t3', '2026-10-07T03:40:00.000Z');
    expect(agregarSinRepetir(null, [a])).toEqual([a]);
    expect(agregarSinRepetir([a, b], [c])).toEqual([a, b, c]);
    expect(agregarSinRepetir([a, b], [{ ...b, instante: '2026-10-06T00:00:00.000Z' }, c])).toEqual([a, b, c]);
  });
});
