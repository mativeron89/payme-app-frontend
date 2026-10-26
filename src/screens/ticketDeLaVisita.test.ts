import { describe, expect, it } from 'vitest';
import type { MesaDetail, MesaItem } from '../api/types';
import { filasDelTicket, prefijoDeItem, prefijoDeLoMio } from './ticketDeLaVisita';

function item(over: Partial<MesaItem>): MesaItem {
  return {
    id: 'i', name: 'Plato', category: 'food', price_cents: 1000, quantity: 1, status: 'available',
    remaining_bps: 0, my_bps: 0, locked_by_me: false, lock_expires_at: null, ...over,
  } as MesaItem;
}
const mesa = (items: MesaItem[], division_mode: MesaDetail['division_mode'] = 'consumo') => ({ division_mode, items });

describe('D479/D482 · AF-2 · lo que va delante del nombre', () => {
  it('la cantidad sólo con la línea entera tuya y más de una unidad; si no, la porción', () => {
    expect(prefijoDeItem(10000, 2)).toBe('2');
    expect(prefijoDeItem(10000, 1)).toBeNull();
    expect(prefijoDeItem(10000, null)).toBeNull();
    expect(prefijoDeItem(5000, 1)).toBe('½');
    // La mitad de una línea de 2 no es «1 agua que pediste vos».
    expect(prefijoDeItem(5000, 2)).toBe('½');
    expect(prefijoDeLoMio({ name: 'Agua mineral', fractionBps: 10000, amountCents: 9000, quantity: 2 })).toBe('2');
  });
});

describe('D479/D482 · AF-1 · «Ver todo el ticket» agrega lo de los demás, sin quién', () => {
  it('por consumo: lo de otro y lo que nadie eligió, por línea, en el orden de la mesa', () => {
    const filas = filasDelTicket(mesa([
      item({ name: 'Pizza', price_cents: 18000, my_bps: 0, remaining_bps: 0 }),
      item({ name: 'Tiramisú', price_cents: 26222, my_bps: 5000, remaining_bps: 0 }),
      item({ name: 'Agua mineral', price_cents: 4500, quantity: 2, my_bps: 0, remaining_bps: 0 }),
      item({ name: 'Pan', price_cents: 3000, my_bps: 0, remaining_bps: 10000 }),
      item({ name: 'Mío entero', price_cents: 5000, my_bps: 10000, remaining_bps: 0 }),
    ]));
    expect(filas).toEqual([
      { tipo: 'otro', name: 'Pizza', prefijo: null, amountCents: 18000 },
      { tipo: 'otro', name: 'Tiramisú', prefijo: '½', amountCents: 13111 },
      { tipo: 'otro', name: 'Agua mineral', prefijo: '2', amountCents: 9000 },
      { tipo: 'libre', name: 'Pan', prefijo: null, amountCents: 3000 },
    ]);
  });

  it('una línea repartida entre lo mío, lo de otro y lo que nadie eligió da dos filas', () => {
    const filas = filasDelTicket(mesa([item({ name: 'Paella', price_cents: 30000, my_bps: 3333, remaining_bps: 3334 })]));
    expect(filas?.map((f) => [f.tipo, f.prefijo])).toEqual([['otro', '⅓'], ['libre', '⅓']]);
  });

  it('🔴 una tenencia ilegible no inventa «Lo eligió otro»: el ticket entero, neutro', () => {
    for (const raro of [
      { my_bps: 6000, remaining_bps: 6000 },
      { my_bps: -1, remaining_bps: 0 },
      { my_bps: 0, remaining_bps: undefined as unknown as number },
    ]) {
      const filas = filasDelTicket(mesa([item({ name: 'Pizza', quantity: 2, ...raro }), item({ name: 'Pan' })]));
      expect(filas?.every((f) => f.tipo === 'ticket'), JSON.stringify(raro)).toBe(true);
      expect(filas?.[0]).toEqual({ tipo: 'ticket', name: 'Pizza', prefijo: '2', amountCents: 2000 });
    }
  });

  it('partes iguales: el ticket entero, sin decir quién eligió qué', () => {
    const filas = filasDelTicket(mesa([item({ name: 'Pizza', my_bps: 0, remaining_bps: 0 })], 'igual'));
    expect(filas).toEqual([{ tipo: 'ticket', name: 'Pizza', prefijo: null, amountCents: 1000 }]);
  });

  it('ítems ilegibles: `null` (la pantalla muestra el error con «Reintentar»)', () => {
    expect(filasDelTicket({ division_mode: 'consumo', items: undefined as unknown as MesaItem[] })).toBeNull();
    expect(filasDelTicket(mesa([item({ name: ' ' })]))).toBeNull();
    expect(filasDelTicket(mesa([item({ quantity: 0 })]))).toBeNull();
    expect(filasDelTicket(mesa([item({ price_cents: 1.5 })]))).toBeNull();
  });

  it('🔴 sólo nombre, porción e importe: ninguna identidad sale de la mesa', () => {
    const filas = filasDelTicket(mesa([item({ name: 'Pizza' })]));
    expect(Object.keys(filas![0]!).sort()).toEqual(['amountCents', 'name', 'prefijo', 'tipo']);
  });
});
