/**
 * AF-26 · «Mis estadísticas» etapa 1 · `consumption_month` en `GET /account/stats`
 * (dueño v2.102.0 · `contract-mirror/routes/account.js:494-551`).
 *
 * **Es OPCIONAL**: el backend servido hoy no lo manda. Ausente o inválido ⇒
 * `null`, y la pantalla queda exactamente como estaba. Nunca rompe y nunca se
 * inventa un número.
 *
 * Qué cuenta como inválido, y por qué se falla cerrado en vez de «arreglar»:
 * - `basis` que no sea `consumption` ni `payments`: el rótulo («consumo» o
 *   «gasto») sale de ahí y el front no adivina.
 * - Montos o visitas que no sean enteros no negativos (centavos, nunca floats).
 * - Una categoría repetida, vacía o con monto 0: el dueño no las manda.
 * - **Que las categorías no sumen el total.** En las dos bases el dueño calcula
 *   el total como esa suma (`consumoDesdeSelecciones` y `consumoDesdePagos`), y
 *   el anillo muestra el total al centro y las porciones alrededor: si no
 *   cuadran, el anillo diría dos cosas distintas.
 *
 * Una categoría que el front no conoce SÍ se acepta: el dueño pasa la categoría
 * del restaurante tal cual, y una cocina nueva no debería apagar la pantalla. Se
 * rotula «Otra cocina».
 */

export type BaseDeConsumo = 'consumption' | 'payments';

export interface CategoriaDelMes {
  readonly category: string;
  readonly amountCents: number;
  readonly visits: number;
}

export interface ConsumoDelMes {
  readonly basis: BaseDeConsumo;
  readonly totalCents: number;
  readonly visits: number;
  readonly avgPerVisitCents: number;
  readonly categories: readonly CategoriaDelMes[];
}

function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function entero(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

export function decodeConsumoDelMes(raw: unknown): ConsumoDelMes | null {
  if (!objeto(raw)) return null;
  if (raw.basis !== 'consumption' && raw.basis !== 'payments') return null;
  if (!entero(raw.total_cents) || !entero(raw.visits) || !entero(raw.avg_per_visit_cents)) return null;
  if (!Array.isArray(raw.categories)) return null;
  const vistas = new Set<string>();
  const categories: CategoriaDelMes[] = [];
  for (const c of raw.categories) {
    if (!objeto(c) || typeof c.category !== 'string' || c.category.length === 0) return null;
    if (!entero(c.amount_cents) || c.amount_cents === 0 || !entero(c.visits)) return null;
    if (vistas.has(c.category)) return null;
    vistas.add(c.category);
    categories.push({ category: c.category, amountCents: c.amount_cents, visits: c.visits });
  }
  const suma = categories.reduce((a, c) => a + c.amountCents, 0);
  if (suma !== raw.total_cents) return null;
  return {
    basis: raw.basis,
    totalCents: raw.total_cents,
    visits: raw.visits,
    avgPerVisitCents: raw.avg_per_visit_cents,
    categories,
  };
}
