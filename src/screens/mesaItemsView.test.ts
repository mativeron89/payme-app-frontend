import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DivisionSlot, MesaDetail, MesaItem } from '../api/types';
import {
  FRACTIONS,
  TOLERANCIA_DE_COMPLETAR,
  restanteAlGuardar,
  availableSlotsOf,
  bpsLabel,
  bpsValido,
  confirmedConsumptionProgress,
  fraccionInicial,
  fractionPreview,
  informativoPublicado,
  limiteInformativo,
  restanteInformativo,
  itemsAmountFor,
  nothingLeftFor,
  platosSinDueno,
  progresoConBorrador,
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
    original_participants: null,
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
  it('nombra las seis fracciones naturales del contrato', () => {
    expect(bpsLabel(10000)).toBe('entero');
    expect(bpsLabel(7500)).toBe('¾');
    expect(bpsLabel(6667)).toBe('⅔');
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
    expect(bpsLabel(8750)).toBe('88%');
    expect(bpsLabel(0)).toBe('0%');
  });

  it('todas las fracciones ofrecidas son valores que el contrato acepta', () => {
    expect(FRACTIONS.map((f) => f.bps)).toEqual([10000, 7500, 6667, 5000, 3333, 2500]);
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

  /**
   * Residual n423 · la tolerancia del dueño. Los esperados NO salen de la
   * fórmula del front: son `effectiveBps` + `priceFraction` de
   * `services/itemClaims.js` (sha256 21656a4b…, el de TOLERANCIA_DE_COMPLETAR)
   * corridos sobre estos mismos datos, con los demás claims a su nominal.
   */
  it('🔴 ⅓ sobre los 3334 que quedan completa: paga lo que el dueño cobra (33340, no 33330)', () => {
    expect(fractionPreview(100000, 3333, 3334)).toBe(33340);
  });

  it('🔴 un faltante de 99 también completa: ¼ sobre 2599 de $123.45 sale 3208', () => {
    expect(fractionPreview(12345, 2500, 2599)).toBe(3208);
  });

  it('control: con un faltante de 100 es nominal (3086), como el dueño («< 100»)', () => {
    expect(fractionPreview(12345, 2500, 2600)).toBe(3086);
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

describe('confirmedConsumptionProgress · reparto global confirmado', () => {
  it('cubre cero, parcial y total sin leer la selección local', () => {
    const zero = confirmedConsumptionProgress(mesa({
      items: [
        item({ id: 'a', price_cents: 30000 }),
        item({ id: 'b', price_cents: 54000 }),
      ],
    }));
    expect(zero).toEqual({
      status: 'known', assignedCents: 0, differenceCents: 84000,
      itemsTotalCents: 84000, totalMatchesItems: true, complete: false, visualPercent: 0,
    });

    const partial = confirmedConsumptionProgress(mesa({
      items: [
        item({ id: 'a', price_cents: 30000, remaining_bps: 0 }),
        item({ id: 'b', price_cents: 54000 }),
      ],
    }));
    expect(partial).toMatchObject({
      status: 'known', assignedCents: 30000, differenceCents: 54000,
      complete: false, visualPercent: 36,
    });

    const complete = confirmedConsumptionProgress(mesa({
      items: [
        item({ id: 'a', price_cents: 30000, remaining_bps: 0 }),
        item({ id: 'b', price_cents: 54000, remaining_bps: 0 }),
      ],
    }));
    expect(complete).toMatchObject({
      status: 'known', assignedCents: 84000, differenceCents: 0,
      complete: true, visualPercent: 100,
    });
  });

  it('aplica cantidad y redondeo canónico a la fracción agregada de cada línea', () => {
    const r = confirmedConsumptionProgress(mesa({
      total_cents: 30003,
      items: [
        // Línea 20002; ⅓ agregado = 6667.3334 → 6667 centavos.
        item({ id: 'cantidad', price_cents: 10001, quantity: 2, remaining_bps: 6667 }),
        // Línea 10001; ¼ agregado = 2500.25 → 2500 centavos.
        item({ id: 'cuarto', price_cents: 10001, remaining_bps: 7500 }),
      ],
    }));
    expect(r).toMatchObject({
      status: 'known', assignedCents: 9167, differenceCents: 20836,
      itemsTotalCents: 30003, totalMatchesItems: true, complete: false, visualPercent: 31,
    });
  });

  it('agrega la ocupación global una vez: no suma pago ni identidad por separado', () => {
    const r = confirmedConsumptionProgress(mesa({
      total_cents: 10000,
      paid_amount_cents: 5000,
      items: [item({ id: 'compartido', remaining_bps: 2500 })],
    }));
    expect(r).toMatchObject({ status: 'known', assignedCents: 7500, differenceCents: 2500 });
  });

  it('un porcentaje redondeable a 100 sigue en 99 hasta el total efectivo', () => {
    const r = confirmedConsumptionProgress(mesa({
      total_cents: 10000,
      items: [item({ id: 'casi', price_cents: 10000, remaining_bps: 1 })],
    }));
    expect(r).toMatchObject({
      status: 'known', assignedCents: 9999, differenceCents: 1,
      complete: false, visualPercent: 99,
    });
  });

  it('conserva discrepancias legacy y nunca las presenta como reparto completo', () => {
    const falta = confirmedConsumptionProgress(mesa({
      total_cents: 84000,
      items: [item({ id: 'legacy', price_cents: 83999, remaining_bps: 0 })],
    }));
    expect(falta).toMatchObject({
      status: 'known', assignedCents: 83999, differenceCents: 1,
      totalMatchesItems: false, complete: false, visualPercent: 99,
    });

    const excede = confirmedConsumptionProgress(mesa({
      total_cents: 84000,
      items: [item({ id: 'legacy', price_cents: 84001, remaining_bps: 0 })],
    }));
    expect(excede).toMatchObject({
      status: 'known', assignedCents: 84001, differenceCents: -1,
      totalMatchesItems: false, complete: false, visualPercent: 99,
    });
  });

  it('falla cerrado ante bps/ítems inválidos, duplicados y overflow', () => {
    expect(confirmedConsumptionProgress(mesa({
      total_cents: Number.NaN,
    }))).toEqual({ status: 'unknown', reason: 'invalid_total' });
    expect(confirmedConsumptionProgress(mesa({
      items: [item({ remaining_bps: undefined as never })],
    }))).toEqual({ status: 'unknown', reason: 'invalid_bps' });
    expect(confirmedConsumptionProgress(mesa({
      items: [item({ id: '' })],
    }))).toEqual({ status: 'unknown', reason: 'invalid_item' });
    expect(confirmedConsumptionProgress(mesa({
      items: [item({ id: 'dup' }), item({ id: 'dup' })],
    }))).toEqual({ status: 'unknown', reason: 'duplicate_item' });
    expect(confirmedConsumptionProgress(mesa({
      items: [item({ quantity: 0 })],
    }))).toEqual({ status: 'unknown', reason: 'invalid_item' });
    expect(confirmedConsumptionProgress(mesa({
      total_cents: Number.MAX_SAFE_INTEGER,
      items: [item({ price_cents: Number.MAX_SAFE_INTEGER, quantity: 2 })],
    }))).toEqual({ status: 'unknown', reason: 'overflow' });
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

/**
 * ORDEN 1A.3 · `remaining_bps` ES DATO DEL CONTRATO Y SE VALIDA COMO TAL.
 *
 * `GET /mesas/:code` no pasa por decoder: el campo llega casteado. Con
 * `undefined`, las DOS comparaciones de `rowStateOf` daban `false`
 * (`undefined <= 0` y `undefined > 0`), así que un ítem 100 % tomado por otro
 * se pintaba DISPONIBLE. Y el default fabricado era el MÁXIMO: `?? 10000`
 * preseleccionaba el plato entero — la opción más cara — justo cuando no se
 * sabía cuánto quedaba.
 */
describe('bpsValido · la tabla de lo que NO es un bps', () => {
  it('acepta sólo enteros de 0 a 10000 inclusive', () => {
    for (const ok of [0, 1, 2500, 3333, 5000, 10000]) expect(bpsValido(ok)).toBe(true);
  });

  it('🔴 rechaza ausente, null, string, NaN, negativo, >10000 y fraccionario', () => {
    for (const malo of [undefined, null, '5000', NaN, Infinity, -1, -0.5, 10001, 25000, 2500.5, {}, []]) {
      expect(bpsValido(malo), String(malo)).toBe(false);
    }
  });
});

describe('fraccionInicial · ante la duda NO se elige el máximo', () => {
  it('elige la fracción más grande que entra en lo que queda', () => {
    expect(fraccionInicial(10000)).toBe(10000);
    expect(fraccionInicial(5000)).toBe(5000);
    expect(fraccionInicial(4000)).toBe(3333);
    expect(fraccionInicial(2500)).toBe(2500);
  });

  it('🔴 con dato inválido devuelve null — jamás el 10000 fabricado', () => {
    for (const malo of [undefined, null, NaN, '10000', -1, 10001]) {
      expect(fraccionInicial(malo), String(malo)).toBeNull();
    }
  });

  it('si no entra NINGUNA fracción tampoco inventa: null', () => {
    // Queda menos que la fracción más chica (¼). Antes esto caía en el
    // `?? 10000` y preseleccionaba el ítem entero sobre un resto de 1 bps.
    expect(fraccionInicial(1)).toBeNull();
    expect(fraccionInicial(0)).toBeNull();
  });
});

/**
 * Decisión 79 · «igual» con el dato del dueño v2.134.0. El restante incluye lo
 * propio guardado, así que el límite de esta cuenta lo suma de vuelta.
 */
describe('decisión 79 · lo que queda por plato en «igual»', () => {
  const item = (informative_remaining_bps: unknown) => ({ id: 'i-1', informative_remaining_bps });

  it('restanteInformativo: entero 0..10000 o null, nunca inventado', () => {
    expect(restanteInformativo(item(5000))).toBe(5000);
    expect(restanteInformativo(item(0))).toBe(0);
    for (const raro of [null, undefined, -1, 10001, 50.5, '5000']) {
      expect(restanteInformativo(item(raro)), String(raro)).toBeNull();
    }
  });

  it('limiteInformativo: lo que queda + lo propio guardado, tope entero; sin dato ⇒ null', () => {
    expect(limiteInformativo(item(5000), new Map())).toBe(5000);
    expect(limiteInformativo(item(0), new Map([['i-1', 5000]]))).toBe(5000);
    expect(limiteInformativo(item(5000), new Map([['i-1', 5000]]))).toBe(10000);
    expect(limiteInformativo(item(10000), new Map([['i-1', 5000]]))).toBe(10000);
    expect(limiteInformativo(item(null), new Map([['i-1', 5000]]))).toBeNull();
  });

  it('informativoPublicado: alcanza con un plato con dato', () => {
    expect(informativoPublicado({ items: [item(null), item(null)] as never })).toBe(false);
    expect(informativoPublicado({ items: [item(null), item(10000)] as never })).toBe(true);
  });

  it('la barra de «igual» cuenta lo ELEGIDO desde informative_remaining_bps (misma cuenta que /mesas/open)', () => {
    const mesa = {
      total_cents: 84000,
      items: [
        { id: 'a', price_cents: 19500, quantity: 1, remaining_bps: 10000, informative_remaining_bps: 0 },
        { id: 'b', price_cents: 64500, quantity: 1, remaining_bps: 10000, informative_remaining_bps: 10000 },
      ] as unknown as MesaItem[],
    };
    const r = confirmedConsumptionProgress(mesa, (i) => i.informative_remaining_bps);
    expect(r).toMatchObject({ status: 'known', assignedCents: 19500, visualPercent: 23, complete: false });
    // El default sigue siendo consumo: con remaining_bps 10000, nada asignado.
    expect(confirmedConsumptionProgress(mesa)).toMatchObject({ status: 'known', assignedCents: 0 });
    // Un dato raro no fabrica un avance.
    const raro = { ...mesa, items: [{ ...mesa.items[0]!, informative_remaining_bps: null }] as MesaItem[] };
    expect(confirmedConsumptionProgress(raro, (i) => i.informative_remaining_bps)).toMatchObject({ status: 'unknown' });
  });
});

/**
 * AF-BARRA-EN-VIVO · decisión 107, punto 3 (n190) · la barra suma el borrador
 * propio antes de «Listo», sin contar lo propio dos veces y sin llegar a 100
 * por el borrador. Los recorridos por pantalla los hace
 * `e2e/barra-en-vivo.spec.ts`.
 */
describe('progresoConBorrador · la barra en vivo', () => {
  const restanteConsumo = (i: MesaItem) => i.remaining_bps;
  const sinPropio = () => 0;
  // $300 + $540 = $840. Otra persona ya registró todo el plato b.
  const base = () => mesa({
    items: [
      item({ id: 'a', price_cents: 30000 }),
      item({ id: 'b', price_cents: 54000, remaining_bps: 0 }),
    ],
  });

  it('control: sin borrador es exactamente lo registrado', () => {
    expect(progresoConBorrador(base(), restanteConsumo, sinPropio, new Map()))
      .toEqual(confirmedConsumptionProgress(base()));
  });

  it('consumo: el borrador se SUMA a lo registrado', () => {
    const r = progresoConBorrador(base(), restanteConsumo, sinPropio, new Map([['a', 5000]]));
    expect(r).toMatchObject({ status: 'known', assignedCents: 54000 + 15000, complete: false, visualPercent: 82 });
  });

  it('🔴 el borrador que completa la mesa NO la lleva a 100 si lo registrado no está completo: tope 99', () => {
    const r = progresoConBorrador(base(), restanteConsumo, sinPropio, new Map([['a', 10000]]));
    expect(r).toMatchObject({ status: 'known', assignedCents: 84000, complete: false, visualPercent: 99 });
  });

  it('con lo registrado completo, 100', () => {
    const completa = mesa({
      items: [
        item({ id: 'a', price_cents: 30000, remaining_bps: 0 }),
        item({ id: 'b', price_cents: 54000, remaining_bps: 0 }),
      ],
    });
    expect(progresoConBorrador(completa, restanteConsumo, sinPropio, new Map())).toMatchObject({ visualPercent: 100 });
  });

  it('🔴 un borrador que ya no entra (otro eligió después) no cuenta: vale lo registrado de ese plato', () => {
    // Del plato a quedan ¾ tomados por otro ($225); mi borrador pide ½ y sólo queda ¼.
    const m = mesa({ items: [item({ id: 'a', price_cents: 30000, remaining_bps: 2500 }), item({ id: 'b', price_cents: 54000, remaining_bps: 0 })] });
    const r = progresoConBorrador(m, restanteConsumo, sinPropio, new Map([['a', 5000]]));
    expect(r).toMatchObject({ assignedCents: 22500 + 54000, visualPercent: 91 });
    // Y lo que sí entra, suma: ¼.
    expect(progresoConBorrador(m, restanteConsumo, sinPropio, new Map([['a', 2500]])))
      .toMatchObject({ assignedCents: 84000, visualPercent: 99 });
  });

  describe('igual: el borrador REEMPLAZA lo guardado', () => {
    const restanteIgual = (i: MesaItem) => i.informative_remaining_bps;
    // Plato a: guardé ½ (el restante del dueño ya la descuenta). Plato b: libre.
    const igual = () => mesa({
      division_mode: 'igual',
      items: [
        item({ id: 'a', price_cents: 30000, informative_remaining_bps: 5000 }),
        item({ id: 'b', price_cents: 54000, informative_remaining_bps: 10000 }),
      ],
    });
    const guardado = new Map([['a', 5000]]);
    const propio = (i: MesaItem) => guardado.get(i.id) ?? 0;

    it('🔴 el borrador igual a lo guardado: lo registrado, sin contar lo propio dos veces', () => {
      const r = progresoConBorrador(igual(), restanteIgual, propio, new Map(guardado));
      expect(r).toEqual(confirmedConsumptionProgress(igual(), restanteIgual));
      expect(r).toMatchObject({ assignedCents: 15000 });
    });

    it('pasar de ½ a entero suma la otra mitad', () => {
      expect(progresoConBorrador(igual(), restanteIgual, propio, new Map([['a', 10000]])))
        .toMatchObject({ assignedCents: 30000 });
    });

    it('soltarlo en el borrador lo resta', () => {
      expect(progresoConBorrador(igual(), restanteIgual, propio, new Map()))
        .toMatchObject({ assignedCents: 0, visualPercent: 0 });
    });

    it('🔴 un borrador que ya no entra: vale lo guardado de ese plato, no se lo saca', () => {
      // Otro tomó el resto del plato a después de mi borrador: queda 0 + mi ½ guardada.
      const lleno = mesa({
        division_mode: 'igual',
        items: [item({ id: 'a', price_cents: 30000, informative_remaining_bps: 0 }), item({ id: 'b', price_cents: 54000, informative_remaining_bps: 10000 })],
      });
      expect(progresoConBorrador(lleno, restanteIgual, propio, new Map([['a', 10000]])))
        .toMatchObject({ assignedCents: 30000 });
    });

    it('sumar otro plato', () => {
      expect(progresoConBorrador(igual(), restanteIgual, propio, new Map([['a', 5000], ['b', 2500]])))
        .toMatchObject({ assignedCents: 15000 + 13500 });
    });
  });

  it('datos del dueño que no cierran (restante + lo propio pasa del entero): lo propio no cuenta más de un plato', () => {
    const restanteIgual = (i: MesaItem) => i.informative_remaining_bps;
    const m = mesa({
      division_mode: 'igual',
      items: [item({ id: 'a', price_cents: 30000, informative_remaining_bps: 10000 }), item({ id: 'b', price_cents: 54000, informative_remaining_bps: 10000 })],
    });
    // Guardado ½ que el restante no descuenta: con un borrador de ½, el plato va ½ tomado.
    expect(progresoConBorrador(m, restanteIgual, (i) => (i.id === 'a' ? 5000 : 0), new Map([['a', 5000]])))
      .toMatchObject({ assignedCents: 15000 });
  });

  it('un dato raro del dueño: lo mismo que lo registrado (desconocido), sin inventar', () => {
    const m = mesa({ items: [item({ id: 'a', remaining_bps: Number.NaN })] });
    expect(progresoConBorrador(m, restanteConsumo, sinPropio, new Map([['a', 5000]])))
      .toEqual(confirmedConsumptionProgress(m));
  });
});

describe('D389 · un plato de $0 cuenta como cubierto en la mesa sin garantía', () => {
  /** $0 sin elegir y $120 elegido entero: el dinero ya está todo asignado. */
  const conCero = (over: Partial<MesaDetail> = {}) => mesa({
    total_cents: 12000,
    items: [
      item({ id: 'cero', price_cents: 0, remaining_bps: 10000 }),
      item({ id: 'b', price_cents: 12000, remaining_bps: 0 }),
    ],
    ...over,
  });

  it('🔴 sin garantía: completo, 100 % y nada por asignar', () => {
    expect(confirmedConsumptionProgress(conCero({ guarantee_mode: false }))).toEqual({
      status: 'known', assignedCents: 12000, differenceCents: 0,
      itemsTotalCents: 12000, totalMatchesItems: true, complete: true, visualPercent: 100,
    });
  });

  it('control positivo: sin la regla (con garantía, o un dueño que no publica guarantee_mode), el mismo caso queda en 99 %', () => {
    for (const guarantee_mode of [true, undefined]) {
      expect(confirmedConsumptionProgress(conCero({ guarantee_mode })), String(guarantee_mode)).toMatchObject({
        status: 'known', assignedCents: 12000, differenceCents: 0, complete: false, visualPercent: 99,
      });
    }
  });

  it('el $0 no tapa lo que falta: con un plato con precio sin elegir, sigue incompleto', () => {
    const r = confirmedConsumptionProgress(mesa({
      guarantee_mode: false,
      total_cents: 20000,
      items: [
        item({ id: 'cero', price_cents: 0 }),
        item({ id: 'b', price_cents: 12000, remaining_bps: 0 }),
        item({ id: 'c', price_cents: 8000 }),
      ],
    }));
    expect(r).toMatchObject({ complete: false, differenceCents: 8000, visualPercent: 60 });
  });

  it('🔴 sólo el $0: un plato con precio elegido casi entero (9999 bps) no cuenta como cubierto, aunque su importe ya redondee al total', () => {
    // fractionAmount(100, 9999) redondea a 100: lo asignado llega al total, pero ese plato no está entero.
    const r = confirmedConsumptionProgress(mesa({
      guarantee_mode: false,
      total_cents: 12000,
      items: [
        item({ id: 'cero', price_cents: 0 }),
        item({ id: 'casi', price_cents: 100, remaining_bps: 1 }),
        item({ id: 'b', price_cents: 11900, remaining_bps: 0 }),
      ],
    }));
    expect(r).toMatchObject({ assignedCents: 12000, differenceCents: 0, complete: false, visualPercent: 99 });
  });

  it('el $0 elegido también cuenta, como siempre (la regla no lo vuelve inelegible)', () => {
    const r = confirmedConsumptionProgress(conCero({
      guarantee_mode: false,
      items: [
        item({ id: 'cero', price_cents: 0, remaining_bps: 0 }),
        item({ id: 'b', price_cents: 12000, remaining_bps: 0 }),
      ],
    }));
    expect(r).toMatchObject({ complete: true, visualPercent: 100 });
  });

  it('igual informativo: la misma regla con informative_remaining_bps', () => {
    const informativa = conCero({
      guarantee_mode: false,
      division_mode: 'igual',
      items: [
        item({ id: 'cero', price_cents: 0, informative_remaining_bps: 10000 }),
        item({ id: 'b', price_cents: 12000, informative_remaining_bps: 0 }),
      ],
    });
    expect(confirmedConsumptionProgress(informativa, (i) => i.informative_remaining_bps)).toMatchObject({ complete: true, visualPercent: 100 });
    expect(confirmedConsumptionProgress({ ...informativa, guarantee_mode: undefined }, (i) => i.informative_remaining_bps))
      .toMatchObject({ complete: false, visualPercent: 99 });
  });

  it('la barra en vivo (progresoConBorrador) también llega a 100 sin elegir el $0', () => {
    const r = progresoConBorrador(conCero({ guarantee_mode: false }), (i) => i.remaining_bps, () => 0, new Map());
    expect(r).toMatchObject({ complete: true, visualPercent: 100 });
  });
});

/**
 * F1 (revisión de V sobre 0.253.1) · la tolerancia con la que el dueño da un plato por completo: un faltante de menos
 * de 100 bps cuenta como cubierto. Antes el front exigía 0 exacto y, con 3 × ⅓, el último «Listo» cerraba la mesa sin
 * la hoja. Viene de 0.227.0, no de D389.
 */
describe('F1 · la tolerancia del dueño (COMPLETING_TOLERANCE_BPS)', () => {
  const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

  it('🔴 la procedencia: el sha256 de las dos fuentes del dueño es el del inventario adoptado (si cambia, volver a medir)', () => {
    const inventario = JSON.parse(leer('../../scripts/mirror-inventory.json')) as {
      archivos: ReadonlyArray<{ origen: string; sha256: string }>;
    };
    expect(TOLERANCIA_DE_COMPLETAR.fuentes.map((f) => f.ruta)).toEqual(['services/itemClaims.js', 'services/informativeSelections.js']);
    for (const fuente of TOLERANCIA_DE_COMPLETAR.fuentes) {
      const sha = inventario.archivos.find((a) => a.origen === fuente.ruta)?.sha256;
      expect(sha, `el inventario adoptó otro ${fuente.ruta}: volver a medir ${fuente.donde}`).toBe(fuente.sha256);
    }
    expect(TOLERANCIA_DE_COMPLETAR.bps).toBe(100);
  });

  it('las dos réplicas del mock usan el mismo valor (consumo y «igual»)', () => {
    expect(leer('../api/mock/mockApi.ts')).toContain(`const COMPLETING_TOLERANCE_BPS = ${TOLERANCIA_DE_COMPLETAR.bps};`);
    expect(leer('../api/mock/store.ts')).toContain(`return 10000 - declarado < ${TOLERANCIA_DE_COMPLETAR.bps} ? 0 : 10000 - declarado;`);
  });

  it('🔴 ⅓ sobre los 3334 que quedan completa el plato; también un faltante de 99', () => {
    expect(restanteAlGuardar(3334, 0, 3333)).toBe(0);
    expect(restanteAlGuardar(3432, 0, 3333)).toBe(0);
  });

  it('el borde: un faltante de 100 o más no lo completa (el dueño compara con «< 100»)', () => {
    expect(restanteAlGuardar(3433, 0, 3333)).toBe(100);
    expect(restanteAlGuardar(6667, 0, 3333)).toBe(3334);
  });

  it('lo exacto sigue igual: ⅔ sobre ⅔ y ⅓ sobre ⅓ dan 0', () => {
    expect(restanteAlGuardar(6667, 0, 6667)).toBe(0);
    expect(restanteAlGuardar(3333, 0, 3333)).toBe(0);
  });

  it('sin tocar el plato manda lo publicado: un restante viejo de 50 sigue en 50 (el cierre de consumo suma contra 10000 exacto)', () => {
    expect(restanteAlGuardar(50, 0, 0)).toBe(50);
  });

  it('«igual»: el borrador reemplaza lo propio; 3333 propios + 3333 de otros y el borrador pide ⅔ → 0', () => {
    expect(restanteAlGuardar(3334, 3333, 6667)).toBe(0);
    expect(restanteAlGuardar(3334, 3333, 3333)).toBe(3334);
  });

  it('un borrador que no entra es null (el dueño lo rechaza)', () => {
    expect(restanteAlGuardar(3334, 0, 5000)).toBeNull();
    expect(restanteAlGuardar(3334, 0, 3333.5)).toBeNull();
  });

  it('🔴 la barra en vivo: con 3 × ⅓, el importe asignado del tercero ya llega al total del plato (antes, unos centavos menos)', () => {
    const tercio = mesa({ items: [item({ id: 'a', price_cents: 30000, remaining_bps: 3334 })], total_cents: 30000 });
    const r = progresoConBorrador(tercio, (i) => i.remaining_bps, () => 0, new Map([['a', 3333]]));
    expect(r).toMatchObject({ status: 'known', assignedCents: 30000, differenceCents: 0, complete: false, visualPercent: 99 });
  });

  it('control: con un faltante de 100 la barra en vivo no lo da por entero', () => {
    const casi = mesa({ items: [item({ id: 'a', price_cents: 30000, remaining_bps: 3433 })], total_cents: 30000 });
    const r = progresoConBorrador(casi, (i) => i.remaining_bps, () => 0, new Map([['a', 3333]]));
    expect(r.status === 'known' && r.differenceCents).toBeGreaterThan(0);
  });
});

/**
 * D622 · AF-2 · mejora 2 · los platos SIN DUEÑO de la tarjeta del estado de la
 * mesa: ninguna parte elegida (`remaining_bps` 10000). Uno a medias no entra en
 * esa cuenta: se cuenta aparte. Sin identidad: sólo el agregado del dueño.
 */
describe('platosSinDueno · D622 mejora 2', () => {
  it('🔴 cuenta los platos sin ninguna parte elegida y, aparte, los que están a medias', () => {
    const m = mesa({
      guarantee_mode: false,
      items: [
        item({ id: 'a', remaining_bps: 10000 }),
        item({ id: 'b', remaining_bps: 10000 }),
        item({ id: 'c', remaining_bps: 5000 }),
        item({ id: 'd', remaining_bps: 0 }),
      ],
    });
    expect(platosSinDueno(m)).toEqual({ sinDueno: 2, aMedias: 1 });
  });

  it('una línea con cantidad cuenta como UN plato (el renglón), no por unidad', () => {
    const m = mesa({ guarantee_mode: false, items: [item({ id: 'a', quantity: 3, remaining_bps: 10000 })] });
    expect(platosSinDueno(m)).toEqual({ sinDueno: 1, aMedias: 0 });
  });

  it('🔴 D389 · sin garantía, el plato de $0 ya cuenta como cubierto: no es «sin dueño»', () => {
    const m = mesa({
      guarantee_mode: false,
      items: [item({ id: 'a', price_cents: 0, remaining_bps: 10000 }), item({ id: 'b', remaining_bps: 10000 })],
    });
    expect(platosSinDueno(m)).toEqual({ sinDueno: 1, aMedias: 0 });
  });

  it('un restante ilegible no se cuenta como nada: falla cerrado', () => {
    const m = mesa({ guarantee_mode: false, items: [item({ id: 'a', remaining_bps: 10001 })] });
    expect(platosSinDueno(m)).toBeNull();
  });
});
