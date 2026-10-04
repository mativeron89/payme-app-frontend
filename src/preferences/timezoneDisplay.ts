/** D169 · sólo presentación. Cada lectura usa IANA y UN instante del panel;
 * compartir un offset hoy no convierte las zonas en un offset persistente. */
export interface ZoneDisplay {
  readonly offsetMinutes: number;
  readonly time: string;
}
export interface TimeZoneGroup extends ZoneDisplay {
  readonly zones: readonly string[];
}

export function timeZoneDisplay(zone: string, instant: Date): ZoneDisplay | null {
  if (!Number.isFinite(instant.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      timeZoneName: 'shortOffset', numberingSystem: 'latn',
    }).formatToParts(instant);
    const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === name)?.value;
    const match = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(part('timeZoneName') ?? '');
    const hour = part('hour'), minute = part('minute');
    if (!match || !hour || !minute || !/^\d{2}$/.test(hour) || !/^\d{2}$/.test(minute)) return null;
    const hours = Number(match[2] ?? 0), minutes = Number(match[3] ?? 0);
    if (hours > 23 || minutes > 59 || Number(hour) > 23 || Number(minute) > 59) return null;
    const offsetMinutes = (hours * 60 + minutes) * (match[1] === '-' ? -1 : 1);
    return { offsetMinutes, time: `${hour}:${minute}` };
  } catch { return null; }
}

export function utcOffsetLabel(minutes: number): string {
  const absolute = Math.abs(minutes), hours = Math.floor(absolute / 60), rest = absolute % 60;
  return `UTC${minutes < 0 ? '−' : minutes > 0 ? '+' : ''}${minutes === 0 ? '' : hours}${rest ? ':' + String(rest).padStart(2, '0') : ''}`;
}

/** Orden estable de la primera zona de cada grupo en el catálogo recibido.
 * Las zonas no admitidas se conservan aparte, sin inventarles un offset. */
export function groupTimeZones(zones: readonly string[], instant: Date,
  supported: (zone: string) => boolean = () => true,
): { groups: readonly TimeZoneGroup[]; unavailable: readonly string[] } {
  const groups = new Map<number, { offsetMinutes: number; time: string; zones: string[] }>();
  const unavailable: string[] = [];
  for (const zone of zones) {
    const display = supported(zone) ? timeZoneDisplay(zone, instant) : null;
    if (!display) { unavailable.push(zone); continue; }
    const group = groups.get(display.offsetMinutes);
    if (group) group.zones.push(zone);
    else groups.set(display.offsetMinutes, { ...display, zones: [zone] });
  }
  return { groups: [...groups.values()], unavailable };
}

/** Reseleccionar el grupo conserva SU IANA, incluidas sus reglas estacionales.
 * Sólo un grupo distinto toma el primer representante válido del catálogo. */
export function zoneForGroup(group: TimeZoneGroup, current: string): string {
  return group.zones.includes(current) ? current : group.zones[0] ?? '';
}
