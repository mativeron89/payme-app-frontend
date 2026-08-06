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
  // propia. No se personaliza porque no hay con qué: `/mesas/open` no trae
  // ningún campo por-participante (G-34). Genérico-y-honesto gana a
  // personal-y-falso.
  partially_paid: 'Pago en curso',
  fully_paid: 'Completa',
  expired: 'Vencida',
  settling: 'Cerrando',
  settled: 'Cerrada',
  dispersing: 'Cerrada',
  completed: 'Cerrada',
  auth_failed: 'Sin garantía',
  cancelled: 'Cancelada',
};

export function mesaStatusLabel(status: MesaStatus | string): string {
  return MESA_STATUS[status as MesaStatus] ?? 'En curso';
}

/** Clase del badge acorde al estado (el color acompaña al texto, no lo reemplaza). */
export function mesaStatusBadgeClass(status: MesaStatus | string): string {
  if (status === 'partially_paid') return 'badge badge-orange';
  if (status === 'fully_paid' || status === 'completed' || status === 'settled') {
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
