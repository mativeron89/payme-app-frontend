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
 *
 * v2.181.0 · D278-2 y D284 · el TOTAL IMPRESO del ticket (`totalDelTicket`) = renglones (`monto_cents`) + servicio + IVA
 * aparte − descuentos. Es lo que pagó quien pagó y lo que se reparte: en «por lo que pidió cada uno», en proporción a lo
 * consumido de los renglones (`repartirPorMayorResto`; abierto, lo no elegido es un bloque más y su parte queda sin
 * repartir); en «iguales», por partes iguales; en «total», a quien pagó; el personal, entero a su dueño. `platos` es la
 * parte de los renglones. Sin ajustes, todo sale igual que antes. Port de `viajesCalculo.js` 2.181.0 (`b3699c9`).
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
  /** D276 · quien lo cargó, si no es quien lo pagó (como `cargado_por` del dueño). */
  readonly cargado_por?: string;
  readonly monto_cents: number;
  /** D263 · lo que pagó cada uno, en el orden en que se cargaron. Sin la lista, `pagado_por` pagó todo (el total). */
  readonly pagadores?: ReadonlyArray<{ readonly user_id: string; readonly monto_cents: number }>;
  /** D278-2 · D284 · los ajustes del recibo; sin ellos (lo viejo, un cliente ≤ 8, un gasto a mano), 0. */
  readonly servicio_cents?: number;
  readonly descuentos_cents?: number;
  readonly iva_aparte_cents?: number;
  readonly items: ReadonlyArray<{ readonly id: string; readonly line_cents: number }>;
  /** En el orden de los miembros. */
  readonly personas: ReadonlyArray<{ readonly user_id: string; readonly presente: boolean; readonly listo: boolean; readonly vivo: boolean }>;
  /** En el orden (created_at, user_id). */
  readonly selecciones: ReadonlyArray<{ readonly item_id: string; readonly user_id: string; readonly fraction_bps: number }>;
}

type ConAjustes = Pick<TicketParaCalculo, 'monto_cents' | 'servicio_cents' | 'descuentos_cents' | 'iva_aparte_cents'>;

/** v2.181.0 · `totalDelTicket` del dueño: los renglones más el servicio y el IVA aparte, menos los descuentos. */
export function totalDelTicket(t: ConAjustes): number {
  const total = t.monto_cents + (t.servicio_cents ?? 0) + (t.iva_aparte_cents ?? 0) - (t.descuentos_cents ?? 0);
  if (!Number.isSafeInteger(total) || total <= 0) throw new Error('viaje_ticket_monto_invalido');
  return total;
}

/**
 * v2.181.0 · `repartirPorMayorResto` del dueño: `total` en proporción a `pesos` (enteros ≥ 0, alguno > 0); a cada uno el
 * piso de su parte y los centavos que faltan a los restos más grandes (en empate, al primero). Con BigInt.
 */
export function repartirPorMayorResto(total: number, pesos: readonly number[]): number[] {
  const W = pesos.reduce((s, p) => s + BigInt(p), 0n);
  if (W <= 0n) throw new Error('viaje_reparto_sin_pesos');
  const T = BigInt(total);
  const partes = pesos.map((p) => (T * BigInt(p)) / W);
  const restos = pesos.map((p, i) => ({ i, r: (T * BigInt(p)) % W }))
    .sort((x, y) => (y.r > x.r ? 1 : y.r < x.r ? -1 : x.i - y.i));
  let faltan = T - partes.reduce((s, x) => s + x, 0n);
  for (let k = 0; faltan > 0n; k += 1, faltan -= 1n) partes[restos[k]!.i]! += 1n;
  return partes.map(Number);
}

/**
 * v2.181.0 · `ajustesDeRecibo` del dueño, sobre el recibo del mock (`items` como `[huella, precio, cantidad]`, `t` =
 * `[subtotal, IVA | null]` o null, `d` los descuentos y `s` los cargos por servicio). El IVA es aparte sólo si los
 * renglones suman el subtotal (o el subtotal más los descuentos, si el subtotal ya viene descontado); ambiguo (IVA
 * incluido con un descuento igual al IVA), no se agrega.
 */
export function ajustesDeRecibo(recibo: {
  readonly items: ReadonlyArray<readonly [unknown, number, number]>;
  readonly totales: { readonly subtotal_cents: number; readonly tax_cents?: number } | null;
  readonly descuentos: readonly number[] | null;
  readonly servicios?: readonly number[] | null;
}): { servicio_cents: number; descuentos_cents: number; iva_aparte_cents: number } {
  const suma = (xs: readonly number[] | null | undefined) => (xs ?? []).reduce((s, c) => s + c, 0);
  const servicio = suma(recibo.servicios);
  const descuentos = suma(recibo.descuentos);
  const renglones = recibo.items.reduce((s, [, precio, cantidad]) => s + precio * cantidad, 0);
  const t = recibo.totales;
  const iva = t?.tax_cents ?? 0;
  const aparte = !!t && iva > 0 && (t.subtotal_cents === renglones
    || (t.subtotal_cents === renglones - descuentos && descuentos !== iva));
  return { servicio_cents: servicio, descuentos_cents: descuentos, iva_aparte_cents: aparte ? iva : 0 };
}

/** D263 · los pagadores de un ticket con lo que pagó cada uno (como `pagadoresDe` del dueño; v2.181.0: suman el total). */
export function pagadoresDe(t: Pick<TicketParaCalculo, 'pagado_por' | 'pagadores'> & ConAjustes):
  ReadonlyArray<{ readonly user_id: string; readonly monto_cents: number }> {
  const total = totalDelTicket(t);
  const lista = t.pagadores && t.pagadores.length ? t.pagadores : [{ user_id: t.pagado_por, monto_cents: total }];
  if (lista.reduce((s, p) => s + p.monto_cents, 0) !== total) throw new Error('viaje_ticket_pagadores_no_cuadran');
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
  /** v2.181.0 · lo de cada uno del TOTAL impreso (sin ajustes, los renglones). */
  readonly consumo: Map<string, number>;
  /** v2.181.0 · lo de cada uno de los renglones, sin su parte del ajuste. */
  readonly platos: Map<string, number>;
  readonly asignado: Map<string, number>;
  readonly sinRepartir: number;
  readonly faltan: string[];
  /** D276 · un gasto personal: todo de su dueño, fuera del balance del viaje. */
  readonly personal?: true;
}

/**
 * v2.179.0 · D276 · `esPersonal` del dueño: el único presente es quien lo cargó (sin `cargado_por`, quien lo pagó) y lo
 * pagó él solo. Si lo pagó otro, no es personal: es una deuda. Es la ÚNICA definición.
 */
export function esPersonal(t: Pick<TicketParaCalculo, 'pagado_por' | 'cargado_por' | 'pagadores' | 'personas'>): boolean {
  const duenio = t.cargado_por ?? t.pagado_por;
  const presentes = t.personas.filter((p) => p.presente);
  const pagadores = t.pagadores && t.pagadores.length ? t.pagadores : [{ user_id: t.pagado_por }];
  return presentes.length === 1 && presentes[0]!.user_id === duenio
    && pagadores.length === 1 && pagadores[0]!.user_id === duenio;
}

const sumar = (m: Map<string, number>, k: string, v: number) => { if (v) m.set(k, (m.get(k) ?? 0) + v); };

export function consumoDelTicket(t: TicketParaCalculo, { cierre = false } = {}): ConsumoDelTicket {
  const consumo = new Map<string, number>();
  const asignado = new Map<string, number>();
  if (!Number.isSafeInteger(t.monto_cents) || t.monto_cents <= 0) throw new Error('viaje_ticket_monto_invalido');
  // v2.181.0 · D278-2: lo que se reparte es el total impreso; `platos`, la parte de los renglones.
  const total = totalDelTicket(t);
  const platos = new Map<string, number>();
  // D276: el personal es todo de su dueño, en cualquier forma y sin elegir.
  if (esPersonal(t)) {
    sumar(consumo, t.cargado_por ?? t.pagado_por, total);
    sumar(platos, t.cargado_por ?? t.pagado_por, t.monto_cents);
    return { consumo, platos, asignado, sinRepartir: 0, faltan: [], personal: true };
  }
  if (t.forma === 'total') {
    // D263: con varios pagadores, cada uno consumió lo que pagó (los renglones, en la misma proporción).
    const pagos = pagadoresDe(t);
    for (const p of pagos) sumar(consumo, p.user_id, p.monto_cents);
    repartirPorMayorResto(t.monto_cents, pagos.map((p) => p.monto_cents)).forEach((c, i) => sumar(platos, pagos[i]!.user_id, c));
    return { consumo, platos, asignado, sinRepartir: 0, faltan: [] };
  }
  if (t.forma === 'iguales') {
    const presentes = t.personas.filter((p) => p.presente);
    if (!presentes.length) throw new Error('viaje_ticket_sin_presentes');
    splitEqual(total, presentes.length).forEach((c, i) => sumar(consumo, presentes[i]!.user_id, c));
    splitEqual(t.monto_cents, presentes.length).forEach((c, i) => sumar(platos, presentes[i]!.user_id, c));
    return { consumo, platos, asignado, sinRepartir: 0, faltan: [] };
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
  // D276: sólo los presentes faltan y reciben lo no elegido al cerrar.
  const presentes = t.personas.filter((p) => p.presente);
  const faltan = presentes.filter((p) => !p.listo).map((p) => p.user_id);
  if (cierre && sinRepartir > 0) {
    const vivos = presentes.filter((p) => p.vivo);
    const sinElegir = vivos.filter((p) => !p.listo);
    const receptores = sinElegir.length ? sinElegir : vivos.length ? vivos : presentes;
    if (!receptores.length) throw new Error('viaje_ticket_sin_personas');
    splitEqual(sinRepartir, receptores.length).forEach((c, i) => {
      sumar(consumo, receptores[i]!.user_id, c);
      sumar(asignado, receptores[i]!.user_id, c);
    });
    sinRepartir = 0;
  }
  // Hasta acá, `consumo` son los renglones. Sin ajustes, es también lo que se reparte, como siempre.
  if (total === t.monto_cents) return { consumo, platos: consumo, asignado, sinRepartir, faltan };
  // v2.181.0 · D278-2: el total impreso, en proporción a lo de los renglones, por mayor resto en el orden de los miembros;
  // abierto, lo no elegido es un bloque más (al final) y su parte queda sin repartir.
  const orden = [...t.personas.map((p) => p.user_id).filter((u) => consumo.has(u)),
    ...[...consumo.keys()].filter((u) => !t.personas.some((p) => p.user_id === u))];
  const pesos = [...orden.map((u) => consumo.get(u)!), ...(sinRepartir > 0 ? [sinRepartir] : [])];
  const partes = repartirPorMayorResto(total, pesos);
  const conAjuste = new Map<string, number>();
  orden.forEach((u, i) => sumar(conAjuste, u, partes[i]!));
  return { consumo: conAjuste, platos: consumo, asignado, sinRepartir: sinRepartir > 0 ? partes[orden.length]! : 0, faltan };
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
    // D276: el personal no suma al gasto del grupo ni mueve balances.
    if (r.personal) continue;
    // v2.181.0 · D278-2: el gasto y lo pagado son el total impreso.
    const total = totalDelTicket(t);
    gasto += total;
    // A quien pagó se le acredita lo asignado: en vivo, lo no elegido no es de nadie.
    const acreditado = total - r.sinRepartir;
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
