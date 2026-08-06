import type { FriendRequest } from '../api/types';

/**
 * OLA 3C · CORRECCIÓN · qué se puede mostrar de una solicitud, y qué no.
 *
 * `POST /friends` responde `202 { requested: true }` exista o no la persona,
 * iguala el tiempo con `pg_sleep` y limita por usuario autenticado. Todo eso
 * está puesto para una sola cosa: **que mandar una solicitud no confirme si una
 * cuenta existe.**
 *
 * Pero el backend sólo inserta la fila cuando el destino existe y está activo
 * (`contract-mirror/routes/friends.js:136-151`), y `GET /friends/requests`
 * proyecta `payme_id, first_name, last_name` (`:206-232`). Con eso, pintar la
 * lista de SALIENTES devolvía en la pantalla siguiente exactamente lo que el
 * POST se había negado a decir — y encima con nombre y apellido reales de
 * alguien que nunca aceptó nada. **La ceguera del POST no sirve de nada si la
 * pantalla siguiente publica el resultado.**
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
 * estado, no el `FriendRequest`. La identidad se descarta en el borde de red y
 * nunca entra al componente, así que no alcanza con acordarse de no pintarla —
 * no está.
 *
 * ⚠️ Esto es MITIGACIÓN, no cierre. La señal presencia/ausencia sobrevive: una
 *    solicitud a alguien que no existe no crea fila y una a alguien que sí
 *    existe la crea, así que el contador todavía distingue los dos casos. Eso
 *    sólo se cierra en el emisor —`GET /friends/requests` es de App Backend— y
 *    está pedido en `GAPS.md` (G-25). No declarar cerrado el oráculo por este
 *    archivo.
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

export function incomingRowView(r: FriendRequest): IncomingRowView {
  return {
    requestId: r.id,
    userId: r.user.id,
    fullName: r.user.full_name,
    firstName: r.user.first_name,
    paymeId: r.user.payme_id,
  };
}

export function outgoingRowView(r: FriendRequest): OutgoingRowView {
  // Deliberadamente NO se propaga `r.user`. Ver el docblock de arriba.
  return { requestId: r.id, requestedAt: r.requested_at };
}
