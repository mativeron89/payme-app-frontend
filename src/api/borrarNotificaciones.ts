import type { AppNotification } from './types';

/**
 * E174 · decisión 174 de Mati · App Backend v2.148.0.
 *
 * - `DELETE /notifications` responde `{ deleted_count }`, un entero ≥ 0 (también
 *   0 sin notificaciones). Cualquier otra forma no acredita el borrado.
 * - `has_inviter_avatar` del payload de `invitation_received` es sólo una
 *   PISTA, calculada al crear la invitación: la ruta de la foto vuelve a decidir
 *   en cada pedido. Las notificaciones previas a v2.148.0 no la traen y se
 *   tratan como `false`.
 */
export function decodeBorradoDeNotificaciones(raw: unknown): { deleted_count: number } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)
      || Object.keys(raw).length !== 1 || !('deleted_count' in raw)) {
    throw new Error('notification_delete_all_response_malformed');
  }
  const count = (raw as { deleted_count: unknown }).deleted_count;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new Error('notification_delete_all_response_malformed');
  }
  return { deleted_count: count };
}

/** `true` sólo si es una invitación recibida con la pista exactamente en `true`. */
export function pideFotoDelInvitador(notification: Pick<AppNotification, 'type' | 'payload'>): boolean {
  return notification.type === 'invitation_received'
    && notification.payload?.has_inviter_avatar === true;
}

/** Las ids de las notificaciones cuya foto de invitador se pide. */
export function idsConFotoDelInvitador(lista: readonly AppNotification[]): Set<string> {
  return new Set(lista.filter(pideFotoDelInvitador).map((n) => n.id));
}

/** La lista sin esa notificación (borrada con éxito). */
export function sinLaNotificacion<T extends Pick<AppNotification, 'id'>>(lista: readonly T[], id: string): T[] {
  return lista.filter((n) => n.id !== id);
}

/** El id del título de una fila: lo nombra la papelera (`aria-describedby`). */
export function idDelTituloDeAviso(notificationId: string): string {
  return `aviso-titulo-${notificationId}`;
}
