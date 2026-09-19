/**
 * AF-29 · 2b · las partes de «Sáb 12/09» y «21:40», en la hora LOCAL del
 * teléfono. Pura: devuelve números; el día de la semana lo traduce la pantalla
 * con `t()` literales, así cada idioma lo dice a su manera.
 *
 * `null` si la fecha no se puede leer: la pantalla no inventa una.
 */
export interface PartesDeFecha {
  /** 0 = domingo … 6 = sábado, como `Date#getDay`. */
  readonly diaSemana: number;
  /** «12/09»: día y mes con dos dígitos, en el orden de México. */
  readonly diaMes: string;
  /** «21:40», 24 horas. */
  readonly hora: string;
}

const dos = (n: number) => String(n).padStart(2, '0');

export function partesDeFecha(iso: string): PartesDeFecha | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return {
    diaSemana: d.getDay(),
    diaMes: `${dos(d.getDate())}/${dos(d.getMonth() + 1)}`,
    hora: `${dos(d.getHours())}:${dos(d.getMinutes())}`,
  };
}
