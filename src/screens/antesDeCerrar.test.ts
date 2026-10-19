import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MesaItem } from '../api/types';
import { elegidosAlGuardar, elegidosRegistrados, lineasElegidas, propioEnConsumo, seleccionCierraLaMesa } from './antesDeCerrar';

/**
 * D240 punto 8 · la hoja antes de que la mesa se cierre. Lo que se prueba acá:
 * cuándo un «Listo» cierra la mesa (la regla del dueño: todo plato sin nada por
 * elegir) y qué lista ve la persona.
 */

function item(over: Partial<MesaItem> = {}): MesaItem {
  return {
    id: 'i-1',
    name: 'Plato',
    category: 'other',
    price_cents: 10000,
    quantity: 1,
    status: 'available',
    remaining_bps: 10000,
    my_bps: 0,
    locked_by_me: false,
    lock_expires_at: null,
    ...over,
  } as MesaItem;
}

const consumo = (items: MesaItem[], borrador: Array<[string, number]>) => seleccionCierraLaMesa(
  { items },
  (i) => i.remaining_bps,
  () => 0,
  new Map(borrador),
);

describe('D240 punto 8 · seleccionCierraLaMesa (consumo)', () => {
  it('los dos platos libres, elegidos enteros: cierra', () => {
    expect(consumo([item({ id: 'a' }), item({ id: 'b' })], [['a', 10000], ['b', 10000]])).toBe(true);
  });

  it('uno elegido a la mitad: no cierra', () => {
    expect(consumo([item({ id: 'a' }), item({ id: 'b' })], [['a', 10000], ['b', 5000]])).toBe(false);
  });

  it('un plato sin elegir: no cierra', () => {
    expect(consumo([item({ id: 'a' }), item({ id: 'b' })], [['a', 10000]])).toBe(false);
  });

  it('otra persona ya tomó un plato entero y el borrador cubre el otro: cierra', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 0 }), item({ id: 'b' })], [['b', 10000]])).toBe(true);
  });

  it('quedaba ½ y el borrador toma esa ½: cierra', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 5000 })], [['a', 5000]])).toBe(true);
  });

  it('un borrador viejo que ya no entra (pide más de lo que queda): no avisa', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 5000 })], [['a', 10000]])).toBe(false);
  });

  it('sin borrador no cierra nada, aunque todo esté tomado', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 0 })], [])).toBe(false);
  });

  it('un dato desconocido del dueño: no avisa', () => {
    expect(consumo([item({ id: 'a', remaining_bps: undefined as unknown as number })], [['a', 10000]])).toBe(false);
    expect(consumo([item({ id: 'a', remaining_bps: 10001 })], [['a', 10000]])).toBe(false);
  });

  it('sin platos: no cierra', () => {
    expect(consumo([], [['a', 10000]])).toBe(false);
  });
});

describe('D240 punto 8 · seleccionCierraLaMesa («igual»: el borrador reemplaza lo guardado)', () => {
  const igual = (items: MesaItem[], guardadas: Array<[string, number]>, borrador: Array<[string, number]>) => {
    const g = new Map(guardadas);
    return seleccionCierraLaMesa({ items }, (i) => i.informative_remaining_bps, (i) => g.get(i.id) ?? 0, new Map(borrador));
  };

  // El restante del dueño ya descuenta lo mío guardado: lo que puedo declarar
  // es restante + lo mío, y el borrador lo reemplaza.
  it('lo propio guardado es ½ del plato a (la otra ½ es de otro); el borrador la conserva y toma el b entero: cierra', () => {
    expect(igual(
      [item({ id: 'a', informative_remaining_bps: 0 }), item({ id: 'b', informative_remaining_bps: 10000 })],
      [['a', 5000]],
      [['a', 5000], ['b', 10000]],
    )).toBe(true);
  });

  it('el borrador suelta lo mío guardado: ya no cierra', () => {
    expect(igual(
      [item({ id: 'a', informative_remaining_bps: 0 }), item({ id: 'b', informative_remaining_bps: 10000 })],
      [['a', 10000]],
      [['b', 10000]],
    )).toBe(false);
  });
});

/**
 * D389 · un plato de $0 cuenta como elegido para cerrar la mesa (la regla del
 * dueño 2.188.0). Sin esto, el último «Listo» cerraba la mesa sin la hoja: el
 * front predecía que no cerraba porque el agua en $0 seguía con 10000.
 */
describe('D389 · seleccionCierraLaMesa con un plato de $0 (mesa sin garantía)', () => {
  const agua = (over: Partial<MesaItem> = {}) => item({ id: 'agua', name: 'Agua mineral', price_cents: 0, ...over });
  const conGarantia = (guarantee_mode: boolean | undefined) => (items: MesaItem[], borrador: Array<[string, number]>) =>
    seleccionCierraLaMesa({ items, guarantee_mode } as Parameters<typeof seleccionCierraLaMesa>[0], (i) => i.remaining_bps, () => 0, new Map(borrador));
  const sinGarantia = conGarantia(false);

  it('🔴 con el agua en $0 sin elegir, elegir el resto cierra: la hoja aparece', () => {
    expect(sinGarantia([item({ id: 'a' }), agua()], [['a', 10000]])).toBe(true);
  });

  it('control positivo: con garantía, o sin el campo, el mismo caso no cierra (sin la regla, la hoja no aparece)', () => {
    expect(conGarantia(true)([item({ id: 'a' }), agua()], [['a', 10000]])).toBe(false);
    expect(conGarantia(undefined)([item({ id: 'a' }), agua()], [['a', 10000]])).toBe(false);
  });

  it('control positivo: un plato con precio sin elegir no cierra, aunque el resto esté elegido', () => {
    expect(sinGarantia([item({ id: 'a' }), agua({ price_cents: 4000 })], [['a', 10000]])).toBe(false);
  });

  it('el $0 se puede seguir eligiendo: entero o a la mitad, cierra igual', () => {
    expect(sinGarantia([item({ id: 'a' }), agua()], [['a', 10000], ['agua', 10000]])).toBe(true);
    expect(sinGarantia([item({ id: 'a' }), agua()], [['a', 10000], ['agua', 5000]])).toBe(true);
  });

  it('un borrador del $0 que ya no entra (pide más de lo que queda) no avisa', () => {
    expect(sinGarantia([item({ id: 'a' }), agua({ remaining_bps: 5000 })], [['a', 10000], ['agua', 10000]])).toBe(false);
  });

  it('elegir sólo el $0, con un plato con precio libre, no cierra', () => {
    expect(sinGarantia([item({ id: 'a' }), agua()], [['agua', 10000]])).toBe(false);
  });

  it('una mesa sin ningún plato con importe no se cierra por selección (el dueño exige uno)', () => {
    expect(sinGarantia([agua(), agua({ id: 'agua-2' })], [['agua', 10000], ['agua-2', 10000]])).toBe(false);
  });

  it('mesa abierta de antes de 2.188.0, con lo de importe ya elegido y el agua libre: elegir el agua cierra', () => {
    expect(sinGarantia([item({ id: 'a', remaining_bps: 0 }), agua()], [['agua', 10000]])).toBe(true);
  });

  it('si ya no quedaba nada, ni el agua, este pedido no la cierra', () => {
    expect(sinGarantia([item({ id: 'a', remaining_bps: 0 }), agua({ remaining_bps: 0 })], [['agua', 0]])).toBe(false);
  });

  /**
   * La mesa «igual» abierta de antes de 2.188.0: el pescado lo declararon otros entero y la persona tiene guardada ½
   * del agua. Soltar el agua deja el borrador VACÍO, pero el PUT escribe y el dueño la da por cubierta: la hoja sale.
   */
  const igualTrabada = (guarantee_mode: boolean, borrador: Array<[string, number]>, precioDelAgua = 0) => seleccionCierraLaMesa(
    {
      items: [
        item({ id: 'pescado', informative_remaining_bps: 0 }),
        agua({ price_cents: precioDelAgua, informative_remaining_bps: 5000 }),
      ],
      guarantee_mode,
    },
    (i) => i.informative_remaining_bps,
    (i) => (i.id === 'agua' ? 5000 : 0),
    new Map(borrador),
  );

  it('🔴 «igual»: soltar el agua en $0 guardada deja el borrador vacío y cierra igual: la hoja aparece', () => {
    expect(igualTrabada(false, [])).toBe(true);
  });

  it('control positivo: el mismo borrador vacío con garantía, o con el agua con precio, no cierra', () => {
    expect(igualTrabada(true, [])).toBe(false);
    expect(igualTrabada(false, [], 4000)).toBe(false);
  });

  it('«igual»: reenviar lo mismo que estaba guardado no cierra (el dueño sólo lee)', () => {
    expect(igualTrabada(false, [['agua', 5000]])).toBe(false);
  });

  it('consumo: un borrador vacío sigue sin cerrar nada, también con el agua en $0', () => {
    expect(sinGarantia([item({ id: 'a', remaining_bps: 0 }), agua()], [])).toBe(false);
  });

  it('«igual»: con el agua en $0 sin declarar, declarar el resto cierra; con garantía, no', () => {
    const igual = (guarantee_mode: boolean) => seleccionCierraLaMesa(
      { items: [item({ id: 'a', informative_remaining_bps: 10000 }), agua({ informative_remaining_bps: 10000 })], guarantee_mode },
      (i) => i.informative_remaining_bps,
      () => 0,
      new Map([['a', 10000]]),
    );
    expect(igual(false)).toBe(true);
    expect(igual(true)).toBe(false);
  });
});

/**
 * F1 (revisión de V sobre 0.253.1) · la hoja usa la tolerancia del dueño: un faltante de menos de 100 bps cuenta
 * como cubierto. Con 3 × ⅓, el tercero elige 3333 sobre 3334 y el dueño cierra la mesa; antes el front calculaba 1 y
 * la hoja no salía. Viene de 0.227.0, no de D389.
 */
describe('F1 · seleccionCierraLaMesa con la tolerancia del dueño', () => {
  it('🔴 consumo: ⅓ sobre los 3334 que quedan cierra: la hoja aparece', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 3334 }), item({ id: 'b', remaining_bps: 0 })], [['a', 3333]])).toBe(true);
  });

  it('consumo: lo exacto sigue cerrando (⅔ sobre ⅔, ⅓ sobre ⅓)', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 6667 })], [['a', 6667]])).toBe(true);
    expect(consumo([item({ id: 'a', remaining_bps: 3333 })], [['a', 3333]])).toBe(true);
  });

  it('el borde: un faltante de 100 o más no cierra (el dueño compara con «< 100»)', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 3433 })], [['a', 3333]])).toBe(false);
    expect(consumo([item({ id: 'a', remaining_bps: 6667 })], [['a', 3333]])).toBe(false);
  });

  it('un faltante de 99 sí cierra (el borde)', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 3432 })], [['a', 3333]])).toBe(true);
  });

  it('consumo: un plato que el borrador no toca y quedó en 50 (claims viejos) no se da por cubierto', () => {
    expect(consumo([item({ id: 'a', remaining_bps: 50 }), item({ id: 'b' })], [['b', 10000]])).toBe(false);
  });

  const igual = (items: MesaItem[], guardadas: Array<[string, number]>, borrador: Array<[string, number]>) => {
    const g = new Map(guardadas);
    return seleccionCierraLaMesa({ items }, (i) => i.informative_remaining_bps, (i) => g.get(i.id) ?? 0, new Map(borrador));
  };

  it('🔴 «igual»: otros declararon 6666 y el borrador declara ⅓: 9999 declarado cierra', () => {
    expect(igual([item({ id: 'a', informative_remaining_bps: 3334 })], [], [['a', 3333]])).toBe(true);
  });

  it('control: en «igual» con 6667 restantes, ⅓ no cierra', () => {
    expect(igual([item({ id: 'a', informative_remaining_bps: 6667 })], [], [['a', 3333]])).toBe(false);
  });

  it('«igual»: con el plato ya en 0 por la tolerancia (9999 declarado), reenviar lo mío no cierra: sale por «no cambia nada»', () => {
    expect(igual([item({ id: 'a', informative_remaining_bps: 0 })], [['a', 3333]], [['a', 3333]])).toBe(false);
  });

  /**
   * T3 · la última línea con «ya no quedaba nada» en true: «igual», todo publicado en 0, y lo que cambia es el $0
   * propio. Este pedido no la cierra. Los tests que dan true ya llegaban a la última línea, pero ninguno llegaba con
   * todo publicado en 0 (el de «ni el agua» sale antes, por `!cambia`), y el mutante `return true` sobrevivía.
   */
  it('si ya no quedaba nada y lo único que cambia es el $0 propio, este pedido no la cierra', () => {
    expect(seleccionCierraLaMesa(
      {
        items: [item({ id: 'p', informative_remaining_bps: 0 }), item({ id: 'agua', price_cents: 0, informative_remaining_bps: 0 })],
        guarantee_mode: false,
      },
      (i) => i.informative_remaining_bps,
      (i) => (i.id === 'agua' ? 5000 : 0),
      new Map(),
    )).toBe(false);
  });
});

/**
 * Lo propio en consumo (decisión de V para 0.253.1). El dueño (`itemClaims.acquire`) suelta mis claims liberables del
 * plato que el pedido toca y lo vuelve a tomar; el front daba siempre 0. Difiere sólo si el borrador incluye un plato
 * que esta cuenta ya registró: una respuesta perdida de `items/lock` (el borrador queda) o dos pestañas.
 */
describe('lo propio en consumo · como el dueño, que suelta y vuelve a tomar', () => {
  /** Como la llama MesaDetailView en consumo. */
  const comoLaPantalla = (items: MesaItem[], borrador: Array<[string, number]>) => {
    const b = new Map(borrador);
    return seleccionCierraLaMesa(
      { items, guarantee_mode: false },
      (i) => i.remaining_bps,
      (i) => propioEnConsumo(i, b),
      b,
      { escribeConCualquierBorrador: true },
    );
  };
  /** Como era antes de 0.253.1: lo propio siempre 0. Es el control positivo de cada caso. */
  const comoAntes = (items: MesaItem[], borrador: Array<[string, number]>) =>
    seleccionCierraLaMesa({ items, guarantee_mode: false }, (i) => i.remaining_bps, () => 0, new Map(borrador));
  const mio = (id: string, over: Partial<MesaItem> = {}) => item({ id, remaining_bps: 0, my_bps: 10000, my_releasable_bps: 10000, ...over });

  it('🔴 respuesta perdida, el sentido irreversible: A y B ya quedaron registrados, el borrador los repite y suma C: cierra y la hoja aparece', () => {
    const items = [mio('A'), mio('B'), item({ id: 'C' })];
    const borrador: Array<[string, number]> = [['A', 10000], ['B', 10000], ['C', 10000]];
    expect(comoLaPantalla(items, borrador)).toBe(true);
    // Control positivo: con lo propio en 0, el borrador de A y B «no entraba» y la hoja no salía; el dueño cerraba igual.
    expect(comoAntes(items, borrador)).toBe(false);
  });

  it('respuesta perdida, el otro sentido: A ½ ya quedó registrada y el borrador la repite: no cierra (antes la hoja salía de más)', () => {
    const items = [mio('A', { remaining_bps: 5000, my_bps: 5000, my_releasable_bps: 5000 }), item({ id: 'B', remaining_bps: 0 })];
    expect(comoLaPantalla(items, [['A', 5000]])).toBe(false);
    expect(comoAntes(items, [['A', 5000]])).toBe(true);
  });

  it('🔴 dos pestañas: otra persona tiene ½ de A y yo, desde la otra pestaña, la otra ½; esta pestaña elige A ½ y B: cierra', () => {
    const items = [mio('A', { remaining_bps: 0, my_bps: 5000, my_releasable_bps: 5000 }), item({ id: 'B' })];
    const borrador: Array<[string, number]> = [['A', 5000], ['B', 10000]];
    expect(comoLaPantalla(items, borrador)).toBe(true);
    expect(comoAntes(items, borrador)).toBe(false);
  });

  it('🔴 sin my_releasable_bps se inclina por mostrar la hoja: el caso irreversible avisa', () => {
    const items = [mio('A', { my_releasable_bps: undefined }), mio('B', { my_releasable_bps: 'x' as unknown as number }), item({ id: 'C' })];
    expect(comoLaPantalla(items, [['A', 10000], ['B', 10000], ['C', 10000]])).toBe(true);
  });

  it('control positivo del fail-safe: con my_releasable_bps en 0 (válido: nada mío se suelta), el mismo borrador no entra y no avisa', () => {
    const items = [mio('A', { my_releasable_bps: 0 }), mio('B', { my_releasable_bps: 0 }), item({ id: 'C' })];
    expect(comoLaPantalla(items, [['A', 10000], ['B', 10000], ['C', 10000]])).toBe(false);
  });

  it('sin my_releasable_bps, en el otro sentido también avisa (una hoja de más se deshace)', () => {
    const items = [mio('A', { remaining_bps: 5000, my_bps: 5000, my_releasable_bps: undefined }), item({ id: 'B', remaining_bps: 0 })];
    expect(comoLaPantalla(items, [['A', 5000]])).toBe(true);
  });

  it('«cambia» en consumo es «hay borrador»: repetir lo mismo también escribe, y con el $0 libre (D389) la mesa se cierra', () => {
    const items = [mio('A'), item({ id: 'agua', price_cents: 0 })];
    expect(comoLaPantalla(items, [['A', 10000]])).toBe(true);
    // Control positivo: sin la opción, «repetir lo mismo» no cambia nada y no avisa.
    const b = new Map([['A', 10000]]);
    expect(seleccionCierraLaMesa({ items, guarantee_mode: false }, (i) => i.remaining_bps, (i) => propioEnConsumo(i, b), b)).toBe(false);
  });

  it('un borrador vacío en consumo sigue sin cerrar nada', () => {
    expect(comoLaPantalla([mio('A', { remaining_bps: 5000, my_bps: 5000, my_releasable_bps: 5000 })], [])).toBe(false);
  });

  it('propioEnConsumo: 0 si el borrador no toca el plato; lo liberable si lo toca; sin el dato, lo justo para que entre', () => {
    const b = new Map([['A', 5000]]);
    expect(propioEnConsumo(mio('B'), b)).toBe(0);
    expect(propioEnConsumo(mio('A', { my_releasable_bps: 3333 }), b)).toBe(3333);
    expect(propioEnConsumo(mio('A', { remaining_bps: 2000, my_releasable_bps: undefined }), b)).toBe(3000);
    expect(propioEnConsumo(mio('A', { remaining_bps: 8000, my_releasable_bps: undefined }), b)).toBe(0);
    // Con un restante inválido decide la función, que no avisa ante un dato desconocido.
    expect(propioEnConsumo(mio('A', { remaining_bps: -1, my_releasable_bps: undefined }), b)).toBe(0);
  });

  it('la lista de la hoja: el plato que el borrador repite reemplaza lo liberable, no lo suma (A ½ sigue en ½)', () => {
    const a = mio('A', { name: 'Pizza', remaining_bps: 5000, my_bps: 5000, my_releasable_bps: 5000 });
    expect(elegidosAlGuardar({ items: [a] }, true, new Map([['A', 5000]])).map((e) => e.bps)).toEqual([5000]);
    // Sin el dato se suma, como antes: es sólo la lista.
    const sinDato = { ...a, my_releasable_bps: undefined };
    expect(elegidosAlGuardar({ items: [sinDato] }, true, new Map([['A', 5000]])).map((e) => e.bps)).toEqual([10000]);
  });

  it('el cableado: MesaDetailView pasa lo propio de consumo y la opción de escritura a la hoja', () => {
    const fuente = readFileSync(new URL('./MesaDetailView.tsx', import.meta.url), 'utf8');
    const listo = fuente.slice(fuente.indexOf('const listoCierraLaMesa'), fuente.indexOf('const enfocarListo'));
    expect(listo).toContain('(item) => propioEnConsumo(item, selected),');
    expect(listo).toContain('{ escribeConCualquierBorrador: true },');
    expect(listo).not.toContain('() => 0');
  });
});

describe('D240 punto 8 · lo que muestra la hoja', () => {
  const items = [
    item({ id: 't1', name: 'Tiramisú', price_cents: 7000, my_bps: 10000 }),
    item({ id: 't2', name: 'Tiramisú', price_cents: 7000, my_bps: 10000 }),
    item({ id: 'ag', name: 'Agua mineral', price_cents: 4000, my_bps: 5000 }),
    item({ id: 'pz', name: 'Pizza', price_cents: 18500, my_bps: 10000, status: 'paid' }),
    item({ id: 'vn', name: 'Vino', price_cents: 12000 }),
  ];

  it('lo registrado, con los iguales juntos y la porción: lo pagado no entra', () => {
    expect(lineasElegidas(elegidosRegistrados({ items }, true, new Map())).map((l) => l.texto))
      .toEqual(['2 × Tiramisú', 'Agua mineral · ½']);
  });

  it('al guardar en consumo: lo registrado más el borrador', () => {
    expect(lineasElegidas(elegidosAlGuardar({ items }, true, new Map([['vn', 10000]]))).map((l) => l.texto))
      .toEqual(['2 × Tiramisú', 'Agua mineral · ½', 'Vino']);
  });

  it('en «igual» lo registrado sale de lo guardado, y al guardar vale sólo el borrador', () => {
    const guardadas = new Map([['vn', 10000]]);
    expect(lineasElegidas(elegidosRegistrados({ items }, false, guardadas)).map((l) => l.texto)).toEqual(['Vino']);
    expect(lineasElegidas(elegidosAlGuardar({ items }, false, new Map([['ag', 10000]]))).map((l) => l.texto))
      .toEqual(['Agua mineral']);
  });
});
