import { describe, expect, it } from 'vitest';
import type { DivisionSlot, MesaDetail, MesaItem } from '../api/types';
import {
  FRACTIONS,
  availableSlotsOf,
  bpsLabel,
  fractionPreview,
  itemsAmountFor,
  nothingLeftFor,
} from './mesaItemsView';

/**
 * Estas funciones vivían adentro de `MesaScreen`, un componente de 1900 líneas
 * que mueve dinero, y por eso **nunca tuvieron un test**. El split de §1.5 las
 * sacó a un módulo puro; esto es lo que hace que haberlas sacado sirva.
 *
 * Lo que se fija acá no es cosmético: `itemsAmountFor` es el monto que la
 * pantalla le muestra al comensal antes de pagar, y `nothingLeftFor` es lo que
 * decide si se le sigue pidiendo que elija sobre una lista vacía.
 */

function item(over: Partial<MesaItem> = {}): MesaItem {
  return {
    id: 'i1',
    name: 'Plato',
    category: 'main',
    price_cents: 10000,
    quantity: 1,
    status: 'available',
    remaining_bps: 10000,
    my_bps: 0,
    locked_by_me: false,
    lock_expires_at: null,
    ...over,
  };
}

function mesa(over: Partial<MesaDetail> = {}): MesaDetail {
  return {
    id: 'm1',
    code: 'PA-1',
    full_name: 'Mesa PA-1',
    restaurant: { id: 'r1', name: 'La Parolaccia', category: 'italian', address: null },
    total_cents: 84000,
    total_display: '$840.00',
    paid_amount_cents: 0,
    tip_amount_cents: 0,
    tip_base_cents: 21000,
    division_mode: 'consumo',
    expected_participants: 4,
    status: 'open',
    expires_at: '2026-08-05T00:00:00.000Z',
    items: [],
    active_staff: [],
    my_role: 'opener',
    ...over,
  };
}

const slot = (over: Partial<DivisionSlot> = {}): DivisionSlot => ({
  slot_index: 0,
  amount_cents: 21000,
  amount_display: '$210.00',
  status: 'available',
  ...over,
});

describe('bpsLabel', () => {
  it('nombra las cuatro fracciones del contrato', () => {
    expect(bpsLabel(10000)).toBe('entero');
    expect(bpsLabel(5000)).toBe('½');
    expect(bpsLabel(3333)).toBe('⅓');
    expect(bpsLabel(2500)).toBe('¼');
  });

  /**
   * 3334 es el resto que deja el backend al partir un ítem en tercios: 3333 +
   * 3333 + 3334 = 10000. Si se mostrara como "33%", el último en tomar vería un
   * número distinto al de los otros dos sobre la misma fracción.
   */
  it('trata 3334 como un tercio, que es el resto de partir en tres', () => {
    expect(bpsLabel(3334)).toBe('⅓');
  });

  it('cualquier otro valor cae a porcentaje', () => {
    expect(bpsLabel(7500)).toBe('75%');
    expect(bpsLabel(0)).toBe('0%');
  });

  it('todas las fracciones ofrecidas son valores que el contrato acepta', () => {
    expect(FRACTIONS.map((f) => f.bps)).toEqual([10000, 5000, 3333, 2500]);
  });
});

describe('fractionPreview', () => {
  it('una fracción parcial es la parte nominal del precio', () => {
    expect(fractionPreview(10000, 5000, 10000)).toBe(5000);
    expect(fractionPreview(10000, 2500, 10000)).toBe(2500);
  });

  /**
   * La COMPLETADORA paga lo que falta, no su nominal. Con ¾ ya tomados, pedir
   * un medio no cuesta la mitad del plato: cuesta el cuarto que queda.
   */
  it('la que completa el ítem paga el resto, no su nominal', () => {
    expect(fractionPreview(10000, 5000, 2500)).toBe(2500);
    expect(fractionPreview(10000, 10000, 3333)).toBe(3333);
  });

  it('nunca devuelve negativo', () => {
    expect(fractionPreview(10000, 10000, 0)).toBe(0);
  });
});

describe('itemsAmountFor', () => {
  it('sin mesa da cero', () => {
    expect(itemsAmountFor(null, new Map())).toBe(0);
  });

  it('suma sólo lo seleccionado, por cantidad', () => {
    const m = mesa({
      items: [
        item({ id: 'a', price_cents: 19500, quantity: 1 }),
        item({ id: 'b', price_cents: 7000, quantity: 2 }),
        item({ id: 'c', price_cents: 4000, quantity: 1 }),
      ],
    });
    expect(itemsAmountFor(m, new Map([['a', 10000]]))).toBe(19500);
    // b vale 7000 × 2 = 14000, y la fracción se aplica sobre el total de la fila.
    expect(itemsAmountFor(m, new Map([['b', 5000]]))).toBe(7000);
    expect(itemsAmountFor(m, new Map([['a', 10000], ['c', 10000]]))).toBe(23500);
  });

  it('un ítem sin fracción explícita se toma entero', () => {
    const m = mesa({ items: [item({ id: 'a', price_cents: 12345 })] });
    expect(itemsAmountFor(m, new Map([['a', 10000]]))).toBe(12345);
  });

  /**
   * En división IGUAL el monto **no depende de la selección**: es el casillero
   * libre. Marcar consumos ahí es información para el restaurante y no mueve un
   * centavo — si esto se rompiera, marcar un plato cambiaría lo que se cobra.
   */
  it('en partes iguales devuelve el casillero libre, ignorando la selección', () => {
    const m = mesa({
      division_mode: 'igual',
      items: [item({ id: 'a' }), item({ id: 'b' })],
      division_slots: [
        slot({ slot_index: 0, status: 'paid', amount_cents: 21000 }),
        slot({ slot_index: 1, status: 'available', amount_cents: 21000 }),
      ],
    });
    expect(itemsAmountFor(m, new Map())).toBe(21000);
    expect(itemsAmountFor(m, new Map([['a', 10000], ['b', 10000]]))).toBe(21000);
  });

  it('en partes iguales sin casilleros libres da cero', () => {
    const m = mesa({
      division_mode: 'igual',
      division_slots: [slot({ status: 'paid' }), slot({ slot_index: 1, status: 'claimed' })],
    });
    expect(itemsAmountFor(m, new Map())).toBe(0);
  });
});

describe('nothingLeftFor', () => {
  it('con algo disponible, queda algo', () => {
    const m = mesa({ items: [item({ id: 'a' }), item({ id: 'b', status: 'paid' })] });
    expect(nothingLeftFor(m)).toBe(false);
  });

  it('todo pagado o tomado por otros: no queda nada', () => {
    const m = mesa({
      items: [
        item({ id: 'a', status: 'paid' }),
        item({ id: 'b', status: 'locked', locked_by_me: false }),
      ],
    });
    expect(nothingLeftFor(m)).toBe(true);
  });

  /**
   * Un ítem `locked` que es MÍO no cuenta como tomado: es justo lo que estoy por
   * pagar. Si contara, la pantalla le diría "no queda nada" a quien tiene su
   * propia selección reservada y a punto de pagarse.
   */
  it('lo que yo tengo reservado NO cuenta como tomado', () => {
    const m = mesa({
      items: [
        item({ id: 'a', status: 'paid' }),
        item({ id: 'b', status: 'locked', locked_by_me: true }),
      ],
    });
    expect(nothingLeftFor(m)).toBe(false);
  });

  it('una mesa sin ítems no dispara el aviso', () => {
    expect(nothingLeftFor(mesa({ items: [] }))).toBe(false);
  });

  it('en partes iguales nunca aplica: el concepto es de consumo', () => {
    const m = mesa({ division_mode: 'igual', items: [item({ id: 'a', status: 'paid' })] });
    expect(nothingLeftFor(m)).toBe(false);
  });
});

describe('availableSlotsOf', () => {
  it('cuenta sólo los libres', () => {
    const m = mesa({
      division_slots: [
        slot({ slot_index: 0, status: 'available' }),
        slot({ slot_index: 1, status: 'claimed' }),
        slot({ slot_index: 2, status: 'available' }),
        slot({ slot_index: 3, status: 'paid' }),
      ],
    });
    expect(availableSlotsOf(m)).toBe(2);
  });

  it('sin casilleros da cero, no explota', () => {
    expect(availableSlotsOf(mesa())).toBe(0);
  });
});
