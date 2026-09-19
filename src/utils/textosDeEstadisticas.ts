import { categoryLabel } from './labels';

type T = (s: string, ...a: unknown[]) => string;

/**
 * Textos compartidos por «Mis estadísticas» (2a) y «Tus restaurantes» (2b).
 *
 * `nombreDeCocina` es el ÚNICO `t()` no literal de las cocinas: `labels.ts` es
 * constante de MÓDULO, devuelve español y se traduce acá, en un solo sitio para
 * el chip de favorita, el anillo y la lista de restaurantes. El censo de
 * `traduccion.test.ts` lo cuenta como uno.
 */
export function nombreDeCocina(category: string | null | undefined, t: T): string | null {
  const crudo = categoryLabel(category);
  return crudo === null ? null : t(crudo);
}

/** Visitas con su palabra: «1 visita», «3 visitas». */
export function visitasTexto(n: number, t: T): string {
  return `${n} ${n === 1 ? t('visita') : t('visitas')}`;
}

/** «5 lugares · 10 visitas», con sus singulares. */
export function lugaresYVisitas(lugares: number, visitas: number, t: T): string {
  return `${lugares} ${lugares === 1 ? t('lugar') : t('lugares')} · ${visitasTexto(visitas, t)}`;
}
