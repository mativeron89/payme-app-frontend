import { personalDateParts, personalInstant } from './personalDates';

/**
 * AF-29 / D158 · partes de «Sáb 12/09» y «21:40» en la zona explícita elegida.
 * El argumento omitido conserva la compatibilidad local histórica, no el
 * consumidor vigente. Pura: el día de semana lo traduce la pantalla con `t()`.
 *
 * `null` si la fecha no se puede leer: la pantalla no inventa una.
 */
export interface PartesDeFecha {
  /** 0 = domingo … 6 = sábado, como `Date#getDay`. */
  readonly diaSemana: number | null;
  /** «12/09»: día y mes con dos dígitos, en el orden de México. */
  readonly diaMes: string;
  /** «21:40», 24 horas. */
  readonly hora: string;
}

const dos = (n: number) => String(n).padStart(2, '0');

export function partesDeFecha(iso: string, zone?: string | null): PartesDeFecha | null {
  // D158: el consumidor vigente pasa su zona explícita. Sin Intl, el ISO se
  // muestra neutral sin inventar día de semana/zona original. El camino sin
  // argumento conserva compatibilidad de callers históricos, no se adopta en UI.
  if (zone !== undefined) {
    const instant = personalInstant(iso);
    if (!instant) return null;
    const parts = personalDateParts(iso, zone);
    if (!parts) return { diaSemana: null, diaMes: instant.toISOString(), hora: '' };
    return { diaSemana: parts.weekday, diaMes: dos(parts.day) + '/' + dos(parts.month), hora: dos(parts.hour) + ':' + dos(parts.minute) };
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return {
    diaSemana: d.getDay(),
    diaMes: `${dos(d.getDate())}/${dos(d.getMonth() + 1)}`,
    hora: `${dos(d.getHours())}:${dos(d.getMinutes())}`,
  };
}
