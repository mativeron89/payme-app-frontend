/**
 * services/viajesCalculo.js — v2.171.0 · AB-VIAJES · el cálculo de un viaje, PURO (sin base ni reloj).
 *
 * Decisión 242 de Mati y el plan del Bibliotecario (OK 2026-10-09T03:31:25Z). PayMe no mueve dinero: esto sólo
 * calcula quién le debe a quién; cada uno transfiere desde su banco y lo marca. Todo en centavos enteros.
 *
 * ─── Lo que consume cada uno en un ticket (`consumoDelTicket`) ──────────────────────────────────────────────────
 *   · «Pagar el total» (`total`): todo a quien pagó. A los demás no les toca nada.
 *   · «En partes iguales» (`iguales`): `money.splitEqual` entre los presentes (D242-6: todos marcados, se
 *     destilda a quien no estuvo), en el orden de los miembros. El centavo de más va a los primeros.
 *   · «Por lo que pidió cada uno» (`consumo`): las porciones, como en la mesa. Cada plato se recorre en el orden
 *     de las selecciones (created_at, user_id) con `consumoPropio.precioInformativo`: la porción nominal es
 *     `fractionAmount` (half-up) y la que completa el plato (tolerancia de 100 bps) paga lo que queda, así lo de
 *     todos suma exactamente la línea.
 *       – En vivo, lo que nadie eligió no es de nadie (`sinRepartir`): a quien pagó sólo se le acredita lo
 *         asignado, así la suma de los balances da 0 también mientras se elige.
 *       – Al cerrar (D242-4), lo no elegido se reparte en partes iguales entre quienes NO eligieron en ese ticket
 *         («Listo» sin tocar). Si todos eligieron (V4), entre todos los del ticket. Una cuenta dada de baja (V5)
 *         no recibe mientras quede alguien vivo; si no queda nadie vivo, entre todos, para que la suma cuadre.
 *
 * ─── El balance (`balanceDelViaje`) ─────────────────────────────────────────────────────────────────────────────
 *   pagó − consumió, por miembro. Invariante: la suma da 0, o lanza `viaje_balance_no_cuadra` (falla cerrado).
 *
 * ─── Las transferencias mínimas (`transferenciasMinimas`) ───────────────────────────────────────────────────────
 *   El mínimo número de transferencias para saldar n balances distintos de 0 es n − (el máximo número de grupos
 *   en que se pueden partir con suma 0): cada grupo de k se salda con k − 1 y no con menos. Se calcula EXACTO con
 *   programación dinámica sobre subconjuntos (2^n, n ≤ 20 miembros): dp[m] = máx dp[m sin i] + (suma(m) = 0).
 *   Dentro de cada grupo, el mayor deudor le paga al mayor acreedor lo que alcance, hasta saldarlo; cada paso
 *   salda a uno, y el último a dos.
 *   Desempate, siempre por el ORDEN DE LOS MIEMBROS (el de la entrada): al armar los grupos gana el índice más
 *   bajo; los grupos salen en el orden de su primer miembro; entre deudores (o acreedores) con el mismo monto, el
 *   que va primero. Misma entrada, misma salida.
 *   El voraz sobre todos a la vez no es mínimo: [+3, −3, +3, +2, +2, −7] le da 5 y el mínimo es 4.
 */
'use strict';

const { splitEqual } = require('../utils/money');
const { precioInformativo } = require('./consumoPropio');

const MAX_MIEMBROS = 20;

function error(code) {
  return new Error(code);
}

const sumar = (m, k, v) => { if (v) m.set(k, (m.get(k) || 0) + v); };

/**
 * @param {{forma:'consumo'|'iguales'|'total', pagado_por:string, monto_cents:number,
 *   items:Array<{id:string, line_cents:number}>,
 *   personas:Array<{user_id:string, presente:boolean, listo:boolean, vivo:boolean}>,
 *   selecciones:Array<{item_id:string, user_id:string, fraction_bps:number}>}} t
 *   `personas` en el orden de los miembros; `selecciones` en el orden (created_at, user_id).
 * @returns {{consumo:Map<string,number>, asignado:Map<string,number>, sinRepartir:number, faltan:string[]}}
 */
function consumoDelTicket(t, { cierre = false } = {}) {
  const consumo = new Map();
  const asignado = new Map();
  if (!Number.isSafeInteger(t.monto_cents) || t.monto_cents <= 0) throw error('viaje_ticket_monto_invalido');
  if (t.forma === 'total') {
    sumar(consumo, t.pagado_por, t.monto_cents);
    return { consumo, asignado, sinRepartir: 0, faltan: [] };
  }
  if (t.forma === 'iguales') {
    const presentes = t.personas.filter((p) => p.presente);
    if (!presentes.length) throw error('viaje_ticket_sin_presentes');
    splitEqual(t.monto_cents, presentes.length).forEach((c, i) => sumar(consumo, presentes[i].user_id, c));
    return { consumo, asignado, sinRepartir: 0, faltan: [] };
  }
  if (t.forma !== 'consumo') throw error('viaje_ticket_forma_invalida');
  const lineas = new Map(t.items.map((i) => [i.id, i.line_cents]));
  const acumulado = new Map();
  for (const s of t.selecciones) {
    const linea = lineas.get(s.item_id);
    if (linea === undefined) throw error('viaje_seleccion_item_desconocido');
    const previo = acumulado.get(s.item_id) || { bps: 0, monto: 0 };
    const precio = precioInformativo(linea, s.fraction_bps, previo.bps, previo.monto);
    acumulado.set(s.item_id, { bps: previo.bps + s.fraction_bps, monto: previo.monto + precio });
    sumar(consumo, s.user_id, precio);
  }
  const elegido = [...consumo.values()].reduce((x, c) => x + c, 0);
  let sinRepartir = t.monto_cents - elegido;
  if (sinRepartir < 0) throw error('viaje_ticket_no_cuadra');
  const faltan = t.personas.filter((p) => !p.listo).map((p) => p.user_id);
  if (cierre && sinRepartir > 0) {
    const vivos = t.personas.filter((p) => p.vivo);
    const sinElegir = vivos.filter((p) => !p.listo);
    const receptores = sinElegir.length ? sinElegir : vivos.length ? vivos : t.personas;
    if (!receptores.length) throw error('viaje_ticket_sin_personas');
    splitEqual(sinRepartir, receptores.length).forEach((c, i) => {
      sumar(consumo, receptores[i].user_id, c);
      sumar(asignado, receptores[i].user_id, c);
    });
    sinRepartir = 0;
  }
  return { consumo, asignado, sinRepartir, faltan };
}

/**
 * @param {string[]} miembros ids en el orden de los miembros
 * @param {Array} tickets ver `consumoDelTicket`
 * @returns {{balance:Map, pagado:Map, consumido:Map, gasto:number, porTicket:Map}}
 */
function balanceDelViaje(miembros, tickets, { cierre = false } = {}) {
  const balance = new Map(miembros.map((m) => [m, 0]));
  const pagado = new Map();
  const consumido = new Map();
  const porTicket = new Map();
  let gasto = 0;
  for (const t of tickets) {
    const r = consumoDelTicket(t, { cierre });
    porTicket.set(t.id, r);
    gasto += t.monto_cents;
    // A quien pagó se le acredita lo asignado: en vivo, lo no elegido no es de nadie.
    const acreditado = t.monto_cents - r.sinRepartir;
    sumar(pagado, t.pagado_por, acreditado);
    balance.set(t.pagado_por, (balance.get(t.pagado_por) || 0) + acreditado);
    for (const [u, c] of r.consumo) {
      sumar(consumido, u, c);
      balance.set(u, (balance.get(u) || 0) - c);
    }
  }
  const suma = [...balance.values()].reduce((x, c) => x + c, 0);
  if (suma !== 0 || ![...balance.values()].every(Number.isSafeInteger)) throw error('viaje_balance_no_cuadra');
  return { balance, pagado, consumido, gasto, porTicket };
}

/**
 * @param {Array<{id:string, cents:number}>} balances en el orden de los miembros; positivo = le deben
 * @returns {Array<{de:string, a:string, monto_cents:number}>}
 */
function transferenciasMinimas(balances) {
  if (!balances.every((b) => Number.isSafeInteger(b.cents))) throw error('viaje_balance_invalido');
  if (balances.reduce((s, b) => s + b.cents, 0) !== 0) throw error('viaje_balance_no_cuadra');
  const nz = balances.filter((b) => b.cents !== 0);
  const n = nz.length;
  if (n === 0) return [];
  if (n > MAX_MIEMBROS) throw error('viaje_demasiados_miembros');
  const total = (1 << n) - 1;
  const suma = new Float64Array(total + 1);
  for (let m = 1; m <= total; m++) {
    const i = 31 - Math.clz32(m & -m);
    suma[m] = suma[m & (m - 1)] + nz[i].cents;
  }
  const dp = new Int8Array(total + 1);
  const quitado = new Int8Array(total + 1);
  for (let m = 1; m <= total; m++) {
    let mejor = -1; let cual = -1;
    for (let i = 0; i < n; i++) {
      if ((m & (1 << i)) && dp[m ^ (1 << i)] > mejor) { mejor = dp[m ^ (1 << i)]; cual = i; }
    }
    dp[m] = mejor + (suma[m] === 0 ? 1 : 0);
    quitado[m] = cual;
  }
  // La cadena de quitados, leída de adentro hacia afuera, corta un grupo cada vez que lo acumulado suma 0.
  const orden = [];
  for (let m = total; m; m ^= (1 << quitado[m])) orden.push(quitado[m]);
  const grupos = [];
  let grupo = []; let acumulado = 0;
  for (let k = orden.length - 1; k >= 0; k--) {
    grupo.push(orden[k]);
    acumulado += nz[orden[k]].cents;
    if (acumulado === 0) { grupos.push(grupo); grupo = []; }
  }
  if (grupo.length || grupos.length !== dp[total]) throw error('viaje_balance_no_cuadra');
  // Los grupos salen en el orden de su primer miembro.
  grupos.sort((x, y) => Math.min(...x) - Math.min(...y));
  const salida = [];
  for (const g of grupos) {
    const resto = g.map((i) => ({ i, c: nz[i].cents }));
    for (;;) {
      const deudor = resto.filter((x) => x.c < 0).sort((x, y) => x.c - y.c || x.i - y.i)[0];
      if (!deudor) break;
      const acreedor = resto.filter((x) => x.c > 0).sort((x, y) => y.c - x.c || x.i - y.i)[0];
      const monto = Math.min(-deudor.c, acreedor.c);
      salida.push({ de: nz[deudor.i].id, a: nz[acreedor.i].id, monto_cents: monto });
      deudor.c += monto;
      acreedor.c -= monto;
    }
  }
  return salida;
}

module.exports = { MAX_MIEMBROS, consumoDelTicket, balanceDelViaje, transferenciasMinimas };
