import { describe, expect, it } from 'vitest';
import { decodeMisMesas } from './misMesas';

/** AF-24 · `GET /api/mesas/mine` se decodifica campo por campo. */

const fila = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  code: 'PA-7310',
  restaurant: { name: 'Tacos El Güero', category: 'mexican' },
  status: 'expired',
  division_mode: 'consumo',
  guarantee_mode: false,
  closure_reason: 'all_items_selected',
  created_at: '2026-09-16T20:00:00.000Z',
  mine: { items_count: 3, amount_cents: 45000 },
};

describe('decodeMisMesas', () => {
  it('control positivo: la forma del dueño se lee entera', () => {
    const r = decodeMisMesas({ mesas: [fila], page: { limit: 20, next_cursor: 'abc' } });
    expect(r.nextCursor).toBe('abc');
    expect(r.mesas).toEqual([{
      id: fila.id, code: 'PA-7310', restaurante: 'Tacos El Güero', categoria: 'mexican',
      status: 'expired', divisionMode: 'consumo', guaranteeMode: false,
      closureReason: 'all_items_selected', createdAt: fila.created_at, itemsCount: 3, amountCents: 45000,
    }]);
  });

  it('🔴 un sobre que no es del dueño es un error, no una lista vacía', () => {
    for (const malo of [null, [], {}, { mesas: {} }, { mesas: [] }, { mesas: [], page: { next_cursor: 7 } }]) {
      // El mensaje importa: un TypeError por leer `undefined` también «tira», y
      // taparía que la guarda del sobre no está (mutante M4 de AF-24).
      expect(() => decodeMisMesas(malo), JSON.stringify(malo)).toThrow('mis_mesas_response_malformed');
    }
  });

  it('🔴 una fila sin id, código o estado se descarta sola, sin llevarse la lista', () => {
    const r = decodeMisMesas({
      mesas: [{ ...fila, id: undefined }, { ...fila, code: '' }, { ...fila, status: 3 }, 'x', fila],
      page: { limit: 20, next_cursor: null },
    });
    expect(r.mesas.map((m) => m.code)).toEqual(['PA-7310']);
  });

  it('🔴 un monto o conteo que no es entero ≥ 0 cae en null (la fila no lo muestra)', () => {
    for (const mine of [{ items_count: -1, amount_cents: 1.5 }, { items_count: '3', amount_cents: '45000' }, undefined]) {
      const [m] = decodeMisMesas({ mesas: [{ ...fila, mine }], page: { limit: 20, next_cursor: null } }).mesas;
      expect([m!.itemsCount, m!.amountCents], JSON.stringify(mine)).toEqual([null, null]);
    }
  });

  it('valores fuera del enum del dueño caen en null, sin inventar', () => {
    const [m] = decodeMisMesas({
      mesas: [{ ...fila, division_mode: 'mitad', guarantee_mode: 'no', closure_reason: 'otro' }],
      page: { limit: 20, next_cursor: null },
    }).mesas;
    expect([m!.divisionMode, m!.guaranteeMode, m!.closureReason]).toEqual([null, null, null]);
  });
});
