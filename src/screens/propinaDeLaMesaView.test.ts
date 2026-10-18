import { describe, expect, it } from 'vitest';
import type { ShareTotals, TipSetting } from '../api/miParte';
import {
  PRESETS_DE_LA_MESA,
  mensajeDeRechazo,
  mismaPropina,
  pideConfirmarOtro,
  porcentajeVisible,
  presetDe,
  puedeFijarPropina,
  rechazoOcultaElSelector,
  sanearOtro,
  servicioImpreso,
  settingDeOtro,
  settingDePreset,
  textoDeLaPropinaDeLaMesa,
} from './propinaDeLaMesaView';

/**
 * D344 · la propina de la MESA que fija el organizador (P1). La especificación
 * es `contract-mirror/contract/mesa-mi-parte-v1.json` (secciones `escritura` y
 * `cliente`) más las reglas aprobadas del selector. Cada valor esperado se
 * deriva a mano y se escribe literal, con la cuenta en un comentario: nunca se
 * calcula llamando al código bajo prueba.
 *
 * Mesa de referencia (un `ShareTotals` válido del contrato):
 *   P = items_cents        = 10000  ($100.00 de platos)
 *   D = discounts_cents    =  1200
 *   B = tip_basis_cents    =  8800  (B = máx(0, P − D) = 10000 − 1200)
 *   T = tip_cents          =   880  (10 % de B = 8800 × 1000 / 10000)
 *   total_cents            =  9680  (10000 − 1200 + 880)
 * B y P son distintos a propósito: es lo que permite ver sobre cuál se cuenta.
 */
const MESA: ShareTotals = {
  items_cents: 10000,
  discounts_cents: 1200,
  service_cents: 0,
  tax_added_cents: 0,
  adjustments_cents: -1200,
  tip_basis_cents: 8800,
  tip_cents: 880,
  total_cents: 9680,
  adjustments_omitted: false,
  adjustments_omitted_reason: null,
};

/** Un traductor falso que interpola `{0}` y anota cada clave que recibe. */
function traductorQueAnota() {
  const claves: string[] = [];
  const t = (s: string, ...args: unknown[]): string => {
    claves.push(s);
    return s.replace(/\{(\d+)\}/g, (_m: string, i: string) => String(args[Number(i)]));
  };
  return { t, claves };
}

describe('los presets de la mesa', () => {
  it('son 0/5/10/15/20 %, con el 0 % primero', () => {
    expect([...PRESETS_DE_LA_MESA]).toEqual([0, 5, 10, 15, 20]);
  });

  it('settingDePreset manda bps: 0/5/10/15/20 % son 0/500/1000/1500/2000', () => {
    // pct × 100 = bps: 0×100=0, 5×100=500, 10×100=1000, 15×100=1500, 20×100=2000.
    expect(settingDePreset(0)).toEqual({ tip_bps: 0 });
    expect(settingDePreset(5)).toEqual({ tip_bps: 500 });
    expect(settingDePreset(10)).toEqual({ tip_bps: 1000 });
    expect(settingDePreset(15)).toEqual({ tip_bps: 1500 });
    expect(settingDePreset(20)).toEqual({ tip_bps: 2000 });
  });

  it('presetDe reconoce exactamente los cinco bps de los presets', () => {
    expect(presetDe({ tip_bps: 0 })).toBe(0);
    expect(presetDe({ tip_bps: 500 })).toBe(5);
    expect(presetDe({ tip_bps: 1000 })).toBe(10);
    expect(presetDe({ tip_bps: 1500 })).toBe(15);
    expect(presetDe({ tip_bps: 2000 })).toBe(20);
  });

  it('presetDe da null sin propina fijada (mutante del término `setting === null`)', () => {
    expect(presetDe(null)).toBeNull();
  });

  it('presetDe da null con «Otro» en pesos, aunque el monto coincida con un preset', () => {
    // {tip_cents: 1000} son $10, no el 10 %; {tip_cents: 0} son $0, no el preset 0 %.
    expect(presetDe({ tip_cents: 1000 })).toBeNull();
    expect(presetDe({ tip_cents: 0 })).toBeNull();
    expect(presetDe({ tip_cents: 500 })).toBeNull();
  });

  it('presetDe da null con un % fijado que no es preset', () => {
    // 1250 bps = 12.5 %; 100 bps = 1 %; 2500 bps = 25 %; 10000 bps = 100 %.
    expect(presetDe({ tip_bps: 1250 })).toBeNull();
    expect(presetDe({ tip_bps: 100 })).toBeNull();
    expect(presetDe({ tip_bps: 2500 })).toBeNull();
    expect(presetDe({ tip_bps: 10000 })).toBeNull();
    // 5 bps NO es el 5 %: el preset 5 se busca como 500, no como 5.
    expect(presetDe({ tip_bps: 5 })).toBeNull();
  });
});

describe('«Otro» es un monto fijo en pesos', () => {
  it('"150" son $150 → {tip_cents: 15000}', () => {
    // 150 × 100 = 15000.
    expect(settingDeOtro('150')).toEqual({ tip_cents: 15000 });
  });

  it('"150.5" → 15050: un decimal son decenas de centavo', () => {
    // 150 × 100 + 5 × 10 = 15050.
    expect(settingDeOtro('150.5')).toEqual({ tip_cents: 15050 });
  });

  it('"150,50" → 15050: la coma se lee como decimal, nunca como miles', () => {
    // "150,50" → "150.50" → 150 × 100 + 50 = 15050 (y no 1505000).
    expect(settingDeOtro('150,50')).toEqual({ tip_cents: 15050 });
    // "12,50" → 1250, que es $12.50 y no $1,250 (125000).
    expect(settingDeOtro('12,50')).toEqual({ tip_cents: 1250 });
  });

  it('"0" → {tip_cents: 0}: el 0 es un monto válido', () => {
    expect(settingDeOtro('0')).toEqual({ tip_cents: 0 });
  });

  it('vacío o sólo espacios no se manda: null', () => {
    expect(settingDeOtro('')).toBeNull();
    expect(settingDeOtro('   ')).toBeNull();
  });

  it('letras no se mandan: null', () => {
    expect(settingDeOtro('abc')).toBeNull();
  });

  it('tres decimales no son un monto: "1.234" → null', () => {
    expect(settingDeOtro('1.234')).toBeNull();
  });

  it('negativo no se manda: "-5" → null (mutante del término `cents >= 0`)', () => {
    expect(settingDeOtro('-5')).toBeNull();
  });

  it('separador de miles con coma y punto decimal no se adivina: "1,234.56" → null', () => {
    expect(settingDeOtro('1,234.56')).toBeNull();
  });

  it('el borde de entero seguro del contrato: 9007199254740991 sí, uno más no', () => {
    // "90071992547409.91" → 9007199254740991 = Number.MAX_SAFE_INTEGER: entero seguro.
    expect(settingDeOtro('90071992547409.91')).toEqual({ tip_cents: 9007199254740991 });
    // "90071992547409.92" → 9007199254740992: ya no es entero seguro.
    expect(settingDeOtro('90071992547409.92')).toBeNull();
  });

  it('nunca devuelve {tip_bps}: siempre la clave tip_cents y sólo esa', () => {
    for (const texto of ['150', '150.5', '150,50', '0', '10', '20', '1000']) {
      const s = settingDeOtro(texto);
      expect(s, texto).not.toBeNull();
      expect(Object.keys(s as object), texto).toEqual(['tip_cents']);
    }
  });
});

describe('sanearOtro deja sólo dígitos y punto', () => {
  it('la coma pasa a punto', () => {
    expect(sanearOtro('12,50')).toBe('12.50');
  });

  it('quita signos, letras, espacios y el símbolo de pesos', () => {
    expect(sanearOtro('$1 50a')).toBe('150');
    expect(sanearOtro('-5')).toBe('5');
    expect(sanearOtro('abc')).toBe('');
    expect(sanearOtro(' 7 ')).toBe('7');
  });

  it('conserva los puntos que ya estaban y convierte cada coma', () => {
    // "1,234.56": la coma → punto y el punto queda: "1.234.56".
    expect(sanearOtro('1,234.56')).toBe('1.234.56');
    // Cada coma, no sólo la primera: "1,2,3" → "1.2.3".
    expect(sanearOtro('1,2,3')).toBe('1.2.3');
  });

  it('lo que ya es limpio queda igual', () => {
    expect(sanearOtro('150.50')).toBe('150.50');
    expect(sanearOtro('')).toBe('');
  });
});

describe('porcentajeVisible lee bps como %', () => {
  it('enteros sin decimales', () => {
    // bps / 100: 0 → 0, 500 → 5, 1000 → 10, 10000 → 100.
    expect(porcentajeVisible(0)).toBe('0');
    expect(porcentajeVisible(500)).toBe('5');
    expect(porcentajeVisible(1000)).toBe('10');
    expect(porcentajeVisible(10000)).toBe('100');
  });

  it('decimales sin ceros de sobra', () => {
    // 1250 / 100 = 12.50 → "12.5"; 1234 / 100 = 12.34; 1205 / 100 = 12.05.
    expect(porcentajeVisible(1250)).toBe('12.5');
    expect(porcentajeVisible(1234)).toBe('12.34');
    expect(porcentajeVisible(1205)).toBe('12.05');
  });

  it('por debajo del 1 %', () => {
    // 1 / 100 = 0.01; 10 / 100 = 0.10 → "0.1"; 50 / 100 = 0.50 → "0.5".
    expect(porcentajeVisible(1)).toBe('0.01');
    expect(porcentajeVisible(10)).toBe('0.1');
    expect(porcentajeVisible(50)).toBe('0.5');
  });
});

describe('textoDeLaPropinaDeLaMesa', () => {
  it('sin fijar dice «Sin propina fijada» y no muestra ningún %', () => {
    const { t, claves } = traductorQueAnota();
    const texto = textoDeLaPropinaDeLaMesa(null, t);
    expect(texto).toBe('Sin propina fijada');
    expect(texto).not.toContain('%');
    expect(claves).toEqual(['Sin propina fijada']);
  });

  it('un % fijado se lee como %: {tip_bps: 1000} → «Propina de la mesa: 10 %»', () => {
    const { t, claves } = traductorQueAnota();
    expect(textoDeLaPropinaDeLaMesa({ tip_bps: 1000 }, t)).toBe('Propina de la mesa: 10 %');
    expect(claves).toEqual(['Propina de la mesa: {0} %']);
  });

  it('el 0 % fijado se muestra como 0 %, distinto de sin fijar', () => {
    const { t } = traductorQueAnota();
    expect(textoDeLaPropinaDeLaMesa({ tip_bps: 0 }, t)).toBe('Propina de la mesa: 0 %');
  });

  it('un % con decimales: {tip_bps: 1250} → «Propina de la mesa: 12.5 %»', () => {
    const { t } = traductorQueAnota();
    expect(textoDeLaPropinaDeLaMesa({ tip_bps: 1250 }, t)).toBe('Propina de la mesa: 12.5 %');
  });

  it('«Otro» se lee en pesos, sin decimales si son cero: {tip_cents: 15000} → «$150»', () => {
    const { t, claves } = traductorQueAnota();
    expect(textoDeLaPropinaDeLaMesa({ tip_cents: 15000 }, t)).toBe('Propina de la mesa: $150');
    expect(claves).toEqual(['Propina de la mesa: {0}']);
  });

  it('«Otro» con centavos: {tip_cents: 15050} → «$150.50»', () => {
    const { t } = traductorQueAnota();
    expect(textoDeLaPropinaDeLaMesa({ tip_cents: 15050 }, t)).toBe('Propina de la mesa: $150.50');
  });

  it('«Otro» nunca se convierte a %: {tip_cents: 1000} son $10 y no el 10 %', () => {
    const { t } = traductorQueAnota();
    const texto = textoDeLaPropinaDeLaMesa({ tip_cents: 1000 }, t);
    expect(texto).toBe('Propina de la mesa: $10');
    expect(texto).not.toContain('%');
  });
});

describe('pideConfirmarOtro: más de 3 veces los platos de la mesa', () => {
  it('por encima de 3 × items_cents pide confirmar', () => {
    // 3 × 10000 = 30000; 30001 > 30000.
    expect(pideConfirmarOtro(30001, MESA)).toBe(true);
  });

  it('3 × exacto es el borde permitido: no pide (estricto)', () => {
    expect(pideConfirmarOtro(30000, MESA)).toBe(false);
    expect(pideConfirmarOtro(29999, MESA)).toBe(false);
  });

  it('un monto chico no pide (mutante del término `cents > 3 × items_cents`)', () => {
    expect(pideConfirmarOtro(100, MESA)).toBe(false);
    expect(pideConfirmarOtro(0, MESA)).toBe(false);
  });

  it('compara contra items_cents, no contra B ni contra total_cents', () => {
    // 29500 supera 3 × B (3 × 8800 = 26400) y 3 × total (3 × 9680 = 29040),
    // pero no supera 3 × P (30000): no pide.
    expect(pideConfirmarOtro(29500, MESA)).toBe(false);
  });

  it('sin platos en la mesa no pregunta (mutante del término `items_cents > 0`)', () => {
    // items_cents = 0: 3 × 0 = 0 y 1 > 0, pero sin platos no hay con qué comparar.
    expect(pideConfirmarOtro(1, { ...MESA, items_cents: 0 })).toBe(false);
  });

  it('sin share_totals no pregunta (mutante del término `!!totales`)', () => {
    expect(pideConfirmarOtro(1_000_000, null)).toBe(false);
    expect(pideConfirmarOtro(1_000_000, undefined)).toBe(false);
  });
});

describe('servicioImpreso', () => {
  it('sin servicio en el ticket: null', () => {
    expect(servicioImpreso(MESA)).toBeNull();
  });

  it('con servicio: el monto', () => {
    expect(servicioImpreso({ ...MESA, service_cents: 1500 })).toBe(1500);
    expect(servicioImpreso({ ...MESA, service_cents: 1 })).toBe(1);
  });

  it('sin share_totals: null', () => {
    expect(servicioImpreso(null)).toBeNull();
    expect(servicioImpreso(undefined)).toBeNull();
  });
});

describe('mismaPropina compara tipo y valor', () => {
  it('null sólo es igual a null', () => {
    expect(mismaPropina(null, null)).toBe(true);
    expect(mismaPropina(null, { tip_bps: 0 })).toBe(false);
    expect(mismaPropina({ tip_bps: 0 }, null)).toBe(false);
    expect(mismaPropina(null, { tip_cents: 0 })).toBe(false);
    expect(mismaPropina({ tip_cents: 0 }, null)).toBe(false);
  });

  it('el 0 % no es $0', () => {
    expect(mismaPropina({ tip_bps: 0 }, { tip_cents: 0 })).toBe(false);
    expect(mismaPropina({ tip_cents: 0 }, { tip_bps: 0 })).toBe(false);
  });

  it('el mismo número con otro tipo no es la misma propina', () => {
    // 1000 bps (10 %) no son 1000 centavos ($10).
    expect(mismaPropina({ tip_bps: 1000 }, { tip_cents: 1000 })).toBe(false);
    expect(mismaPropina({ tip_cents: 1000 }, { tip_bps: 1000 })).toBe(false);
  });

  it('mismo tipo: igual si el valor es igual', () => {
    expect(mismaPropina({ tip_bps: 1000 }, { tip_bps: 1000 })).toBe(true);
    expect(mismaPropina({ tip_bps: 1000 }, { tip_bps: 1500 })).toBe(false);
    expect(mismaPropina({ tip_cents: 15000 }, { tip_cents: 15000 })).toBe(true);
    expect(mismaPropina({ tip_cents: 15000 }, { tip_cents: 15050 })).toBe(false);
  });
});

describe('puedeFijarPropina: un caso por término', () => {
  const BASE = {
    esTitular: true,
    pagosCortados: true,
    guaranteeMode: false as boolean | undefined,
    status: 'open',
    tipSetting: null as TipSetting | null | undefined,
  };

  it('todo en orden: el organizador ve el selector, también sin propina fijada', () => {
    expect(puedeFijarPropina(BASE)).toBe(true);
    expect(puedeFijarPropina({ ...BASE, tipSetting: { tip_bps: 1000 } })).toBe(true);
    expect(puedeFijarPropina({ ...BASE, tipSetting: { tip_cents: 15000 } })).toBe(true);
  });

  it('quien no es titular no lo ve (término `esTitular`)', () => {
    expect(puedeFijarPropina({ ...BASE, esTitular: false })).toBe(false);
  });

  it('con los pagos encendidos no se ve (término `pagosCortados`)', () => {
    expect(puedeFijarPropina({ ...BASE, pagosCortados: false })).toBe(false);
  });

  it('con garantía, o sin saber si la hay, no se ve (término `guaranteeMode === false`)', () => {
    expect(puedeFijarPropina({ ...BASE, guaranteeMode: true })).toBe(false);
    expect(puedeFijarPropina({ ...BASE, guaranteeMode: undefined })).toBe(false);
  });

  it('una mesa que no está abierta no lo muestra (término `status === open`)', () => {
    expect(puedeFijarPropina({ ...BASE, status: 'partially_paid' })).toBe(false);
    expect(puedeFijarPropina({ ...BASE, status: 'expired' })).toBe(false);
    expect(puedeFijarPropina({ ...BASE, status: 'closed' })).toBe(false);
    expect(puedeFijarPropina({ ...BASE, status: 'pending_auth' })).toBe(false);
  });

  it('sin la clave tip_setting bien formada no se ve (término `tipSetting !== undefined`)', () => {
    expect(puedeFijarPropina({ ...BASE, tipSetting: undefined })).toBe(false);
  });
});

describe('mensajeDeRechazo', () => {
  const ORGANIZADOR = 'Sólo quien abrió la mesa puede cambiar la propina.';
  const NO_APLICA = 'Esta mesa no admite fijar la propina.';
  const CERRADA = 'La mesa ya cerró. Queda la propina que estaba guardada.';
  const NO_DISPONIBLE = 'Esta mesa ya no está disponible.';
  const MONTO = 'No pudimos guardar ese monto. Revisa la propina.';
  const GENERICO = 'No pudimos guardar la propina.';

  function mensaje(status: number | null, codigo: string | null): { texto: string; claves: string[] } {
    const { t, claves } = traductorQueAnota();
    return { texto: mensajeDeRechazo({ status, codigo }, t), claves };
  }

  it('not_mesa_organizer', () => {
    expect(mensaje(403, 'not_mesa_organizer')).toEqual({ texto: ORGANIZADOR, claves: [ORGANIZADOR] });
  });

  it('tip_setting_not_applicable', () => {
    expect(mensaje(409, 'tip_setting_not_applicable')).toEqual({ texto: NO_APLICA, claves: [NO_APLICA] });
  });

  it('mesa_not_active', () => {
    expect(mensaje(409, 'mesa_not_active')).toEqual({ texto: CERRADA, claves: [CERRADA] });
  });

  it('mesa_not_found', () => {
    expect(mensaje(404, 'mesa_not_found')).toEqual({ texto: NO_DISPONIBLE, claves: [NO_DISPONIBLE] });
    // Por el código, no por el 404: con otro status da lo mismo.
    expect(mensaje(null, 'mesa_not_found')).toEqual({ texto: NO_DISPONIBLE, claves: [NO_DISPONIBLE] });
    expect(mensaje(409, 'mesa_not_found')).toEqual({ texto: NO_DISPONIBLE, claves: [NO_DISPONIBLE] });
  });

  it('validation_error', () => {
    expect(mensaje(400, 'validation_error')).toEqual({ texto: MONTO, claves: [MONTO] });
  });

  it('un 404 sin código es el de no disponible', () => {
    expect(mensaje(404, null)).toEqual({ texto: NO_DISPONIBLE, claves: [NO_DISPONIBLE] });
  });

  it('cualquier otro rechazo es el genérico', () => {
    expect(mensaje(500, null).texto).toBe(GENERICO);
    expect(mensaje(null, null).texto).toBe(GENERICO);
    expect(mensaje(403, null).texto).toBe(GENERICO);
    expect(mensaje(409, 'guarantee_required').texto).toBe(GENERICO);
    expect(mensaje(500, null).claves).toEqual([GENERICO]);
  });

  it('los seis textos que devuelve son distintos entre sí', () => {
    const textos = [
      mensaje(403, 'not_mesa_organizer'), mensaje(409, 'tip_setting_not_applicable'), mensaje(409, 'mesa_not_active'),
      mensaje(null, 'mesa_not_found'), mensaje(400, 'validation_error'), mensaje(500, null),
    ].map((m) => m.texto);
    for (const x of textos) expect(x.length).toBeGreaterThan(0);
    expect(new Set(textos).size).toBe(6);
  });
});

describe('rechazoOcultaElSelector', () => {
  it('sólo not_mesa_organizer y tip_setting_not_applicable lo ocultan', () => {
    expect(rechazoOcultaElSelector('not_mesa_organizer')).toBe(true);
    expect(rechazoOcultaElSelector('tip_setting_not_applicable')).toBe(true);
  });

  it('los demás rechazos lo dejan', () => {
    expect(rechazoOcultaElSelector('mesa_not_active')).toBe(false);
    expect(rechazoOcultaElSelector('mesa_not_found')).toBe(false);
    expect(rechazoOcultaElSelector('validation_error')).toBe(false);
    expect(rechazoOcultaElSelector(null)).toBe(false);
    expect(rechazoOcultaElSelector('')).toBe(false);
    expect(rechazoOcultaElSelector('NOT_MESA_ORGANIZER')).toBe(false);
  });
});
