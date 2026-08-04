/**
 * CIERRE DEL PAGO SIN CUENTA · la copy del canje, como función pura.
 *
 * Vive separada de la pantalla por la misma razón que `friendRequestsView`:
 * este repo **no tiene librería de render**, así que lo único que se puede
 * fijar con tests es la lógica extraída. Y acá lo que hay que fijar es
 * precisamente una regla de privacidad, no una decoración.
 *
 * ## La regla que estos mensajes tienen que respetar
 *
 * El emisor contesta el MISMO `403 invitation_link_not_valid` para los CUATRO
 * motivos de rechazo —inválido, vencido, cancelado y supersedido— **a
 * propósito**: distinguirlos le diría a un desconocido si una mesa existe.
 *
 * Por eso `rejected` es **un solo estado**, no cuatro. No hay dónde escribir
 * "tu link venció" ni "el organizador lo canceló", porque el front no lo sabe
 * y no debe aparentar saberlo. Es la misma doctrina del 202 ciego de
 * `addFriend`, y la lección que dejó la pantalla "Enviadas": *cerrar un oráculo
 * en el emisor no lo cierra si el consumidor publica el resultado*.
 *
 * ## Por qué `unavailable` sí está separado
 *
 * El `503 invitation_link_unavailable` NO es un rechazo: el emisor lo devuelve
 * cuando no puede **verificar** el token (le falta el secreto de firma), y él
 * mismo declara que contestar 403 ahí "afirmaría que el token no sirve".
 * Fundirlo con el rechazo le diría a alguien que su invitación está muerta
 * cuando lo único que pasa es que el backend está a media configuración — y,
 * peor, lo haría dejar de reintentar.
 *
 * La diferencia observable es `retryable`, no el texto: un rechazo no ofrece
 * reintentar porque reintentar no lo va a cambiar.
 */

export type JoinLinkOutcome =
  /** Canjeando, o esperando a que haya sesión. */
  | 'joining'
  /** 403 · los CUATRO motivos del contrato, indistinguibles a propósito. */
  | 'rejected'
  /** 503 · el emisor no pudo verificar. Reintentable. */
  | 'unavailable'
  /** Red caída, timeout, 5xx genérico, 2xx malformado. Reintentable. */
  | 'error';

export interface JoinLinkMessage {
  readonly title: string;
  readonly body: string;
  readonly retryable: boolean;
}

export function joinLinkMessage(outcome: JoinLinkOutcome): JoinLinkMessage {
  switch (outcome) {
    case 'joining':
      return {
        title: 'Sumándote a la mesa…',
        body: 'Un segundo.',
        retryable: false,
      };
    case 'rejected':
      // UN solo texto para los cuatro motivos. Si alguien viene a "mejorar" esto
      // distinguiendo vencido de cancelado: el backend no se lo dice, y no se lo
      // dice a propósito.
      return {
        title: 'Este link ya no sirve',
        body: 'Pedile al organizador que te comparta uno nuevo.',
        retryable: false,
      };
    case 'unavailable':
      return {
        title: 'No pudimos verificar el link',
        body: 'No es que no sirva: no pudimos comprobarlo ahora. Probá de nuevo en un momento.',
        retryable: true,
      };
    case 'error':
      return {
        title: 'No pudimos sumarte',
        body: 'Puede ser la conexión. Probá de nuevo.',
        retryable: true,
      };
  }
}
