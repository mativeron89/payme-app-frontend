import type { MesaStatus, WalletTxType } from '../api/types';

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
  partially_paid: 'Falta pagar',
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

const TX_EMOJI: Record<WalletTxType, string> = {
  topup_oxxo: '🏪',
  topup_card: '💳',
  topup_spei: '🏦',
  transfer_in: '↘️',
  transfer_out: '↗️',
  payment_mesa: '🍝',
  refund_mesa: '↩️',
  tip_received: '💰',
  tip_payout: '💸',
  adjustment_credit: '➕',
  adjustment_debit: '➖',
};

export function walletTxEmoji(type: WalletTxType | string): string {
  return TX_EMOJI[type as WalletTxType] ?? '•';
}
