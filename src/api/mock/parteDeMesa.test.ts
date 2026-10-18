import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { tipFromBps } from '../../utils/money';
import {
  PROCEDENCIA,
  baseDePropina,
  calcular,
  mayorResto,
  neto,
  parteConsumo,
  parteIgual,
  propinaTotal,
  totales,
  type AjustesDelTicket,
  type EntradaDeCalculo,
  type MiParte,
  type PersonaConPlatos,
  type PropinaDeLaMesa,
} from './parteDeMesa';
import { repartirPorMayorResto } from './viajesCalculo';

/**
 * D344 · el port de «Mi parte» del dueño (`services/parteDeMesa.js`, App Backend 2.186.1 en el inventario de 2.187.0),
 * sólo para el mock. Todo en centavos enteros.
 *
 *   ① la procedencia declarada es la que adoptó el inventario;
 *   ② vectores calculados A MANO, con la cuenta escrita al lado (no salen de este código);
 *   ③ la equivalencia: los vectores de `tests/parte-de-mesa.test.js` del dueño en `c8432e7`, sha256
 *     `e14ec51cca45561e67127336df8e908d21fb819dd01a9860c816e5bbd725d23f` (secciones ① y ②; la ④ es de
 *     `ajustesAplicables`, que no se porta), y el ⑧ de `tests/mi-parte-http.test.js`, sha256
 *     `ce639e9420684486d11c1150732c9d69fd7624bb4624f935ddf8924acfa3dcf0` (lo que 2.186.1 le sumó a ese archivo es
 *     del HTTP: orden 403/400, bordes del cuerpo y la mesa legacy; no es de este cálculo);
 *   ④ las propiedades del dueño, con la misma semilla;
 *   ⑤ las simplificaciones declaradas;
 *   ⑥ la guarda estática del CAMINO del build real hasta el módulo; no mide el bundle (ver ⑥);
 *   ⑦ los `ejemplos` del contrato espejado (2.186.1), corridos contra este port.
 */

const persona = (id: string, p: number): PersonaConPlatos => ({ id, p });
const E = (items: number, ajustes: number, propina: number, total: number): MiParte =>
  ({ items_cents: items, adjustments_cents: ajustes, tip_cents: propina, total_cents: total });
const suma = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** Todas las partes de una mesa por consumo, más lo que nadie eligió: para comprobar las sumas (`todas` del dueño). */
function todas({ P, ajustes, setting, personas, U }: {
  readonly P: number;
  readonly ajustes: AjustesDelTicket;
  readonly setting: PropinaDeLaMesa | null;
  readonly personas: readonly PersonaConPlatos[];
  readonly U: number;
}) {
  const filas = personas.map((x) => calcular({ modo: 'consumo', P, ajustes, setting, personas, U, yo: x.id }));
  const { share_totals: tot } = filas[0] ?? calcular({ modo: 'consumo', P, ajustes, setting, personas, U, yo: null });
  const pesos = [...personas.map((x) => x.p), U];
  const N = tot.items_cents + tot.adjustments_cents;
  const sinElegir = mayorResto(N, pesos).at(-1)! + (tot.tip_cents > 0 ? mayorResto(tot.tip_cents, pesos).at(-1)! : 0);
  return { tot, partes: filas.map((f) => f.my_share!), sinElegir };
}

describe('① la procedencia', () => {
  const inventario = JSON.parse(readFileSync(new URL('../../../scripts/mirror-inventory.json', import.meta.url), 'utf8')) as {
    commit: string;
    archivos: ReadonlyArray<{ origen: string; sha256: string }>;
  };
  const sha = (origen: string) => inventario.archivos.find((a) => a.origen === origen)?.sha256;

  it('🔴 el sha256 del original es el que declara el inventario adoptado: si el dueño lo cambia, esto se pone rojo', () => {
    expect(sha(PROCEDENCIA.ruta)).toBe(PROCEDENCIA.sha256);
    expect(sha(PROCEDENCIA.dinero.ruta), 'cambió `utils/money.js`: volver a comparar `tipFromBps` y `splitEqual`')
      .toBe(PROCEDENCIA.dinero.sha256);
  });

  it('🔴 el commit declarado es el del inventario adoptado: si cambia el inventario adoptado, esto se pone rojo', () => {
    expect(inventario.commit, 'el inventario adoptó otro commit del dueño: volver a medir el original y sus vectores')
      .toBe(PROCEDENCIA.commit);
  });

  it('las claves que devuelve son exactamente las del contrato, en su orden', () => {
    const contrato = JSON.parse(readFileSync(new URL('../../../contract-mirror/contract/mesa-mi-parte-v1.json', import.meta.url), 'utf8')) as {
      lectura: { claves: { share_totals: string; my_share: string } };
    };
    const claves = (s: string) => s.slice(1, s.indexOf('}')).split(',').map((x) => x.trim());
    const r = calcular({ modo: 'consumo', P: 100, personas: [persona('a', 100)], yo: 'a' });
    expect(Object.keys(r.share_totals)).toEqual(claves(contrato.lectura.claves.share_totals));
    expect(Object.keys(r.my_share!)).toEqual(claves(contrato.lectura.claves.my_share));
  });
});

describe('② vectores calculados a mano', () => {
  it('por consumo, dos personas y $10 que nadie eligió: lo sin elegir no se le carga a nadie', () => {
    // P = 10000 (Ana 6000, Beto 3000, U 1000), D = 1000, 10 %.
    // N = 10000 − 1000 = 9000 · B = máx(0, 10000 − 1000) = 9000 · T = 9000 × 10 % = 900.
    // Pesos [6000, 3000, 1000] sobre W = 10000, sin restos: N → [5400, 2700, 900] · T → [540, 270, 90].
    // Ana: 6000, 5400 − 6000 = −600, 540, 5940 · Beto: 3000, −300, 270, 2970 · lo sin elegir: 900 + 90 = 990.
    // 5940 + 2970 + 990 = 9900 = N + T.
    const base = {
      modo: 'consumo' as const, P: 10000, personas: [persona('ana', 6000), persona('beto', 3000)], U: 1000,
      ajustes: { D: 1000 }, setting: { tip_bps: 1000 },
    };
    expect(calcular({ ...base, yo: 'ana' }).my_share).toEqual(E(6000, -600, 540, 5940));
    expect(calcular({ ...base, yo: 'beto' }).my_share).toEqual(E(3000, -300, 270, 2970));
    expect(calcular({ ...base, yo: 'ana' }).share_totals).toEqual({
      items_cents: 10000, discounts_cents: 1000, service_cents: 0, tax_added_cents: 0, adjustments_cents: -1000,
      tip_basis_cents: 9000, tip_cents: 900, total_cents: 9900, adjustments_omitted: false, adjustments_omitted_reason: null,
    });
  });

  it('por consumo, tres personas con restos: lo sin elegir es un peso más y el empate va al que se sumó antes', () => {
    // P = 1000 (Ana, Beto y Caro 300 cada uno, U 100), D = 1, 15 %.
    // N = 999 · B = 999 · T = (999 × 1500 + 5000) / 10000 = 1503500 / 10000 → 150.
    // N sobre W = 1000: 999 × 300 = 299700 → 299 resto 700 (×3); 999 × 100 = 99900 → 99 resto 900. Pisos 996, faltan 3.
    //   Restos de mayor a menor: U (900), Ana (700), Beto (700), Caro (700) → un centavo a U, Ana y Beto: [300, 300, 299, 100].
    // T sobre W = 1000: 150 × 300 / 1000 = 45 exacto (×3), U 15: [45, 45, 45, 15].
    // Ana 300, 0, 45, 345 · Beto igual · Caro 300, −1, 45, 344 · lo sin elegir 100 + 15. 345 + 345 + 344 + 115 = 1149.
    const base = {
      modo: 'consumo' as const, P: 1000, personas: [persona('ana', 300), persona('beto', 300), persona('caro', 300)], U: 100,
      ajustes: { D: 1 }, setting: { tip_bps: 1500 },
    };
    expect(calcular({ ...base, yo: 'ana' }).my_share).toEqual(E(300, 0, 45, 345));
    expect(calcular({ ...base, yo: 'beto' }).my_share).toEqual(E(300, 0, 45, 345));
    expect(calcular({ ...base, yo: 'caro' }).my_share).toEqual(E(300, -1, 45, 344));
    expect(calcular({ ...base, yo: 'caro' }).share_totals).toMatchObject({ adjustments_cents: -1, tip_basis_cents: 999, tip_cents: 150, total_cents: 1149 });
  });

  it('🔴 el empate de centavos va al que se sumó antes: invertir el orden mueve el centavo', () => {
    // P = 100 (Ana 50, Beto 50, U 0), D = 1, sin propina. N = 99 sobre W = 100: 99 × 50 = 4950 → 49 resto 50 para los
    // dos; falta 1 y el empate lo gana el primero de la lista.
    const ab = { modo: 'consumo' as const, P: 100, personas: [persona('ana', 50), persona('beto', 50)], U: 0, ajustes: { D: 1 } };
    expect(calcular({ ...ab, yo: 'ana' }).my_share).toEqual(E(50, 0, 0, 50));
    expect(calcular({ ...ab, yo: 'beto' }).my_share).toEqual(E(50, -1, 0, 49));
    const ba = { ...ab, personas: [persona('beto', 50), persona('ana', 50)] };
    expect(calcular({ ...ba, yo: 'beto' }).my_share).toEqual(E(50, 0, 0, 50));
    expect(calcular({ ...ba, yo: 'ana' }).my_share).toEqual(E(50, -1, 0, 49));
  });

  it('en partes iguales, n = 3 con servicio: el centavo de más a las primeras partes; k fuera de rango, null', () => {
    // P = 1000, S = 100, 10 %. N = 1100 · B = 1000 (el servicio no entra) · T = 100.
    // splitEqual(1000, 3) = [334, 333, 333] · splitEqual(1100, 3) = [367, 367, 366] · splitEqual(100, 3) = [34, 33, 33].
    // k0: 334, 367 − 334 = 33, 34, 401 · k1: 333, 34, 33, 400 · k2: 333, 33, 33, 399. 401 + 400 + 399 = 1200 = N + T.
    const base = { modo: 'igual' as const, P: 1000, n: 3, ajustes: { S: 100 }, setting: { tip_bps: 1000 } };
    expect(calcular({ ...base, k: 0 }).my_share).toEqual(E(334, 33, 34, 401));
    expect(calcular({ ...base, k: 1 }).my_share).toEqual(E(333, 34, 33, 400));
    expect(calcular({ ...base, k: 2 }).my_share).toEqual(E(333, 33, 33, 399));
    expect(calcular({ ...base, k: 0 }).share_totals).toEqual({
      items_cents: 1000, discounts_cents: 0, service_cents: 100, tax_added_cents: 0, adjustments_cents: 100,
      tip_basis_cents: 1000, tip_cents: 100, total_cents: 1200, adjustments_omitted: false, adjustments_omitted_reason: null,
    });
    // Se sumaron más personas que las partes declaradas, o quien mira no es activo: sin parte.
    expect(calcular({ ...base, k: 3 }).my_share).toBeNull();
    expect(calcular({ ...base, k: -1 }).my_share).toBeNull();
    expect(calcular({ ...base, k: 1.5 }).my_share).toBeNull();
    expect(calcular({ modo: 'igual', P: 1000, n: 3 }).my_share, 'sin k, el default es −1').toBeNull();
  });

  it('🔴 los defaults de `calcular`: n = 1 en partes iguales y, por consumo, sin personas ni U no hay con qué repartir', () => {
    // Sin n, n = 1: splitEqual(1000, 1) = [1000] de platos y de neto, sin ajustes ni propina; k = 0 es la única parte.
    expect(calcular({ modo: 'igual', P: 1000, k: 0 }).my_share, 'sin n, el default es 1').toEqual(E(1000, 0, 0, 1000));
    // Sin personas ni U: personas = [] y U = 0, el único peso es U = 0 y W = 0. Si U valiera 1, saldrían ceros.
    expect(() => calcular({ modo: 'consumo', P: 100 }), 'sin personas, [] y sin U, 0').toThrow('parte_mesa_entrada_invalida');
  });

  it('🔴 neto_no_positivo: sin ajustes y con la marca; B usa el descuento leído y la propina por % da 0, pero «Otro» sigue', () => {
    // P = 5000, S = 500, D = 6000, 20 %. P + S − D = −500 ≤ 0 → D = S = V = 0, N = 5000.
    // B = máx(0, 5000 − 6000) = 0 → T = 0 × 20 % = 0.
    const base = { modo: 'consumo' as const, P: 5000, personas: [persona('ana', 5000)], U: 0, yo: 'ana', ajustes: { D: 6000, S: 500 } };
    const pct = calcular({ ...base, setting: { tip_bps: 2000 } });
    expect(pct.share_totals).toEqual({
      items_cents: 5000, discounts_cents: 0, service_cents: 0, tax_added_cents: 0, adjustments_cents: 0,
      tip_basis_cents: 0, tip_cents: 0, total_cents: 5000, adjustments_omitted: true, adjustments_omitted_reason: 'neto_no_positivo',
    });
    expect(pct.my_share).toEqual(E(5000, 0, 0, 5000));
    // «Otro» $7: el monto fijo no depende de B. N + T = 5000 + 700.
    const otro = calcular({ ...base, setting: { tip_cents: 700 } });
    expect(otro.share_totals).toMatchObject({ tip_basis_cents: 0, tip_cents: 700, total_cents: 5700, adjustments_omitted_reason: 'neto_no_positivo' });
    expect(otro.my_share).toEqual(E(5000, 0, 700, 5700));
    // El borde: D = P + S = 5500 da N = 0, también sin ajustes.
    expect(calcular({ ...base, ajustes: { D: 5500, S: 500 } }).share_totals.adjustments_omitted_reason).toBe('neto_no_positivo');
    // D = 5499: N = 1 > 0 y los ajustes SÍ se aplican, pero B = máx(0, 5000 − 5499) = 0: la propina por % sigue en 0.
    // Ana: 5000, 1 − 5000 = −4999, 0, 1.
    const casi = calcular({ ...base, ajustes: { D: 5499, S: 500 }, setting: { tip_bps: 2000 } });
    expect(casi.share_totals).toEqual({
      items_cents: 5000, discounts_cents: 5499, service_cents: 500, tax_added_cents: 0, adjustments_cents: -4999,
      tip_basis_cents: 0, tip_cents: 0, total_cents: 1, adjustments_omitted: false, adjustments_omitted_reason: null,
    });
    expect(casi.my_share).toEqual(E(5000, -4999, 0, 1));
  });

  it('🔴 mesa_corregida: el descuento no se lee, B = P, y la marca gana aunque el neto tampoco fuera positivo', () => {
    // P = 8000, D = 1500 y S = 800 omitidos, 10 %. N = 8000 · B = 8000 · T = 800.
    // Partes iguales, n = 2: [4000, 4000] de platos y de neto, [400, 400] de propina.
    const base = { modo: 'igual' as const, P: 8000, n: 2, ajustes: { D: 1500, S: 800, omitidos: true }, setting: { tip_bps: 1000 } };
    const r = calcular({ ...base, k: 0 });
    expect(r.share_totals).toEqual({
      items_cents: 8000, discounts_cents: 0, service_cents: 0, tax_added_cents: 0, adjustments_cents: 0,
      tip_basis_cents: 8000, tip_cents: 800, total_cents: 8800, adjustments_omitted: true, adjustments_omitted_reason: 'mesa_corregida',
    });
    expect(r.my_share).toEqual(E(4000, 0, 400, 4400));
    expect(calcular({ ...base, k: 1 }).my_share).toEqual(E(4000, 0, 400, 4400));
    // D = 9000 > P: con la marca de corregida, el motivo es el de la corrección y B sigue siendo P.
    expect(calcular({ ...base, k: 0, ajustes: { D: 9000, omitidos: true } }).share_totals)
      .toMatchObject({ tip_basis_cents: 8000, tip_cents: 800, adjustments_omitted_reason: 'mesa_corregida' });
  });

  it('«Otro» es un monto fijo que se reparte por mayor resto, igual que el neto', () => {
    // P = 3000 (Ana 2000, Beto 1000), D = 500, «Otro» 1234. N = 2500 · B = 2500 (se publica igual) · T = 1234.
    // N sobre W = 3000: Ana 5000000 / 3000 → 1666 resto 2000; Beto 2500000 / 3000 → 833 resto 1000; falta 1 → Ana 1667.
    // T: Ana 2468000 / 3000 → 822 resto 2000; Beto 1234000 / 3000 → 411 resto 1000; falta 1 → Ana 823.
    // Ana: 2000, 1667 − 2000 = −333, 823, 2490 · Beto: 1000, −167, 411, 1244. 2490 + 1244 = 3734 = 2500 + 1234.
    const base = {
      modo: 'consumo' as const, P: 3000, personas: [persona('ana', 2000), persona('beto', 1000)], U: 0,
      ajustes: { D: 500 }, setting: { tip_cents: 1234 },
    };
    expect(calcular({ ...base, yo: 'ana' }).my_share).toEqual(E(2000, -333, 823, 2490));
    expect(calcular({ ...base, yo: 'beto' }).my_share).toEqual(E(1000, -167, 411, 1244));
    expect(calcular({ ...base, yo: 'ana' }).share_totals)
      .toMatchObject({ adjustments_cents: -500, tip_basis_cents: 2500, tip_cents: 1234, total_cents: 3734 });
    expect(propinaTotal(0, { tip_cents: 1234 }), '«Otro» no depende de la base').toBe(1234);
  });

  it('🔴 sin fijar vale 0, nunca un % que nadie eligió; el % redondea la mitad hacia arriba', () => {
    const base = { modo: 'consumo' as const, P: 2000, personas: [persona('ana', 2000)], U: 0, yo: 'ana' };
    for (const setting of [null, undefined]) {
      const r = calcular({ ...base, setting });
      expect(r.share_totals).toMatchObject({ tip_basis_cents: 2000, tip_cents: 0, total_cents: 2000 });
      expect(r.my_share).toEqual(E(2000, 0, 0, 2000));
    }
    expect(calcular(base).share_totals.tip_cents, 'sin `setting`, el default es null').toBe(0);
    expect(propinaTotal(2000, undefined)).toBe(0);
    expect(propinaTotal(2000, { tip_bps: 0 })).toBe(0);
    // 125 × 10 % = 12.5 → 13 · 124 × 10 % = 12.4 → 12 · 5 × 10 % = 0.5 → 1 · 4 × 10 % = 0.4 → 0.
    expect([125, 124, 5, 4].map((b) => propinaTotal(b, { tip_bps: 1000 }))).toEqual([13, 12, 1, 0]);
  });

  it('🔴 desborde: un total que no es un entero seguro lanza parte_mesa_desborde, nunca sale como número', () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    // «Otro» enorme: N + T = 100 + MAX.
    expect(() => calcular({ modo: 'consumo', P: 100, personas: [persona('a', 100)], setting: { tip_cents: MAX }, yo: 'a' }))
      .toThrow('parte_mesa_desborde');
    // Por %: P = MAX, B = MAX, T = MAX × 100 % = MAX → N + T = 2 × MAX.
    expect(() => calcular({ modo: 'igual', P: MAX, n: 1, k: 0, setting: { tip_bps: 10000 } })).toThrow('parte_mesa_desborde');
    expect(() => parteIgual({ P: 100, N: 100, T: MAX, n: 1, k: 0 })).toThrow('parte_mesa_desborde');
    expect(() => parteConsumo({ N: 100, T: MAX, personas: [persona('a', 100)], U: 0, yo: 'a' })).toThrow('parte_mesa_desborde');
  });

  it('🔴 entradas inválidas fallan cerrado con parte_mesa_entrada_invalida', () => {
    const invalida = 'parte_mesa_entrada_invalida';
    expect(() => mayorResto(-1, [1, 1])).toThrow(invalida);
    expect(() => mayorResto(1.5, [1])).toThrow(invalida);
    expect(() => mayorResto(Number.MAX_SAFE_INTEGER + 1, [1])).toThrow(invalida);
    expect(() => mayorResto(10, [])).toThrow(invalida);
    expect(() => mayorResto(10, [0, 0])).toThrow(invalida);
    expect(() => mayorResto(10, [1, -1])).toThrow(invalida);
    expect(() => mayorResto(10, [1.5, 1])).toThrow(invalida);
    expect(() => neto({ P: 0 })).toThrow(invalida);
    expect(() => neto({ P: 100, D: -1 })).toThrow(invalida);
    expect(() => neto({ P: 100, S: 0.5 })).toThrow(invalida);
    expect(() => baseDePropina(-1, 0)).toThrow(invalida);
    expect(() => baseDePropina(100, -1)).toThrow(invalida);
    expect(() => propinaTotal(-1, null), 'la base se valida antes que «sin fijar»').toThrow(invalida);
    expect(() => propinaTotal(100, { tip_cents: -1 })).toThrow(invalida);
    expect(() => propinaTotal(100, { tip_cents: 1.5 })).toThrow(invalida);
    expect(() => parteIgual({ P: 100, N: 100, T: 0, n: 0, k: 0 })).toThrow(invalida);
    expect(() => parteConsumo({ N: 100, T: 0, personas: [persona('a', 100)], U: -1, yo: 'a' })).toThrow(invalida);
    expect(() => parteConsumo({ N: 100, T: -1, personas: [persona('a', 100)], U: 0, yo: 'a' })).toThrow(invalida);
    // Nadie en la lista y nada sin elegir: no hay peso con qué repartir.
    expect(() => calcular({ modo: 'consumo', P: 100, personas: [], U: 0, yo: null })).toThrow(invalida);
    // Un % fuera de 0..10000 lanza el error de `tipFromBps`, igual que en el dueño (que lo registra como «otro»).
    expect(() => propinaTotal(100, { tip_bps: 10001 })).toThrow('bps out of range (0-10000)');
    expect(() => propinaTotal(100, { tip_bps: 1.5 })).toThrow('bps out of range (0-10000)');
  });
});

describe('③ la equivalencia con el dueño · tests/parte-de-mesa.test.js ① y ②, y el ⑧ de mi-parte-http', () => {
  const A = 'ana'; const B = 'beto'; const C = 'caro';
  const dos = [persona(A, 10000), persona(B, 7000)];
  const mesa = <X extends object>(extra: X) => ({ modo: 'consumo' as const, P: 17000, personas: dos, U: 0, ...extra });

  it('🔴 E1 · descuento $20, propina 10 % sobre $150: Ana $97.06, Beto $67.94', () => {
    const base = mesa({ ajustes: { D: 2000 }, setting: { tip_bps: 1000 } });
    expect(calcular({ ...base, yo: A }).my_share).toEqual(E(10000, -1176, 882, 9706));
    expect(calcular({ ...base, yo: B }).my_share).toEqual(E(7000, -824, 618, 6794));
    expect(calcular({ ...base, yo: A }).share_totals).toEqual({
      items_cents: 17000, discounts_cents: 2000, service_cents: 0, tax_added_cents: 0,
      adjustments_cents: -2000, tip_basis_cents: 15000, tip_cents: 1500, total_cents: 16500, adjustments_omitted: false,
      adjustments_omitted_reason: null,
    });
  });

  it('E2 · tres de $100, descuento $20, 15 %: el centavo del empate al primero que se sumó', () => {
    const personas = [persona(A, 10000), persona(B, 10000), persona(C, 10000)];
    const base = { modo: 'consumo' as const, P: 30000, personas, U: 0, ajustes: { D: 2000 }, setting: { tip_bps: 1500 } };
    expect(calcular({ ...base, yo: A }).my_share).toEqual(E(10000, -666, 1400, 10734));
    expect(calcular({ ...base, yo: B }).my_share).toEqual(E(10000, -667, 1400, 10733));
    expect(calcular({ ...base, yo: C }).my_share).toEqual(E(10000, -667, 1400, 10733));
  });

  it('E3 · con $30 sin elegir: la propina sobre $180, y lo sin elegir no se le carga a nadie', () => {
    const base = { P: 20000, personas: dos, U: 3000, ajustes: { D: 2000 }, setting: { tip_bps: 1000 } };
    expect(calcular({ modo: 'consumo', ...base, yo: A }).my_share).toEqual(E(10000, -1000, 900, 9900));
    expect(calcular({ modo: 'consumo', ...base, yo: B }).my_share).toEqual(E(7000, -700, 630, 6930));
    expect(todas(base).sinElegir).toBe(2970);
  });

  it('E4 · descuento grande, propina 0 %: nadie queda negativo', () => {
    const base = { modo: 'consumo' as const, P: 9100, personas: [persona(A, 9000), persona(B, 100)], U: 0, ajustes: { D: 5000 }, setting: { tip_bps: 0 } };
    expect(calcular({ ...base, yo: A }).my_share).toEqual(E(9000, -4945, 0, 4055));
    expect(calcular({ ...base, yo: B }).my_share).toEqual(E(100, -55, 0, 45));
  });

  it('E5 · «Otro» $50 fijos: no depende de la base', () => {
    const base = mesa({ ajustes: { D: 2000 }, setting: { tip_cents: 5000 } });
    expect(calcular({ ...base, yo: A }).my_share).toEqual(E(10000, -1176, 2941, 11765));
    expect(calcular({ ...base, yo: B }).my_share).toEqual(E(7000, -824, 2059, 8235));
  });

  it('E6 · IVA aparte $27.20 sin descuento: «ajustes» positivo, propina sobre los platos', () => {
    const base = mesa({ ajustes: { V: 2720 }, setting: { tip_bps: 1000 } });
    expect(calcular({ ...base, yo: A }).my_share).toEqual(E(10000, 1600, 1000, 12600));
    expect(calcular({ ...base, yo: B }).my_share).toEqual(E(7000, 1120, 700, 8820));
  });

  it('E7 · servicio $17 y descuento $20, propina de la mesa 0 %', () => {
    const base = mesa({ ajustes: { D: 2000, S: 1700 }, setting: { tip_bps: 0 } });
    expect(calcular({ ...base, yo: A }).my_share).toEqual(E(10000, -176, 0, 9824));
    expect(calcular({ ...base, yo: B }).my_share).toEqual(E(7000, -124, 0, 6876));
  });

  it('🔴 E8 · servicio, IVA aparte y descuento: la base de la propina no incluye ni servicio ni IVA', () => {
    const base = mesa({ ajustes: { D: 2000, S: 1700, V: 2720 }, setting: { tip_bps: 1000 } });
    expect(calcular({ ...base, yo: A }).my_share).toEqual(E(10000, 1424, 882, 12306));
    expect(calcular({ ...base, yo: B }).my_share).toEqual(E(7000, 996, 618, 8614));
    expect(calcular({ ...base, yo: A }).share_totals.tip_cents).toBe(1500);
  });

  it('🔴 IG-A · $300 entre 3, descuento $20, 10 % sobre $280', () => {
    const base = { modo: 'igual' as const, P: 30000, n: 3, ajustes: { D: 2000 }, setting: { tip_bps: 1000 } };
    expect(calcular({ ...base, k: 0 }).my_share).toEqual(E(10000, -666, 934, 10268));
    expect(calcular({ ...base, k: 1 }).my_share).toEqual(E(10000, -667, 933, 10266));
    expect(calcular({ ...base, k: 2 }).my_share).toEqual(E(10000, -667, 933, 10266));
  });

  it('IG-B · $1 entre 3 con 2 centavos de descuento: el centavo cae distinto en «ajustes», el total es exacto', () => {
    const base = { modo: 'igual' as const, P: 100, n: 3, ajustes: { D: 2 } };
    expect([0, 1, 2].map((k) => calcular({ ...base, k }).my_share)).toEqual([E(34, -1, 0, 33), E(33, 0, 0, 33), E(33, -1, 0, 32)]);
  });

  it('🔴 sin propina fijada vale 0; 0 % es 0; «Otro» es el monto', () => {
    expect(propinaTotal(15000, null)).toBe(0);
    expect(propinaTotal(15000, { tip_bps: 0 })).toBe(0);
    expect(propinaTotal(15000, { tip_bps: 1000 })).toBe(1500);
    expect(propinaTotal(0, { tip_cents: 5000 }), '«Otro» no depende de la base').toBe(5000);
  });

  it('🔴 la propina por % redondea lejos del cero (round_half_away de tipFromBps): ni piso, ni al par, ni hacia abajo', () => {
    // 2.186.1 · revisión G5, punto 7: todos los ejemplos daban un % exacto y floor o half-even pasaban igual.
    expect(propinaTotal(1050, { tip_bps: 1500 }), '157,5 ¢ → 158 (el piso daría 157)').toBe(158);
    expect(propinaTotal(25, { tip_bps: 1000 }), '2,5 ¢ → 3 (al par o hacia abajo daría 2)').toBe(3);
    const r = calcular({ modo: 'consumo', P: 1050, personas: [persona('a', 1050)], setting: { tip_bps: 1500 }, yo: 'a' });
    expect([r.share_totals.tip_cents, r.my_share!.tip_cents]).toEqual([158, 158]);
  });

  it('🔴 la base es máx(0, P − D): con un descuento mayor o igual que los platos, la propina por % es 0', () => {
    expect(baseDePropina(17000, 2000)).toBe(15000);
    expect(baseDePropina(17000, 17000)).toBe(0);
    expect(baseDePropina(17000, 20000)).toBe(0);
    const r = calcular({ modo: 'consumo', P: 10000, personas: [persona('a', 10000)], ajustes: { D: 12000, S: 5000 }, setting: { tip_bps: 2000 }, yo: 'a' });
    expect(r.share_totals.tip_cents).toBe(0);
    expect(r.my_share).toEqual(E(10000, -7000, 0, 3000));
  });

  it('🔴 mesa corregida (R4): sin ajustes, la marca, y la propina sobre los platos (B = P)', () => {
    const omit = calcular({ modo: 'consumo', P: 17000, personas: [persona('a', 17000)], ajustes: { D: 2000, omitidos: true }, setting: { tip_bps: 1000 }, yo: 'a' });
    expect(omit.share_totals).toEqual({
      items_cents: 17000, discounts_cents: 0, service_cents: 0, tax_added_cents: 0,
      adjustments_cents: 0, tip_basis_cents: 17000, tip_cents: 1700, total_cents: 18700, adjustments_omitted: true,
      adjustments_omitted_reason: 'mesa_corregida',
    });
  });

  it('🔴 neto ≤ 0 (resguardo): sin ajustes y con la marca, pero la base sigue siendo P − D leído: la propina por % es 0', () => {
    const base = { modo: 'consumo' as const, P: 17000, personas: [persona('a', 17000)], yo: 'a' };
    const cero = calcular({ ...base, ajustes: { D: 17000 }, setting: { tip_bps: 1000 } });
    expect(cero.share_totals).toEqual({
      items_cents: 17000, discounts_cents: 0, service_cents: 0, tax_added_cents: 0,
      adjustments_cents: 0, tip_basis_cents: 0, tip_cents: 0, total_cents: 17000, adjustments_omitted: true,
      adjustments_omitted_reason: 'neto_no_positivo',
    });
    expect(cero.my_share).toEqual(E(17000, 0, 0, 17000));
    const casi = calcular({ ...base, ajustes: { D: 16999 }, setting: { tip_bps: 1000 } });
    expect([casi.share_totals.tip_cents, casi.share_totals.adjustments_omitted, casi.my_share!.total_cents],
      'con un centavo de neto, la propina por % redondea a 0: sin salto').toEqual([0, false, 1]);
    expect(calcular({ ...base, ajustes: { D: 17000 }, setting: { tip_cents: 5000 } }).share_totals.tip_cents, '«Otro» no cambia').toBe(5000);
    expect(neto({ P: 100, D: 100 })).toEqual({ P: 100, D: 0, S: 0, V: 0, N: 100, omitidos: true, motivo: 'neto_no_positivo' });
    expect(neto({ P: 100, D: 99 })).toEqual({ P: 100, D: 99, S: 0, V: 0, N: 1, omitidos: false, motivo: null });
    expect(neto({ P: 100, D: 200, omitidos: true }), 'la mesa corregida manda: su motivo, aunque el neto tampoco fuera positivo')
      .toEqual({ P: 100, D: 0, S: 0, V: 0, N: 100, omitidos: true, motivo: 'mesa_corregida' });
  });

  it('🔴 redondeo: un plato de 2 ¢ en tres cuartos le da a una persona −1 ¢ de «ajustes» sin ningún ajuste del ticket', () => {
    // 2.186.1 · revisión G5, punto 2: no cambia el cálculo, se describe. Cada cuarto nominal vale 1 ¢, lo elegido suma 3
    // sobre una línea de 2, y el neto (2) se reparte sobre pesos que suman 3. La suma sigue exacta y nadie queda negativo.
    const personas = [persona('ana', 1), persona('beto', 1), persona('caro', 1)];
    const partes = personas.map((x) => calcular({ modo: 'consumo', P: 2, personas, yo: x.id }));
    expect(partes.map((r) => r.my_share)).toEqual([E(1, 0, 0, 1), E(1, 0, 0, 1), E(1, -1, 0, 0)]);
    const t = partes[2]!.share_totals;
    expect([t.discounts_cents, t.service_cents, t.tax_added_cents, t.adjustments_cents, t.adjustments_omitted],
      'share_totals no trae ningún ajuste del ticket: el −1 ¢ es redondeo').toEqual([0, 0, 0, 0, false]);
    expect(suma(partes.map((r) => r.my_share!.total_cents))).toBe(2);
  });

  it('quien no eligió nada no recibe nada; en partes iguales, quien no tiene parte recibe null', () => {
    const r = calcular({ modo: 'consumo', P: 10000, personas: [persona('a', 10000), persona('b', 0)], ajustes: { D: 1000 }, setting: { tip_bps: 1000 }, yo: 'b' });
    expect(r.my_share).toEqual(E(0, 0, 0, 0));
    expect(calcular({ modo: 'consumo', P: 10000, personas: [persona('a', 10000)], yo: 'otro' }).my_share).toEqual(E(0, 0, 0, 0));
    expect(calcular({ modo: 'igual', P: 30000, n: 2, k: 2 }).my_share, 'una persona de más').toBeNull();
    expect(calcular({ modo: 'igual', P: 30000, n: 2, k: -1 }).my_share).toBeNull();
  });

  it('🔴 quien mira sin estar en la lista (una invitación pendiente) recibe ceros, nunca la parte de lo sin elegir', () => {
    const base = { modo: 'consumo' as const, P: 20000, personas: [persona('ana', 10000), persona('beto', 7000)], U: 3000,
      ajustes: { D: 2000 }, setting: { tip_bps: 1000 } };
    expect(calcular({ ...base, yo: 'pendiente' }).my_share).toEqual(E(0, 0, 0, 0));
    expect(calcular({ ...base, yo: null }).my_share).toEqual(E(0, 0, 0, 0));
  });

  it('🔴 entradas inválidas fallan cerrado, y un desborde no sale como número', () => {
    expect(() => mayorResto(-1, [1, 1])).toThrow(/parte_mesa_entrada_invalida/);
    expect(() => mayorResto(10, [1, -1])).toThrow(/parte_mesa_entrada_invalida/);
    expect(() => mayorResto(10, [1.5, 1])).toThrow(/parte_mesa_entrada_invalida/);
    expect(() => mayorResto(10, [0, 0])).toThrow(/parte_mesa_entrada_invalida/);
    expect(() => mayorResto(10, [])).toThrow(/parte_mesa_entrada_invalida/);
    expect(() => neto({ P: 0 })).toThrow(/parte_mesa_entrada_invalida/);
    expect(() => propinaTotal(100, { tip_cents: -1 })).toThrow(/parte_mesa_entrada_invalida/);
    expect(() => calcular({ modo: 'consumo', P: 100, personas: [persona('a', 100)], setting: { tip_cents: Number.MAX_SAFE_INTEGER }, yo: 'a' }))
      .toThrow(/parte_mesa_desborde/);
    expect(() => parteConsumo({ N: 100, T: Number.MAX_SAFE_INTEGER, personas: [persona('a', 100)], U: 0, yo: 'a' })).toThrow(/parte_mesa_desborde/);
    expect(() => parteIgual({ P: 100, N: 100, T: Number.MAX_SAFE_INTEGER, n: 1, k: 0 })).toThrow(/parte_mesa_desborde/);
  });

  it('🔴 el neto no se calcula si P + S + V no es un entero seguro: antes salía corrido un centavo, sin lanzar', () => {
    // 2.186.1 · revisión G5, punto 1. Con `number`, MAX + 2 se redondeaba antes de restar D: N salía …990 donde es …991.
    const MAX = Number.MAX_SAFE_INTEGER;
    expect(() => neto({ P: MAX, D: 2, S: 2 })).toThrow(/^parte_mesa_desborde$/);
    expect(() => neto({ P: MAX - 4, D: 7, S: 5, V: 1 })).toThrow(/^parte_mesa_desborde$/);
    expect(() => neto({ P: MAX - 2, S: 2, V: 1 }), 'P + S + V = 2^53: ya no es seguro').toThrow(/^parte_mesa_desborde$/);
    expect(() => calcular({ modo: 'igual', P: MAX, ajustes: { D: 2, S: 2 }, n: 1, k: 0 })).toThrow(/parte_mesa_desborde/);
    // En el borde exacto (P + S + V = MAX) calcula, y la identidad del contrato se cumple.
    const borde = neto({ P: MAX - 2, S: 1, V: 1, D: 5 });
    expect([borde.N, borde.omitidos]).toEqual([MAX - 5, false]);
    const t = calcular({ modo: 'igual', P: MAX - 2, ajustes: { S: 1, V: 1, D: 5 }, n: 1, k: 0 }).share_totals;
    expect(t.items_cents + t.adjustments_cents + t.tip_cents).toBe(t.total_cents);
    expect(t.total_cents).toBe(MAX - 5);
    // La mesa corregida no suma ajustes: P solo, aunque llegara al borde.
    expect(neto({ P: MAX, omitidos: true }).N).toBe(MAX);
  });

  it('🔴 el total de la mesa controla su propio desborde: con dos personas, o sin parte, ninguna parte desborda y igual lanza', () => {
    const dosDeCien = { modo: 'consumo' as const, P: 200, personas: [persona('a', 100), persona('b', 100)], setting: { tip_cents: Number.MAX_SAFE_INTEGER - 50 } };
    expect(Number.isSafeInteger(parteConsumo({ N: 200, T: Number.MAX_SAFE_INTEGER - 50, personas: dosDeCien.personas, U: 0, yo: 'a' }).total_cents)).toBe(true);
    expect(() => calcular({ ...dosDeCien, yo: 'a' })).toThrow(/parte_mesa_desborde/);
    expect(() => calcular({ ...dosDeCien, yo: 'otro' })).toThrow(/parte_mesa_desborde/);
    expect(() => calcular({ modo: 'igual', P: 100, n: 2, k: -1, setting: { tip_cents: Number.MAX_SAFE_INTEGER } })).toThrow(/parte_mesa_desborde/);
    expect(() => totales(neto({ P: 100 }), Number.MAX_SAFE_INTEGER, 100)).toThrow(/parte_mesa_desborde/);
  });

  it('🔴 ⑧ de mi-parte-http · un plato de 2 centavos con tres cuartos elegidos suma 3 (1 + 1 + 1): sin negativos', () => {
    // El dueño calcula U = máx(0, 2 − 3) = 0 plato por plato (eso es de quien llama). N = 2 sobre W = 3: los tres con
    // piso 0 y resto 2; faltan 2 → Ana y Beto. Caro: 1, 0 − 1 = −1, 0, 0.
    const base = { modo: 'consumo' as const, P: 2, personas: [persona('ana', 1), persona('beto', 1), persona('caro', 1)], U: 0 };
    expect(['ana', 'beto', 'caro'].map((yo) => calcular({ ...base, yo }).my_share)).toEqual([E(1, 0, 0, 1), E(1, 0, 0, 1), E(1, -1, 0, 0)]);
  });
});

describe('④ propiedades, con la semilla fija del dueño (tests/parte-de-mesa.test.js ③)', () => {
  let semilla = 344;
  const rnd = () => (semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648;
  const entero = (n: number) => Math.floor(rnd() * n);

  it('🔴 la copia del mayor resto da lo mismo que la de Viajes', () => {
    for (let i = 0; i < 2000; i++) {
      const pesos = Array.from({ length: 1 + entero(10) }, () => (entero(4) === 0 ? 0 : entero(300000)));
      // `: boolean` explícito: sin él, TypeScript infiere el predicado `p is 0` y `every` estrecha `pesos` a `0[]`.
      if (pesos.every((p): boolean => p === 0)) pesos[0] = 1;
      const total = entero(3000000);
      expect(mayorResto(total, pesos), JSON.stringify({ total, pesos })).toEqual(repartirPorMayorResto(total, pesos));
    }
  });

  it('🔴 por consumo: suma exacta, sin negativos, peso 0 sin parte, nadie paga de más por el descuento, T(B) ≤ T(P)', () => {
    for (let i = 0; i < 2000; i++) {
      const personas = Array.from({ length: 1 + entero(8) }, (_, j) => persona(`p${j}`, entero(5) === 0 ? 0 : 1 + entero(150000)));
      const U = entero(3) === 0 ? entero(80000) : 0;
      const P = suma(personas.map((x) => x.p)) + U;
      if (P === 0) continue;
      const S = entero(4) === 0 ? entero(Math.floor(P / 5) + 1) : 0;
      const V = entero(4) === 0 ? entero(Math.floor(P / 6) + 1) : 0;
      const D = entero(3) === 0 ? 0 : entero(P + S + V);
      const setting: PropinaDeLaMesa = entero(5) === 0
        ? { tip_cents: entero(50000) }
        : { tip_bps: [0, 500, 1000, 1500, 2000, entero(10001)][entero(6)]! };
      const caso = { P, ajustes: { D, S, V }, setting, personas, U };
      const { tot, partes, sinElegir } = todas(caso);
      const N = P + S + V - D;
      const ctx = JSON.stringify(caso);
      expect(tot.total_cents, ctx).toBe(N + tot.tip_cents);
      expect(suma(partes.map((x) => x.total_cents)) + sinElegir, ctx).toBe(N + tot.tip_cents);
      // Las dos identidades del contrato (`lectura.claves.share_totals`).
      expect(tot.adjustments_cents, ctx).toBe(tot.service_cents + tot.tax_added_cents - tot.discounts_cents);
      expect(tot.total_cents, ctx).toBe(tot.items_cents + tot.adjustments_cents + tot.tip_cents);
      partes.forEach((x, k) => {
        expect(x.total_cents >= 0 && x.tip_cents >= 0 && x.items_cents + x.adjustments_cents >= 0, ctx).toBe(true);
        if (personas[k]!.p === 0) expect(x, ctx).toEqual(E(0, 0, 0, 0));
        if (S === 0 && V === 0) expect(x.adjustments_cents <= 0, ctx).toBe(true);
      });
      expect(tot.tip_basis_cents, ctx).toBe(Math.max(0, P - D));
      if (setting.tip_bps !== undefined) {
        // 2.186.1 · revisión G5, punto 7: la propina es EXACTAMENTE la de tipFromBps sobre B, no sólo una cota.
        expect(tot.tip_cents, ctx).toBe(tipFromBps(Math.max(0, P - D), 1, setting.tip_bps));
        expect(tot.tip_cents <= tipFromBps(P, 1, setting.tip_bps), ctx).toBe(true);
        if (D >= P) expect(tot.tip_cents, ctx).toBe(0);
      }
    }
  });

  it('en partes iguales: las n partes suman exacto', () => {
    for (let i = 0; i < 2000; i++) {
      const n = 1 + entero(20);
      const P = 1 + entero(500000);
      const D = entero(3) === 0 ? 0 : entero(P);
      const setting = { tip_bps: entero(10001) };
      const partes = Array.from({ length: n }, (_, k) => calcular({ modo: 'igual', P, n, k, ajustes: { D }, setting }).my_share!);
      const { share_totals: tot } = calcular({ modo: 'igual', P, n, k: 0, ajustes: { D }, setting });
      expect(suma(partes.map((x) => x.total_cents))).toBe(tot.total_cents);
      expect(suma(partes.map((x) => x.items_cents))).toBe(P);
      expect(suma(partes.map((x) => x.tip_cents))).toBe(tot.tip_cents);
    }
  });
});

describe('⑤ las simplificaciones del mock: lo que arma quien llama', () => {
  it('el orden de `personas` es el de la lista que recibe: no hay `joined_at` acá (ver ② · el empate)', () => {
    const base = { modo: 'consumo' as const, P: 100, U: 0, ajustes: { D: 1 } };
    const primero = (personas: readonly PersonaConPlatos[]) =>
      personas.map((x) => calcular({ ...base, personas, yo: x.id }).my_share!.total_cents);
    expect(primero([persona('activa', 50), persona('ya_no_activa', 50)])).toEqual([50, 49]);
    expect(primero([persona('ya_no_activa', 50), persona('activa', 50)])).toEqual([50, 49]);
  });

  it('🔴 no comprueba que Σ p + U = P (el dueño tampoco): si quien llama olvida U, el neto entero cae en quien eligió', () => {
    // P = 1000 con 600 sin elegir que no se pasaron: pesos [400, 0], Ana recibe los 1000 del neto.
    expect(calcular({ modo: 'consumo', P: 1000, personas: [persona('ana', 400)], U: 0, yo: 'ana' }).my_share).toEqual(E(400, 600, 0, 1000));
    // Con U = 600, lo correcto: Ana 400 y lo sin elegir se queda con el resto.
    expect(calcular({ modo: 'consumo', P: 1000, personas: [persona('ana', 400)], U: 600, yo: 'ana' }).my_share).toEqual(E(400, 0, 0, 400));
  });

  it('`ajustes` llega decidido: `omitidos` marca la mesa corregida aunque no hubiera nada que omitir', () => {
    // `origenItems.ajustesAplicables` sólo marca si había algo que omitir; decidirlo es de quien llama.
    expect(calcular({ modo: 'consumo', P: 1000, personas: [persona('a', 1000)], ajustes: { omitidos: true }, yo: 'a' }).share_totals)
      .toMatchObject({ adjustments_omitted: true, adjustments_omitted_reason: 'mesa_corregida', adjustments_cents: 0 });
    expect(calcular({ modo: 'consumo', P: 1000, personas: [persona('a', 1000)], yo: 'a' }).share_totals)
      .toMatchObject({ adjustments_omitted: false, adjustments_omitted_reason: null });
  });
});

/**
 * ⑥ 🔴 LA GUARDA ESTÁTICA: fija el CAMINO del build real hasta este módulo, no el contenido del bundle.
 *
 * Derivada del árbol (como la de `src/arnes/jsxGuardas.test.ts`), sin construir nada:
 *   a. ningún archivo de producción fuera de `src/api/mock/` lo importa directo (estático, `import()`, reexport o
 *      `?raw`), y ningún `import.meta.glob` de producción puede alcanzar al mock;
 *   b. la cadena entera, no sólo el primer eslabón: lo que dentro del mock lo usa (directo o por funciones locales) y se
 *      exporta —hoy `toMesaDetail` de `store.ts` y `mockGetMesa` de `mockApi.ts`— sale del mock por un solo lugar,
 *      `src/api/index.ts` (`import * as mock from './mock/mockApi'`). Ahí lo único que corre al cargar es la rama
 *      verdadera de `IS_MOCK ? mockApi : realApi`, con `IS_MOCK` declarado como `import.meta.env.VITE_MOCK === '1'`, y
 *      nada de la cadena se exporta;
 *   c. en esa cadena nada lo ejecuta al cargarse el módulo: ni una IIFE, ni el callback de una llamada que corre al
 *      cargar, ni una función local que lo use;
 *   d. el módulo no tiene efectos al cargarse y sólo importa `utils/money`;
 *   e. sus dos códigos de error son marcas únicas del mock: buscar `parte_mesa_desborde` en un artefacto alcanza.
 *
 * 🔴 Lo que esto NO acredita: el contenido de `dist/`. Una guarda estática no mide el bundle; que el build real se
 * quede sin el port depende de que pliegue `IS_MOCK` y descarte la rama del mock, y eso este test no lo ve.
 *
 * Lo medido, con fecha: el 2026-10-17 el integrador corrió `vite build` real (`NODE_ENV=production`, con
 * `VITE_API_URL`) y mock (`--mode mock`, `VITE_MOCK=1`) en carpetas temporales. En el real, 0 archivos con
 * `parte_mesa_desborde` y 0 con cada una de las claves del mock `payme.app.mock.parte_pagada.v1`,
 * `payme.app.mock.propina_mesa.v1` y `payme.app.mock.cerrar.v1`; en el mock, 1 archivo con cada una. Esas cuatro marcas
 * son lo medido: no dicen nada del resto de `mockApi.ts`. Un `dist/` construido en modo mock sí trae el port, así que
 * no sirve para medir el real. La medición permanente sobre el artefacto corresponde a `scripts/artefactos.test.ts`,
 * no a este test.
 *
 * Límites del análisis, declarados: los nombres se siguen sin ámbitos (un homónimo sobra, nunca falta); una función
 * escrita en cualquier lugar que no sea guardarla (una declaración, un `export default`, un `return`, el cuerpo de una
 * flecha o un literal que termina en uno de esos) cuenta como que puede correr; y una referencia al cargar cuenta
 * aunque no sea una llamada. Todo eso falla cerrado.
 */
describe('⑦ los `ejemplos` del contrato espejado (2.186.1): «sirven también para probar el mock de App Frontend»', () => {
  const contrato = JSON.parse(readFileSync(new URL('../../../contract-mirror/contract/mesa-mi-parte-v1.json', import.meta.url), 'utf8')) as {
    ejemplos: {
      casos: ReadonlyArray<{ id: string; entrada: EntradaDeCalculo; my_share: MiParte | null; share_totals?: unknown }>;
      sin_calculo: ReadonlyArray<{ id: string; entrada: EntradaDeCalculo; error: string }>;
    };
  };
  const { casos, sin_calculo: sinCalculo } = contrato.ejemplos;

  it('hay ejemplos que correr (si no, lo de abajo pasaría en vacío)', () => {
    expect(casos.length).toBeGreaterThan(0);
    expect(sinCalculo.length).toBeGreaterThan(0);
  });

  it('🔴 cada caso da la parte del contrato y, si la declara, los totales de la mesa', () => {
    for (const caso of casos) {
      const r = calcular(caso.entrada);
      expect(r.my_share, caso.id).toEqual(caso.my_share);
      if (caso.share_totals !== undefined) expect(r.share_totals, caso.id).toEqual(caso.share_totals);
    }
  });

  it('🔴 lo que el contrato no calcula lanza su error, nunca sale como número', () => {
    for (const caso of sinCalculo) expect(() => calcular(caso.entrada), caso.id).toThrow(new RegExp(`^${caso.error}$`));
  });
});

describe('⑥ 🔴 la guarda estática: el camino del build real hasta «Mi parte» del mock (no el bundle)', () => {
  const MODULO = '/src/api/mock/parteDeMesa';
  const MOCK = '/src/api/mock';
  const SALIDA = '/src/api/index.ts';
  const CODIGOS = ['parte_mesa_entrada_invalida', 'parte_mesa_desborde'];
  const PRODUCCION = import.meta.glob(
    ['/src/**/*.ts', '/src/**/*.tsx', '/src/**/*.js', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  /** Lo que de un módulo alcanza al port: todo (`TODO`), o los nombres que exporta y llegan a él. */
  const TODO = '*';
  type Alcance = typeof TODO | ReadonlySet<string>;
  const incluye = (a: Alcance, nombre: string) => a === TODO || a.has(TODO) || a.has(nombre);
  interface Archivo { readonly ruta: string; readonly sf: ts.SourceFile }

  const analizar = (ruta: string, texto: string): ts.SourceFile => ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true,
    ruta.endsWith('.tsx') ? ts.ScriptKind.TSX : ruta.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const archivo = (ruta: string, texto: string): Archivo => ({ ruta, sf: analizar(ruta, texto) });
  const linea = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const sinExtension = (r: string) => r.replace(/\.(ts|tsx|js|mjs)$/, '');
  const enElMock = (r: string) => r.startsWith(`${MOCK}/`);
  const MODULOS = new Set(Object.keys(PRODUCCION).map(sinExtension));

  /** El módulo que nombra `spec`, escrito en `ruta` (relativo o absoluto, con o sin extensión ni `?query`); null si es un paquete o un alias. */
  function resolver(ruta: string, spec: string): string | null {
    const limpio = spec.split('?')[0]!;
    const destino = limpio.startsWith('/') ? limpio : limpio.startsWith('.') ? posix.join(posix.dirname(ruta), limpio) : null;
    if (destino === null) return null;
    const base = sinExtension(destino);
    return !MODULOS.has(base) && MODULOS.has(`${base}/index`) ? `${base}/index` : base;
  }
  const nombraAlModulo = (ruta: string, spec: string) => resolver(ruta, spec) === MODULO;

  /** Los patrones de un `import.meta.glob`; null donde no hay un literal: no se puede afirmar adónde apunta. */
  const patrones = (a: ts.Expression | undefined): Array<string | null> =>
    a === undefined ? [null]
      : ts.isArrayLiteralExpression(a) ? a.elements.map((e) => (ts.isStringLiteralLike(e) ? e.text : null))
        : ts.isStringLiteralLike(a) ? [a.text] : [null];

  /**
   * Si un patrón, escrito en `ruta`, puede alcanzar al mock. Falla cerrado: sin literal, con `**`, con un alias, o con
   * un prefijo fijo (lo anterior al primer segmento con comodín) que sea ancestro del mock o esté dentro de él. Una
   * exclusión (`!…`) no suma archivos.
   */
  function alcanzaAlMock(ruta: string, patron: string | null): boolean {
    if (patron === null) return true;
    if (patron.startsWith('!')) return false;
    if (patron.includes('**')) return true;
    const absoluto = patron.startsWith('/') ? patron : patron.startsWith('.') ? posix.join(posix.dirname(ruta), patron) : null;
    if (absoluto === null) return true;
    const segmentos = absoluto.split('/');
    const comodin = segmentos.findIndex((s) => /[*?[\]{}()!+@]/.test(s));
    const fijo = (comodin < 0 ? segmentos : segmentos.slice(0, comodin)).join('/');
    return `${MOCK}/`.startsWith(`${fijo}/`) || fijo.startsWith(`${MOCK}/`);
  }

  /** Lo que un archivo hace con este módulo de forma directa: imports, globs que pueden alcanzar al mock y literales con sus códigos. */
  function hallazgos({ ruta, sf }: Archivo) {
    const importa: string[] = [];
    const globs: string[] = [];
    const marcas: string[] = [];
    const visitar = (n: ts.Node): void => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        if (nombraAlModulo(ruta, n.moduleSpecifier.text)) importa.push(`${ruta}:${linea(sf, n)}`);
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const a = n.arguments[0];
        if (!a || !ts.isStringLiteralLike(a)) importa.push(`${ruta}:${linea(sf, n)} (import() sin literal: no se puede afirmar)`);
        else if (nombraAlModulo(ruta, a.text)) importa.push(`${ruta}:${linea(sf, n)}`);
      } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'glob'
        && ts.isMetaProperty(n.expression.expression)) {
        if (patrones(n.arguments[0]).some((p) => alcanzaAlMock(ruta, p))) globs.push(`${ruta}:${linea(sf, n)}`);
      } else if (ts.isStringLiteralLike(n) && CODIGOS.includes(n.text)) {
        marcas.push(ruta);
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    return { importa, globs, marcas };
  }

  /** Si un identificador es una referencia a un valor: no el nombre de una propiedad, ni el de lo que se declara. */
  function esReferencia(id: ts.Identifier): boolean {
    const p = id.parent;
    if (!p) return true;
    const esSuNombre = (x: { readonly name?: ts.Node }) => x.name === id;
    if ((ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p)
      || ts.isGetAccessorDeclaration(p) || ts.isSetAccessorDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodSignature(p)
      || ts.isEnumMember(p) || ts.isJsxAttribute(p)) && esSuNombre(p)) return false;
    if ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p)
      || ts.isClassExpression(p) || ts.isParameter(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p)
      || ts.isEnumDeclaration(p)) && esSuNombre(p)) return false;
    if (ts.isBindingElement(p) && (p.name === id || p.propertyName === id)) return false;
    // `export { local as publico }`: `publico` es el nombre exportado, no una referencia.
    if (ts.isExportSpecifier(p) && p.propertyName !== undefined && p.name === id) return false;
    return !(ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p));
  }

  /** Si `id` usa algo contaminado. De un espacio de nombres sólo cuenta un miembro contaminado (`mock.mockGetMesa`, no `mock.MockApiError`); cualquier otro uso del espacio, sí. */
  function usa(id: ts.Identifier, malos: ReadonlyMap<string, Alcance>): boolean {
    const a = malos.get(id.text);
    if (a === undefined || !esReferencia(id)) return false;
    const p = id.parent;
    return a === TODO || !(ts.isPropertyAccessExpression(p) && p.expression === id) || incluye(a, p.name.text);
  }

  /** Las referencias contaminadas dentro de `nodo`, salvo los tipos y las que caen en `corte`. */
  function usos(nodo: ts.Node, malos: ReadonlyMap<string, Alcance>, corte: (id: ts.Identifier) => boolean = () => false): ts.Identifier[] {
    const out: ts.Identifier[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) || ts.isTypeNode(n)) return;
      if (ts.isIdentifier(n) && usa(n, malos) && !corte(n)) out.push(n);
      ts.forEachChild(n, visitar);
    };
    visitar(nodo);
    return out;
  }

  const nombresDe = (b: ts.BindingName): string[] => ts.isIdentifier(b)
    ? [b.text]
    : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : nombresDe(e.name)));

  /**
   * Los nombres del archivo que alcanzan algo contaminado: las semillas y, hasta un punto fijo, toda declaración
   * (función, clase o variable, a cualquier profundidad) que use alguno. Por nombre, sin ámbitos.
   */
  function contaminados(sf: ts.SourceFile, semillas: ReadonlyMap<string, Alcance>, corte?: (id: ts.Identifier) => boolean) {
    const malos = new Map(semillas);
    if (malos.size === 0) return malos;
    const declaraciones: Array<{ nombres: string[]; cuerpo: ts.Node }> = [];
    const juntar = (n: ts.Node): void => {
      if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) declaraciones.push({ nombres: [n.name.text], cuerpo: n });
      else if (ts.isVariableDeclaration(n) && n.initializer) declaraciones.push({ nombres: nombresDe(n.name), cuerpo: n.initializer });
      ts.forEachChild(n, juntar);
    };
    juntar(sf);
    for (let cambio = true; cambio;) {
      cambio = false;
      for (const d of declaraciones) {
        if (d.nombres.every((x) => malos.get(x) === TODO) || usos(d.cuerpo, malos, corte).length === 0) continue;
        for (const x of d.nombres) malos.set(x, TODO);
        cambio = true;
      }
    }
    return malos;
  }

  /**
   * Si una función, donde está escrita, queda guardada sin correr: el valor de una declaración, de un `export default`,
   * de un `return` o del cuerpo de una flecha, o dentro de un literal (objeto o arreglo) que termina en uno de esos.
   * Cualquier otro lugar (callee, argumento, operando) cuenta como que puede correr.
   */
  function quedaGuardada(fn: ts.Node): boolean {
    let n: ts.Node = fn;
    for (let p = n.parent; p; n = p, p = n.parent) {
      if (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p) || ts.isNonNullExpression(p)
        || ts.isTypeAssertionExpression(p) || ts.isArrayLiteralExpression(p) || ts.isObjectLiteralExpression(p)
        || (ts.isPropertyAssignment(p) && p.initializer === n)) continue;
      return (ts.isVariableDeclaration(p) && p.initializer === n) || ts.isExportAssignment(p) || ts.isReturnStatement(p)
        || (ts.isArrowFunction(p) && p.body === n) || (ts.isPropertyDeclaration(p) && p.initializer === n);
    }
    return false;
  }
  const esFuncion = (n: ts.Node) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
    || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
  /** El cuerpo no corre al definirla: una declaración o un miembro de clase, siempre; una expresión o un método de un literal, si queda guardada. */
  const seDifiere = (n: ts.Node) => ts.isFunctionDeclaration(n) || (n.parent !== undefined && ts.isClassLike(n.parent)) || quedaGuardada(n);

  /** Las referencias contaminadas que corren al cargarse el archivo: fuera de toda función que se difiere. */
  function alCargar(sf: ts.SourceFile, malos: ReadonlyMap<string, Alcance>): ts.Identifier[] {
    const out: ts.Identifier[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) || ts.isTypeNode(n) || (esFuncion(n) && seDifiere(n))) return;
      if (ts.isIdentifier(n) && usa(n, malos)) out.push(n);
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    return out;
  }

  /** Lo que el archivo liga de módulos contaminados (nombre local → alcance) y los `import()` que no se pueden afirmar. */
  function ligaduras({ ruta, sf }: Archivo, contaminadas: ReadonlyMap<string, Alcance>) {
    const nombres = new Map<string, Alcance>();
    const dudas: string[] = [];
    const visitar = (n: ts.Node): void => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
        const a = contaminadas.get(resolver(ruta, n.moduleSpecifier.text) ?? '');
        const c = n.importClause;
        if (a !== undefined && c && !c.isTypeOnly) {
          if (c.name && incluye(a, 'default')) nombres.set(c.name.text, TODO);
          const nb = c.namedBindings;
          if (nb && ts.isNamespaceImport(nb)) nombres.set(nb.name.text, a);
          if (nb && ts.isNamedImports(nb)) {
            for (const e of nb.elements) if (!e.isTypeOnly && incluye(a, (e.propertyName ?? e.name).text)) nombres.set(e.name.text, TODO);
          }
        }
      } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const a = n.arguments[0];
        if (!a || !ts.isStringLiteralLike(a) || contaminadas.has(resolver(ruta, a.text) ?? '')) dudas.push(`${ruta}:${linea(sf, n)} import()`);
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
    return { nombres, dudas };
  }

  /** Lo que el archivo exporta y alcanza al port: sus declaraciones contaminadas, `export default`, `export { … }` y lo que reexporta de un módulo contaminado. */
  function exportados({ ruta, sf }: Archivo, malos: ReadonlyMap<string, Alcance>, contaminadas: ReadonlyMap<string, Alcance>,
    corte?: (id: ts.Identifier) => boolean): string[] {
    const out = new Set<string>();
    for (const st of sf.statements) {
      const mods = (ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : []).map((m) => m.kind);
      const porDefecto = mods.includes(ts.SyntaxKind.DefaultKeyword);
      if (mods.includes(ts.SyntaxKind.ExportKeyword) && (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st))) {
        const sucia = st.name ? malos.get(st.name.text) === TODO : usos(st, malos, corte).length > 0;
        if (sucia) out.add(porDefecto || !st.name ? 'default' : st.name.text);
      } else if (mods.includes(ts.SyntaxKind.ExportKeyword) && ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) for (const x of nombresDe(d.name)) if (malos.get(x) === TODO) out.add(x);
      } else if (ts.isExportAssignment(st)) {
        if (usos(st.expression, malos, corte).length > 0) out.add('default');
      } else if (ts.isExportDeclaration(st) && !st.isTypeOnly) {
        const origen = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
          ? contaminadas.get(resolver(ruta, st.moduleSpecifier.text) ?? '') : undefined;
        if (st.moduleSpecifier && origen === undefined) continue;
        if (!st.exportClause) {
          if (origen === TODO) out.add(TODO);
          else for (const x of origen ?? []) out.add(x);
        }
        else if (ts.isNamespaceExport(st.exportClause)) out.add(st.exportClause.name.text);
        else {
          for (const e of st.exportClause.elements) {
            const local = (e.propertyName ?? e.name).text;
            if (!e.isTypeOnly && (origen !== undefined ? incluye(origen, local) : malos.has(local))) out.add(e.name.text);
          }
        }
      }
    }
    return [...out].sort();
  }

  /** El alcance del port, módulo por módulo dentro del mock, hasta un punto fijo: el port entero y lo que cada archivo del mock exporta y llega a él. */
  function cierre(arbol: readonly Archivo[]): Map<string, Alcance> {
    const contaminadas = new Map<string, Alcance>([[MODULO, TODO]]);
    for (let cambio = true; cambio;) {
      cambio = false;
      for (const a of arbol) {
        const id = sinExtension(a.ruta);
        if (!enElMock(a.ruta) || id === MODULO) continue;
        // Sin `continue` cuando no liga nada: un archivo que sólo reexporta (`export * from`) también es un eslabón.
        const sale = exportados(a, contaminados(a.sf, ligaduras(a, contaminadas).nombres), contaminadas);
        const antes = contaminadas.get(id);
        if (sale.length > (antes === undefined || antes === TODO ? 0 : antes.size)) {
          contaminadas.set(id, new Set(sale));
          cambio = true;
        }
      }
    }
    return contaminadas;
  }

  /** Por dónde sale la cadena del mock: cada archivo fuera de `src/api/mock/` que liga o reexporta algo contaminado, y todo `import()` que no se puede afirmar. */
  function salidas(arbol: readonly Archivo[], contaminadas: ReadonlyMap<string, Alcance>): string[] {
    return arbol.filter((a) => sinExtension(a.ruta) !== MODULO).flatMap((a) => {
      const { nombres, dudas } = ligaduras(a, contaminadas);
      if (enElMock(a.ruta)) return dudas;
      return [
        ...[...nombres.keys()].map((n) => `${a.ruta} · ${n}`),
        ...exportados(a, new Map(), contaminadas).map((n) => `${a.ruta} · export ${n}`),
        ...dudas,
      ];
    });
  }

  /** La rama verdadera de `IS_MOCK ? … : …`: donde el build real corta la cadena. */
  const enElCorte = (id: ts.Identifier): boolean => {
    const p = id.parent;
    return ts.isConditionalExpression(p) && p.whenTrue === id && ts.isIdentifier(p.condition) && p.condition.text === 'IS_MOCK';
  };

  /** En una salida: lo que corre al cargar (en el corte y fuera de él), lo que exporta de la cadena y cómo declara `IS_MOCK`. */
  function revisarSalida(a: Archivo, contaminadas: ReadonlyMap<string, Alcance>) {
    const malos = contaminados(a.sf, ligaduras(a, contaminadas).nombres, enElCorte);
    const cargas = alCargar(a.sf, malos).map((id) => ({ id, texto: `${a.ruta}:${linea(a.sf, id)} ${id.text}` }));
    const declaracion = a.sf.statements.filter(ts.isVariableStatement).flatMap((st) => [...st.declarationList.declarations])
      .find((d) => ts.isIdentifier(d.name) && d.name.text === 'IS_MOCK');
    return {
      corte: cargas.filter((c) => enElCorte(c.id)).map((c) => c.texto),
      fuera: cargas.filter((c) => !enElCorte(c.id)).map((c) => c.texto),
      exporta: exportados(a, malos, contaminadas, enElCorte),
      isMock: declaracion?.initializer?.getText(a.sf) ?? null,
    };
  }

  /** Para las sondas: lo que corre al cargar en un texto suelto, con el alcance que se pase (por defecto, sólo el port). */
  function usosAlCargar(ruta: string, texto: string, contaminadas: ReadonlyMap<string, Alcance> = new Map([[MODULO, TODO]])): string[] {
    const a = archivo(ruta, texto);
    return alCargar(a.sf, contaminados(a.sf, ligaduras(a, contaminadas).nombres)).map((id) => `${a.ruta}:${linea(a.sf, id)} ${id.text}`);
  }

  /** Las sentencias de primer nivel que podrían tener efectos al cargarse, o imports que no sean de `utils/money`. */
  function sentenciasConEfecto(ruta: string, texto: string): string[] {
    const sf = analizar(ruta, texto);
    const CONSTANTES: readonly ts.SyntaxKind[] = [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword];
    const puro = (e: ts.Expression): boolean =>
      ts.isArrowFunction(e) || ts.isFunctionExpression(e) || ts.isStringLiteralLike(e) || ts.isNumericLiteral(e) || ts.isBigIntLiteral(e)
      || CONSTANTES.includes(e.kind)
      || ((ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) && puro(e.expression))
      || (ts.isArrayLiteralExpression(e) && e.elements.every(puro))
      || (ts.isObjectLiteralExpression(e) && e.properties.every((p) => ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && puro(p.initializer)));
    return sf.statements.filter((st) => {
      if (ts.isImportDeclaration(st)) {
        return !st.importClause?.isTypeOnly && !(ts.isStringLiteral(st.moduleSpecifier) && st.moduleSpecifier.text === '../../utils/money');
      }
      if (ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) return false;
      if (ts.isExportDeclaration(st)) return !!st.moduleSpecifier;
      if (ts.isVariableStatement(st)) {
        const esConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
        return !esConst || !st.declarationList.declarations.every((d) => d.initializer !== undefined && puro(d.initializer));
      }
      return true;
    }).map((st) => `${ruta}:${linea(sf, st)}`);
  }

  const ARBOL = Object.entries(PRODUCCION).map(([ruta, texto]) => archivo(ruta, texto));
  const porArchivo = ARBOL.map((a) => ({ ruta: a.ruta, ...hallazgos(a) }));
  const CONTAMINADAS = cierre(ARBOL);
  const alcanceDe = (m: string, contaminadas: ReadonlyMap<string, Alcance> = CONTAMINADAS) => {
    const a = contaminadas.get(m);
    return a === undefined ? [] : a === TODO ? [TODO] : [...a].sort();
  };

  it('el barrido ve el árbol de producción y al módulo (si no, todo lo de abajo pasaría en vacío)', () => {
    expect(Object.keys(PRODUCCION).length, 'el barrido no vio el árbol de producción').toBeGreaterThan(200);
    expect(Object.keys(PRODUCCION)).toContain(`${MODULO}.ts`);
    expect(Object.keys(PRODUCCION).some((r) => r.endsWith('.test.ts')), 'los tests no son producción').toBe(false);
  });

  it('🔴 a · ningún archivo fuera de `src/api/mock/` lo importa directo, y ningún glob de producción puede alcanzar al mock', () => {
    const afuera = porArchivo.filter((a) => !enElMock(a.ruta)).flatMap((a) => a.importa);
    expect(afuera, `importan «Mi parte» del mock desde el camino real: ${afuera.join(' · ')}`).toEqual([]);
    const globs = porArchivo.flatMap((a) => a.globs);
    expect(globs, `un glob de producción puede arrastrar el mock: ${globs.join(' · ')}`).toEqual([]);
  });

  it('🔴 b · la cadena sale del mock sólo por `src/api/index.ts`, ahí sólo corre en la rama `IS_MOCK ?` y no se exporta', () => {
    // Control positivo: el cierre ve la cadena real (si no, lo de abajo pasaría en vacío).
    expect(alcanceDe(`${MOCK}/store`), 'store.ts usa el port en `toMesaDetail`').toContain('toMesaDetail');
    expect(alcanceDe(`${MOCK}/mockApi`), 'mockApi.ts llega por `mockGetMesa`').toContain('mockGetMesa');
    const fuera = salidas(ARBOL, CONTAMINADAS);
    expect(fuera, `lo que alcanza al port sale del mock por otro lado: ${fuera.join(' · ')}`).toEqual([`${SALIDA} · mock`]);
    const salida = revisarSalida(ARBOL.find((a) => a.ruta === SALIDA)!, CONTAMINADAS);
    expect(salida.isMock, 'el corte es una constante que el build reemplaza').toBe("import.meta.env.VITE_MOCK === '1'");
    expect(salida.fuera, `en index.ts corre al cargar fuera del corte: ${salida.fuera.join(' · ')}`).toEqual([]);
    expect(salida.corte, 'control positivo: la rama `IS_MOCK ? mockApi` existe y se ve').toHaveLength(1);
    expect(salida.exporta, `index.ts exporta algo de la cadena: ${salida.exporta.join(' · ')}`).toEqual([]);
  });

  it('🔴 c · en la cadena, dentro del mock, nada lo ejecuta al cargarse el módulo', () => {
    const cadena = ARBOL.filter((a) => enElMock(a.ruta) && sinExtension(a.ruta) !== MODULO)
      .map((a) => ({ a, nombres: ligaduras(a, CONTAMINADAS).nombres }))
      .filter((x) => x.nombres.size > 0);
    expect(cadena.map((x) => x.a.ruta), 'control positivo: ve a los dos eslabones')
      .toEqual(expect.arrayContaining([`${MOCK}/store.ts`, `${MOCK}/mockApi.ts`]));
    const malos = cadena.flatMap(({ a, nombres }) => alCargar(a.sf, contaminados(a.sf, nombres)).map((id) => `${a.ruta}:${linea(a.sf, id)} ${id.text}`));
    expect(malos, `se ejecuta al cargar el módulo que lo usa: ${malos.join(' · ')}`).toEqual([]);
  });

  it('🔴 d · el módulo no tiene efectos al cargarse y sólo importa `utils/money`', () => {
    const fuente = PRODUCCION[`${MODULO}.ts`]!;
    expect(sentenciasConEfecto(`${MODULO}.ts`, fuente)).toEqual([]);
  });

  it('🔴 e · sus códigos de error son marcas únicas del mock', () => {
    const conMarca = [...new Set(porArchivo.flatMap((a) => a.marcas))];
    expect(conMarca, 'control positivo: el módulo lleva sus dos códigos').toContain(`${MODULO}.ts`);
    expect(CODIGOS.every((c) => PRODUCCION[`${MODULO}.ts`]!.includes(`'${c}'`))).toBe(true);
    const afuera = conMarca.filter((r) => !enElMock(r));
    expect(afuera, `los códigos de «Mi parte» aparecen fuera del mock: ${afuera.join(' · ')}`).toEqual([]);
  });

  it('🔴 SONDA · import, glob y marca: los detectores ven lo que tienen que ver, y lo legítimo no', () => {
    const fuera = '/src/screens/Pantalla.tsx';
    const h = (ruta: string, texto: string) => hallazgos(archivo(ruta, texto));
    const importa = (ruta: string, texto: string) => h(ruta, texto).importa.length > 0;
    expect(importa(fuera, "import { calcular } from '../api/mock/parteDeMesa';")).toBe(true);
    expect(importa(fuera, "export async function f() { return import('../api/mock/parteDeMesa.ts'); }")).toBe(true);
    expect(importa('/src/api/x.ts', "export * from './mock/parteDeMesa';")).toBe(true);
    expect(importa('/src/api/x.ts', "import fuente from './mock/parteDeMesa.ts?raw';")).toBe(true);
    expect(importa('/src/api/x.ts', "import { calcular } from '/src/api/mock/parteDeMesa';")).toBe(true);
    expect(importa(fuera, 'export const f = (m: string) => import(m);'), 'un import() sin literal falla cerrado').toBe(true);
    expect(importa(fuera, "// import { calcular } from '../api/mock/parteDeMesa'")).toBe(false);
    expect(importa(fuera, "const texto = \"import { calcular } from '../api/mock/parteDeMesa'\";")).toBe(false);
    expect(importa(fuera, "import { x } from '../api/mock/parteDeMesaVieja';")).toBe(false);

    const glob = (texto: string) => h(fuera, texto).globs.length;
    expect(glob("const m = import.meta.glob('../api/mock/*.ts');")).toBe(1);
    expect(glob("const m = import.meta.glob('../api/*/*.ts');"), 'sin la palabra mock, el prefijo fijo es ancestro').toBe(1);
    expect(glob("const m = import.meta.glob('../api/{mock,otros}/*.ts');"), 'una llave corta el prefijo fijo').toBe(1);
    expect(glob("const m = import.meta.glob('/src/**/*.svg');"), 'con `**` falla cerrado').toBe(1);
    expect(glob("const m = import.meta.glob(['../assets/*.svg', patron]);"), 'un patrón que no es literal falla cerrado').toBe(1);
    expect(glob('const m = import.meta.glob(`../api/${x}/*.ts`);'), 'una plantilla con huecos falla cerrado').toBe(1);
    expect(glob("const m = import.meta.glob('@/api/*.ts');"), 'un alias falla cerrado').toBe(1);
    expect(glob('const m = import.meta.glob(patron);')).toBe(1);
    expect(glob("const m = import.meta.glob('../assets/*.svg');")).toBe(0);
    expect(glob("const m = import.meta.glob('../api/mockito/*.ts');"), 'un hermano con el mismo prefijo no es el mock').toBe(0);
    expect(glob("const m = import.meta.glob(['../assets/*.svg', '!../api/mock/*.ts']);"), 'una exclusión no suma archivos').toBe(0);

    expect(h(fuera, "throw new Error('parte_mesa_desborde');").marcas).toEqual([fuera]);
    expect(h(fuera, "// 'parte_mesa_desborde'").marcas).toEqual([]);
  });

  it('🔴 SONDA · al cargar: cuentan la IIFE, el callback de una llamada que corre y la función local que lo usa; lo guardado no', () => {
    const mock = '/src/api/mock/store.ts';
    const imp = "import { calcular as calcularParteDeMesa } from './parteDeMesa';\n";
    const cuenta = (texto: string) => usosAlCargar(mock, imp + texto).length;
    // Lo que corre al cargar.
    expect(cuenta("const r = calcularParteDeMesa({ modo: 'igual', P: 1 });")).toBe(1);
    expect(cuenta("export const X = (() => calcularParteDeMesa({ modo: 'igual', P: 1 }))();"), 'una IIFE corre al cargar').toBe(1);
    expect(cuenta('(function () { return calcularParteDeMesa(); })();')).toBe(1);
    expect(cuenta('(() => calcularParteDeMesa()).call(null);')).toBe(1);
    expect(cuenta("[0].map(() => calcularParteDeMesa({ modo: 'igual', P: 1 }));"), 'el callback de una llamada que corre al cargar').toBe(1);
    expect(cuenta('setTimeout(function () { calcularParteDeMesa(); });')).toBe(1);
    expect(cuenta("function parteDeLaMesaMock() { return calcularParteDeMesa({ modo: 'igual', P: 1 }); }\nconst y = parteDeLaMesaMock();"),
      'una función local que lo usa, llamada al cargar').toBe(1);
    expect(cuenta('const a = () => calcularParteDeMesa();\nfunction b() { return a(); }\nexport const c = b();'), 'a dos saltos').toBe(1);
    expect(cuenta('const o = { f() { return calcularParteDeMesa(); } };\nexport const v = o.f();'), 'un método de un literal').toBe(1);
    expect(cuenta('class K { static x = calcularParteDeMesa(); }'), 'un campo estático corre al cargar').toBe(1);
    expect(usosAlCargar(mock, "import * as parte from './parteDeMesa';\nexport const m = parte.mayorResto;")).toHaveLength(1);
    expect(usosAlCargar(mock, "import { calcular } from './parteDeMesa';\nexport { calcular };"), 'reexportarlo lo deja a la vista').toHaveLength(1);
    // Lo que queda guardado y no corre al cargar.
    expect(cuenta("export function f() { return calcularParteDeMesa({ modo: 'igual', P: 1 }); }")).toBe(0);
    expect(cuenta('export function f() { return [0].map(() => calcularParteDeMesa()); }'), 'el callback adentro de una función').toBe(0);
    expect(cuenta('const g = () => calcularParteDeMesa();\nexport function h() { return g(); }')).toBe(0);
    expect(cuenta('export const api = { getMesa: () => calcularParteDeMesa() };')).toBe(0);
    expect(cuenta('export const f = (() => () => calcularParteDeMesa())();'), 'la IIFE devuelve la función sin correrla').toBe(0);
    expect(cuenta('const lista = [() => calcularParteDeMesa()];')).toBe(0);
    expect(cuenta('class K { m() { return calcularParteDeMesa(); } static g = () => calcularParteDeMesa(); }')).toBe(0);
    expect(cuenta('export default () => calcularParteDeMesa();')).toBe(0);
    expect(usosAlCargar(mock, "import type { MiParte } from './parteDeMesa';\nexport let x: MiParte | null = null;")).toEqual([]);
    expect(usosAlCargar(mock, "import { calcular } from './parteDeMesa';\nexport const o = { calcular: 1 };"), 'una clave homónima no es un uso').toEqual([]);
    // De un espacio de nombres cuenta el miembro contaminado, no los demás.
    const alcance = new Map<string, Alcance>([[MODULO, TODO], [`${MOCK}/mockApi`, new Set(['mockGetMesa'])]]);
    expect(usosAlCargar('/src/api/x.ts', "import * as m from './mock/mockApi';\nexport const a = m.MockApiError;", alcance)).toEqual([]);
    expect(usosAlCargar('/src/api/x.ts', "import * as m from './mock/mockApi';\nexport const a = m.mockGetMesa;", alcance)).toHaveLength(1);
    expect(usosAlCargar('/src/api/x.ts', "import * as m from './mock/mockApi';\nexport const a = m;", alcance), 'el espacio entero cuenta').toHaveLength(1);
  });

  it('🔴 SONDA · el cierre sigue la cadena de archivo en archivo dentro del mock y encuentra cada salida', () => {
    const base: Record<string, string> = {
      [`${MODULO}.ts`]: 'export function calcular(): number { return 1; }',
      [`${MOCK}/store.ts`]: "import { calcular as calcularParteDeMesa } from './parteDeMesa';\n"
        + 'function parteDeLaMesaMock() { return calcularParteDeMesa(); }\n'
        + 'export function toMesaDetail() { return { parte: parteDeLaMesaMock() }; }\n'
        + 'export function resetDemo(): number { return 0; }',
      [`${MOCK}/mockApi.ts`]: "import { toMesaDetail } from './store';\n"
        + 'export async function mockGetMesa() { return toMesaDetail(); }\nexport class MockApiError extends Error {}',
      [SALIDA]: "import * as mock from './mock/mockApi';\nexport const IS_MOCK: boolean = import.meta.env.VITE_MOCK === '1';\n"
        + 'const mockApi = { getMesa: () => mock.mockGetMesa() };\nconst realApi = { getMesa: () => null };\n'
        + 'export const api = IS_MOCK ? mockApi : realApi;\nexport const ErrorDelMock = mock.MockApiError;',
      '/src/screens/MasScreen.tsx': "import { resetDemo } from '../api/mock/store';\nexport function Mas() { return resetDemo(); }",
    };
    const arbol = (cambios: Record<string, string> = {}) => Object.entries({ ...base, ...cambios }).map(([r, t]) => archivo(r, t));
    const salen = (cambios: Record<string, string> = {}) => { const a = arbol(cambios); return salidas(a, cierre(a)); };
    const indice = (cambios: Record<string, string> = {}) => {
      const a = arbol(cambios);
      return revisarSalida(a.find((x) => x.ruta === SALIDA)!, cierre(a));
    };

    // El árbol de hoy: la cadena llega a mockApi y sale sólo por index.ts, cortada en `IS_MOCK ?`.
    expect(alcanceDe(`${MOCK}/store`, cierre(arbol()))).toEqual(['toMesaDetail']);
    expect(alcanceDe(`${MOCK}/mockApi`, cierre(arbol()))).toEqual(['mockGetMesa']);
    expect(salen(), '`resetDemo` no alcanza al port: MasScreen no es una salida').toEqual([`${SALIDA} · mock`]);
    expect(indice()).toEqual({ corte: [`${SALIDA}:5 mockApi`], fuera: [], exporta: [], isMock: "import.meta.env.VITE_MOCK === '1'" });

    // El mutante del revisor: store.ts exporta la función local y MasScreen la importa.
    const storeExporta = base[`${MOCK}/store.ts`]!.replace('function parteDeLaMesaMock', 'export function parteDeLaMesaMock');
    expect(salen({
      [`${MOCK}/store.ts`]: storeExporta,
      '/src/screens/MasScreen.tsx': "import { parteDeLaMesaMock } from '../api/mock/store';\nexport function Mas() { return parteDeLaMesaMock(); }",
    })).toContain('/src/screens/MasScreen.tsx · parteDeLaMesaMock');
    // Un salto más: MasScreen importa de mockApi lo que llega por toMesaDetail.
    expect(salen({ '/src/screens/MasScreen.tsx': "import { mockGetMesa } from '../api/mock/mockApi';\nexport const Mas = () => mockGetMesa();" }))
      .toContain('/src/screens/MasScreen.tsx · mockGetMesa');
    // Un puente dentro del mock con `export *` no esconde la cadena.
    expect(salen({
      [`${MOCK}/puente.ts`]: "export * from './store';",
      '/src/screens/MasScreen.tsx': "import { toMesaDetail } from '../api/mock/puente';\nexport const Mas = () => toMesaDetail();",
    })).toContain('/src/screens/MasScreen.tsx · toMesaDetail');
    // Un reexport desde afuera, y un import() dinámico.
    expect(salen({ '/src/api/otro.ts': "export { toMesaDetail } from './mock/store';" })).toContain('/src/api/otro.ts · export toMesaDetail');
    expect(salen({ '/src/screens/MasScreen.tsx': "export async function Mas() { return (await import('../api/mock/mockApi')).mockGetMesa(); }" }))
      .toContain('/src/screens/MasScreen.tsx:1 import()');
    // Sin el corte, la salida corre al cargar y la cadena se exporta.
    const sinCorte = base[SALIDA]!.replace('IS_MOCK ? mockApi : realApi', 'mockApi');
    expect(indice({ [SALIDA]: sinCorte })).toMatchObject({ corte: [], fuera: [`${SALIDA}:5 mockApi`], exporta: ['api'] });
    // Con el corte al revés tampoco vale: la rama del mock queda en el lado falso.
    const alReves = base[SALIDA]!.replace('IS_MOCK ? mockApi : realApi', '!IS_MOCK ? realApi : mockApi');
    expect(indice({ [SALIDA]: alReves })).toMatchObject({ corte: [], exporta: ['api'] });
    // Con `IS_MOCK` fijo, el build ya no tiene qué plegar.
    expect(indice({ [SALIDA]: base[SALIDA]!.replace("import.meta.env.VITE_MOCK === '1'", 'true') }).isMock).toBe('true');
  });

  it('🔴 SONDA · el módulo sin efectos: lo puro pasa, lo que corre o importa otra cosa no', () => {
    const propio = `${MODULO}.ts`;
    expect(sentenciasConEfecto(propio, "import { tipFromBps } from '../../utils/money';\nexport function f() { return tipFromBps(1, 1, 1); }")).toEqual([]);
    expect(sentenciasConEfecto(propio, "export const X = { a: 'b', c: [1, 2] } as const;\nconst g = (x: number) => x;")).toEqual([]);
    expect(sentenciasConEfecto(propio, 'console.log(1);')).toHaveLength(1);
    expect(sentenciasConEfecto(propio, "import { state } from './store';")).toHaveLength(1);
    expect(sentenciasConEfecto(propio, 'export const X = f();')).toHaveLength(1);
    expect(sentenciasConEfecto(propio, 'export let n = 0;')).toHaveLength(1);
  });

  it('control positivo sobre el árbol real: este test lo importa y el detector lo ve', () => {
    const propio = readFileSync(new URL('./parteDeMesa.test.ts', import.meta.url), 'utf8');
    expect(hallazgos(archivo('/src/api/mock/parteDeMesa.test.ts', propio)).importa).toHaveLength(1);
  });
});
