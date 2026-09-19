/**
 * AF-26 · «Mis estadísticas» 2a · la aritmética del anillo, pura y sin React.
 *
 * Diseño 2a (`ops/bibliotecario-claude-20260917/diseno-mis-estadisticas-20260919/`):
 * anillo SVG de `<circle>` con `stroke-dasharray`, radio 54, grosor 17, corte
 * de 3px entre porciones, sin animación ni librería. Cada porción mide su parte
 * de la circunferencia MENOS el corte, y arranca donde terminó la anterior
 * (medido del diseño: 40,26 % de 339,29 = 136,6 → trazo 133,6 y la siguiente
 * empieza en −136,6).
 */

export const RADIO_ANILLO = 54;
export const GROSOR_ANILLO = 17;
export const CORTE_ANILLO = 3;
export const CIRCUNFERENCIA = 2 * Math.PI * RADIO_ANILLO;

/**
 * Los cinco colores del sistema, en el orden del diseño. El quinto también es el
 * de la porción que agrupa de la sexta categoría en adelante.
 */
export const COLORES_ANILLO = ['#0FB5C9', '#101E3B', '#0A7B80', '#6FD3DE', '#4A5B78'] as const;

/**
 * Porcentajes ENTEROS que suman exactamente 100, por resto mayor: cada uno se
 * trunca y los puntos que faltan van a los restos más grandes. Ante un empate de
 * restos gana el que viene antes, que es el de más monto porque el dueño ordena.
 * Con total 0 no hay porcentaje que dar: todos 0 (la pantalla no los muestra).
 */
export function porcentajesEnteros(montos: readonly number[]): number[] {
  const total = montos.reduce((a, m) => a + m, 0);
  if (total <= 0) return montos.map(() => 0);
  const base = montos.map((m) => Math.floor((m * 100) / total));
  let faltan = 100 - base.reduce((a, p) => a + p, 0);
  const porResto = montos
    .map((m, i) => ({ i, resto: (m * 100) % total }))
    .sort((a, b) => b.resto - a.resto || a.i - b.i);
  for (const { i } of porResto) {
    if (faltan <= 0) break;
    base[i] += 1;
    faltan -= 1;
  }
  return base;
}

/** Índice de color de una categoría en la lista: de la quinta en adelante, el quinto. */
export function colorDeFila(indice: number): string {
  return COLORES_ANILLO[Math.min(indice, COLORES_ANILLO.length - 1)];
}

export interface PorcionAnillo {
  readonly color: string;
  /** Largo del trazo visible. */
  readonly trazo: number;
  /** Lo que resta de la circunferencia (el hueco del dasharray). */
  readonly hueco: number;
  /** `stroke-dashoffset`: negativo, dónde arranca. */
  readonly desde: number;
}

/**
 * Las porciones del anillo. Las cuatro primeras categorías van solas; de la
 * quinta en adelante se juntan en UNA porción del quinto color, como pide la
 * orden («de la sexta en adelante se agrupan visualmente en la última»: con
 * cinco colores, la última porción es la quinta). La lista de abajo sigue
 * mostrando cada categoría por separado: nunca el color solo.
 *
 * Una sola categoría es un anillo entero, sin corte: no hay dos porciones que
 * separar.
 */
export function porcionesDelAnillo(montos: readonly number[]): PorcionAnillo[] {
  const total = montos.reduce((a, m) => a + m, 0);
  if (total <= 0 || montos.length === 0) return [];
  const max = COLORES_ANILLO.length;
  const agrupados = montos.length <= max
    ? [...montos]
    : [...montos.slice(0, max - 1), montos.slice(max - 1).reduce((a, m) => a + m, 0)];
  const vivos = agrupados.filter((m) => m > 0);
  if (vivos.length === 1) {
    return [{ color: COLORES_ANILLO[agrupados.findIndex((m) => m > 0)], trazo: CIRCUNFERENCIA, hueco: 0, desde: 0 }];
  }
  let acumulado = 0;
  const porciones: PorcionAnillo[] = [];
  agrupados.forEach((m, i) => {
    if (m <= 0) return;
    const parte = (m / total) * CIRCUNFERENCIA;
    const trazo = Math.max(parte - CORTE_ANILLO, 0);
    porciones.push({ color: COLORES_ANILLO[i], trazo, hueco: CIRCUNFERENCIA - trazo, desde: -acumulado });
    acumulado += parte;
  });
  return porciones;
}
