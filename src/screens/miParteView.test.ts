import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MyShare, ParteDelDetalle, ShareTotals, TipSetting } from '../api/miParte';
import {
  avisoDeAjustesOmitidos,
  miParteDelDueno,
  muestraElDesglose,
  renglonDeAjustes,
  rotuloDeAjustes,
  rotuloDePropina,
  totalesDeLaMesa,
  vistaPreviaPorConsumo,
} from './miParteView';

/**
 * D344 · «Mi parte» (`contract-mirror/contract/mesa-mi-parte-v1.json`, sección
 * `cliente`). Lógica pura de lo que se muestra en la mesa sin garantía.
 *
 * Los esperados se calculan a mano y se escriben literales con su cuenta al
 * lado; ninguno sale de llamar al código bajo prueba. Cada término de cada
 * condición tiene su caso que falla si se quita ese término.
 */
const contrato = JSON.parse(
  readFileSync(new URL('../../contract-mirror/contract/mesa-mi-parte-v1.json', import.meta.url), 'utf8'),
) as { cliente: string[] };

/** Un `t` falso: devuelve la clave en español con `{0}`, `{1}`… interpolados. */
const t = (s: string, ...args: unknown[]): string =>
  s.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)]));

/**
 * Totales coherentes con las identidades del contrato:
 * adjustments = S + V − D y total = P + adjustments + T. La base B se pasa
 * explícita porque depende de la marca de omisión.
 */
function totales(campos: {
  P: number; D?: number; S?: number; V?: number; B: number; T: number;
  omitidos?: boolean; motivo?: ShareTotals['adjustments_omitted_reason'];
}): ShareTotals {
  const D = campos.D ?? 0;
  const S = campos.S ?? 0;
  const V = campos.V ?? 0;
  const A = S + V - D;
  return {
    items_cents: campos.P,
    discounts_cents: D,
    service_cents: S,
    tax_added_cents: V,
    adjustments_cents: A,
    tip_basis_cents: campos.B,
    tip_cents: campos.T,
    total_cents: campos.P + A + campos.T,
    adjustments_omitted: campos.omitidos ?? false,
    adjustments_omitted_reason: campos.motivo ?? null,
  };
}

function miParte(platos: number, ajustes: number, propina: number): MyShare {
  return { items_cents: platos, adjustments_cents: ajustes, tip_cents: propina, total_cents: platos + ajustes + propina };
}

function parte(shareTotals: ShareTotals | null | undefined, myShare: MyShare | null | undefined): ParteDelDetalle {
  return { tipSetting: { tip_bps: 1000 }, shareTotals, myShare };
}

/**
 * La mesa de los ejemplos de la vista previa: platos 10000, descuento 1200, sin
 * servicio ni IVA aparte. adjustments = 0 + 0 − 1200 = −1200. B = máx(0, 10000 −
 * 1200) = 8800; propina 10 % = 880. total = 10000 − 1200 + 880 = 9680. El factor
 * de la vista previa es (10000 − 1200 + 880) / 10000 = 9680 / 10000.
 */
const MESA_CON_DESCUENTO = totales({ P: 10000, D: 1200, B: 8800, T: 880 });

describe('totalesDeLaMesa · sólo en la mesa sin garantía y con los totales en objeto', () => {
  it('sin garantía y con totales: devuelve los mismos totales del dueño', () => {
    expect(totalesDeLaMesa(parte(MESA_CON_DESCUENTO, null), false)).toBe(MESA_CON_DESCUENTO);
  });

  it('🔴 término `guaranteeMode === false` · con garantía: null aunque haya totales', () => {
    expect(totalesDeLaMesa(parte(MESA_CON_DESCUENTO, null), true)).toBeNull();
  });

  it('🔴 término `guaranteeMode === false` · sin saber el modo (undefined): null', () => {
    expect(totalesDeLaMesa(parte(MESA_CON_DESCUENTO, null), undefined)).toBeNull();
  });

  it('🔴 término `shareTotals` · totales en null: null', () => {
    expect(totalesDeLaMesa(parte(null, null), false)).toBeNull();
  });

  it('🔴 término `shareTotals` · totales ausentes (undefined): null, nunca undefined', () => {
    // Sin el término, la rama devolvería `parte.shareTotals`, que es undefined.
    expect(totalesDeLaMesa(parte(undefined, null), false)).toBeNull();
  });
});

describe('miParteDelDueno · la parte propia sólo junto con los totales', () => {
  const mia = miParte(2500, -300, 220);

  it('sin garantía, con totales y con parte: devuelve la misma parte del dueño', () => {
    expect(miParteDelDueno(parte(MESA_CON_DESCUENTO, mia), false)).toBe(mia);
  });

  it('🔴 término de los totales · con garantía: null aunque haya parte', () => {
    expect(miParteDelDueno(parte(MESA_CON_DESCUENTO, mia), true)).toBeNull();
  });

  it('🔴 término de los totales · sin totales en objeto: null aunque haya parte', () => {
    expect(miParteDelDueno(parte(null, mia), false)).toBeNull();
    expect(miParteDelDueno(parte(undefined, mia), false)).toBeNull();
  });

  it('🔴 término `myShare` · parte en null: null', () => {
    expect(miParteDelDueno(parte(MESA_CON_DESCUENTO, null), false)).toBeNull();
  });

  it('🔴 término `myShare` · parte ausente (undefined): null, nunca undefined', () => {
    expect(miParteDelDueno(parte(MESA_CON_DESCUENTO, undefined), false)).toBeNull();
  });
});

describe('vistaPreviaPorConsumo · elegido × (platos + ajustes + propina) / platos, la mitad hacia arriba', () => {
  it('cuenta exacta: 2500 × 9680 / 10000 = 2420', () => {
    expect(vistaPreviaPorConsumo(2500, MESA_CON_DESCUENTO)).toBe(2420);
  });

  it('redondea hacia abajo bajo la mitad: 3333 × 9680 / 10000 = 3226.344 → 3226', () => {
    expect(vistaPreviaPorConsumo(3333, MESA_CON_DESCUENTO)).toBe(3226);
  });

  it('redondea hacia arriba sobre la mitad: 5 × 9680 / 10000 = 4.84 → 5', () => {
    expect(vistaPreviaPorConsumo(5, MESA_CON_DESCUENTO)).toBe(5);
  });

  it('nada elegido: 0 × 9680 / 10000 = 0', () => {
    expect(vistaPreviaPorConsumo(0, MESA_CON_DESCUENTO)).toBe(0);
  });

  describe('la mitad exacta sube', () => {
    // Platos 4, sin ajustes, «Otro» de 2: B = 4, total = 4 + 0 + 2 = 6. Factor 6 / 4.
    const mesa = totales({ P: 4, B: 4, T: 2 });

    it('1 × 6 / 4 = 1.5 → 2', () => {
      expect(vistaPreviaPorConsumo(1, mesa)).toBe(2);
    });

    it('3 × 6 / 4 = 4.5 → 5 (no al par, que daría 4)', () => {
      expect(vistaPreviaPorConsumo(3, mesa)).toBe(5);
    });
  });

  it('🔴 platos de la mesa en 0: null (no hay base para repartir)', () => {
    // Totales armados a mano: platos 0 y una propina «Otro» de 500.
    const sinPlatos = totales({ P: 0, B: 0, T: 500, omitidos: true, motivo: 'mesa_corregida' });
    expect(vistaPreviaPorConsumo(0, sinPlatos)).toBeNull();
    expect(vistaPreviaPorConsumo(100, sinPlatos)).toBeNull();
    // El borde: con UN centavo de platos sí hay base. 1 × (1 + 0 + 1) / 1 = 2.
    expect(vistaPreviaPorConsumo(1, totales({ P: 1, B: 1, T: 1 }))).toBe(2);
  });

  it('🔴 elegido negativo, no entero o NaN: null', () => {
    // Un entero que no es seguro tampoco: 2^53 + 2 no es un monto.
    expect(vistaPreviaPorConsumo(9007199254740994, MESA_CON_DESCUENTO)).toBeNull();
    expect(vistaPreviaPorConsumo(-1, MESA_CON_DESCUENTO)).toBeNull();
    expect(vistaPreviaPorConsumo(2.5, MESA_CON_DESCUENTO)).toBeNull();
    expect(vistaPreviaPorConsumo(Number.NaN, MESA_CON_DESCUENTO)).toBeNull();
    expect(vistaPreviaPorConsumo(Number.POSITIVE_INFINITY, MESA_CON_DESCUENTO)).toBeNull();
  });

  it('🔴 término `elegidoCents < 0` · elegido negativo con un factor negativo: null, no un monto positivo', () => {
    // Totales incoherentes a propósito: platos 100, ajustes −200, propina 0 →
    // factor (100 − 200 + 0) / 100 = −1. Sin el término, −100 × −1 = 100 pasaría.
    const raros: ShareTotals = { ...totales({ P: 100, B: 100, T: 0 }), adjustments_cents: -200, total_cents: -100 };
    expect(vistaPreviaPorConsumo(-100, raros)).toBeNull();
  });

  it('🔴 un monto a la vista nunca es negativo: con un factor negativo, null', () => {
    // Mismos totales incoherentes: 100 × (100 − 200 + 0) / 100 = −100, que no se muestra.
    const raros: ShareTotals = { ...totales({ P: 100, B: 100, T: 0 }), adjustments_cents: -200, total_cents: -100 };
    expect(vistaPreviaPorConsumo(100, raros)).toBeNull();
  });

  describe('valores grandes: el producto supera 2^53 y el resultado es seguro', () => {
    it('9 000 000 000 × (9 000 000 000 + 0 + 900 000 000) / 9 000 000 000 = 9 900 000 000', () => {
      // Producto 9e9 × 9.9e9 = 8.91e19, mucho más que 2^53 ≈ 9.007e15.
      const mesa = totales({ P: 9_000_000_000, B: 9_000_000_000, T: 900_000_000 });
      expect(vistaPreviaPorConsumo(9_000_000_000, mesa)).toBe(9_900_000_000);
    });

    it('🔴 elegido 2^53 − 1 con factor 9 / 9: exacto 9007199254740991 (en coma flotante saldría …990)', () => {
      // Platos 9, sin ajustes ni propina: factor 9 / 9 = 1. Producto
      // 9007199254740991 × 9 = 81064793292668919, que no cabe exacto en un double.
      const mesa = totales({ P: 9, B: 9, T: 0 });
      expect(vistaPreviaPorConsumo(9007199254740991, mesa)).toBe(9007199254740991);
    });

    it('🔴 1234567890123457 × 10 / 9 = 1371742100137174.44 → 1371742100137174 (en coma flotante saldría …175)', () => {
      // Platos 9, «Otro» de 1: factor 10 / 9. Producto 12345678901234570;
      // 9 × 1371742100137174 = 12345678901234566, resto 4, y 4 / 9 < 1/2: abajo.
      const mesa = totales({ P: 9, B: 9, T: 1 });
      expect(vistaPreviaPorConsumo(1234567890123457, mesa)).toBe(1371742100137174);
    });

    it('🔴 un resultado que no es entero seguro: null', () => {
      // Platos 1, «Otro» de 1: factor 2 / 1. (2^53 − 1) × 2 = 18014398509481982 > 2^53 − 1.
      const mesa = totales({ P: 1, B: 1, T: 1 });
      expect(vistaPreviaPorConsumo(9007199254740991, mesa)).toBeNull();
    });
  });
});

describe('renglonDeAjustes · el rótulo del renglón de ajustes', () => {
  const sinCentavo = miParte(2500, 0, 0);

  it('🔴 término `service_cents > 0` · servicio sin descuento: descuento_y_cargos', () => {
    // S = 500, D = 0, V = 0 → adjustments = 500. B = 10000, propina 0.
    expect(renglonDeAjustes(totales({ P: 10000, S: 500, B: 10000, T: 0 }), sinCentavo)).toBe('descuento_y_cargos');
  });

  it('🔴 término `tax_added_cents > 0` · IVA aparte sin descuento: descuento_y_cargos', () => {
    // V = 1600, D = 0, S = 0 → adjustments = 1600.
    expect(renglonDeAjustes(totales({ P: 10000, V: 1600, B: 10000, T: 0 }), sinCentavo)).toBe('descuento_y_cargos');
  });

  it('descuento con servicio: descuento_y_cargos, no sólo «descuento»', () => {
    // D = 1200, S = 500 → adjustments = −700. B = 8800.
    expect(renglonDeAjustes(totales({ P: 10000, D: 1200, S: 500, B: 8800, T: 0 }), sinCentavo)).toBe('descuento_y_cargos');
  });

  it('🔴 término `discounts_cents > 0` · sólo descuento: descuento, aunque la parte propia no tenga ajuste', () => {
    expect(renglonDeAjustes(MESA_CON_DESCUENTO, sinCentavo)).toBe('descuento');
  });

  it('🔴 término `mia.adjustments_cents !== 0` · sin ajustes del ticket y un centavo positivo: redondeo', () => {
    const sinAjustes = totales({ P: 10000, B: 10000, T: 0 });
    expect(renglonDeAjustes(sinAjustes, miParte(2500, 1, 0))).toBe('redondeo');
  });

  it('sin ajustes del ticket y un centavo negativo: redondeo', () => {
    const sinAjustes = totales({ P: 10000, B: 10000, T: 0 });
    expect(renglonDeAjustes(sinAjustes, miParte(2500, -1, 0))).toBe('redondeo');
  });

  it('sin ajustes del ticket y sin centavo: no hay renglón (null)', () => {
    const sinAjustes = totales({ P: 10000, B: 10000, T: 0 });
    expect(renglonDeAjustes(sinAjustes, sinCentavo)).toBeNull();
  });
});

describe('rotuloDeAjustes · los literales de cada renglón', () => {
  it('descuento → «Descuento»', () => {
    expect(rotuloDeAjustes('descuento', t)).toBe('Descuento');
  });

  it('descuento_y_cargos → «Descuento y cargos del ticket»', () => {
    expect(rotuloDeAjustes('descuento_y_cargos', t)).toBe('Descuento y cargos del ticket');
  });

  it('redondeo → «Redondeo»', () => {
    expect(rotuloDeAjustes('redondeo', t)).toBe('Redondeo');
  });
});

describe('rotuloDePropina · nunca un % que nadie eligió', () => {
  it('🔴 sin fijar (null): «Propina», sin ningún %', () => {
    expect(rotuloDePropina(null, t)).toBe('Propina');
  });

  it('1000 bps: «Propina (10 % de la mesa)»', () => {
    // 1000 / 100 = 10.
    expect(rotuloDePropina({ tip_bps: 1000 }, t)).toBe('Propina (10 % de la mesa)');
  });

  it('1250 bps: «Propina (12.5 % de la mesa)»', () => {
    // 1250 / 100 = 12.5.
    expect(rotuloDePropina({ tip_bps: 1250 }, t)).toBe('Propina (12.5 % de la mesa)');
  });

  it('0 bps es un % elegido: «Propina (0 % de la mesa)»', () => {
    expect(rotuloDePropina({ tip_bps: 0 }, t)).toBe('Propina (0 % de la mesa)');
  });

  it('🔴 «Otro» (tip_cents): «Propina de la mesa», sin %', () => {
    const otro: TipSetting = { tip_cents: 4500 };
    expect(rotuloDePropina(otro, t)).toBe('Propina de la mesa');
    expect(rotuloDePropina({ tip_cents: 0 }, t)).toBe('Propina de la mesa');
  });
});

describe('avisoDeAjustesOmitidos · los avisos de la concreción 7', () => {
  /** El texto entre «» que el contrato pone después de `con "<motivo>", `. */
  function textoDelContrato(motivo: string): string {
    const linea = contrato.cliente.find((c) => c.includes('adjustments_omitted = true'));
    if (!linea) throw new Error('el contrato cambió de forma');
    const m = new RegExp(`con "${motivo}", «([^»]+)»`).exec(linea);
    if (!m) throw new Error(`el contrato no trae el aviso de ${motivo}`);
    return m[1]!;
  }

  /** Quita la mayúscula inicial y el punto final que agrega la app. */
  function comoEnElContrato(aviso: string): string {
    expect(aviso.endsWith('.')).toBe(true);
    return aviso.charAt(0).toLowerCase() + aviso.slice(1, -1);
  }

  const corregida = totales({ P: 10000, B: 10000, T: 0, omitidos: true, motivo: 'mesa_corregida' });
  const netoNoPositivo = totales({ P: 1000, B: 0, T: 0, omitidos: true, motivo: 'neto_no_positivo' });

  it('sin la marca: null', () => {
    expect(avisoDeAjustesOmitidos(MESA_CON_DESCUENTO, t)).toBeNull();
  });

  it('🔴 sin la marca: null aunque viniera un motivo (manda la marca)', () => {
    const conMotivoSinMarca: ShareTotals = { ...MESA_CON_DESCUENTO, adjustments_omitted_reason: 'mesa_corregida' };
    expect(avisoDeAjustesOmitidos(conMotivoSinMarca, t)).toBeNull();
  });

  it('mesa_corregida: el literal exacto, y coincide con el contrato', () => {
    const aviso = avisoDeAjustesOmitidos(corregida, t);
    expect(aviso).toBe('Como la mesa se corrigió, los ajustes del ticket no se aplicaron y la propina va sobre los platos.');
    expect(comoEnElContrato(aviso!)).toBe(textoDelContrato('mesa_corregida'));
  });

  it('neto_no_positivo: el literal exacto, y coincide con el contrato', () => {
    const aviso = avisoDeAjustesOmitidos(netoNoPositivo, t);
    expect(aviso).toBe('El descuento del ticket cubre toda la cuenta: no se aplicó y la propina por % queda en 0.');
    expect(comoEnElContrato(aviso!)).toBe(textoDelContrato('neto_no_positivo'));
  });
});

describe('muestraElDesglose · cuándo va el desglose propio', () => {
  it('sin parte (null): no, ni por consumo ni en partes iguales', () => {
    expect(muestraElDesglose(null, true)).toBe(false);
    expect(muestraElDesglose(null, false)).toBe(false);
  });

  it('por consumo con platos elegidos: sí', () => {
    expect(muestraElDesglose(miParte(1, 0, 0), true)).toBe(true);
    expect(muestraElDesglose(miParte(2500, -300, 220), true)).toBe(true);
  });

  it('🔴 por consumo sin platos elegidos (ceros): no', () => {
    expect(muestraElDesglose(miParte(0, 0, 0), true)).toBe(false);
  });

  it('🔴 en partes iguales: sí, también con platos en 0', () => {
    expect(muestraElDesglose(miParte(0, 0, 0), false)).toBe(true);
    expect(muestraElDesglose(miParte(3300, -400, 290), false)).toBe(true);
  });
});
