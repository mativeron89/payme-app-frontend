/** D158 · sólo presentación. No modifica instantes, períodos ni expiraciones. */
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

type FormatProfile = 'support' | 'parts' | 'date' | 'month';
const FORMAT_OPTIONS: Readonly<Record<FormatProfile, Intl.DateTimeFormatOptions>> = {
  support: {},
  parts: {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  },
  date: { day: 'numeric', month: 'short' },
  month: { month: 'long', year: 'numeric' },
};
const FORMAT_LIMIT = 8;
const formats = new Map<string, Intl.DateTimeFormat>();
let formatConstructor: typeof Intl.DateTimeFormat | undefined;

/** D166: reutilizar sólo el formateador, nunca fechas, resultados ni «hoy».
 * La fábrica es lazy; el import no consulta Intl, storage ni el navegador.
 * Un Intl reemplazado/no disponible invalida la caché, no oculta el fallback. */
function formatter(profile: FormatProfile, locale: string, zone: string): Intl.DateTimeFormat {
  const ctor = typeof Intl === 'undefined' ? undefined : Intl.DateTimeFormat;
  if (ctor !== formatConstructor) {
    formats.clear();
    formatConstructor = ctor;
  }
  if (typeof ctor !== 'function') throw new TypeError('Intl.DateTimeFormat no disponible');
  const key = JSON.stringify([profile, locale, zone]);
  const existing = formats.get(key);
  if (existing) {
    formats.delete(key);
    formats.set(key, existing);
    return existing;
  }
  // Los errores no se almacenan ni expulsan un formateador válido.
  const next = new ctor(locale, { ...FORMAT_OPTIONS[profile], timeZone: zone });
  if (formats.size === FORMAT_LIMIT) formats.delete(formats.keys().next().value!);
  formats.set(key, next);
  return next;
}

/** No atribuir zona a fechas civiles/naive ni aceptar normalización de 30/02. */
export function personalInstant(iso: string): Date | null {
  const match = INSTANT.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]!
      || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return null;
  const offset = match[8]!;
  if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Invocado al montar/actuar, nunca durante import ni desde un árbol público. */
export function supportsTimeZone(zone: string): boolean {
  try {
    formatter('support', 'en-US', zone).format(0);
    return true;
  } catch {
    return false;
  }
}

export interface PersonalDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly weekday: number;
  readonly calendarDay: number;
}

const two = (n: number) => String(n).padStart(2, '0');

export function personalDateParts(iso: string, zone: string | null): PersonalDateParts | null {
  const instant = personalInstant(iso);
  if (!instant || zone === null) return null;
  try {
    const parts = formatter('parts', 'en-US', zone).formatToParts(instant);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const year = part('year'), month = part('month'), day = part('day');
    const hour = part('hour'), minute = part('minute');
    if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
    const calendar = new Date(0);
    // setUTCFullYear evita el salto 0–99→1900 de Date.UTC; no muta el instante.
    calendar.setUTCFullYear(year, month - 1, day);
    calendar.setUTCHours(0, 0, 0, 0);
    return { year, month, day, hour, minute,
      weekday: calendar.getUTCDay(), calendarDay: Math.floor(calendar.getTime() / DAY_MS) };
  } catch {
    return null;
  }
}

/** Hoy/Ayer son días calendario en la zona elegida, no tramos móviles de 24 h. */
export function personalDateLabel(
  iso: string,
  locale: string,
  zone: string | null,
  t: (text: string) => string,
  now: Date = new Date(),
): string {
  const instant = personalInstant(iso);
  if (!instant) return t('Fecha no disponible');
  const parts = personalDateParts(iso, zone);
  const today = Number.isFinite(now.getTime()) ? personalDateParts(now.toISOString(), zone) : null;
  if (parts && today) {
    const difference = today.calendarDay - parts.calendarDay;
    if (difference === 0) return t('Hoy');
    if (difference === 1) return t('Ayer');
  }
  if (zone !== null && parts) {
    try {
      return formatter('date', locale, zone).format(instant);
    } catch { /* ISO UTC neutral, no hora local atribuida al teléfono. */ }
  }
  return instant.toISOString();
}

export function personalMonth(iso: string, locale: string, zone: string | null): { key: string; label: string } {
  const instant = personalInstant(iso);
  if (!instant) return { key: 'sin-fecha', label: 'Sin fecha' };
  const parts = personalDateParts(iso, zone);
  if (!parts || zone === null) {
    const key = instant.toISOString().slice(0, 7);
    return { key, label: key + ' (UTC)' };
  }
  const key = String(parts.year).padStart(4, '0') + '-' + two(parts.month);
  try {
    return { key, label: formatter('month', locale, zone).format(instant) };
  } catch {
    return { key, label: key };
  }
}

/**
 * Aviso sobre la zona en que se muestran las fechas, o `null` si no hay nada
 * que avisar. E173-1 · decisión 173 de Mati: «Quitar el mensaje de "Fechas
 * mostradas.."». Con una zona aplicada no hay leyenda; quedan sólo los dos
 * avisos de navegador degradado, que dicen otra cosa: que las fechas salen en
 * UTC porque el navegador no pudo aplicar la zona.
 */
export function personalZoneCaption(zone: string | null, t: (text: string, ...args: unknown[]) => string): string | null {
  if (zone === null) return t('Fechas en ISO UTC: este navegador no pudo aplicar una zona horaria.');
  if (zone === 'UTC') return t('Fallback UTC: este navegador no admite la zona inicial de México.');
  return null;
}
