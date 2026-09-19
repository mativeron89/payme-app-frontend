/**
 * AF-24 · «Tus mesas» · `GET /api/mesas/mine` (dueño C4, v2.85.0 ·
 * `contract-mirror/routes/mesas.js:943-1082`).
 *
 * Devuelve SÓLO las mesas de la cuenta autenticada: organizador, o
 * participante con una selección viva. De cada una trae lo mínimo para
 * reconocerla y `mine {items_count, amount_cents}`, que es lo que eligió ESA
 * cuenta. El dueño no publica nada de otros pagadores (`:890-894`).
 *
 * Decodificación defensiva: un sobre que no es el del dueño es un error, que la
 * pantalla muestra como tal. Una FILA rara se descarta sola, sin llevarse la
 * lista. Un campo raro dentro de una fila buena cae en `null` y la pantalla
 * omite ese dato; nunca pinta «undefined».
 */

export interface TuMesa {
  readonly id: string;
  readonly code: string;
  readonly restaurante: string | null;
  readonly categoria: string | null;
  readonly status: string;
  readonly divisionMode: 'consumo' | 'igual' | null;
  readonly guaranteeMode: boolean | null;
  readonly closureReason: 'all_items_selected' | 'time' | null;
  readonly createdAt: string | null;
  /** `null` si el dueño no mandó un conteo/monto válido: la fila no lo muestra. */
  readonly itemsCount: number | null;
  readonly amountCents: number | null;
}

export interface PaginaMisMesas {
  readonly mesas: readonly TuMesa[];
  readonly nextCursor: string | null;
}

function objeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}

function enteroNoNegativo(v: unknown): number | null {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

function fila(raw: unknown): TuMesa | null {
  if (!objeto(raw)) return null;
  const id = texto(raw.id);
  const code = texto(raw.code);
  const status = texto(raw.status);
  // Sin id, código o estado la fila no se puede mostrar ni ordenar: se descarta.
  if (!id || !code || !status) return null;
  const restaurante = objeto(raw.restaurant) ? raw.restaurant : {};
  const mine = objeto(raw.mine) ? raw.mine : {};
  return {
    id,
    code,
    restaurante: texto(restaurante.name),
    categoria: texto(restaurante.category),
    status,
    divisionMode: raw.division_mode === 'consumo' || raw.division_mode === 'igual' ? raw.division_mode : null,
    guaranteeMode: typeof raw.guarantee_mode === 'boolean' ? raw.guarantee_mode : null,
    closureReason: raw.closure_reason === 'all_items_selected' || raw.closure_reason === 'time'
      ? raw.closure_reason
      : null,
    createdAt: texto(raw.created_at),
    itemsCount: enteroNoNegativo(mine.items_count),
    amountCents: enteroNoNegativo(mine.amount_cents),
  };
}

export function decodeMisMesas(raw: unknown): PaginaMisMesas {
  if (!objeto(raw) || !Array.isArray(raw.mesas) || !objeto(raw.page)) {
    throw new Error('mis_mesas_response_malformed');
  }
  const cursor = raw.page.next_cursor;
  if (cursor !== null && typeof cursor !== 'string') throw new Error('mis_mesas_response_malformed');
  return {
    mesas: raw.mesas.map(fila).filter((m): m is TuMesa => m !== null),
    nextCursor: cursor,
  };
}
