import { isDefinitiveMutationError } from '../api/mutationRetry';
import type { InformativeSelectionResponse, MesaDetail } from '../api/types';

/** Foto de lecturas existentes, nunca una revisión atómica del servidor (n422). */
export interface PreparacionListo {
  readonly mesa: MesaDetail;
  readonly selected: Map<string, number>;
  readonly denominators: Map<string, number>;
  readonly informativasGuardadas: ReadonlyMap<string, number>;
  readonly informativeSaved: boolean;
  readonly guardadaLeida: boolean;
  readonly identityEpoch: number;
  readonly readEpoch: number;
  readonly revision: number;
}

export function mismoBorrador(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): boolean {
  return a.size === b.size && [...a].every(([id, bps]) => b.get(id) === bps);
}

/** Un par contradictorio no habilita guardar, aunque cada GET haya tenido éxito. */
export function lecturaCompatible(mesa: MesaDetail, propia: InformativeSelectionResponse): boolean {
  return propia.mesa.code === mesa.code
    && propia.mesa.division_mode === mesa.division_mode
    && propia.mesa.status === mesa.status
    && propia.mesa.closure_reason === (mesa.closure_reason ?? null)
    && propia.selection.items.every(({ item_id }) => mesa.items.some((i) => i.id === item_id));
}

/**
 * Evidencia conservadora de un lock incierto: todos los platos pedidos deben
 * publicar exactamente la fracción propia liberable. Sin ese dato o con una
 * fracción distinta no afirmamos guardado. No fabricamos tokens ni reenviamos.
 * Un tercio absorbido por tolerancia puede quedar inconcluso: se conserva el
 * bloqueo, antes que atribuirle al intento una escritura que no podemos probar.
 */
export function consumoConfirmado(mesa: MesaDetail, intento: ReadonlyMap<string, number>): boolean {
  return intento.size > 0 && [...intento].every(([id, bps]) => {
    const item = mesa.items.find((i) => i.id === id);
    return item !== undefined && item.my_releasable_bps === bps && item.my_bps >= bps;
  });
}

/** Rechazos de dominio anteriores a la escritura en el dueño d203. */
export function rechazoDefinitivoSeleccion(code: string, status: number | null): boolean {
  if (isDefinitiveMutationError(code, status)) return true;
  return status === 409 && [
    'selection_closure_confirmation_required',
    'selection_closure_state_changed',
    'informative_selection_read_only',
    'informative_fraction_exceeds_item',
    'informative_selection_requires_payments_disabled',
    'informative_selection_requires_no_guarantee',
    'informative_selection_not_available_for_division_mode',
    'original_participants_unknown',
    'fraction_denominator_exceeds_original',
    'fraction_not_allowed_for_original_participants',
    'fraction_denominator_consumo_only',
  ].includes(code);
}
