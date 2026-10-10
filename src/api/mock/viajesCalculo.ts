import { fractionAmount, splitEqual } from '../../utils/money';

/**
 * AF-VIAJES · el cálculo de un viaje, **sólo para el mock**. Port de
 * `contract-mirror/services/viajesCalculo.js` (App Backend 2.171.0) y de
 * `precioInformativo` de `services/consumoPropio.js` del dueño.
 *
 * 🔴 La app NO calcula balances ni transferencias: los muestra tal como los
 * publica el dueño (contrato `viajes-v1.json`, «El front espeja»). Esto vive en
 * `mock/` para que el modo de ejemplo responda lo mismo que el dueño, y nada de
 * producto lo importa (`viajesCalculo.test.ts` lo vigila).
 *
 * Todo en centavos enteros.
 */

export const MAX_MIEMBROS = 20;
/** `itemClaims.COMPLETING_TOLERANCE_BPS` del dueño (decisión 81). */
const TOLERANCIA_BPS = 100;

/** `consumoPropio.precioInformativo` del dueño: la porción que completa el plato paga lo que queda. */
export function precioInformativo(linea: number, bps: number, bpsAnteriores: number, montoAnteriores: number): number {
  const queda = Math.max(0, linea - montoAnteriores);
  if (bpsAnteriores + bps >= 10000 - TOLERANCIA_BPS) return queda;
  return Math.min(fractionAmount(linea, bps), queda);
}

/** `informativeSelections.restanteDe` del dueño. */
export function restanteDe(declarado: number): number {
  return 10000 - declarado < TOLERANCIA_BPS ? 0 : 10000 - declarado;
}

export interface TicketParaCalculo {
  readonly id: string;
  readonly forma: 'consumo' | 'iguales' | 'total';
  readonly pagado_por: string;
  readonly monto_cents: number;
  /** D263 · lo que pagó cada uno, en el orden en que se cargaron. Sin la lista, `pagado_por` pagó todo. */
  readonly pagadores?: ReadonlyArray<{ readonly user_id: string; readonly monto_cents: number }>;
  readonly items: ReadonlyArray<{ readonly id: string; readonly line_cents: number }>;
  /** En el orden de los miembros. */
  readonly personas: ReadonlyArray<{ readonly user_id: string; readonly presente: boolean; readonly listo: boolean; readonly vivo: boolean }>;
  /** En el orden (created_at, user_id). */
  readonly selecciones: ReadonlyArray<{ readonly item_id: string; readonly user_id: string; readonly fraction_bps: number }>;
}

/** D263 · los pagadores de un ticket con lo que pagó cada uno (como `pagadoresDe` del dueño). */
export function pagadoresDe(t: Pick<TicketParaCalculo, 'pagado_por' | 'monto_cents' | 'pagadores'>):
  ReadonlyArray<{ readonly user_id: string; readonly monto_cents: number }> {
  const lista = t.pagadores && t.pagadores.length ? t.pagadores : [{ user_id: t.pagado_por, monto_cents: t.monto_cents }];
  if (lista.reduce((s, p) => s + p.monto_cents, 0) !== t.monto_cents) throw new Error('viaje_ticket_pagadores_no_cuadran');
  return lista;
}

/**
 * D263 · `total` en proporción a `pesos` (enteros > 0), en centavos enteros: a cada uno el piso de su parte y lo que
 * sobra, de a un centavo, a los primeros (como `repartirProporcional` del dueño, con BigInt).
 */
export function repartirProporcional(total: number, pesos: readonly number[]): number[] {
  const suma = BigInt(pesos.reduce((s, p) => s + p, 0));
  const partes = pesos.map((p) => Number((BigInt(total) * BigInt(p)) / suma));
  let resto = total - partes.reduce((s, x) => s + x, 0);
  for (let i = 0; resto > 0; i = (i + 1) % partes.length) {
    partes[i]! += 1;
    resto -= 1;
  }
  return partes;
}

export interface ConsumoDelTicket {
  readonly consumo: Map<string, number>;
  readonly asignado: Map<string, number>;
  readonly sinRepartir: number;
  readonly faltan: string[];
}

const sumar = (m: Map<string, number>, k: string, v: number) => { if (v) m.set(k, (m.get(k) ?? 0) + v); };

export function consumoDelTicket(t: TicketParaCalculo, { cierre = false } = {}): ConsumoDelTicket {
  const consumo = new Map<string, number>();
  const asignado = new Map<string, number>();
  if (!Number.isSafeInteger(t.monto_cents) || t.monto_cents <= 0) throw new Error('viaje_ticket_monto_invalido');
  if (t.forma === 'total') {
    // D263: con varios pagadores, cada uno consumió lo que pagó.
    for (const p of pagadoresDe(t)) sumar(consumo, p.user_id, p.monto_cents);
    return { consumo, asignado, sinRepartir: 0, faltan: [] };
  }
  if (t.forma === 'iguales') {
    const presentes = t.personas.filter((p) => p.presente);
    if (!presentes.length) throw new Error('viaje_ticket_sin_presentes');
    splitEqual(t.monto_cents, presentes.length).forEach((c, i) => sumar(consumo, presentes[i]!.user_id, c));
    return { consumo, asignado, sinRepartir: 0, faltan: [] };
  }
  const lineas = new Map(t.items.map((i) => [i.id, i.line_cents]));
  const acumulado = new Map<string, { bps: number; monto: number }>();
  for (const s of t.selecciones) {
    const linea = lineas.get(s.item_id);
    if (linea === undefined) throw new Error('viaje_seleccion_item_desconocido');
    const previo = acumulado.get(s.item_id) ?? { bps: 0, monto: 0 };
    const precio = precioInformativo(linea, s.fraction_bps, previo.bps, previo.monto);
    acumulado.set(s.item_id, { bps: previo.bps + s.fraction_bps, monto: previo.monto + precio });
    sumar(consumo, s.user_id, precio);
  }
  const elegido = [...consumo.values()].reduce((x, c) => x + c, 0);
  let sinRepartir = t.monto_cents - elegido;
  if (sinRepartir < 0) throw new Error('viaje_ticket_no_cuadra');
  const faltan = t.personas.filter((p) => !p.listo).map((p) => p.user_id);
  if (cierre && sinRepartir > 0) {
    const vivos = t.personas.filter((p) => p.vivo);
    const sinElegir = vivos.filter((p) => !p.listo);
    const receptores = sinElegir.length ? sinElegir : vivos.length ? vivos : t.personas;
    if (!receptores.length) throw new Error('viaje_ticket_sin_personas');
    splitEqual(sinRepartir, receptores.length).forEach((c, i) => {
      sumar(consumo, receptores[i]!.user_id, c);
      sumar(asignado, receptores[i]!.user_id, c);
    });
    sinRepartir = 0;
  }
  return { consumo, asignado, sinRepartir, faltan };
}

export interface BalanceDelViaje {
  readonly balance: Map<string, number>;
  readonly pagado: Map<string, number>;
  readonly consumido: Map<string, number>;
  readonly gasto: number;
  readonly porTicket: Map<string, ConsumoDelTicket>;
}

export function balanceDelViaje(miembros: readonly string[], tickets: readonly TicketParaCalculo[], { cierre = false } = {}): BalanceDelViaje {
  const balance = new Map(miembros.map((m) => [m, 0]));
  const pagado = new Map<string, number>();
  const consumido = new Map<string, number>();
  const porTicket = new Map<string, ConsumoDelTicket>();
  let gasto = 0;
  for (const t of tickets) {
    const r = consumoDelTicket(t, { cierre });
    porTicket.set(t.id, r);
    gasto += t.monto_cents;
    // A quien pagó se le acredita lo asignado: en vivo, lo no elegido no es de nadie.
    const acreditado = t.monto_cents - r.sinRepartir;
    // D263: con varios, en proporción a lo que pagó cada uno.
    const pagadores = pagadoresDe(t);
    const partes = repartirProporcional(acreditado, pagadores.map((p) => p.monto_cents));
    pagadores.forEach((p, i) => {
      sumar(pagado, p.user_id, partes[i]!);
      balance.set(p.user_id, (balance.get(p.user_id) ?? 0) + partes[i]!);
    });
    for (const [u, c] of r.consumo) {
      sumar(consumido, u, c);
      balance.set(u, (balance.get(u) ?? 0) - c);
    }
  }
  const suma = [...balance.values()].reduce((x, c) => x + c, 0);
  if (suma !== 0 || ![...balance.values()].every(Number.isSafeInteger)) throw new Error('viaje_balance_no_cuadra');
  return { balance, pagado, consumido, gasto, porTicket };
}

/**
 * El mínimo número de transferencias, exacto, por programación dinámica sobre
 * subconjuntos (n ≤ 20). Mismos desempates que el dueño: misma entrada, misma
 * salida. El voraz sobre todos a la vez no es mínimo: `[+3, −3, +3, +2, +2, −7]`
 * le da 5 y el mínimo es 4.
 */
export function transferenciasMinimas(balances: ReadonlyArray<{ readonly id: string; readonly cents: number }>):
  Array<{ de: string; a: string; monto_cents: number }> {
  if (!balances.every((b) => Number.isSafeInteger(b.cents))) throw new Error('viaje_balance_invalido');
  if (balances.reduce((s, b) => s + b.cents, 0) !== 0) throw new Error('viaje_balance_no_cuadra');
  const nz = balances.filter((b) => b.cents !== 0);
  const n = nz.length;
  if (n === 0) return [];
  if (n > MAX_MIEMBROS) throw new Error('viaje_demasiados_miembros');
  const total = (1 << n) - 1;
  const suma = new Float64Array(total + 1);
  for (let m = 1; m <= total; m++) {
    const i = 31 - Math.clz32(m & -m);
    suma[m] = suma[m & (m - 1)]! + nz[i]!.cents;
  }
  const dp = new Int8Array(total + 1);
  const quitado = new Int8Array(total + 1);
  for (let m = 1; m <= total; m++) {
    let mejor = -1; let cual = -1;
    for (let i = 0; i < n; i++) {
      if ((m & (1 << i)) && dp[m ^ (1 << i)]! > mejor) { mejor = dp[m ^ (1 << i)]!; cual = i; }
    }
    dp[m] = mejor + (suma[m] === 0 ? 1 : 0);
    quitado[m] = cual;
  }
  // La cadena de quitados, leída de adentro hacia afuera, corta un grupo cada vez que lo acumulado suma 0.
  const orden: number[] = [];
  for (let m = total; m; m ^= (1 << quitado[m]!)) orden.push(quitado[m]!);
  const grupos: number[][] = [];
  let grupo: number[] = []; let acumulado = 0;
  for (let k = orden.length - 1; k >= 0; k--) {
    grupo.push(orden[k]!);
    acumulado += nz[orden[k]!]!.cents;
    if (acumulado === 0) { grupos.push(grupo); grupo = []; }
  }
  if (grupo.length || grupos.length !== dp[total]) throw new Error('viaje_balance_no_cuadra');
  // Los grupos salen en el orden de su primer miembro.
  grupos.sort((x, y) => Math.min(...x) - Math.min(...y));
  const salida: Array<{ de: string; a: string; monto_cents: number }> = [];
  for (const g of grupos) {
    const resto = g.map((i) => ({ i, c: nz[i]!.cents }));
    for (;;) {
      const deudor = resto.filter((x) => x.c < 0).sort((x, y) => x.c - y.c || x.i - y.i)[0];
      if (!deudor) break;
      const acreedor = resto.filter((x) => x.c > 0).sort((x, y) => y.c - x.c || x.i - y.i)[0]!;
      const monto = Math.min(-deudor.c, acreedor.c);
      salida.push({ de: nz[deudor.i]!.id, a: nz[acreedor.i]!.id, monto_cents: monto });
      deudor.c += monto;
      acreedor.c -= monto;
    }
  }
  return salida;
}
