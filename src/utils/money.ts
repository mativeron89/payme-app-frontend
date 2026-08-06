/**
 * utils/money.ts — Helpers de dinero en centavos.
 *
 * PROCEDENCIA: réplica tipada del `utils/money.js` en App Backend
 * `e8a3faf2f520b249cbe6001f14ef70230a405695`, mirror 67/67 verificado
 * byte a byte durante el cierre local del 2026-08-03.
 * Regla dura #5: la aritmética debe permanecer idéntica entre ambos lados.
 */

export const CURRENCY = 'mxn';
const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

/**
 * Convierte string|number a centavos (integer).
 *   "210"    → 21000
 *   "210.5"  → 21050
 *   "210.45" → 21045
 *   210.45   → 21045
 */
export function stringToCents(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error(`Invalid amount: ${input}`);
    return stringToCents(String(input));
  }
  if (typeof input !== 'string') {
    throw new TypeError('stringToCents requires string|number');
  }
  const match = input.match(/^(-)?\$?(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    throw new Error(`Invalid amount format: ${input}`);
  }
  const negative = !!match[1];
  const intPart = match[2];
  const decPart = match[3] || '';
  const dec = (decPart + '00').slice(0, 2);
  const totalStr = `${intPart}${dec}`;
  const total = Number(totalStr);
  if (!Number.isFinite(total) || total > MAX_SAFE_CENTS) {
    throw new Error(`Amount overflow: ${input}`);
  }
  return negative ? -total : total;
}

/** 21000 → "210.00" */
export function centsToString(c: number | bigint): string {
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
export function centsToDisplay(c: number | bigint): string {
  return `$${centsToString(c)}`;
}

/** Suma segura en centavos (acepta number|bigint|string-numéricos). */
export function sumCents(...values: Array<number | bigint | string>): number {
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
export function calculateFee(grossCents: number, feePct: number): number {
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

/** Prorratea centavos con redondeo half-up y sin multiplicar en Number. */
export function prorateCents(totalCents: number, partCents: number, wholeCents: number): number {
  for (const [name, value] of [
    ['totalCents', totalCents],
    ['partCents', partCents],
    ['wholeCents', wholeCents],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  if (wholeCents === 0) throw new Error('wholeCents must be greater than zero');
  if (partCents > wholeCents) throw new Error('partCents cannot exceed wholeCents');
  const denominator = BigInt(wholeCents);
  const result = ((BigInt(totalCents) * BigInt(partCents)) + (denominator / 2n)) / denominator;
  if (result > BigInt(MAX_SAFE_CENTS)) throw new Error('prorated cents overflow');
  return Number(result);
}

/**
 * D7 (v2.17): propina por comensal sobre base partes-iguales.
 * Réplica EXACTA de `tipFromBps` del backend (utils/money.js:107-112,
 * espejado en contract-mirror) — el cobro real lo computa el SERVER; esto es
 * solo la preview del picker de %, con el mismo redondeo.
 */
export function tipFromBps(totalCents: number, n: number, bps: number): number {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0)
    throw new Error('totalCents must be non-negative safe integer');
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('n must be positive safe integer');
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10000)
    throw new Error('bps out of range (0-10000)');
  const denominator = BigInt(n) * 10_000n;
  const tip = (BigInt(totalCents) * BigInt(bps) + (denominator / 2n)) / denominator;
  if (tip > BigInt(MAX_SAFE_CENTS)) throw new Error('tip overflow');
  return Number(tip);
}

/**
 * v2.18 (fracciones): monto NOMINAL de una fracción de ítem. Réplica EXACTA de
 * `fractionAmount` del backend (utils/money.js:121-123, espejado): delega en
 * tipFromBps(price, 1, bps). La fracción que COMPLETA el ítem NO usa esto —
 * el server ajusta (price − suma de las demás) para cerrar exacto
 * (services/itemClaims.js del espejo); acá solo se PREVISUALIZA.
 */
export function fractionAmount(priceCents: number, fractionBps: number): number {
  return tipFromBps(priceCents, 1, fractionBps);
}

/**
 * División igualitaria entre N personas con manejo determinístico de remainder.
 * El primer comensal absorbe los centavos sobrantes.
 */
export function splitEqual(totalCents: number, n: number): number[] {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('n must be positive safe integer');
  if (!Number.isSafeInteger(totalCents) || totalCents < 0)
    throw new Error('totalCents must be non-negative safe integer');
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  const parts: number[] = new Array(n).fill(base);
  for (let i = 0; i < remainder; i++) parts[i] += 1;
  return parts;
}
