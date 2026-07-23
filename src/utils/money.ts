/**
 * utils/money.ts — Helpers de dinero en centavos.
 *
 * PROCEDENCIA: réplica EXACTA de `contract-mirror/utils/money.js`
 * (payme-app-backend v2.13, utils/money.js), tipada para TS estricto.
 * Regla dura #5 del CLAUDE.md: si el backend expone utilidades de dinero,
 * se replican EXACTAS. No modificar acá: si hay un problema, es del contrato
 * y va a GAPS.md.
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
  if (typeof c === 'bigint') c = Number(c);
  if (typeof c !== 'number') throw new TypeError('centsToString requires number|bigint');
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
    const n = typeof v === 'bigint' ? Number(v) : Number(v || 0);
    if (!Number.isFinite(n)) throw new Error(`Invalid amount in sum: ${v}`);
    total += n;
  }
  return total;
}

/** Fee en centavos. fee_pct entre 0 y 1 (0.02 = 2%). */
export function calculateFee(grossCents: number, feePct: number): number {
  const pct = Number(feePct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1) throw new Error('fee_pct out of range');
  return Math.round(Number(grossCents) * pct);
}

/**
 * D7 (v2.17): propina por comensal sobre base partes-iguales.
 * Réplica EXACTA de `tipFromBps` del backend (utils/money.js:107-112,
 * espejado en contract-mirror) — el cobro real lo computa el SERVER; esto es
 * solo la preview del picker de %, con el mismo redondeo.
 */
export function tipFromBps(totalCents: number, n: number, bps: number): number {
  if (!Number.isInteger(totalCents) || totalCents < 0)
    throw new Error('totalCents must be non-negative integer');
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be positive integer');
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw new Error('bps out of range (0-10000)');
  return Math.round((totalCents * bps) / (n * 10000));
}

/**
 * División igualitaria entre N personas con manejo determinístico de remainder.
 * El primer comensal absorbe los centavos sobrantes.
 */
export function splitEqual(totalCents: number, n: number): number[] {
  if (!Number.isInteger(n) || n < 1) throw new Error('n must be positive integer');
  if (!Number.isInteger(totalCents) || totalCents < 0)
    throw new Error('totalCents must be non-negative integer');
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  const parts: number[] = new Array(n).fill(base);
  for (let i = 0; i < remainder; i++) parts[i] += 1;
  return parts;
}
