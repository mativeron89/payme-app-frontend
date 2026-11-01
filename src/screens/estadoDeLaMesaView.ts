import type { MesaDetail } from '../api/types';
import { formatMXN } from '../utils/format';
import { leerMiembros } from '../api/miembros';
import { confirmedConsumptionProgress, platosSinDueno } from './mesaItemsView';
import { personasDeLaMesa, type PersonasDeLaMesa } from './quienEligioView';

type Traducir = (s: string, ...a: unknown[]) => string;

export interface EstadoDeLaMesa {
  /** Línea 1: «Todavía no eligió nadie» o «Falta elegir $X de $Y». La que se anuncia. */
  readonly titular: string;
  /** Línea 2: los platos sin dueño (y los a medias), o `null` si no hay qué decir. */
  readonly platos: string | null;
  readonly consejo: string;
  /**
   * AF-4 · línea 3: «Se sumaron N de M» con las fichas, sólo con `members` del dueño
   * (`members_version=1`, 2.210.0) y con esperados. Sin el dato la clave no está y la
   * tarjeta queda como en AF-2.
   */
  readonly personas?: PersonasDeLaMesa;
}

/**
 * D622 · AF-2 · mejora 2 (§2 de la especificación). AF-4 suma «Se sumaron N de
 * M» con el contrato de AB-1 (`mesa.members`, D628): sin ese dato la línea no
 * existe; no se inventa un conteo.
 *
 * Sólo cuenta lo REGISTRADO por la mesa (`confirmedConsumptionProgress`, con el
 * `remaining_bps` del dueño), no el borrador de quien mira: es el estado de la
 * mesa, no la barra en vivo de la cabecera. Sin identidad y sin montos por
 * persona (D628–D631).
 *
 * `null` = no hay tarjeta:
 * - la mesa de ejemplo de la guía (D367: la guía no escribe ni promete);
 * - partes iguales (fuera de esta entrega) o una mesa con garantía: sólo la
 *   mesa sin garantía por consumo se cierra sola al elegir todo
 *   (`closure_reason: all_items_selected`), que es lo que el consejo afirma;
 * - una mesa que no está abierta (`open` / `partially_paid`);
 * - un reparto que no se puede calcular, platos que no suman el total de la
 *   mesa (no se afirma «falta») o todo ya elegido (la mesa se está cerrando).
 */
export function estadoDeLaMesa(
  mesa: MesaDetail,
  quien: { readonly esOrganizador: boolean; readonly ejemplo: boolean },
  t: Traducir,
): EstadoDeLaMesa | null {
  if (quien.ejemplo) return null;
  if (mesa.division_mode !== 'consumo' || mesa.guarantee_mode !== false) return null;
  if (mesa.status !== 'open' && mesa.status !== 'partially_paid') return null;
  const avance = confirmedConsumptionProgress(mesa);
  if (avance.status !== 'known' || !avance.totalMatchesItems || avance.complete) return null;
  const platos = platosSinDueno(mesa);
  if (!platos) return null;

  const nadie = avance.assignedCents === 0;
  const personas = personasDeLaMesa(leerMiembros(mesa), t);
  return {
    titular: nadie
      ? t('Todavía no eligió nadie')
      : t('Falta elegir {0} de {1}', formatMXN(avance.differenceCents), formatMXN(mesa.total_cents)),
    platos: nadie ? null : lineaDePlatos(platos.sinDueno, platos.aMedias, t),
    consejo: quien.esOrganizador
      ? t('Antes de cerrar la mesa, revisa que todos hayan elegido lo suyo.')
      : t('Cuando se elija todo, la mesa se cierra sola.'),
    ...(personas && { personas }),
  };
}

/**
 * «Quedan 3 platos sin dueño.»; los a medias se nombran aparte sólo si hay. Con todos los platos con dueño y alguno
 * a medias, sólo los a medias (AF-3, m3 de E06: antes la línea desaparecía y no decía qué faltaba). Sin nada, nada.
 */
function lineaDePlatos(sinDueno: number, aMedias: number, t: Traducir): string | null {
  if (sinDueno === 0) {
    if (aMedias === 0) return null;
    return aMedias === 1 ? t('Queda 1 plato a medias.') : t('Quedan {0} platos a medias.', aMedias);
  }
  if (aMedias === 0) {
    return sinDueno === 1 ? t('Queda 1 plato sin dueño.') : t('Quedan {0} platos sin dueño.', sinDueno);
  }
  if (sinDueno === 1) {
    return aMedias === 1 ? t('Queda 1 plato sin dueño y 1 a medias.') : t('Queda 1 plato sin dueño y {0} a medias.', aMedias);
  }
  return aMedias === 1
    ? t('Quedan {0} platos sin dueño y 1 a medias.', sinDueno)
    : t('Quedan {0} platos sin dueño y {1} a medias.', sinDueno, aMedias);
}
