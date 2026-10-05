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

/**
 * La forma de un anillo: radio, grosor, corte entre porciones y paleta. Por
 * defecto, la de 2a/2c (`GEOMETRIA_2A`), que siguen usando las pantallas de
 * detalle. E173-4 · la de Estadísticas es otra (`GEOMETRIA_E173`).
 */
export interface GeometriaAnillo {
  readonly radio: number;
  readonly grosor: number;
  readonly corte: number;
  readonly colores: readonly string[];
}

export const GEOMETRIA_2A: GeometriaAnillo = {
  radio: RADIO_ANILLO,
  grosor: GROSOR_ANILLO,
  corte: CORTE_ANILLO,
  colores: COLORES_ANILLO,
};

/**
 * E173-4 · decisión 173 · especificación de Claude Design
 * (`PANTALLA-estadisticas.md`): anillo de 168 px, grosor 20 (r = 74 en un
 * viewBox de 168), separación de 2 px y cuatro colores en orden de monto. De la
 * cuarta cocina en adelante, el anillo las junta en la cuarta porción; la lista
 * las sigue mostrando todas.
 */
export const GEOMETRIA_E173: GeometriaAnillo = {
  radio: 74,
  grosor: 20,
  corte: 2,
  colores: ['#0FB5C9', '#101E3B', '#6FD3DE', '#64748B'],
};

/** Índice de color de una categoría en la lista: de la quinta en adelante, el quinto. */
export function colorDeFila(indice: number): string {
  return colorEnPaleta(indice, COLORES_ANILLO);
}

/**
 * E173-4 · el mismo criterio con otra paleta: de la última en adelante, la
 * última. Función aparte y no un segundo parámetro de `colorDeFila`: ésa se usa
 * en `.map(colorDeFila)`, que le pasaría el índice del arreglo como paleta.
 */
export function colorEnPaleta(indice: number, colores: readonly string[]): string {
  return colores[Math.min(indice, colores.length - 1)]!;
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
export function porcionesDelAnillo(montos: readonly number[], geometria: GeometriaAnillo = GEOMETRIA_2A): PorcionAnillo[] {
  const { colores, corte } = geometria;
  const circunferencia = 2 * Math.PI * geometria.radio;
  const total = montos.reduce((a, m) => a + m, 0);
  if (total <= 0 || montos.length === 0) return [];
  const max = colores.length;
  const agrupados = montos.length <= max
    ? [...montos]
    : [...montos.slice(0, max - 1), montos.slice(max - 1).reduce((a, m) => a + m, 0)];
  const vivos = agrupados.filter((m) => m > 0);
  if (vivos.length === 1) {
    return [{ color: colores[agrupados.findIndex((m) => m > 0)]!, trazo: circunferencia, hueco: 0, desde: 0 }];
  }
  let acumulado = 0;
  const porciones: PorcionAnillo[] = [];
  agrupados.forEach((m, i) => {
    if (m <= 0) return;
    const parte = (m / total) * circunferencia;
    const trazo = Math.max(parte - corte, 0);
    porciones.push({ color: colores[i]!, trazo, hueco: circunferencia - trazo, desde: -acumulado });
    acumulado += parte;
  });
  return porciones;
}
