import { denominatorBps } from '../api/mesaPresentation';
import { bpsLabel } from './mesaItemsView';

/**
 * AF-QUE-CONSUMISTE · decisión 90 de Mati · «¿Qué consumiste?» según el diseño
 * de Claude Design (`DISENO_CLAUDE_DESIGN_QUE_CONSUMISTE_20260926/`,
 * `PANTALLA-que-consumiste.md` sha256 `fabae11b…`).
 *
 * Lo puro de la pantalla: qué porciones se ofrecen y cómo se nombran. Vive
 * aparte para poder ejercitarlo sin montar la vista.
 */

/**
 * Decisión 90, definición 2 · «Entero, ½, ⅓ y ¼». ⅔ y ¾ salieron del selector
 * (y con ellos «Otro»): una selección ya guardada con esas porciones se sigue
 * mostrando con `etiquetaPorcion`, pero no se ofrece elegirla.
 */
export const PORCIONES = [1, 2, 3, 4] as const;

/**
 * Regla 4 del diseño · las porciones que caben en la mesa y en lo que queda del
 * plato. Con 4 personas: Entero, ½, ⅓, ¼; con 2: Entero y ½; en un «Queda ½» no
 * aparece Entero.
 *
 * `original` es la cantidad de personas de la mesa (n204); sin el dato no se
 * limita por personas. `restanteBps` es lo que esta cuenta puede tomar: en
 * consumo, `remaining_bps`; en «igual», el límite de la decisión 79. Un
 * restante que no es un entero de 0 a 10000 no ofrece nada.
 */
export function porcionesDisponibles(original: number | null, restanteBps: number): number[] {
  if (!Number.isSafeInteger(restanteBps) || restanteBps < 0 || restanteBps > 10000) return [];
  const tope = original ?? PORCIONES.length;
  return PORCIONES.filter((d) => d <= tope && denominatorBps(d) <= restanteBps);
}

/**
 * El texto de la píldora de porción. Entero se dice «Entero»; el resto, con el
 * mismo glifo de siempre (`bpsLabel`), así que una porción vieja (⅔, ¾, 1/5…)
 * se sigue leyendo bien.
 */
export function etiquetaPorcion(bps: number, t: (s: string, ...a: unknown[]) => string): string {
  return bps >= 10000 ? t('Entero') : bpsLabel(bps);
}

/** «1 plato» / «N platos», para «Mi parte · N platos». */
export function textoPlatos(n: number, t: (s: string, ...a: unknown[]) => string): string {
  return n === 1 ? t('1 plato') : t('{0} platos', n);
}
