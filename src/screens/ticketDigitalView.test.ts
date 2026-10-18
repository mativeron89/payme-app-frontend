import { describe, expect, it } from 'vitest';
import type { MesaDetail } from '../api/types';
import { ticketDigitalView } from './ticketDigitalView';
import { leerParteDelDetalle } from '../api/miParte';

const mesa = {
  code: 'PA-1234',
  restaurant: { id: 'r-1', name: 'Casa Azul', category: 'mexican', address: 'Privada 123' },
  total_cents: 42000,
  items: [
    {
      id: 'item-1', name: 'Tacos', category: 'mexican', price_cents: 14000, quantity: 3,
      status: 'locked', remaining_bps: 0, my_bps: 0, locked_by_me: false, lock_expires_at: null,
    },
  ],
} as MesaDetail;

describe('ticketDigitalView', () => {
  it('proyecta sólo restaurante, código, ítems/cantidad/precio y total', () => {
    expect(ticketDigitalView(mesa, 'PA-1234')).toEqual({
      code: 'PA-1234',
      restaurantName: 'Casa Azul',
      items: [{ name: 'Tacos', quantity: 3, unitPriceCents: 14000 }],
      totalCents: 42000,
    });
    expect(JSON.stringify(ticketDigitalView(mesa, 'PA-1234'))).not.toContain('Privada');
    expect(JSON.stringify(ticketDigitalView(mesa, 'PA-1234'))).not.toContain('locked');
  });

  it('D209 · con `ticket_totals` del dueño, el subtotal y el IVA; sin la clave, como antes', () => {
    const conTotales = { ...mesa, ticket_totals: { subtotal_cents: 36207, tax_cents: 5793 } } as MesaDetail;
    expect(ticketDigitalView(conTotales, 'PA-1234').totals).toEqual({ subtotalCents: 36207, taxCents: 5793, ivaAparte: false });
    expect('totals' in ticketDigitalView(mesa, 'PA-1234')).toBe(false);
  });

  it('🔴 L1 · IVA agregado: el subtotal es el total de la mesa; ya no lanza y el IVA queda aparte', () => {
    const agregado = { ...mesa, ticket_totals: { subtotal_cents: 42000, tax_cents: 6720 } } as MesaDetail;
    expect(ticketDigitalView(agregado, 'PA-1234').totals).toEqual({ subtotalCents: 42000, taxCents: 6720, ivaAparte: true });
  });

  it('🔴 D218 · con descuento: la suma, y sin totales aunque vinieran', () => {
    const conDescuento = {
      ...mesa,
      ticket_adjustments: [{ kind: 'discount', amount_cents: 5000 }, { kind: 'discount', amount_cents: 1000 }],
    } as MesaDetail;
    const vista = ticketDigitalView(conDescuento, 'PA-1234');
    expect(vista.discountCents).toBe(6000);
    expect(vista.totalCents).toBe(42000);
    expect('totals' in ticketDigitalView({ ...conDescuento, ticket_totals: { subtotal_cents: 36207, tax_cents: 5793 } } as MesaDetail, 'PA-1234'))
      .toBe(false);
    expect('discountCents' in ticketDigitalView(mesa, 'PA-1234')).toBe(false);
  });

  describe('D224 · una mesa con cargo por servicio (fila v2)', () => {
    const conServicio = (extra: Partial<MesaDetail>) => ({
      ...mesa, ticket_adjustments: [{ kind: 'service_charge', amount_cents: 5000 }], ...extra,
    }) as MesaDetail;

    it('🔴 sin totales: el servicio y el total impreso = ítems + servicio', () => {
      const vista = ticketDigitalView(conServicio({}), 'PA-1234');
      expect(vista.desglose?.filas).toEqual([{ clave: 'servicio', cents: 5000 }, { clave: 'total', cents: 47000 }]);
      expect(vista.desglose?.aparte).toEqual({ ivaCents: 0, descuentoCents: 0, servicioCents: 5000 });
      expect(vista.totalCents).toBe(42000);
    });

    it('🔴 con IVA agregado: Subtotal, IVA, Cargo por servicio y el impreso deducido', () => {
      const vista = ticketDigitalView(conServicio({ ticket_totals: { subtotal_cents: 42000, tax_cents: 6720 } }), 'PA-1234');
      expect(vista.desglose?.filas.map((f) => `${f.clave}:${f.cents}`))
        .toEqual(['subtotal:42000', 'iva:6720', 'servicio:5000', 'total:53720']);
    });

    it('con IVA incluido: el IVA no queda aparte, el servicio sí', () => {
      const vista = ticketDigitalView(conServicio({ ticket_totals: { subtotal_cents: 36207, tax_cents: 5793 } }), 'PA-1234');
      expect(vista.desglose?.filas.map((f) => `${f.clave}:${f.cents}`))
        .toEqual(['subtotal:36207', 'iva:5793', 'servicio:5000', 'total:47000']);
      expect(vista.desglose?.aparte).toEqual({ ivaCents: 0, descuentoCents: 0, servicioCents: 5000 });
    });

    it('🔴 si no cierra, como la mesa con descuento: sin total inventado (plan D)', () => {
      const vista = ticketDigitalView(conServicio({ ticket_totals: { subtotal_cents: 30000, tax_cents: 4800 } }), 'PA-1234');
      expect(vista.desglose).toBeUndefined();
      expect(vista.apartes).toEqual({ descuentoCents: 0, servicioCents: 5000 });
    });

    it('🔴 si cierran DOS totales distintos, tampoco se elige uno (plan D)', () => {
      // Con IVA igual al descuento, «incluido» y «agregado» cierran los dos.
      const vista = ticketDigitalView({
        ...mesa,
        ticket_adjustments: [{ kind: 'discount', amount_cents: 6000 }, { kind: 'service_charge', amount_cents: 5000 }],
        ticket_totals: { subtotal_cents: 36000, tax_cents: 6000 },
      } as MesaDetail, 'PA-1234');
      expect(vista.desglose).toBeUndefined();
      expect(vista.apartes).toEqual({ descuentoCents: 6000, servicioCents: 5000 });
    });

    it('🔴 una mesa v1 (sólo descuentos, sin totales) se ve igual que hoy', () => {
      const v1 = ticketDigitalView({ ...mesa, ticket_adjustments: [{ kind: 'discount', amount_cents: 5000 }] } as MesaDetail, 'PA-1234');
      expect(v1.discountCents).toBe(5000);
      expect(v1.desglose).toBeUndefined();
      expect(v1.apartes).toBeUndefined();
    });

    it('🔴 totales de una fila v2 con forma rota: falla cerrado', () => {
      expect(() => ticketDigitalView(conServicio({ ticket_totals: { subtotal_cents: 0 } as never }), 'PA-1234'))
        .toThrow('ticket_digital_malformed');
      expect(() => ticketDigitalView(conServicio({ ticket_totals: { subtotal_cents: 42000, total_cents: 1 } as never }), 'PA-1234'))
        .toThrow('ticket_digital_malformed');
    });
  });

  it.each([
    ['vacío', []],
    ['más de 10', Array.from({ length: 11 }, () => ({ kind: 'discount', amount_cents: 100 }))],
    ['kind desconocido', [{ kind: 'surcharge', amount_cents: 100 }]],
    ['importe cero', [{ kind: 'discount', amount_cents: 0 }]],
    ['una clave de más', [{ kind: 'discount', amount_cents: 100, label: 'DESC' }]],
    ['no es arreglo', { kind: 'discount', amount_cents: 100 }],
  ])('🔴 D218 · `ticket_adjustments` %s: falla cerrado', (_caso, ajustes) => {
    expect(() => ticketDigitalView({ ...mesa, ticket_adjustments: ajustes } as unknown as MesaDetail, 'PA-1234'))
      .toThrow('ticket_digital_malformed');
  });

  it.each([
    ['no suman el total de la mesa', { subtotal_cents: 36207, tax_cents: 5794 }],
    ['ni S ni S + IVA son el total', { subtotal_cents: 30000, tax_cents: 4800 }],
    ['subtotal cero', { subtotal_cents: 0, tax_cents: 42000 }],
    ['IVA negativo', { subtotal_cents: 43000, tax_cents: -1000 }],
    ['una clave de más', { subtotal_cents: 36207, tax_cents: 5793, total_cents: 42000 }],
    ['no es objeto', [36207, 5793]],
  ])('🔴 D209 · `ticket_totals` que %s: falla cerrado, como el resto del visor', (_caso, ticketTotals) => {
    expect(() => ticketDigitalView({ ...mesa, ticket_totals: ticketTotals } as unknown as MesaDetail, 'PA-1234'))
      .toThrow('ticket_digital_malformed');
  });

  it('falla cerrado si el código o los campos visibles no son válidos', () => {
    expect(() => ticketDigitalView(mesa, 'PA-9999')).toThrow('ticket_digital_malformed');
    expect(() => ticketDigitalView({ ...mesa, total_cents: -1 }, 'PA-1234')).toThrow('ticket_digital_malformed');
    expect(() => ticketDigitalView({ ...mesa, items: [{ ...mesa.items[0]!, quantity: 0 }] }, 'PA-1234'))
      .toThrow('ticket_digital_malformed');
  });
});

/**
 * D344 · `yaIncluye`: los ajustes que «Mi parte» ya incluye, sólo en la mesa sin
 * garantía con `share_totals` válido, sin la marca de omitidos y con al menos un
 * ajuste. Los `share_totals` se escriben a mano, cada uno con su cuenta, y con
 * las identidades del contrato que exige `leerShareTotals`:
 *   adjustments = service + tax_added − discounts
 *   total       = items + adjustments + tip
 *   tip_basis   = máx(0, items − discounts) sin la marca
 * Con `tip_setting: null` la propina coherente es 0.
 */
describe('D344 · ticketDigitalView · yaIncluye', () => {
  const resto = { adjustments_omitted: false, adjustments_omitted_reason: null };
  // IVA 6720, servicio 5000, descuento 3000 · ajustes 5000 + 6720 − 3000 = 8720
  // · base 42000 − 3000 = 39000 · total 42000 + 8720 + 0 = 50720.
  const losTres = {
    items_cents: 42000, discounts_cents: 3000, service_cents: 5000, tax_added_cents: 6720, adjustments_cents: 8720,
    tip_basis_cents: 39000, tip_cents: 0, total_cents: 50720, ...resto,
  };
  // Sólo IVA 6720 · ajustes 6720 · base 42000 · total 42000 + 6720 = 48720.
  const soloIva = {
    items_cents: 42000, discounts_cents: 0, service_cents: 0, tax_added_cents: 6720, adjustments_cents: 6720,
    tip_basis_cents: 42000, tip_cents: 0, total_cents: 48720, ...resto,
  };
  // Sólo servicio 5000 · ajustes 5000 · base 42000 · total 47000.
  const soloServicio = {
    items_cents: 42000, discounts_cents: 0, service_cents: 5000, tax_added_cents: 0, adjustments_cents: 5000,
    tip_basis_cents: 42000, tip_cents: 0, total_cents: 47000, ...resto,
  };
  // Sólo descuento 3000 · ajustes −3000 · base 39000 · total 39000.
  const soloDescuento = {
    items_cents: 42000, discounts_cents: 3000, service_cents: 0, tax_added_cents: 0, adjustments_cents: -3000,
    tip_basis_cents: 39000, tip_cents: 0, total_cents: 39000, ...resto,
  };
  // IVA 6720 y servicio 5000 · ajustes 11720 · base 42000 · total 53720.
  const ivaYServicio = {
    items_cents: 42000, discounts_cents: 0, service_cents: 5000, tax_added_cents: 6720, adjustments_cents: 11720,
    tip_basis_cents: 42000, tip_cents: 0, total_cents: 53720, ...resto,
  };
  // Sin ajustes · ajustes 0 · base 42000 · total 42000.
  const sinAjustes = {
    items_cents: 42000, discounts_cents: 0, service_cents: 0, tax_added_cents: 0, adjustments_cents: 0,
    tip_basis_cents: 42000, tip_cents: 0, total_cents: 42000, ...resto,
  };
  // Mesa corregida: con la marca, descuento, servicio e IVA en 0 y base = platos.
  const omitidos = {
    items_cents: 42000, discounts_cents: 0, service_cents: 0, tax_added_cents: 0, adjustments_cents: 0,
    tip_basis_cents: 42000, tip_cents: 0, total_cents: 42000,
    adjustments_omitted: true, adjustments_omitted_reason: 'mesa_corregida',
  };
  // La parte de quien mira: 12345 + 2563 = 14908; 14908 + 1111 = 16019. Ningún
  // monto coincide con otro de la mesa.
  const miParte = { items_cents: 12345, adjustments_cents: 2563, tip_cents: 1111, total_cents: 16019 };

  const sinGarantia = (extra: Record<string, unknown>) =>
    ({ ...mesa, guarantee_mode: false, tip_setting: null, ...extra }) as unknown as MesaDetail;
  const deSiempre = {
    code: 'PA-1234',
    restaurantName: 'Casa Azul',
    items: [{ name: 'Tacos', quantity: 3, unitPriceCents: 14000 }],
    totalCents: 42000,
  };

  it('🔴 sin garantía y con los tres ajustes: la proyección de siempre más exactamente esos tres montos', () => {
    expect(ticketDigitalView(sinGarantia({ share_totals: losTres, my_share: miParte }), 'PA-1234')).toStrictEqual({
      ...deSiempre,
      yaIncluye: { tax_added_cents: 6720, service_cents: 5000, discounts_cents: 3000 },
    });
  });

  // Un caso por término del `||`: con un solo ajuste mayor que cero ya aparece.
  it.each([
    ['sólo el IVA aparte', soloIva, { tax_added_cents: 6720, service_cents: 0, discounts_cents: 0 }],
    ['sólo el cargo por servicio', soloServicio, { tax_added_cents: 0, service_cents: 5000, discounts_cents: 0 }],
    ['sólo el descuento', soloDescuento, { tax_added_cents: 0, service_cents: 0, discounts_cents: 3000 }],
  ])('🔴 con %s: presente, con los tres montos', (_caso, shareTotals, esperado) => {
    expect(ticketDigitalView(sinGarantia({ share_totals: shareTotals }), 'PA-1234').yaIncluye).toStrictEqual(esperado);
  });

  it.each([
    ['con garantía', { ...mesa, guarantee_mode: true, tip_setting: null, share_totals: losTres }],
    ['sin la clave guarantee_mode', { ...mesa, tip_setting: null, share_totals: losTres }],
    ['con share_totals en null', { ...mesa, guarantee_mode: false, tip_setting: null, share_totals: null }],
    ['sin la clave share_totals', { ...mesa, guarantee_mode: false, tip_setting: null }],
    ['con share_totals mal formado (ajustes que no cierran: 8721 ≠ 8720)',
      { ...mesa, guarantee_mode: false, tip_setting: null, share_totals: { ...losTres, adjustments_cents: 8721 } }],
    ['con share_totals mal formado (la marca en texto)',
      { ...mesa, guarantee_mode: false, tip_setting: null, share_totals: { ...losTres, adjustments_omitted: 'false' } }],
    // Sin validar, un 0 se leería como «sin la marca» y saldría presente.
    ['con share_totals mal formado (la marca en número)',
      { ...mesa, guarantee_mode: false, tip_setting: null, share_totals: { ...losTres, adjustments_omitted: 0 } }],
    // «Mi parte» exige que la propina de los totales sea la que fijó el organizador:
    // sin tip_setting, o con otra propina, el dueño no la publicó así y no se usa.
    ['sin la clave tip_setting', { ...mesa, guarantee_mode: false, share_totals: losTres }],
    ['con una propina que no es la de los totales', { ...mesa, guarantee_mode: false, tip_setting: { tip_cents: 1 }, share_totals: losTres }],
    ['con share_totals que no es objeto', { ...mesa, guarantee_mode: false, tip_setting: null, share_totals: [losTres] }],
    ['con adjustments_omitted en true', { ...mesa, guarantee_mode: false, tip_setting: null, share_totals: omitidos }],
    ['sin ajustes', { ...mesa, guarantee_mode: false, tip_setting: null, share_totals: sinAjustes }],
  ])('🔴 %s: la clave yaIncluye no está y la proyección es la de siempre', (_caso, entrada) => {
    const vista = ticketDigitalView(entrada as unknown as MesaDetail, 'PA-1234');
    expect('yaIncluye' in vista).toBe(false);
    expect(vista).toStrictEqual(deSiempre);
  });

  it('🔴 con una fila v2 que no cierra (apartes), los apartes de siempre más yaIncluye', () => {
    // Impreso deducido 30000 + 4800 + 5000 = 39800; los platos con el servicio dan 47000, o 51800 con
    // el IVA: no cierra, así que van los apartes (plan D).
    const vista = ticketDigitalView(sinGarantia({
      ticket_adjustments: [{ kind: 'service_charge', amount_cents: 5000 }],
      ticket_totals: { subtotal_cents: 30000, tax_cents: 4800 },
      share_totals: soloServicio,
    }), 'PA-1234');
    expect(vista).toStrictEqual({
      ...deSiempre,
      apartes: { descuentoCents: 0, servicioCents: 5000 },
      yaIncluye: { tax_added_cents: 0, service_cents: 5000, discounts_cents: 0 },
    });
  });

  it('🔴 la propina de la mesa no entra en yaIncluye', () => {
    // Con «Otro» de 4000: propina 4000 · total 42000 + 8720 + 4000 = 54720.
    const conPropina = { ...losTres, tip_cents: 4000, total_cents: 54720 };
    const vista = ticketDigitalView(sinGarantia({ tip_setting: { tip_cents: 4000 }, share_totals: conPropina }), 'PA-1234');
    expect(vista.yaIncluye).toStrictEqual({ tax_added_cents: 6720, service_cents: 5000, discounts_cents: 3000 });
    // Se comparan NÚMEROS, no texto: «14000» contiene la subcadena «4000».
    const numeros = JSON.stringify(vista).match(/-?\d+/g)!.map(Number);
    expect(numeros).not.toContain(4000);
    expect(numeros).not.toContain(54720);
    expect(numeros).toContain(14000);
  });

  it('🔴 R5 · nunca proyecta my_share ni la parte de nadie', () => {
    const vista = ticketDigitalView(sinGarantia({ share_totals: losTres, my_share: miParte }), 'PA-1234');
    const claves: string[] = [];
    const numeros: number[] = [];
    const recorrer = (v: unknown): void => {
      if (typeof v === 'number') numeros.push(v);
      else if (Array.isArray(v)) v.forEach(recorrer);
      else if (typeof v === 'object' && v !== null) {
        for (const [k, x] of Object.entries(v)) { claves.push(k); recorrer(x); }
      }
    };
    recorrer(vista);
    for (const prohibida of ['my_share', 'myShare']) expect(claves).not.toContain(prohibida);
    // Los cuatro montos de la parte propia y su neto (14908).
    for (const monto of [12345, 2563, 1111, 16019, 14908]) expect(numeros).not.toContain(monto);
    expect(JSON.stringify(vista)).not.toMatch(/my_?share/i);
    // Tampoco los totales de la mesa que no son ajustes (platos, base, total).
    expect(numeros).not.toContain(39000);
    expect(numeros).not.toContain(50720);
  });

  it('🔴 con una fila v2 (IVA agregado y servicio), el desglose de siempre más yaIncluye', () => {
    // Impreso deducido: 42000 + 6720 + 5000 = 53720; la mesa cierra con IVA agregado.
    const vista = ticketDigitalView(sinGarantia({
      ticket_adjustments: [{ kind: 'service_charge', amount_cents: 5000 }],
      ticket_totals: { subtotal_cents: 42000, tax_cents: 6720 },
      share_totals: ivaYServicio,
    }), 'PA-1234');
    expect(vista.desglose?.filas.map((f) => `${f.clave}:${f.cents}`))
      .toEqual(['subtotal:42000', 'iva:6720', 'servicio:5000', 'total:53720']);
    expect(vista.desglose?.aparte).toEqual({ ivaCents: 6720, descuentoCents: 0, servicioCents: 5000 });
    expect(vista.yaIncluye).toStrictEqual({ tax_added_cents: 6720, service_cents: 5000, discounts_cents: 0 });
    expect(Object.keys(vista).sort()).toEqual(['code', 'desglose', 'items', 'restaurantName', 'totalCents', 'yaIncluye']);
  });

  it('🔴 con una fila v1 (sólo descuento), el descuento de siempre más yaIncluye', () => {
    const vista = ticketDigitalView(sinGarantia({
      ticket_adjustments: [{ kind: 'discount', amount_cents: 3000 }],
      share_totals: soloDescuento,
    }), 'PA-1234');
    expect(vista).toStrictEqual({
      ...deSiempre,
      discountCents: 3000,
      yaIncluye: { tax_added_cents: 0, service_cents: 0, discounts_cents: 3000 },
    });
  });

  it('🔴 D209 · con ticket_totals de IVA agregado, los totales de siempre más yaIncluye', () => {
    const vista = ticketDigitalView(sinGarantia({
      ticket_totals: { subtotal_cents: 42000, tax_cents: 6720 },
      share_totals: soloIva,
    }), 'PA-1234');
    expect(vista).toStrictEqual({
      ...deSiempre,
      totals: { subtotalCents: 42000, taxCents: 6720, ivaAparte: true },
      yaIncluye: { tax_added_cents: 6720, service_cents: 0, discounts_cents: 0 },
    });
  });

  it('con garantía, la fila v2 se ve exactamente como sin «Mi parte»', () => {
    const vista = ticketDigitalView({
      ...mesa,
      guarantee_mode: true,
      tip_setting: null,
      ticket_adjustments: [{ kind: 'service_charge', amount_cents: 5000 }],
      share_totals: ivaYServicio,
    } as unknown as MesaDetail, 'PA-1234');
    // Sin totales: impreso = 42000 + 5000 = 47000.
    expect(vista).toStrictEqual({
      ...deSiempre,
      desglose: {
        filas: [{ clave: 'servicio', cents: 5000 }, { clave: 'total', cents: 47000 }],
        aparte: { ivaCents: 0, descuentoCents: 0, servicioCents: 5000 },
      },
    });
  });

  it('control · los share_totals válidos de estos casos SÍ se leen: la ausencia sale de la regla, no del dato roto', () => {
    // Sin esto, «sin ajustes» u «omitidos» podrían dar ausente sólo porque el
    // dato de prueba no pasa la lectura del contrato.
    for (const [nombre, shareTotals] of Object.entries({
      losTres, soloIva, soloServicio, soloDescuento, ivaYServicio, sinAjustes, omitidos,
    })) {
      const leido = leerParteDelDetalle(sinGarantia({ share_totals: shareTotals })).shareTotals;
      expect(leido, nombre).toBeTypeOf('object');
      expect(leido, nombre).not.toBeNull();
    }
    // Y los mal formados de arriba, no.
    expect(leerParteDelDetalle(sinGarantia({ share_totals: { ...losTres, adjustments_cents: 8721 } })).shareTotals).toBeUndefined();
    expect(leerParteDelDetalle(sinGarantia({ share_totals: { ...losTres, adjustments_omitted: 'false' } })).shareTotals).toBeUndefined();
    expect(leerParteDelDetalle(sinGarantia({ share_totals: [losTres] })).shareTotals).toBeUndefined();
  });
});
