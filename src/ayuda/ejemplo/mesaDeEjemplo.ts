import { informativeSelectionResponse } from '../../api/contractResponses';
import { denominatorBps, topePorcion } from '../../api/mesaPresentation';
import type { Participante } from '../../api/participantes';
import { decodeSoltarConsumo, type ConsumoSoltado } from '../../api/soltarConsumo';
import {
  INFORMATIVE_SELECTION_CONTRACT,
  type InformativeSelectionResponse,
  type LockFractionRequest,
  type LockItemsResponse,
  type MesaDetail,
  type MesaDetailResponse,
  type ReplaceInformativeSelectionRequest,
} from '../../api/types';
import { modoContrato } from '../../screens/divisionModo';
import { centsToDisplay, splitEqual } from '../../utils/money';
import { mesaArmada, type EstadoArmado, type EstadoDelEjemplo } from './estadoEjemplo';
import {
  CODIGO_EJEMPLO,
  ID_MESA_DE_EJEMPLO,
  PLATOS_DE_EJEMPLO,
  RESTAURANTE_DE_EJEMPLO,
  TOTAL_DE_EJEMPLO_CENTS as TOTAL_CENTS,
  VIDA_DE_LA_MESA_DE_EJEMPLO_MS,
} from './fixtureEjemplo';

/**
 * D363 · D367 · la mesa de ejemplo, armada y modificada en memoria.
 *
 * Plan técnico §4.1: **el mock no sirve de motor** (se persiste, se comparte con
 * el build real si no se namespacea y no viaja en el build real), así que el
 * ejemplo trae este constructor chico. Replica del dueño sólo lo que el
 * recorrido toca: el detalle de una mesa abierta SIN garantía, la reserva de
 * `items/lock` con su tolerancia de completar, `items/release` y la selección
 * informativa de «igual».
 *
 * 🔴 **Lo que el detalle NO trae, a propósito** (delta del plan §3, punto 5):
 * `tip_setting`, `share_totals` ni `my_share` (sin ellas no se ofrece propina, ni
 * «Propina de la mesa», ni «Cómo se arma tu parte»: D367 deja la propina fuera
 * del ejemplo), `ticket_totals` ni `ticket_adjustments`. Ausentes y no `null`:
 * es la forma de un dueño que no las publica, que la app ya sabe leer.
 *
 * 🔴 **Nunca cierra la mesa.** El dueño cierra una mesa sin garantía cuando la
 * selección cubre todos los platos (`all_items_selected`); el ejemplo no: la
 * mesa tiene que seguir abierta para que Inicio la muestre en el final (4a). Por
 * eso ninguna respuesta de acá lleva `mesa_status`, y la selección informativa
 * siempre vuelve `open`. Que el «Listo» no abra «Con esto se cierra la mesa» lo
 * cuida además la bandera `ejemplo` de `MesaDetailView` (punto 2).
 *
 * Las respuestas que la fachada decodifica (selección informativa y soltar) se
 * arman CRUDAS y pasan por **los mismos decodificadores estrictos** que el `api`
 * real: si el contrato cambia, el ejemplo se pone rojo acá y no en la pantalla.
 * La lista de participantes (vacía) la coteja el test con su decodificador.
 */

/** Un pedido que el ejemplo no acepta. Nunca sale a la red: es un rechazo de la memoria. */
export class RechazoDelEjemplo extends Error {
  constructor(readonly codigo: string) {
    super(codigo);
    this.name = 'RechazoDelEjemplo';
  }
}

function armado(estado: EstadoDelEjemplo): EstadoArmado {
  if (!mesaArmada(estado)) throw new RechazoDelEjemplo('ejemplo_sin_mesa');
  return estado;
}

/** El detalle de `GET /mesas/PA-1224`: una mesa abierta sin garantía, con la selección del ejemplo. */
export function detalleDeEjemplo(estadoActual: EstadoDelEjemplo): MesaDetailResponse {
  const estado = armado(estadoActual);
  const modo = modoContrato(estado.division);
  const igual = modo === 'igual';
  const mesa: MesaDetail = {
    id: ID_MESA_DE_EJEMPLO,
    code: CODIGO_EJEMPLO,
    full_name: `Mesa ${CODIGO_EJEMPLO} - ${RESTAURANTE_DE_EJEMPLO.name}`,
    restaurant: { ...RESTAURANTE_DE_EJEMPLO },
    total_cents: TOTAL_CENTS,
    total_display: centsToDisplay(TOTAL_CENTS),
    paid_amount_cents: 0,
    tip_amount_cents: 0,
    tip_base_cents: Math.round(TOTAL_CENTS / estado.personas),
    division_mode: modo,
    expected_participants: estado.personas,
    original_participants: estado.personas,
    status: 'open',
    expires_at: new Date(estado.armadaEn + VIDA_DE_LA_MESA_DE_EJEMPLO_MS).toISOString(),
    // P3 · explícito: sin garantía. La bandera `ejemplo` esconde lo que esto
    // habilitaría para el titular (el cierre por selección y «Cerrar mesa»).
    guarantee_mode: false,
    closure_reason: null,
    informative_selection_capability: {
      contract: INFORMATIVE_SELECTION_CONTRACT,
      supported: igual,
      mutable: igual,
    },
    items: PLATOS_DE_EJEMPLO.map((plato) => {
      const propio = estado.seleccion.get(plato.id) ?? 0;
      const reservado = igual ? 0 : propio;
      return {
        id: plato.id,
        name: plato.name,
        category: 'other',
        price_cents: plato.price_cents,
        quantity: 1,
        status: 'available' as const,
        remaining_bps: 10000 - reservado,
        my_bps: reservado,
        locked_by_me: reservado > 0,
        lock_expires_at: null,
        my_paid_bps: 0,
        my_releasable_bps: reservado,
        informative_remaining_bps: igual ? 10000 - propio : null,
      };
    }),
    ...(igual
      ? {
        division_slots: splitEqual(TOTAL_CENTS, estado.personas).map((amount, idx) => ({
          slot_index: idx,
          amount_cents: amount,
          amount_display: centsToDisplay(amount),
          status: 'available' as const,
          claimed_by_me: false,
        })),
      }
      : {}),
    active_staff: [],
    my_role: 'opener',
  };
  return { mesa };
}

function plato(itemId: unknown) {
  const encontrado = PLATOS_DE_EJEMPLO.find((p) => p.id === itemId);
  if (!encontrado) throw new RechazoDelEjemplo('item_not_found');
  return encontrado;
}

/** Las porciones que el dueño admite con N personas: 1/k con k ≤ min(N, 20). */
function porcionesPermitidas(personas: number): ReadonlySet<number> {
  return new Set(Array.from({ length: topePorcion(personas) }, (_, i) => denominatorBps(i + 1)));
}

/**
 * `POST /mesas/PA-1224/items/lock` en «por lo que pidió cada uno». Como el dueño,
 * lo propio del plato se reemplaza; y como hay una sola persona, lo que queda es
 * siempre el entero. Por eso la tolerancia de completar del dueño
 * (`COMPLETING_TOLERANCE_BPS`, menos de 100 bps sin elegir) no aplica: con
 * porciones 1/k, lo que falta es 0 o al menos la mitad. La reserva no vence:
 * mesa sin garantía.
 */
export function bloquearEnEjemplo(
  estadoActual: EstadoDelEjemplo,
  pedidos: readonly LockFractionRequest[],
): { readonly seleccion: ReadonlyMap<string, number>; readonly respuesta: LockItemsResponse } {
  const estado = armado(estadoActual);
  if (modoContrato(estado.division) !== 'consumo') throw new RechazoDelEjemplo('fraction_denominator_consumo_only');
  if (!Array.isArray(pedidos) || pedidos.length === 0) throw new RechazoDelEjemplo('validation_error');
  const permitidas = porcionesPermitidas(estado.personas);
  const seleccion = new Map(estado.seleccion);
  const claims: Array<{ item_id: string; fraction_bps: number }> = [];
  for (const pedido of pedidos) {
    const elegido = plato(pedido.item_id);
    let pedidoBps: number;
    if ('fraction_denominator' in pedido) {
      const k = pedido.fraction_denominator;
      if (!Number.isSafeInteger(k) || k < 1 || k > topePorcion(estado.personas)) {
        throw new RechazoDelEjemplo('fraction_denominator_exceeds_original');
      }
      pedidoBps = denominatorBps(k);
    } else {
      if (!permitidas.has(pedido.fraction_bps)) throw new RechazoDelEjemplo('fraction_not_allowed_for_original_participants');
      pedidoBps = pedido.fraction_bps;
    }
    seleccion.set(elegido.id, pedidoBps);
    claims.push({ item_id: elegido.id, fraction_bps: pedidoBps });
  }
  return {
    seleccion,
    respuesta: {
      locked: claims.map((c) => c.item_id),
      claims,
      lock_token: 'ejemplo',
      lock_expires_at: null,
    },
  };
}

/** `POST /mesas/PA-1224/items/release`: suelta lo propio de esos platos. */
export function soltarEnEjemplo(
  estadoActual: EstadoDelEjemplo,
  itemIds: readonly string[],
): { readonly seleccion: ReadonlyMap<string, number>; readonly soltados: readonly ConsumoSoltado[] } {
  const estado = armado(estadoActual);
  if (modoContrato(estado.division) !== 'consumo') throw new RechazoDelEjemplo('release_consumo_only');
  const seleccion = new Map(estado.seleccion);
  const released: Array<{ item_id: string; fraction_bps: number }> = [];
  for (const id of itemIds) {
    const elegido = plato(id);
    const propio = seleccion.get(elegido.id) ?? 0;
    if (propio > 0) released.push({ item_id: elegido.id, fraction_bps: propio });
    seleccion.delete(elegido.id);
  }
  return { seleccion, soltados: decodeSoltarConsumo({ released }) };
}

function respuestaInformativa(estado: EstadoArmado): InformativeSelectionResponse {
  const items = [...estado.seleccion.entries()]
    .map(([item_id, declared_fraction_bps]) => ({ item_id, declared_fraction_bps }))
    .sort((a, b) => a.item_id.localeCompare(b.item_id));
  return informativeSelectionResponse({
    contract: INFORMATIVE_SELECTION_CONTRACT,
    mesa: { code: CODIGO_EJEMPLO, division_mode: 'igual', status: 'open', mutable: true, closure_reason: null },
    selection: {
      source: 'informative',
      items,
      updated_at: items.length > 0 && estado.guardadaEn !== null ? new Date(estado.guardadaEn).toISOString() : null,
    },
    coverage: {
      all_items_selected: PLATOS_DE_EJEMPLO.every((p) => estado.seleccion.get(p.id) === 10000),
    },
  });
}

/** `GET /mesas/PA-1224/informative-selection` («En partes iguales» y «Pagar el total»). */
export function seleccionInformativaDeEjemplo(estadoActual: EstadoDelEjemplo): InformativeSelectionResponse {
  const estado = armado(estadoActual);
  if (modoContrato(estado.division) !== 'igual') {
    throw new RechazoDelEjemplo('informative_selection_not_available_for_division_mode');
  }
  return respuestaInformativa(estado);
}

/**
 * `PUT /mesas/PA-1224/informative-selection`. Valida como el dueño (forma exacta,
 * `confirm_closure: true`, cada plato una vez, 1/k con k ≤ min(N, 20)) y
 * devuelve lo guardado; la mesa sigue abierta aunque cubra todo.
 */
export function reemplazarInformativaEnEjemplo(
  estadoActual: EstadoDelEjemplo,
  pedido: ReplaceInformativeSelectionRequest,
  ahora: number = Date.now(),
): { readonly seleccion: ReadonlyMap<string, number>; readonly respuesta: InformativeSelectionResponse } {
  const estado = armado(estadoActual);
  if (modoContrato(estado.division) !== 'igual') {
    throw new RechazoDelEjemplo('informative_selection_not_available_for_division_mode');
  }
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)
      || Object.keys(pedido).length !== 2 || pedido.confirm_closure !== true || !Array.isArray(pedido.items)) {
    throw new RechazoDelEjemplo('validation_error');
  }
  const permitidas = porcionesPermitidas(estado.personas);
  const seleccion = new Map<string, number>();
  for (const item of pedido.items) {
    const elegido = plato(item?.item_id);
    if (seleccion.has(elegido.id) || !permitidas.has(item.declared_fraction_bps)) {
      throw new RechazoDelEjemplo('validation_error');
    }
    seleccion.set(elegido.id, item.declared_fraction_bps);
  }
  const guardada: EstadoArmado = { ...estado, seleccion, guardadaEn: seleccion.size > 0 ? ahora : null };
  return { seleccion, respuesta: respuestaInformativa(guardada) };
}

/**
 * `GET /mesas/PA-1224/participants`: nadie más se sumó (la ficha: «1 persona»,
 * que es quien abrió). Es lo que el decodificador real devuelve para
 * `{ participants: [] }` (lo coteja el test). No se lo llama acá: `participantes.ts`
 * importa `username.ts`, que carga la fachada con `import()` tras un 428, y
 * desde el ejemplo no se llega a la fachada (`sinRed.test.ts`).
 */
export function participantesDeEjemplo(estadoActual: EstadoDelEjemplo): readonly Participante[] {
  armado(estadoActual);
  return [];
}
