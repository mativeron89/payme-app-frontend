/**
 * utils/format.ts — Helpers de PRESENTACIÓN (no de aritmética de dinero).
 * La aritmética vive en money.ts (réplica del backend). Acá solo formato
 * visual: separador de miles es-MX y fechas relativas. El /100 en el borde
 * de display es lo que pide la regla "centavos enteros, mostrados /100".
 */

const mxn = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  minimumFractionDigits: 2,
});

/** 125000 → "$1,250.00" (solo para mostrar; jamás para calcular). */
export function formatMXN(cents: number): string {
  return mxn.format(cents / 100);
}

/** Countdown "MM:SS" hasta una fecha ISO; null si ya pasó. */
export function countdownTo(isoDate: string, now: Date = new Date()): string | null {
  const ms = new Date(isoDate).getTime() - now.getTime();
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/** Normaliza para búsqueda: sin acentos y en minúsculas ("José" → "jose"). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
