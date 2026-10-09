import { describe, expect, it } from 'vitest';
import { balanceDelViaje, consumoDelTicket, precioInformativo, transferenciasMinimas, type TicketParaCalculo } from './viajesCalculo';

/**
 * AF-VIAJES · el port del cálculo del dueño (`contract-mirror/services/viajesCalculo.js`,
 * App Backend 2.171.0), sólo para el mock. Todo en centavos enteros.
 */

const persona = (user_id: string, extra: Partial<{ presente: boolean; listo: boolean; vivo: boolean }> = {}) =>
  ({ user_id, presente: true, listo: true, vivo: true, ...extra });

describe('transferenciasMinimas · el mínimo exacto, no el voraz', () => {
  it('🔴 el contraejemplo del dueño: [+3, −3, +3, +2, +2, −7] son 4 transferencias, no 5', () => {
    const balances = [3, -3, 3, 2, 2, -7].map((cents, i) => ({ id: `m${i}`, cents }));
    const t = transferenciasMinimas(balances);
    expect(t).toHaveLength(4);
    // Saldan exactamente a cada uno.
    const neto = new Map(balances.map((b) => [b.id, b.cents]));
    for (const x of t) {
      neto.set(x.de, neto.get(x.de)! + x.monto_cents);
      neto.set(x.a, neto.get(x.a)! - x.monto_cents);
    }
    expect([...neto.values()].every((c) => c === 0)).toBe(true);
    // El primer grupo es {m0, m1}: m1 le paga 3 a m0.
    expect(t[0]).toEqual({ de: 'm1', a: 'm0', monto_cents: 3 });
  });

  it('misma entrada, misma salida; sin balances, nada', () => {
    const b = [{ id: 'a', cents: -542 }, { id: 'b', cents: 2384 }, { id: 'c', cents: -230 }, { id: 'd', cents: -1612 }];
    expect(transferenciasMinimas(b)).toEqual(transferenciasMinimas(b));
    expect(transferenciasMinimas(b)).toEqual([
      { de: 'd', a: 'b', monto_cents: 1612 },
      { de: 'a', a: 'b', monto_cents: 542 },
      { de: 'c', a: 'b', monto_cents: 230 },
    ]);
    expect(transferenciasMinimas([{ id: 'a', cents: 0 }])).toEqual([]);
  });

  it('falla cerrado si los balances no suman 0', () => {
    expect(() => transferenciasMinimas([{ id: 'a', cents: 1 }])).toThrow('viaje_balance_no_cuadra');
  });
});

describe('consumoDelTicket · las tres formas', () => {
  const base = (forma: TicketParaCalculo['forma'], extra: Partial<TicketParaCalculo> = {}): TicketParaCalculo => ({
    id: 't', forma, pagado_por: 'a', monto_cents: 1001,
    items: [{ id: 'i1', line_cents: 1001 }],
    personas: [persona('a'), persona('b'), persona('c')],
    selecciones: [],
    ...extra,
  });

  it('pagar el total: todo a quien pagó', () => {
    expect([...consumoDelTicket(base('total')).consumo]).toEqual([['a', 1001]]);
  });

  it('en partes iguales: entre los presentes, el centavo de más a los primeros', () => {
    const r = consumoDelTicket(base('iguales', { personas: [persona('a'), persona('b', { presente: false }), persona('c')] }));
    expect([...r.consumo]).toEqual([['a', 501], ['c', 500]]);
  });

  it('por consumo: en vivo lo no elegido no es de nadie; al cerrar, a quien no eligió (D242-4)', () => {
    const t = base('consumo', {
      personas: [persona('a'), persona('b', { listo: false }), persona('c')],
      selecciones: [{ item_id: 'i1', user_id: 'a', fraction_bps: 5000 }],
    });
    const vivo = consumoDelTicket(t);
    expect(vivo.sinRepartir).toBe(500);
    expect(vivo.faltan).toEqual(['b']);
    const cierre = consumoDelTicket(t, { cierre: true });
    expect(cierre.asignado.get('b')).toBe(500);
    expect(cierre.sinRepartir).toBe(0);
  });

  it('la porción que completa el plato paga lo que queda', () => {
    expect(precioInformativo(1000, 3333, 6666, 667)).toBe(333);
    expect(precioInformativo(1000, 3333, 0, 0)).toBe(333);
  });
});

describe('balanceDelViaje', () => {
  it('pagó − consumió, y la suma da 0 también mientras se elige', () => {
    const t: TicketParaCalculo = {
      id: 't', forma: 'consumo', pagado_por: 'a', monto_cents: 1000,
      items: [{ id: 'i1', line_cents: 1000 }],
      personas: [persona('a'), persona('b', { listo: false })],
      selecciones: [{ item_id: 'i1', user_id: 'a', fraction_bps: 2500 }],
    };
    const b = balanceDelViaje(['a', 'b'], [t]);
    expect(b.balance.get('a')).toBe(0);
    expect(b.balance.get('b')).toBe(0);
    expect(b.gasto).toBe(1000);
  });
});
