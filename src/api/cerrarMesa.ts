/**
 * AF-34 · n98 · el organizador cierra la mesa · `POST /api/mesas/:code/close`
 * (dueño v2.113.0 · handoff `docs/HANDOFF_MESA_QUE_VENCE_Y_CIERRE_V2.113.0.md`).
 *
 * 200 `{ mesa_status: "expired", closure_reason: "closed_by_organizer" }`, también
 * si ya la había cerrado él (idempotente). Claves exactas: la pantalla recarga la
 * mesa igual, pero un 200 con otra forma no se toma como cierre.
 */
export interface MesaCerrada {
  readonly mesaStatus: 'expired';
  readonly closureReason: 'closed_by_organizer';
}

export function decodeMesaCerrada(raw: unknown): MesaCerrada {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('close_response_malformed');
  const r = raw as Record<string, unknown>;
  const claves = Object.keys(r).sort();
  if (claves.length !== 2 || claves[0] !== 'closure_reason' || claves[1] !== 'mesa_status'
      || r.mesa_status !== 'expired' || r.closure_reason !== 'closed_by_organizer') {
    throw new Error('close_response_malformed');
  }
  return { mesaStatus: 'expired', closureReason: 'closed_by_organizer' };
}

/**
 * Qué hace la pantalla con cada respuesta del dueño. Pura, para testearla sin
 * red: `status` y `code` salen de `extractApiError`.
 * - `recargar`: se cerró (o ya estaba cerrada) ⇒ recargar la mesa.
 * - `retirar`: el botón no corresponde (403) o todavía no existe (409
 *   `close_not_applicable`, 404 de un backend anterior) ⇒ se saca en esa mesa.
 * - `reintentar`: error neutro, el botón sigue.
 */
export type ResultadoDeCerrar =
  | { readonly accion: 'recargar'; readonly aviso: 'ya_cerrada' | null }
  | { readonly accion: 'retirar'; readonly aviso: 'no_disponible' | null }
  | { readonly accion: 'reintentar' };

export function resultadoDeCerrar(status: number | null, code: string): ResultadoDeCerrar {
  if (status === 409 && code === 'mesa_not_active') return { accion: 'recargar', aviso: 'ya_cerrada' };
  if (status === 403) return { accion: 'retirar', aviso: null };
  if ((status === 409 && code === 'close_not_applicable') || status === 404) return { accion: 'retirar', aviso: 'no_disponible' };
  return { accion: 'reintentar' };
}
