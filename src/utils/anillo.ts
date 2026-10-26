/**
 * AF-26 · «Mis estadísticas» · los porcentajes enteros de una lista de montos.
 *
 * D479/D482 · AF-1 · Claude Design 0.261 retiró los anillos de Estadísticas:
 * quedan barras con el color FIJO de cada clave (`coloresDeEstadisticas.ts`). De
 * la aritmética del anillo sobrevive sólo esto, que usan las barras y la mezcla
 * de Evolución.
 */

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
