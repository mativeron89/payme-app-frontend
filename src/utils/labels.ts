import type { MesaStatus, WalletTxType } from '../api/types';
import type { IconName } from '../components/Icon';

/**
 * Traducción de los enums del contrato a lenguaje de usuario.
 *
 * Regla: NINGÚN valor crudo del backend (`partially_paid`, `payment_mesa`,
 * `succeeded`…) se muestra en pantalla. El contrato manda en el código; acá
 * se decide cómo se le cuenta al comensal.
 */

const MESA_STATUS: Record<MesaStatus, string> = {
  pending_auth: 'Autorizando',
  open: 'Abierta',
  // §1.1 (corrección de honestidad, 2026-08-05): es el estado de la MESA, no
  // del que mira — quien ya pagó su parte leía "Falta pagar" como deuda
  // propia. AF-18 (dueño v2.93.0, G-34 cerrado): cuando `/mesas/open` trae
  // `my_status` `paid`/`pending`, la pantalla muestra la etiqueta PERSONAL
  // (`estadoPersonalDeMesa`, abajo); ésta sigue siendo la genérica para
  // `not_applicable`, un estado ausente o uno desconocido.
  partially_paid: 'Pago en curso',
  fully_paid: 'Completa',
  expired: 'Vencida',
  settling: 'Cerrando',
  settled: 'Cerrada',
  dispersing: 'Cerrada',
  completed: 'Cerrada',
  auth_failed: 'Sin garantía',
  cancelled: 'Cancelada',
  // 🔴 FALTABA (ORDEN 2-A, 2026-08-07): `dispersed` está en la FSM del dueño
  // —terminal del flujo legacy sin garantía— y este `Record` exhaustivo no lo
  // tenía, porque el union `MesaStatus` tampoco. Caía en el `?? 'En curso'`
  // del getter: una mesa TERMINADA se leía como si siguiera viva. Para el
  // comensal es una mesa cerrada y así se dice.
  dispersed: 'Cerrada',
};

/**
 * 🔴 LOS RÓTULOS DE ACÁ ESTÁN EN ESPAÑOL A PROPÓSITO y se traducen AL
 * RENDERIZAR. Son constantes de módulo: no hay `t` en este ámbito.
 *
 * Lo destapó UNA CAPTURA, no el barrido del DOM: la insignia decía «Pago en
 * curso» dentro de la app en inglés, y mi detector de español no la vio
 * porque la frase **no lleva ni un acento** y ninguna de sus palabras estaba
 * en mi lista. **Un discriminador incompleto informa lo mismo que una
 * pantalla limpia.**
 */
export function mesaStatusLabel(status: MesaStatus | string): string {
  return MESA_STATUS[status as MesaStatus] ?? 'En curso';
}

/** Clase del badge acorde al estado (el color acompaña al texto, no lo reemplaza). */
export function mesaStatusBadgeClass(status: MesaStatus | string): string {
  if (status === 'partially_paid') return 'badge badge-orange';
  if (status === 'fully_paid' || status === 'completed' || status === 'settled' || status === 'dispersed') {
    return 'badge badge-gray';
  }
  return 'badge badge-teal';
}

const TX_LABEL: Record<WalletTxType, string> = {
  topup_oxxo: 'Carga en OXXO',
  topup_card: 'Carga con tarjeta',
  topup_spei: 'Abono por SPEI',
  transfer_in: 'Transferencia recibida',
  transfer_out: 'Transferencia enviada',
  payment_mesa: 'Pago de mesa',
  refund_mesa: 'Devolución de mesa',
  tip_received: 'Propina recibida',
  tip_payout: 'Propina enviada',
  adjustment_credit: 'Ajuste a favor',
  adjustment_debit: 'Ajuste en contra',
};

export function walletTxLabel(type: WalletTxType | string): string {
  return TX_LABEL[type as WalletTxType] ?? 'Movimiento';
}

const TX_ICON: Record<WalletTxType, IconName> = {
  topup_oxxo: 'store',
  topup_card: 'card',
  topup_spei: 'bank',
  transfer_in: 'arrow-down-left',
  transfer_out: 'arrow-up-right',
  payment_mesa: 'dining',
  refund_mesa: 'refresh',
  tip_received: 'cash',
  tip_payout: 'cash',
  adjustment_credit: 'plus',
  adjustment_debit: 'minus',
};

export function walletTxIcon(type: WalletTxType | string): IconName {
  return TX_ICON[type as WalletTxType] ?? 'wallet';
}

/**
 * Categoría del RESTAURANTE — el enum de `restaurants.category` del contrato
 * (`italian | japanese | mexican | cafe | other`), que es lo que devuelve
 * `favorite_category` de `GET /account/stats`.
 *
 * **No es el tipo del plato.** El spec de Estadísticas (§1.11) lo dice con
 * todas las letras porque es una confusión fácil y cara: el ranking por
 * tipología de plato —carne, pescado, pollo— no existe en ninguna parte del
 * contrato, y clasificar qué comió cada persona roza categorías sensibles
 * (una dieta puede revelar religión o condición de salud). El copy dice
 * "cocina" y no promete otra cosa.
 *
 * Un valor desconocido devuelve `null`, no "Otros": si el emisor agrega una
 * categoría nueva, preferimos no mostrarla a mostrarla mal.
 */
const CATEGORIA: Record<string, string> = {
  italian: 'Italiana',
  japanese: 'Japonesa',
  mexican: 'Mexicana',
  cafe: 'Café',
  other: 'Otros',
};

export function categoryLabel(category: string | null | undefined): string | null {
  if (!category) return null;
  return CATEGORIA[category] ?? null;
}

// ─── AF-18 · campos aditivos del dueño v2.93.0 ─────────────────────────────
//
// Los tres llegan en `GET /mesas/open` e `/invitations` como claves NUEVAS y
// sin decodificador de claves exactas: contra un backend 2.92.0 simplemente
// no vienen. Por eso cada uno se lee acá, campo por campo, y cualquier forma
// que no sea la del contrato cae en `null` ⇒ la conducta 0.168.0 de siempre.

/** G-27 · `participants_count`: los que se SUMARON (no los esperados). */
export function personasEnMesa(mesa: { readonly participants_count?: unknown }): number | null {
  const n = mesa.participants_count;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Estados de mesa en los que la persona todavía puede estar pagando. */
const MESA_EN_CURSO = new Set<string>(['open', 'partially_paid']);

export type EstadoPersonal = 'paid' | 'pending';

/**
 * 🔴 G-34 · decisión de Mati del 2026-09-18, «Según lo que eligió cada uno».
 *
 * `my_status` lo calcula el dueño SÓLO para quien mira. Se personaliza la
 * etiqueta únicamente con `paid` o `pending` y en una mesa que sigue en curso:
 * «Ya pagaste, faltan otros» con la mesa ya completa sería falso.
 * `not_applicable`, ausente o cualquier valor desconocido ⇒ `null`, y la
 * pantalla usa la etiqueta genérica de la MESA (`mesaStatusLabel`). No se
 * infiere nada de `pct_paid` ni de montos: eso es de la mesa entera.
 */
export function estadoPersonalDeMesa(mesa: {
  readonly status: string;
  readonly my_status?: unknown;
}): EstadoPersonal | null {
  if (!MESA_EN_CURSO.has(mesa.status)) return null;
  return mesa.my_status === 'paid' || mesa.my_status === 'pending' ? mesa.my_status : null;
}

/**
 * `my_paid_cents`: lo que pagó ESTA cuenta, con propina y menos reembolsos.
 * Sólo acompaña a una etiqueta personal, y sólo si es un entero de centavos
 * ≥ 0. Nunca se muestra ni se deriva lo que pagó otro.
 */
export function pagadoPropioCentavos(mesa: {
  readonly status: string;
  readonly my_status?: unknown;
  readonly my_paid_cents?: unknown;
}): number | null {
  if (estadoPersonalDeMesa(mesa) === null) return null;
  const c = mesa.my_paid_cents;
  return typeof c === 'number' && Number.isSafeInteger(c) && c >= 0 ? c : null;
}

/**
 * G-31 · el ícono de la tarjeta de invitación sale de `restaurant_category`
 * (enum cerrado del dueño). Ausente, desconocido u `other` ⇒ `store`, el
 * genérico de siempre, que no afirma ninguna cocina. Nunca se infiere del
 * nombre del restaurante.
 *
 * ⚠️ No es el mismo mapa que `MesasScreen` (`other → dining`) y es a
 * propósito: a 26px, los círculos de `dining` se leen como una diana.
 */
const ICONO_CATEGORIA: Record<string, IconName> = {
  italian: 'pasta',
  japanese: 'sushi',
  mexican: 'taco',
  cafe: 'coffee',
};

export function iconoDeCategoriaRestaurante(category: unknown): IconName {
  return typeof category === 'string' && Object.hasOwn(ICONO_CATEGORIA, category)
    ? ICONO_CATEGORIA[category]!
    : 'store';
}
