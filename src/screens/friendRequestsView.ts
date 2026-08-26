import type { IncomingFriendRequest, OutgoingFriendRequest } from '../api/types';

/**
 * OLA 3C · CORRECCIÓN · qué se puede mostrar de una solicitud, y qué no.
 *
 * `POST /friends` responde `202 { requested: true }` exista o no la persona,
 * iguala el tiempo con `pg_sleep` y limita por usuario autenticado. Todo eso
 * está puesto para una sola cosa: **que mandar una solicitud no confirme si una
 * cuenta existe.**
 *
 * App Backend v2.71 cierra también la señal de cardinalidad: cada intento crea
 * un recibo opaco y `GET ...direction=outgoing` devuelve sólo `{id,
 * requested_at}`. Durante la secuencia Frontend→Backend, el decoder acepta el
 * DTO anterior con `user`, pero lo destruye antes de que alcance esta vista.
 *
 * La asimetría entrante/saliente NO es un descuido, es la regla:
 *
 * - **ENTRANTE** — quien la mandó eligió darse a conocer. Mostrar su nombre es
 *   consecuencia de un acto suyo, y sin nombre no hay forma de decidir si
 *   aceptar. Se muestra completo.
 * - **SALIENTE** — el destinatario no hizo nada. Su nombre le llegaría a
 *   cualquiera que haya tipeado su correo. No se muestra hasta que acepte; ahí
 *   aparece en la lista de amigos, que es el lugar donde el consentimiento ya
 *   ocurrió.
 *
 * El tipo `OutgoingRowView` es la única puerta: la pantalla guarda ESTO en su
 * estado, no el DTO legacy. La identidad se descarta en el borde de red y
 * nunca entra al componente, así que no alcanza con acordarse de no pintarla:
 * no está.
 *
 * El cierre owner-first está documentado como G-25. Este archivo conserva la
 * asimetría deliberada: entrantes con identidad; salientes sólo con recibo.
 */

/** Solicitud ENTRANTE: lleva identidad, y debe llevarla. */
export interface IncomingRowView {
  requestId: string;
  /** Id de la PERSONA (para bloquear). Distinto de `requestId`. */
  userId: string;
  fullName: string;
  firstName: string;
  paymeId: string;
}

/**
 * Solicitud SALIENTE: **sin un solo campo de identidad**.
 *
 * Si agregás un campo acá, `friendRequestsView.test.ts` se pone en rojo: el
 * test compara el juego de claves completo, no una lista de prohibidas, así que
 * también atrapa un campo nuevo que nadie previó.
 */
export interface OutgoingRowView {
  requestId: string;
  requestedAt: string;
}

export function incomingRowView(r: IncomingFriendRequest): IncomingRowView {
  return {
    requestId: r.id,
    userId: r.user.id,
    fullName: r.user.full_name,
    firstName: r.user.first_name,
    paymeId: r.user.payme_id,
  };
}

export function outgoingRowView(r: OutgoingFriendRequest): OutgoingRowView {
  return { requestId: r.id, requestedAt: r.requested_at };
}

/**
 * La UI obtiene una lista nueva sólo después del 200 contractual de DELETE.
 * Rechazo/red/2xx malformado propagan error y dejan intacta la lista original.
 */
export async function cancelOutgoingReceipt(
  rows: readonly OutgoingRowView[],
  receiptId: string,
  cancel: (receiptId: string) => Promise<void>,
): Promise<OutgoingRowView[]> {
  await cancel(receiptId);
  return rows.filter((row) => row.requestId !== receiptId);
}
