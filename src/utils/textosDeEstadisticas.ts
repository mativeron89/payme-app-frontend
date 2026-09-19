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

/** AF-31 · el nombre del período, como aparece en la burbuja y en el selector. */
export function etiquetaDePeriodo(clave: string, t: T): string {
  if (clave === 'last_month') return t('Mes pasado');
  if (clave === 'last_3_months') return t('Últimos 3 meses');
  if (clave === 'this_year') return t('Este año');
  return t('Este mes');
}

/** AF-31 · el cierre de frases como «3 lugares · 6 visitas este mes». */
export function sufijoDePeriodo(clave: string, t: T): string {
  if (clave === 'last_month') return t('el mes pasado');
  if (clave === 'last_3_months') return t('en los últimos 3 meses');
  if (clave === 'this_year') return t('este año');
  return t('este mes');
}

/** «1 vez», «4 veces». En platos, `times` son visitas (handoff v2.107.0). */
export function vecesTexto(n: number, t: T): string {
  return `${n} ${n === 1 ? t('vez') : t('veces')}`;
}

/** AF-36 · «7 platos», con su singular: la cifra de la burbuja de 2c. */
export function platosTexto(n: number, t: T): string {
  return `${n} ${n === 1 ? t('plato') : t('platos')}`;
}

/** «15 platos distintos», con su singular. */
export function platosDistintos(n: number, t: T): string {
  return `${n} ${n === 1 ? t('plato distinto') : t('platos distintos')}`;
}
