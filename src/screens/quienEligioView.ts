import { leerEligieron, type FichaDeMiembro, type Miembros, type QuienesEligieron } from '../api/miembros';

type Traducir = (s: string, ...a: unknown[]) => string;

/**
 * D622 · mejora 3 (§3 de la especificación) · D628 · D639 · quién eligió cada
 * plato, con las iniciales que manda el dueño (`src/api/miembros.ts`).
 *
 * - Lo ven sólo los de la mesa; quien tiene una invitación sin aceptar recibe
 *   `null` del dueño y ve «Lo eligió otro», como hoy.
 * - Nunca el nombre completo ni montos por persona: el texto dice quién eligió,
 *   no cuánto paga nadie. D639 (decisión informada): un plato de una sola
 *   persona se ve con sus iniciales y su precio; quien salió de la mesa conserva
 *   sus iniciales donde tiene partes (las manda el dueño así).
 * - Quien mira se nombra «tú», nunca con sus iniciales.
 * - El color sale del orden de llegada y no significa nada: lo dicen las letras.
 */

/** Hasta 3 fichas por plato y «+N» (§3). */
export const FICHAS_POR_PLATO = 3;
/** Hasta 8 círculos en «Se sumaron N de M», entre fichas y «?» (§2). */
export const CIRCULOS_DE_LA_MESA = 8;

/**
 * 8 tonos, uno por orden de llegada. Las iniciales van en blanco: cada tono da
 * ≥ 4.5:1 con el blanco, y por lo mismo ≥ 3:1 contra el fondo blanco de la
 * tarjeta (lo fija el test con `contraste`).
 */
export const PALETA_DE_FICHAS: readonly string[] = [
  '#1d4ed8', '#047857', '#b91c1c', '#7e22ce', '#a16207', '#0e7490', '#be185d', '#4d7c0f',
];

export function colorDeFicha(ordinal: number): string {
  return PALETA_DE_FICHAS[((ordinal % PALETA_DE_FICHAS.length) + PALETA_DE_FICHAS.length) % PALETA_DE_FICHAS.length]!;
}

function luminancia(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const canal = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255);
}

/** Contraste WCAG 2.x entre dos colores `#rrggbb`. */
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** ¿Hay alguien que no sea quien mira con una parte del plato? Sólo entonces el plato lleva fichas. */
export function otrosEligieron(q: QuienesEligieron | null | undefined): q is QuienesEligieron {
  return !!q && (q.mas > 0 || q.fichas.some((f) => !f.mine));
}

/** Las fichas que se dibujan y cuántas quedan en «+N» (las que no entran más las que el dueño no mandó). */
export function fichasALaVista(q: QuienesEligieron, max: number): { visibles: readonly FichaDeMiembro[]; resto: number } {
  const visibles = q.fichas.slice(0, max);
  return { visibles, resto: q.fichas.length - visibles.length + q.mas };
}

/** «Lo eligió AM» / «Lo eligieron AM y LP» / «Lo eligieron AM, LP y 2 más»; quien mira es «tú». */
export function textoDeQuienEligio(q: QuienesEligieron, t: Traducir): string | null {
  const texto = frasesDeQuienEligio(q, t);
  // En inglés la frase empieza por el nombre: «you and AM picked it» va con mayúscula. Las iniciales ya la tienen.
  return texto === null ? null : texto.charAt(0).toLocaleUpperCase() + texto.slice(1);
}

function frasesDeQuienEligio(q: QuienesEligieron, t: Traducir): string | null {
  const nombres = q.fichas.map((f) => (f.mine ? t('tú') : f.initials));
  const total = q.fichas.length + q.mas;
  if (total === 0 || nombres.length === 0) return null;
  if (total === 1) return t('Lo eligió {0}', nombres[0]);
  // El decodificador sólo acepta `picked_by_more > 0` con las 6 fichas: con más de una persona hay al menos dos nombres.
  if (nombres.length < 2) return null;
  if (total === 2) return t('Lo eligieron {0} y {1}', nombres[0], nombres[1]);
  return t('Lo eligieron {0}, {1} y {2} más', nombres[0], nombres[1], total - 2);
}

/** La tercera línea de la tarjeta del estado (§2): «Se sumaron N de M», las fichas y un «?» por cada esperado que falta. */
export interface PersonasDeLaMesa {
  readonly texto: string;
  readonly fichas: readonly FichaDeMiembro[];
  /** Cuántos «?» de borde punteado se dibujan. */
  readonly faltan: number;
  /** Lo que queda en «+N»: los que se sumaron y no entraron, y los esperados sin «?». */
  readonly resto: number;
}

/** Sin `members` o sin esperados (mesa vieja) no hay línea: no se inventa un conteo. */
export function personasDeLaMesa(m: Miembros | null | undefined, t: Traducir): PersonasDeLaMesa | null {
  if (!m || m.expectedCount === null) return null;
  const fichas = m.fichas.slice(0, CIRCULOS_DE_LA_MESA);
  const esperanSin = Math.max(0, m.expectedCount - m.joinedCount);
  const faltan = Math.min(esperanSin, CIRCULOS_DE_LA_MESA - fichas.length);
  return {
    texto: t('Se sumaron {0} de {1}', m.joinedCount, m.expectedCount),
    fichas,
    faltan,
    resto: (m.joinedCount - fichas.length) + (esperanSin - faltan),
  };
}

/**
 * Las fichas de un renglón de «¿Qué consumiste?», o `null` si el renglón queda como hoy:
 * - sólo por consumo (en partes iguales no hay dueño de un plato, D79);
 * - nunca en la mesa de ejemplo de la guía (D367: no usa datos de otros);
 * - sólo con el dato del dueño bien formado, y si alguien que no es quien mira tiene una parte.
 */
export function quienEligioDelPlato(
  item: unknown,
  donde: { readonly esConsumo: boolean; readonly ejemplo: boolean },
): QuienesEligieron | null {
  if (!donde.esConsumo || donde.ejemplo) return null;
  const q = leerEligieron(item);
  return otrosEligieron(q) ? q : null;
}
