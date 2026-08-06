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

/**
 * Countdown LARGO, el que pide `SPEC_APP.md` §1.1 para la burbuja de la mesa:
 * *"Vence en 2 h 14 min"*. `countdownTo` da "MM:SS", que a dos horas de
 * distancia dice "134:07" — un número que nadie lee como tiempo.
 *
 * `urgent` es la otra mitad del spec: **bajo 1 h la línea pasa a `--warning`**.
 * Va acá y no en la pantalla porque es el umbral, no el color: quien lo lea en
 * un test tiene que poder cruzar el minuto 60 sin abrir un navegador.
 *
 * `null` cuando ya venció: la burbuja de una mesa vencida no muestra countdown,
 * y devolver "0 min" sería decir que todavía queda algo.
 */
export interface LongCountdown {
  text: string;
  /** Falta menos de una hora. */
  urgent: boolean;
}

export function countdownLong(isoDate: string, now: Date = new Date()): LongCountdown | null {
  const ms = new Date(isoDate).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMin = Math.floor(ms / 60_000);
  const urgent = totalMin < 60;
  if (totalMin < 1) return { text: 'menos de 1 min', urgent };
  if (totalMin < 60) return { text: `${totalMin} min`, urgent };
  const hs = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return { text: min === 0 ? `${hs} h` : `${hs} h ${min} min`, urgent };
}

/**
 * Fecha relativa corta ("hace 3 h", "ayer"). Vivía dentro de AvisosScreen; se
 * subió acá cuando la pantalla de solicitudes necesitó la misma, porque una
 * solicitud saliente ya no muestra a quién y la antigüedad es lo único que le
 * queda al usuario para distinguirlas.
 */
export function relTime(isoDate: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(isoDate).getTime()) / 60_000);
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hs = Math.floor(mins / 60);
  if (hs < 24) return `hace ${hs} h`;
  const days = Math.floor(hs / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

/** Normaliza para búsqueda: sin acentos y en minúsculas ("José" → "jose"). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
