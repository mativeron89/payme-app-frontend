import { describe, expect, it } from 'vitest';
import { decodeSoltarConsumo } from './soltarConsumo';
import { esMioElegido, sePuedeSoltar } from '../screens/MesaDetailView';
import type { MesaDetail, MesaItem } from './types';

describe('AF-25 · decodeSoltarConsumo', () => {
  it('lee lo que el dueño soltó, y vacío es una respuesta válida', () => {
    expect(decodeSoltarConsumo({ released: [{ item_id: 'i-1', fraction_bps: 5000 }] }))
      .toEqual([{ itemId: 'i-1', fractionBps: 5000 }]);
    expect(decodeSoltarConsumo({ released: [] })).toEqual([]);
  });

  it('🔴 un sobre o una fila rara es un error: no se inventa un «se soltó»', () => {
    for (const malo of [
      null, [], {}, { released: {} },
      { released: [{ item_id: 'i-1' }] },
      { released: [{ item_id: '', fraction_bps: 5000 }] },
      { released: [{ item_id: 'i-1', fraction_bps: 0 }] },
      { released: [{ item_id: 'i-1', fraction_bps: 10001 }] },
      { released: [{ item_id: 'i-1', fraction_bps: 2.5 }] },
    ]) {
      expect(() => decodeSoltarConsumo(malo), JSON.stringify(malo)).toThrow('release_response_malformed');
    }
  });
});

const ITEM: MesaItem = {
  id: 'i-1', name: 'Tagliatelle Bolognese', category: 'pasta', price_cents: 19500, quantity: 1,
  status: 'locked', remaining_bps: 0, my_bps: 10000, locked_by_me: true, lock_expires_at: null,
};

const MESA = {
  status: 'open',
  paid_amount_cents: 0,
  division_mode: 'consumo',
} as unknown as MesaDetail;

describe('AF-25 · cuándo se ofrece «Soltar»', () => {
  it('control positivo: mío, reservado, mesa abierta y sin pagos', () => {
    expect(sePuedeSoltar(ITEM, MESA, true)).toBe(true);
  });

  it('🔴 nunca sobre lo pagado', () => {
    expect(sePuedeSoltar({ ...ITEM, status: 'paid' }, MESA, true)).toBe(false);
  });

  it('🔴 con cualquier pago en la mesa no se ofrece: my_bps no distingue lo mío pagado (G-40)', () => {
    expect(sePuedeSoltar(ITEM, { ...MESA, paid_amount_cents: 1 }, true)).toBe(false);
  });

  it('nunca en «igual», ni sobre lo de otro, ni con la mesa no abierta', () => {
    expect(sePuedeSoltar(ITEM, MESA, false)).toBe(false);
    expect(sePuedeSoltar({ ...ITEM, my_bps: 0 }, MESA, true)).toBe(false);
    expect(sePuedeSoltar({ ...ITEM, locked_by_me: false }, MESA, true)).toBe(false);
    expect(sePuedeSoltar(ITEM, { ...MESA, status: 'partially_paid' } as MesaDetail, true)).toBe(false);
  });

  it('«Lo elegiste» sí aparece con pagos en la mesa: sigue siendo cierto', () => {
    expect(esMioElegido(ITEM, true)).toBe(true);
    expect(esMioElegido({ ...ITEM, status: 'paid' }, true)).toBe(false);
    expect(esMioElegido(ITEM, false)).toBe(false);
  });
});
