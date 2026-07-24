/**
 * utils/money.js — Helpers de manejo de dinero en centavos
 *
 * FIX m1: las funciones de aritmética usan integer-arithmetic seguro.
 * Las inputs string se parsean con cuidado: "210.45" → 21045 sin pasar
 * por el float `21.045` (que se redondearía mal). Convertimos por separado
 * la parte entera y los centavos.
 */
'use strict';

const CURRENCY = 'mxn';
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;  // 9.007e15 — más que suficiente

/**
 * Convierte string|number a centavos (integer).
 *   "210"    → 21000
 *   "210.5"  → 21050
 *   "210.45" → 21045
 *   210.45   → 21045
 */
function stringToCents(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Invalid amount: ${input}`);
    return Math.round(input * 100);
  }
  if (typeof input !== 'string') {
    throw new TypeError('stringToCents requires string|number');
  }
  const clean = input.replace(/[^0-9.\-]/g, '');
  if (!clean || !/^-?\d+(\.\d{1,2})?$/.test(clean)) {
    throw new Error(`Invalid amount format: ${input}`);
  }
  const negative = clean.startsWith('-');
  const abs = negative ? clean.slice(1) : clean;
  const [intPart, decPart = ''] = abs.split('.');
  const dec = (decPart + '00').slice(0, 2);  // padding a 2 dígitos
  const totalStr = `${intPart}${dec}`;
  const total = Number(totalStr);
  if (!Number.isFinite(total) || total > MAX_SAFE_CENTS) {
    throw new Error(`Amount overflow: ${input}`);
  }
  return negative ? -total : total;
}

/** 21000 → "210.00" */
function centsToString(c) {
  if (typeof c === 'bigint') c = Number(c);
  if (typeof c !== 'number') throw new TypeError('centsToString requires number|bigint');
  const neg = c < 0;
  const abs = Math.abs(c);
  const major = Math.floor(abs / 100);
  const minor = (abs % 100).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${major}.${minor}`;
}

/** 21000 → "$210.00" */
function centsToDisplay(c) {
  return `$${centsToString(c)}`;
}

/** Suma segura en centavos (acepta number|bigint|string-numéricos). */
function sumCents(...values) {
  let total = 0;
  for (const v of values) {
    const n = typeof v === 'bigint' ? Number(v) : Number(v || 0);
    if (!Number.isFinite(n)) throw new Error(`Invalid amount in sum: ${v}`);
    total += n;
  }
  return total;
}

/** Fee en centavos. fee_pct entre 0 y 1 (0.02 = 2%). */
function calculateFee(grossCents, feePct) {
  const pct = Number(feePct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1) throw new Error('fee_pct out of range');
  return Math.round(Number(grossCents) * pct);
}

/**
 * División igualitaria entre N personas con manejo determinístico de remainder.
 * El primer comensal absorbe los centavos sobrantes.
 *   splitEqual(840_00, 4) → [21000, 21000, 21000, 21000]
 *   splitEqual(841_00, 4) → [21025, 21025, 21025, 21025]  (84100/4 = 21025)
 *   splitEqual(842_00, 4) → [21050, 21050, 21050, 21050]
 *   splitEqual(840_01, 4) → [21001, 21000, 21000, 21000]
 */
function splitEqual(totalCents, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be positive integer');
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('totalCents must be non-negative integer');
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - (base * n);
  const parts = new Array(n).fill(base);
  for (let i = 0; i < remainder; i++) parts[i] += 1;
  return parts;
}

/**
 * D7 (v2.17): propina por % sobre base partes-iguales.
 *   tip = round( (total/N) × bps/10000 )
 * en UN solo paso de aritmética entera (no se redondea la base primero: menos
 * error acumulado). Para montos >= 0, Math.round es exactamente
 * half-away-from-zero (la mitad de centavo sube). bps 0..10000 = 0..100% de
 * la parte del comensal (tope ratificado 2026-07-23; el monto a mano va por
 * tip_cents, sin bps).
 * Rango seguro: totalCents×bps < 2^53 con totales reales de restaurante.
 */
function tipFromBps(totalCents, n, bps) {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('totalCents must be non-negative integer');
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be positive integer');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error('bps out of range (0-10000)');
  return Math.round((totalCents * bps) / (n * 10000));
}

/**
 * v2.18 (fracciones): precio NOMINAL de una fracción de un ítem —
 * round(price × bps/10000), misma familia de redondeo que tipFromBps (para
 * montos >= 0, half-away-from-zero). La fracción que COMPLETA el ítem no usa
 * esto: ajusta (price − suma de las demás) para que el total cierre exacto —
 * esa cuenta vive en services/itemClaims.js.
 */
function fractionAmount(priceCents, fractionBps) {
  return tipFromBps(priceCents, 1, fractionBps);
}

module.exports = {
  CURRENCY,
  stringToCents, centsToString, centsToDisplay,
  sumCents, calculateFee, splitEqual, tipFromBps, fractionAmount,
};
