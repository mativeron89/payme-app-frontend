import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractResponseError } from './contractResponses';
import { HttpError } from './http';
import { MockApiError } from './mock/mockApi';
import { MonetarySafetyError } from './idempotency';
import {
  clasificarErrorDePropina,
  cuerpoDelPutDePropina,
  leerMyShare,
  leerParteDelDetalle,
  leerRespuestaDelPutDePropina,
  leerShareTotals,
  leerTipSetting,
  type MyShare,
  type ShareTotals,
  type TipSetting,
} from './miParte';
import type { ApiError } from './types';

/**
 * D344 · «Mi parte» · App Backend 2.186.0 (`contract-mirror/contract/mesa-mi-parte-v1.json`).
 *
 * Los números de los ejemplos son los de las pruebas del dueño
 * (`tests/parte-de-mesa.test.js`, E1–E8 e IG-A/IG-B de la propuesta v2), para
 * que el decodificador apruebe exactamente lo que el dueño publica. Cada regla
 * tiene su caso que la rompe sola (un mutante por término), salvo las que ya
 * implican otras (se dice cuál).
 */
const contrato = JSON.parse(
  readFileSync(new URL('../../contract-mirror/contract/mesa-mi-parte-v1.json', import.meta.url), 'utf8'),
) as {
  id: string;
  escritura: { ruta: string; cuerpo: string };
  lectura: { claves: { tip_setting: string; share_totals: string; my_share: string } };
};

const MAX = Number.MAX_SAFE_INTEGER;

/** Las claves que el contrato escribe entre llaves al principio de su texto. */
function clavesDelTexto(texto: string): string[] {
  const m = /^\{([^}]*)\}/.exec(texto);
  if (!m) throw new Error('el contrato cambió de forma');
  return m[1]!.split(/,\s*/);
}

function totales(
  P: number, D: number, S: number, V: number, A: number, B: number, T: number, total: number,
  omitidos = false, motivo: string | null = null,
): Record<string, unknown> {
  return {
    items_cents: P, discounts_cents: D, service_cents: S, tax_added_cents: V, adjustments_cents: A,
    tip_basis_cents: B, tip_cents: T, total_cents: total,
    adjustments_omitted: omitidos, adjustments_omitted_reason: motivo,
  };
}

function parte(items: number, ajustes: number, propina: number, total: number): Record<string, unknown> {
  return { items_cents: items, adjustments_cents: ajustes, tip_cents: propina, total_cents: total };
}

// E1 · descuento $20, propina 10 % sobre $150.
const E1 = totales(17000, 2000, 0, 0, -2000, 15000, 1500, 16500);
const E1_ANA = parte(10000, -1176, 882, 9706);
const E1_BETO = parte(7000, -824, 618, 6794);
// E2 · tres de $100, descuento $20, 15 % sobre $280: $42.
const E2 = totales(30000, 2000, 0, 0, -2000, 28000, 4200, 32200);
// E5 · «Otro» $50 fijos.
const E5 = totales(17000, 2000, 0, 0, -2000, 15000, 5000, 20000);
const E5_ANA = parte(10000, -1176, 2941, 11765);
// E8 · servicio $17, IVA aparte $27.20 y descuento $20.
const E8 = totales(17000, 2000, 1700, 2720, 2420, 15000, 1500, 20920);
const E8_ANA = parte(10000, 1424, 882, 12306);
// R4 · la mesa se corrigió: sin ajustes y la propina sobre los platos (B = P).
const CORREGIDA = totales(17000, 0, 0, 0, 0, 17000, 1700, 18700, true, 'mesa_corregida');
// Resguardo · el descuento cubre la cuenta: sin ajustes y la propina por % en 0 (B = 0).
const NETO_CERO = totales(17000, 0, 0, 0, 0, 0, 0, 17000, true, 'neto_no_positivo');
const NETO_CERO_ANA = parte(17000, 0, 0, 17000);
// Un centavo de neto: sin la marca, y la propina por % redondea a 0.
const CASI = totales(17000, 16999, 0, 0, -16999, 1, 0, 1);
// IG-B · $1 entre 3 con 2 centavos de descuento, sin propina fijada.
const IG_B = totales(100, 2, 0, 0, -2, 98, 0, 98);

describe('D344 · el contrato espejado', () => {
  it('es el del dueño', () => {
    expect(contrato.id).toBe('payme.app.mesa_mi_parte/v1');
    expect(contrato.escritura.ruta).toBe('PUT /api/mesas/:code/tip');
  });

  it('las claves de share_totals y my_share son las del contrato, ni una más', () => {
    expect(Object.keys(E1).sort()).toEqual(clavesDelTexto(contrato.lectura.claves.share_totals).sort());
    expect(Object.keys(E1_ANA).sort()).toEqual(clavesDelTexto(contrato.lectura.claves.my_share).sort());
    expect(clavesDelTexto(contrato.lectura.claves.share_totals)).toHaveLength(10);
  });
});

describe('D344 · tip_setting', () => {
  it('null, un % de 0 a 10000 o «Otro» entero ≥ 0', () => {
    expect(leerTipSetting(null)).toBeNull();
    for (const bps of [0, 500, 1000, 1500, 2000, 1, 9999, 10000]) {
      expect(leerTipSetting({ tip_bps: bps })).toEqual({ tip_bps: bps });
    }
    for (const cents of [0, 1, 5000, 123456, MAX]) {
      expect(leerTipSetting({ tip_cents: cents })).toEqual({ tip_cents: cents });
    }
  });

  it('devuelve una copia, no el objeto recibido', () => {
    const crudo = { tip_bps: 1000 };
    const leido = leerTipSetting(crudo);
    expect(leido).toEqual(crudo);
    expect(leido).not.toBe(crudo);
  });

  it('🔴 un mutante por borde: 10001, −1, decimales y montos fuera del rango seguro', () => {
    for (const malo of [
      { tip_bps: 10001 }, { tip_bps: -1 }, { tip_bps: 1000.5 }, { tip_bps: Number.NaN },
      { tip_cents: -1 }, { tip_cents: 1.5 }, { tip_cents: MAX + 1 }, { tip_cents: Number.POSITIVE_INFINITY },
      { tip_cents: Number.NaN },
    ]) {
      expect(leerTipSetting(malo), JSON.stringify(malo)).toBeUndefined();
    }
  });

  it('🔴 exactamente una clave: dos, de más, ninguna, o textos, no valen', () => {
    for (const malo of [
      {}, { tip_bps: 1000, tip_cents: 0 }, { tip_bps: 1000, extra: 1 }, { tip_cents: 500, tip_bps: null },
      { tip_bps: '1000' }, { tip_cents: '500' }, { tip_bps: null }, { tip_cents: true }, { otro: 1000 },
      [], [{ tip_bps: 1000 }], 'tip_bps', 1000, true, undefined,
    ]) {
      expect(leerTipSetting(malo), JSON.stringify(malo)).toBeUndefined();
    }
  });

  it('🔴 sin prototipos: una clave heredada no cuenta como propia', () => {
    expect(leerTipSetting(Object.create({ tip_bps: 1000 }) as unknown)).toBeUndefined();
    const conHerencia = Object.assign(Object.create({ tip_bps: 1000 }) as object, { tip_cents: 500 });
    expect(leerTipSetting(conHerencia)).toEqual({ tip_cents: 500 });
  });

  it('nunca lanza: un getter que falla cuenta como mal formado', () => {
    const traicionero = { get tip_bps(): number { throw new Error('boom'); } };
    expect(leerTipSetting(traicionero)).toBeUndefined();
  });
});

describe('D344 · share_totals · las formas del dueño', () => {
  it('los ejemplos de la propuesta: E1, E2, E5, E8, mesa corregida, neto no positivo, un centavo e IG-B', () => {
    for (const [nombre, t] of Object.entries({ E1, E2, E5, E8, CORREGIDA, NETO_CERO, CASI, IG_B })) {
      expect(leerShareTotals(t), nombre).toEqual(t);
    }
    expect(leerShareTotals(null)).toBeNull();
  });

  it('el motivo con la marca: mesa_corregida y neto_no_positivo', () => {
    expect(leerShareTotals(CORREGIDA)?.adjustments_omitted_reason).toBe('mesa_corregida');
    expect(leerShareTotals(NETO_CERO)?.adjustments_omitted_reason).toBe('neto_no_positivo');
    // «Otro» no cambia con el neto no positivo: la propina fija se suma igual.
    expect(leerShareTotals(totales(17000, 0, 0, 0, 0, 0, 5000, 22000, true, 'neto_no_positivo'))).toBeDefined();
  });

  it('🔴 claves exactas: cada una de las 10 que falte, o una de más, no vale', () => {
    for (const clave of Object.keys(E1)) {
      const sinUna: Record<string, unknown> = { ...E1 };
      delete sinUna[clave];
      expect(leerShareTotals(sinUna), `sin ${clave}`).toBeUndefined();
    }
    expect(leerShareTotals({ ...E1, extra: 0 })).toBeUndefined();
    for (const malo of [{}, [], 'E1', 0, true, undefined]) expect(leerShareTotals(malo)).toBeUndefined();
  });

  it('🔴 adjustments = service + tax_added − discounts (lo demás cierra igual)', () => {
    expect(leerShareTotals({ ...E1, adjustments_cents: -1999, total_cents: 16501 })).toBeUndefined();
    expect(leerShareTotals({ ...E8, adjustments_cents: 2421, total_cents: 20921 })).toBeUndefined();
  });

  it('🔴 total = items + adjustments + tip', () => {
    expect(leerShareTotals({ ...E1, total_cents: 16501 })).toBeUndefined();
    expect(leerShareTotals({ ...E1, total_cents: 16499 })).toBeUndefined();
    expect(leerShareTotals({ ...E8, total_cents: 20920 - 1500 })).toBeUndefined();
  });

  it('🔴 la base exacta: máx(0, items − discounts) sin la marca, items corregida, 0 con neto no positivo', () => {
    expect(leerShareTotals({ ...E1, tip_basis_cents: 14999 })).toBeUndefined();
    expect(leerShareTotals({ ...E1, tip_basis_cents: 15001 })).toBeUndefined();
    expect(leerShareTotals({ ...CORREGIDA, tip_basis_cents: 16999 })).toBeUndefined();
    expect(leerShareTotals({ ...NETO_CERO, tip_basis_cents: 1 })).toBeUndefined();
    // B ≤ items: lo implica la base exacta, pero se comprueba igual.
    expect(leerShareTotals({ ...CORREGIDA, tip_basis_cents: 17001 })).toBeUndefined();
    // Con el descuento mayor que los platos y el servicio cubriendo, B = 0 sin la marca.
    expect(leerShareTotals(totales(10000, 12000, 5000, 0, -7000, 0, 0, 3000))).toBeDefined();
    expect(leerShareTotals(totales(10000, 12000, 5000, 0, -7000, 1, 0, 3000))).toBeUndefined();
  });

  it('🔴 sin la marca, el neto es positivo: con neto 0 el dueño pone la marca', () => {
    // Todo lo demás cierra: identidades, base 0 = máx(0, 17000 − 17000), total 0 ≥ 0.
    expect(leerShareTotals(totales(17000, 17000, 0, 0, -17000, 0, 0, 0))).toBeUndefined();
  });

  it('🔴 adjustments_omitted booleano estricto', () => {
    for (const malo of ['false', 0, 1, null, 'true']) {
      expect(leerShareTotals({ ...E1, adjustments_omitted: malo }), String(malo)).toBeUndefined();
    }
  });

  it('🔴 con la marca, descuentos, servicio e IVA aparte en 0, uno por uno', () => {
    expect(leerShareTotals({ ...CORREGIDA, discounts_cents: 100, adjustments_cents: -100, total_cents: 18600 }))
      .toBeUndefined();
    expect(leerShareTotals({ ...CORREGIDA, service_cents: 100, adjustments_cents: 100, total_cents: 18800 }))
      .toBeUndefined();
    expect(leerShareTotals({ ...CORREGIDA, tax_added_cents: 100, adjustments_cents: 100, total_cents: 18800 }))
      .toBeUndefined();
  });

  it('🔴 el motivo: conocido con la marca, null sin ella', () => {
    for (const malo of [null, 'otro', '', 'MESA_CORREGIDA', 1]) {
      expect(leerShareTotals({ ...CORREGIDA, adjustments_omitted_reason: malo }), String(malo)).toBeUndefined();
    }
    for (const malo of ['mesa_corregida', 'neto_no_positivo', '', 'null']) {
      expect(leerShareTotals({ ...E1, adjustments_omitted_reason: malo }), malo).toBeUndefined();
    }
  });

  it('🔴 pisos en 0, uno por uno, con las cuentas cerrando igual', () => {
    // Propina −1: neto 15000 y total 14999 cierran; sólo el piso lo rechaza.
    expect(leerShareTotals({ ...E1, tip_cents: -1, total_cents: 14999 })).toBeUndefined();
    // Servicio −100: adjustments −2100 y total 16400 cierran.
    expect(leerShareTotals({ ...E1, service_cents: -100, adjustments_cents: -2100, total_cents: 16400 })).toBeUndefined();
    // IVA aparte −100: igual.
    expect(leerShareTotals({ ...E1, tax_added_cents: -100, adjustments_cents: -2100, total_cents: 16400 })).toBeUndefined();
    // Platos, descuentos y base negativos también rompen otra regla; se rechazan igual.
    expect(leerShareTotals({ ...E1, items_cents: -1 })).toBeUndefined();
    expect(leerShareTotals({ ...E1, discounts_cents: -1 })).toBeUndefined();
    expect(leerShareTotals({ ...E1, tip_basis_cents: -1 })).toBeUndefined();
    // El total ≥ 0 lo implican las identidades y el neto positivo; un total negativo cae igual.
    expect(leerShareTotals({ ...E1, total_cents: -1 })).toBeUndefined();
  });

  it('🔴 enteros: decimales que cierran todas las cuentas igual no valen', () => {
    // 0.5 + 0.5 − 2001 = −2000 y la base 14999 = 17000 − 2001: sólo el entero lo rechaza.
    expect(leerShareTotals({ ...E1, service_cents: 0.5, tax_added_cents: 0.5, discounts_cents: 2001, tip_basis_cents: 14999 }))
      .toBeUndefined();
    expect(leerShareTotals({ ...E1, items_cents: '17000' })).toBeUndefined();
    expect(leerShareTotals({ ...E1, tip_cents: MAX + 1, total_cents: 15000 + MAX + 1 })).toBeUndefined();
  });

  it('🔴 aritmética exacta: un redondeo de la coma flotante no aprueba una cuenta que no cierra', () => {
    const S = MAX - 1;
    const V = 5;
    const D = 10;
    // La resta ingenua (S + V) − D pasa por 2^53 + 3, que redondea a 2^53 + 4: da MAX − 5.
    expect(S + V - D).toBe(MAX - 5);
    // La cuenta exacta da MAX − 6, y esa es la única que se acepta.
    expect(leerShareTotals(totales(1, D, S, V, MAX - 6, 0, 0, MAX - 5))).toBeDefined();
    expect(leerShareTotals(totales(1, D, S, V, MAX - 5, 0, 0, MAX - 4))).toBeUndefined();
  });
});

describe('D344 · my_share', () => {
  it('las partes del dueño, con ajustes negativos, cero y null', () => {
    for (const p of [E1_ANA, E1_BETO, E5_ANA, E8_ANA, NETO_CERO_ANA, parte(33, -1, 0, 32), parte(0, 0, 0, 0)]) {
      expect(leerMyShare(p), JSON.stringify(p)).toEqual(p);
    }
    // En partes iguales, quien no tiene parte recibe null.
    expect(leerMyShare(null)).toBeNull();
  });

  it('🔴 claves exactas', () => {
    for (const clave of Object.keys(E1_ANA)) {
      const sinUna: Record<string, unknown> = { ...E1_ANA };
      delete sinUna[clave];
      expect(leerMyShare(sinUna), `sin ${clave}`).toBeUndefined();
    }
    expect(leerMyShare({ ...E1_ANA, user_id: 'x' })).toBeUndefined();
    for (const malo of [{}, [], 'parte', 0, undefined]) expect(leerMyShare(malo)).toBeUndefined();
  });

  it('🔴 un mutante por término, con lo demás cerrando', () => {
    // platos + ajustes ≥ 0: 100 − 101 = −1 (el total 100 cierra con la propina 101).
    expect(leerMyShare(parte(100, -101, 101, 100))).toBeUndefined();
    // total = platos + ajustes + propina.
    expect(leerMyShare(parte(10000, -1176, 882, 9707))).toBeUndefined();
    // platos ≥ 0: −1 + 1 = 0 y el total 0 cierra.
    expect(leerMyShare(parte(-1, 1, 0, 0))).toBeUndefined();
    // propina ≥ 0: 100 + 0 − 1 = 99 cierra.
    expect(leerMyShare(parte(100, 0, -1, 99))).toBeUndefined();
    // enteros: 0.5 + 0.5 = 1 cierra.
    expect(leerMyShare(parte(0.5, 0.5, 0, 1))).toBeUndefined();
    expect(leerMyShare(parte(100, 0, 0, '100' as unknown as number))).toBeUndefined();
    expect(leerMyShare(parte(MAX, 1, 0, MAX))).toBeUndefined();
  });
});

describe('D344 · leerParteDelDetalle', () => {
  function mesa(extra: Record<string, unknown>): Record<string, unknown> {
    return { code: 'PA-1234', status: 'open', guarantee_mode: false, total_cents: 17000, ...extra };
  }

  it('la mesa sin garantía con todo: E1 desde el JSON del dueño', () => {
    const crudo = JSON.parse(JSON.stringify(mesa({ tip_setting: { tip_bps: 1000 }, share_totals: E1, my_share: E1_ANA })));
    expect(leerParteDelDetalle(crudo)).toEqual({ tipSetting: { tip_bps: 1000 }, shareTotals: E1, myShare: E1_ANA });
  });

  it('cada forma del dueño cierra con su propina', () => {
    const casos: Array<[TipSetting | null, Record<string, unknown>, Record<string, unknown> | null]> = [
      [{ tip_bps: 1000 }, E1, E1_BETO],
      [{ tip_bps: 1500 }, E2, parte(10000, -666, 1400, 10734)],
      [{ tip_cents: 5000 }, E5, E5_ANA],
      [{ tip_bps: 1000 }, E8, E8_ANA],
      [{ tip_bps: 1000 }, CORREGIDA, parte(17000, 0, 1700, 18700)],
      [{ tip_bps: 1000 }, NETO_CERO, NETO_CERO_ANA],
      [{ tip_bps: 1000 }, CASI, parte(17000, -16999, 0, 1)],
      [null, IG_B, parte(33, -1, 0, 32)],
      [{ tip_bps: 0 }, totales(9100, 5000, 0, 0, -5000, 4100, 0, 4100), parte(100, -55, 0, 45)],
    ];
    for (const [tip, t, mia] of casos) {
      const leido = leerParteDelDetalle(mesa({ tip_setting: tip, share_totals: t, my_share: mia }));
      expect(leido, JSON.stringify(t)).toEqual({ tipSetting: tip, shareTotals: t, myShare: mia });
    }
  });

  it('las tres en null: la mesa con garantía o la que no se pudo leer', () => {
    expect(leerParteDelDetalle(mesa({ tip_setting: null, share_totals: null, my_share: null })))
      .toEqual({ tipSetting: null, shareTotals: null, myShare: null });
  });

  it('el cálculo que no se pudo hacer: la propina sale igual y las otras dos en null', () => {
    expect(leerParteDelDetalle(mesa({ tip_setting: { tip_cents: MAX }, share_totals: null, my_share: null })))
      .toEqual({ tipSetting: { tip_cents: MAX }, shareTotals: null, myShare: null });
  });

  it('en partes iguales, quien no tiene parte: my_share null con los totales', () => {
    expect(leerParteDelDetalle(mesa({ tip_setting: null, share_totals: IG_B, my_share: null })))
      .toEqual({ tipSetting: null, shareTotals: IG_B, myShare: null });
  });

  it('sin la negociación (las claves no vienen): las tres undefined', () => {
    expect(leerParteDelDetalle(mesa({}))).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
    expect(leerParteDelDetalle({})).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
  });

  it('🔴 si mesa no es un objeto: las tres undefined', () => {
    for (const malo of [undefined, null, 'mesa', 0, true, [], [{ tip_setting: null }]]) {
      expect(leerParteDelDetalle(malo), String(malo)).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
    }
  });

  it('🔴 las claves heredadas no cuentan: sólo las propias de la mesa', () => {
    const heredada = Object.create(mesa({ tip_setting: { tip_bps: 1000 }, share_totals: E1, my_share: E1_ANA })) as unknown;
    expect(leerParteDelDetalle(heredada)).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
  });

  it('cada clave se lee aparte: una mal formada no tumba a las otras dos', () => {
    expect(leerParteDelDetalle(mesa({ tip_setting: { tip_bps: 1000 }, share_totals: E1, my_share: { items_cents: 1 } })))
      .toEqual({ tipSetting: { tip_bps: 1000 }, shareTotals: E1, myShare: undefined });
  });

  it('🔴 coherencia: una my_share en objeto sin totales válidos cuenta como ausente', () => {
    expect(leerParteDelDetalle(mesa({ tip_setting: { tip_bps: 1000 }, share_totals: null, my_share: E1_ANA })))
      .toEqual({ tipSetting: { tip_bps: 1000 }, shareTotals: null, myShare: undefined });
    expect(leerParteDelDetalle(mesa({ tip_setting: { tip_bps: 1000 }, share_totals: { ...E1, extra: 1 }, my_share: E1_ANA })))
      .toEqual({ tipSetting: { tip_bps: 1000 }, shareTotals: undefined, myShare: undefined });
    expect(leerParteDelDetalle(mesa({ tip_setting: { tip_bps: 1000 }, my_share: E1_ANA })))
      .toEqual({ tipSetting: { tip_bps: 1000 }, shareTotals: undefined, myShare: undefined });
    // Una my_share en null sí se conserva sin totales: no afirma ningún monto.
    expect(leerParteDelDetalle(mesa({ tip_setting: null, share_totals: 'roto', my_share: null })))
      .toEqual({ tipSetting: null, shareTotals: undefined, myShare: null });
  });

  it('no exige que mis platos queden por debajo de los de la mesa (el contrato no lo garantiza)', () => {
    const mia = parte(17001, -2000, 1500, 16501);
    expect(leerParteDelDetalle(mesa({ tip_setting: { tip_bps: 1000 }, share_totals: E1, my_share: mia })).myShare)
      .toEqual(mia);
  });

  it('🔴 la propina de los totales es la que fijó el organizador: nunca una que nadie eligió', () => {
    const sinTotales = (tip: unknown, t: Record<string, unknown>) =>
      leerParteDelDetalle(mesa({ tip_setting: tip, share_totals: t, my_share: E1_ANA }));
    // Sin fijar, la propina es 0.
    expect(sinTotales(null, E1)).toEqual({ tipSetting: null, shareTotals: undefined, myShare: undefined });
    // «Otro»: el monto fijo, ni un centavo de más ni de menos.
    expect(sinTotales({ tip_cents: 1501 }, E1).shareTotals).toBeUndefined();
    expect(sinTotales({ tip_cents: 1500 }, E1).shareTotals).toEqual(E1);
    // Un %: round_half_away(B × bps / 10000) sobre la base.
    expect(sinTotales({ tip_bps: 1500 }, E1).shareTotals).toBeUndefined();
    expect(sinTotales({ tip_bps: 1500 }, { ...E2, tip_cents: 4201, total_cents: 32201 }).shareTotals).toBeUndefined();
    // La mitad se redondea hacia arriba: 15 × 10 % = 1.5 → 2.
    expect(sinTotales({ tip_bps: 1000 }, totales(15, 0, 0, 0, 0, 15, 2, 17)).shareTotals).toBeDefined();
    expect(sinTotales({ tip_bps: 1000 }, totales(15, 0, 0, 0, 0, 15, 1, 16)).shareTotals).toBeUndefined();
    // Con el neto no positivo, el % da 0 aunque se haya elegido.
    expect(sinTotales({ tip_bps: 2000 }, NETO_CERO).shareTotals).toEqual(NETO_CERO);
    // Una tip_setting mal formada o ausente no deja con qué comparar: los totales no se usan.
    expect(sinTotales({ tip_bps: 10001 }, E1)).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
    expect(leerParteDelDetalle(mesa({ share_totals: E1, my_share: E1_ANA })))
      .toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
  });

  it('🔴 nunca lanza: un getter que falla o un Proxy roto dan las tres undefined', () => {
    const conGetter = { get tip_setting(): unknown { throw new Error('boom'); }, share_totals: E1, my_share: E1_ANA };
    expect(() => leerParteDelDetalle(conGetter)).not.toThrow();
    expect(leerParteDelDetalle(conGetter)).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
    const roto = new Proxy({}, { ownKeys() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); } });
    expect(() => leerParteDelDetalle(roto)).not.toThrow();
    expect(leerParteDelDetalle(roto)).toEqual({ tipSetting: undefined, shareTotals: undefined, myShare: undefined });
  });

  it('los tipos de lo que devuelve son los del contrato', () => {
    const leido = leerParteDelDetalle(mesa({ tip_setting: { tip_bps: 1000 }, share_totals: E1, my_share: E1_ANA }));
    const t: ShareTotals | null | undefined = leido.shareTotals;
    const m: MyShare | null | undefined = leido.myShare;
    expect(t?.tip_basis_cents).toBe(15000);
    expect(m?.total_cents).toBe(9706);
  });
});

describe('D344 · PUT /tip · el cuerpo', () => {
  // Los presets del contrato: «los presets 0/5/10/15/20 % son 0/500/1000/1500/2000».
  const presets = /presets 0\/5\/10\/15\/20 % son ([\d/]+)/.exec(contrato.escritura.cuerpo)?.[1]?.split('/').map(Number) ?? [];

  it('el contrato nombra los cinco presets', () => {
    expect(presets).toEqual([0, 500, 1000, 1500, 2000]);
  });

  it('cada preset, exacto', () => {
    for (const bps of presets) {
      expect(JSON.stringify(cuerpoDelPutDePropina({ tip_bps: bps }))).toBe(`{"tip_setting":{"tip_bps":${bps}}}`);
    }
  });

  it('«Otro», como se tipea, incluido 0', () => {
    expect(JSON.stringify(cuerpoDelPutDePropina({ tip_cents: 12345 }))).toBe('{"tip_setting":{"tip_cents":12345}}');
    expect(JSON.stringify(cuerpoDelPutDePropina({ tip_cents: 0 }))).toBe('{"tip_setting":{"tip_cents":0}}');
  });

  it('🔴 null vuelve a «sin fijar»: nunca {tip_bps: 0}', () => {
    expect(JSON.stringify(cuerpoDelPutDePropina(null))).toBe('{"tip_setting":null}');
  });

  it('manda una copia validada', () => {
    const elegido = { tip_bps: 1000 };
    const cuerpo = cuerpoDelPutDePropina(elegido);
    expect(cuerpo.tip_setting).toEqual(elegido);
    expect(cuerpo.tip_setting).not.toBe(elegido);
  });

  it('🔴 lanza un TypeError ante una propina inválida, sin corregirla', () => {
    for (const malo of [
      { tip_bps: -1 }, { tip_bps: 10001 }, { tip_cents: 1.5 }, {}, { tip_bps: 0, tip_cents: 0 },
      { tip_cents: -1 }, { tip_cents: Number.NaN }, { tip_bps: '1000' }, undefined,
    ]) {
      expect(() => cuerpoDelPutDePropina(malo as unknown as TipSetting), JSON.stringify(malo)).toThrow(TypeError);
      expect(() => cuerpoDelPutDePropina(malo as unknown as TipSetting)).toThrow('tip_setting_invalid');
    }
  });
});

describe('D344 · PUT /tip · la respuesta 200', () => {
  it('{ tip_setting: X } con el valor que quedó', () => {
    expect(leerRespuestaDelPutDePropina({ tip_setting: { tip_bps: 1000 } })).toEqual({ tip_bps: 1000 });
    expect(leerRespuestaDelPutDePropina({ tip_setting: { tip_cents: 0 } })).toEqual({ tip_cents: 0 });
    expect(leerRespuestaDelPutDePropina({ tip_setting: null })).toBeNull();
  });

  it('🔴 cualquier otra forma es un contrato roto', () => {
    for (const malo of [
      {}, null, undefined, 'ok', [], { tip_setting: { tip_bps: 10001 } }, { tip_setting: 1000 },
      { tip_setting: null, extra: 1 }, { tip_setting: undefined }, { tip_bps: 1000 },
      { tip_setting: { tip_bps: 1000, tip_cents: 0 } }, Object.create({ tip_setting: null }) as unknown,
    ]) {
      expect(() => leerRespuestaDelPutDePropina(malo), JSON.stringify(malo)).toThrow(ContractResponseError);
    }
  });

  it('un cuerpo traicionero también da el error de contrato, no el suyo', () => {
    const traicionero = { get tip_setting(): unknown { throw new Error('boom'); } };
    expect(() => leerRespuestaDelPutDePropina(traicionero)).toThrow(ContractResponseError);
  });
});

describe('D344 · PUT /tip · clasificar el error', () => {
  it('🔴 fijos: 400, 403, 404 y 409, con su status y su código', () => {
    expect(clasificarErrorDePropina(new HttpError(400, { error: 'validation_error' })))
      .toEqual({ clase: 'fijo', status: 400, codigo: 'validation_error' });
    expect(clasificarErrorDePropina(new HttpError(403, { error: 'not_mesa_organizer' })))
      .toEqual({ clase: 'fijo', status: 403, codigo: 'not_mesa_organizer' });
    expect(clasificarErrorDePropina(new HttpError(404, { error: 'mesa_not_found' })))
      .toEqual({ clase: 'fijo', status: 404, codigo: 'mesa_not_found' });
    expect(clasificarErrorDePropina(new HttpError(409, { error: 'tip_setting_not_applicable' })))
      .toEqual({ clase: 'fijo', status: 409, codigo: 'tip_setting_not_applicable' });
    const cerrada: ApiError = { error: 'mesa_not_active', mesa_status: 'expired', closure_reason: 'time' };
    expect(clasificarErrorDePropina(new HttpError(409, cerrada)))
      .toEqual({ clase: 'fijo', status: 409, codigo: 'mesa_not_active' });
  });

  it('🔴 cualquier 409 es fijo, también los que otras mutaciones tratan como ambiguos', () => {
    for (const codigo of ['idempotency_conflict', 'concurrent_conflict', 'algo_nuevo']) {
      expect(clasificarErrorDePropina(new HttpError(409, { error: codigo })).clase, codigo).toBe('fijo');
    }
  });

  it('🔴 cualquier otro 4xx es fijo; el 429 y el 408 (un timeout) no', () => {
    for (const status of [401, 402, 405, 410, 422, 425, 428, 430, 499]) {
      expect(clasificarErrorDePropina(new HttpError(status, null)).clase, String(status)).toBe('fijo');
    }
    expect(clasificarErrorDePropina(new HttpError(429, { error: 'rate_limited' })))
      .toEqual({ clase: 'transitorio', status: 429, codigo: 'rate_limited' });
    expect(clasificarErrorDePropina(new HttpError(408, null)))
      .toEqual({ clase: 'transitorio', status: 408, codigo: null });
    // Un status por debajo de 400 (no debería llegar como error) no es fijo.
    expect(clasificarErrorDePropina(new HttpError(302, null)))
      .toEqual({ clase: 'transitorio', status: 302, codigo: null });
  });

  it('🔴 transitorios: 5xx', () => {
    expect(clasificarErrorDePropina(new HttpError(500, null)))
      .toEqual({ clase: 'transitorio', status: 500, codigo: null });
    expect(clasificarErrorDePropina(new HttpError(503, { error: 'service_unavailable' })))
      .toEqual({ clase: 'transitorio', status: 503, codigo: 'service_unavailable' });
    for (const status of [502, 504, 599]) {
      expect(clasificarErrorDePropina(new HttpError(status, null)).clase, String(status)).toBe('transitorio');
    }
  });

  it('🔴 transitorios: el timeout del AbortController y el fetch caído', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    // Es lo que rechaza fetch cuando vence el timer de `http.ts`.
    const timeout: unknown = ctrl.signal.reason;
    expect(timeout).toBeInstanceOf(DOMException);
    expect((timeout as DOMException).name).toBe('AbortError');
    expect(clasificarErrorDePropina(timeout)).toEqual({ clase: 'transitorio', status: null, codigo: null });
    expect(clasificarErrorDePropina(new DOMException('aborted', 'AbortError')).clase).toBe('transitorio');
    for (const red of [new TypeError('Failed to fetch'), new TypeError('Load failed'), new TypeError('network_error')]) {
      expect(clasificarErrorDePropina(red), red.message).toEqual({ clase: 'transitorio', status: null, codigo: null });
    }
  });

  it('desconocidos sin status: transitorios (se reintentan con tope)', () => {
    for (const raro of [new ContractResponseError('mesas/:code/tip'), new Error('x'), new MonetarySafetyError('x'), 'x', null, undefined, {}]) {
      expect(clasificarErrorDePropina(raro), String(raro)).toEqual({ clase: 'transitorio', status: null, codigo: null });
    }
  });

  it('🔴 la propina inválida del cuerpo es fija: reintentar mandaría lo mismo', () => {
    let lanzado: unknown;
    try {
      cuerpoDelPutDePropina({ tip_bps: 10001 });
    } catch (err) {
      lanzado = err;
    }
    expect(lanzado).toBeInstanceOf(TypeError);
    expect(clasificarErrorDePropina(lanzado)).toEqual({ clase: 'fijo', status: null, codigo: 'tip_setting_invalid' });
  });

  it('el riel mock, con la misma tabla', () => {
    expect(clasificarErrorDePropina(new MockApiError(409, 'mesa_not_active', { mesa_status: 'expired', closure_reason: 'time' })))
      .toEqual({ clase: 'fijo', status: 409, codigo: 'mesa_not_active' });
    expect(clasificarErrorDePropina(new MockApiError(403, 'not_mesa_organizer')))
      .toEqual({ clase: 'fijo', status: 403, codigo: 'not_mesa_organizer' });
    expect(clasificarErrorDePropina(new MockApiError(503, 'service_unavailable')))
      .toEqual({ clase: 'transitorio', status: 503, codigo: 'service_unavailable' });
    // Un código vacío no es un código.
    expect(clasificarErrorDePropina(new MockApiError(409, '')))
      .toEqual({ clase: 'fijo', status: 409, codigo: null });
  });

  it('el código sólo si el cuerpo lo trae como texto; un cuerpo raro no lanza', () => {
    expect(clasificarErrorDePropina(new HttpError(409, null))).toEqual({ clase: 'fijo', status: 409, codigo: null });
    expect(clasificarErrorDePropina(new HttpError(409, {} as ApiError))).toEqual({ clase: 'fijo', status: 409, codigo: null });
    expect(clasificarErrorDePropina(new HttpError(409, { error: 7 } as unknown as ApiError)))
      .toEqual({ clase: 'fijo', status: 409, codigo: null });
    for (const cuerpo of ['texto', 42, [1, 2]]) {
      expect(clasificarErrorDePropina(new HttpError(502, cuerpo as unknown as ApiError)), String(cuerpo))
        .toEqual({ clase: 'transitorio', status: 502, codigo: null });
    }
  });

  it('no usa la tabla de otras mutaciones', () => {
    const fuente = readFileSync(new URL('./miParte.ts', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/from ['"]\.\/mutationRetry['"]/);
  });
});
