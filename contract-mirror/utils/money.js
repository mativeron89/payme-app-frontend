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
    // La notación exponencial no es un importe de API válido: String(1e21)
    // la revelaría y el parser la rechaza antes de cualquier coerción.
    return stringToCents(String(input));
  }
  if (typeof input !== 'string') {
    throw new TypeError('stringToCents requires string|number');
  }
  // Un único símbolo $ opcional al comienzo; no se "limpia" basura porque
  // $1,000, 1e3 o $$1 cambian el monto interpretado.
  const match = input.match(/^(-)?\$?(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new Error(`Invalid amount format: ${input}`);
  }
  const negative = !!match[1];
  const intPart = match[2];
  const decPart = match[3] || '';
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
  if (typeof c === 'bigint') {
    if (c > BigInt(MAX_SAFE_CENTS) || c < -BigInt(MAX_SAFE_CENTS)) throw new Error('cents overflow');
    c = Number(c);
  }
  if (typeof c !== 'number') throw new TypeError('centsToString requires number|bigint');
  if (!Number.isSafeInteger(c)) throw new Error('cents must be a safe integer');
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
    if (typeof v === 'bigint' && (v > BigInt(MAX_SAFE_CENTS) || v < -BigInt(MAX_SAFE_CENTS))) {
      throw new Error(`Invalid cents in sum: ${v}`);
    }
    const n = typeof v === 'bigint' ? Number(v) : Number(v || 0);
    if (!Number.isSafeInteger(n)) throw new Error(`Invalid cents in sum: ${v}`);
    total += n;
    if (!Number.isSafeInteger(total)) throw new Error('Cents sum overflow');
  }
  return total;
}

/** Fee en centavos. fee_pct entre 0 y 1 (0.02 = 2%). */
function calculateFee(grossCents, feePct) {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) throw new Error('gross_cents must be a non-negative safe integer');
  const pct = Number(feePct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1) throw new Error('fee_pct out of range');
  const bps = Math.round(pct * 10_000);
  if (!Number.isSafeInteger(bps) || Math.abs(pct - (bps / 10_000)) > Number.EPSILON * 8) {
    throw new Error('fee_pct must be representable in bps');
  }
  const fee = (BigInt(grossCents) * BigInt(bps) + 5_000n) / 10_000n;
  if (fee > BigInt(MAX_SAFE_CENTS)) throw new Error('fee overflow');
  return Number(fee);
}

/**
 * Prorratea un total de centavos por una fracción part/whole usando enteros.
 * El redondeo para valores no negativos es half-up, igual que Stripe/los
 * demás helpers monetarios del proyecto, sin multiplicar dentro de Number.
 */
function prorateCents(totalCents, partCents, wholeCents) {
  for (const [name, value] of [
    ['totalCents', totalCents],
    ['partCents', partCents],
    ['wholeCents', wholeCents],
  ]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  if (wholeCents === 0) throw new Error('wholeCents must be greater than zero');
  if (partCents > wholeCents) throw new Error('partCents cannot exceed wholeCents');
  const denominator = BigInt(wholeCents);
  const result = (
    (BigInt(totalCents) * BigInt(partCents)) + (denominator / 2n)
  ) / denominator;
  if (result > BigInt(MAX_SAFE_CENTS)) throw new Error('prorated cents overflow');
  return Number(result);
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
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('n must be positive safe integer');
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('totalCents must be non-negative safe integer');
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
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('totalCents must be non-negative safe integer');
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('n must be positive safe integer');
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000) throw new Error('bps out of range (0-10000)');
  const denominator = BigInt(n) * 10_000n;
  const tip = (BigInt(totalCents) * BigInt(bps) + (denominator / 2n)) / denominator;
  if (tip > BigInt(MAX_SAFE_CENTS)) throw new Error('tip overflow');
  return Number(tip);
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
  sumCents, calculateFee, prorateCents, splitEqual, tipFromBps, fractionAmount,
};
