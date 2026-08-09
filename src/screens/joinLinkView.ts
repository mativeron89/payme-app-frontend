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
  /**
   * 400 `invitation_token_required` · el token no tiene forma de token (vacío,
   * o fuera de 8..200 caracteres). Es TERMINAL, no un problema de red.
   *
   * Antes caía en `error`, y `error` ofrece reintentar. Eso invita a reintentos
   * engañosos: un link truncado al copiarlo de WhatsApp no se arregla
   * reintentando, y cada reintento le dice a la persona que puede estar por
   * funcionar. La copy honesta es "este link está incompleto".
   *
   * Es un rechazo pero NO se funde con `rejected`: acá el defecto está en el
   * link que la persona tiene en la mano, y eso sí se puede accionar —pedir que
   * se lo manden de nuevo, o abrirlo completo—. No revela nada de la mesa.
   */
  | 'invalid'
  /**
   * 410 `mesa_not_joinable` (v2.45.0) · el token era GENUINO pero la mesa ya
   * no está viva. Pantalla D de §1.2, hermana de las otras — y NO se funde
   * con `rejected` a propósito: el 403 opaco protege al desconocido (no
   * acredita que la mesa exista); el 410 sólo llega DESPUÉS de validar el
   * token, así que quien lo recibe fue invitado de verdad y merece saber qué
   * pasó. Decir "esta mesa ya cerró" acá no regala el oráculo que el 403
   * paga. Terminal: la mesa no revive, no hay replay útil.
   */
  | 'mesa_cerrada'
  /** 503 · el emisor no pudo verificar. Reintentable. */
  | 'unavailable'
  /** Red caída, timeout, 5xx genérico, 2xx malformado. Reintentable. */
  | 'error';

export interface JoinLinkMessage {
  readonly title: string;
  readonly body: string;
  readonly retryable: boolean;
  /**
   * Línea extra ANTES del círculo (pantalla D): el recién registrado que
   * canjeó y encontró la mesa muerta queda con cuenta nueva y cero mesas —
   * un Inicio vacío justo después de un alta se lee como rotura. La
   * explicación vive ACÁ, que es la pantalla que sabe qué pasó: Inicio no
   * tiene por qué adivinar por qué está vacío (Diseño, 2026-08-06). Cada
   * pantalla dice lo que sabe, y nada que tenga que adivinar.
   */
  readonly nota?: string;
}

/**
 * Qué PANTALLA de SPEC_APP.md §1.2 corresponde mostrar.
 *
 * Vive acá, como función pura, por la misma razón que `joinLinkMessage`: la
 * suite no tiene librería de render —por ratificación— así que lo único que se
 * puede fijar con tests es la decisión, no el JSX. Y acá la decisión es una
 * regla de privacidad, no una preferencia de layout:
 *
 *   **sin sesión no se ve NADA de la mesa.** Cualquiera sea el resultado del
 *   canje, sin sesión la pantalla es el alta (§1.2-A) y nunca el detalle del
 *   rechazo ni el nombre del restaurante. El orden de estas ramas ES la regla.
 */
export type JoinLinkStage =
  /** §1.2-A · 401: hay que crear cuenta o entrar. Genérica, sin datos de mesa. */
  | 'signup'
  /** Canjeando, ya con sesión. */
  | 'joining'
  /** §1.2-B · terminal: el link no va a servir. Salida por el círculo. */
  | 'blocked'
  /** No terminal (503, red): la salida es Reintentar. */
  | 'retry'
  /** §1.2-C · canje exitoso. Es el único momento con permiso de nombrar la mesa. */
  | 'joined';

export function joinLinkStage(state: {
  readonly hasSession: boolean;
  readonly hasJoined: boolean;
  readonly outcome: JoinLinkOutcome;
}): JoinLinkStage {
  // El canje ya cerró: hay sesión y hay inscripción. Es lo único que habilita
  // §1.2-C, y por eso va primero.
  if (state.hasJoined) return 'joined';
  if (!state.hasSession) return 'signup';
  if (state.outcome === 'joining') return 'joining';
  return joinLinkMessage(state.outcome).retryable ? 'retry' : 'blocked';
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
      // La copy es la del SPEC_APP.md §1.2-B, textual. Decía "Este link ya no
      // sirve · Pedile al organizador…"; el spec la cerró como "…ya no
      // funciona · Pedile a quien te invitó…", que además no nombra un rol de
      // la mesa: coherente con que esta pantalla no acredita que la mesa exista.
      return {
        title: 'Este link ya no funciona',
        body: 'Pedile a quien te invitó que te comparta uno nuevo.',
        retryable: false,
      };
    case 'invalid':
      return {
        title: 'Este link está incompleto',
        body: 'Puede haberse cortado al copiarlo. Pide que te lo manden de nuevo y ábrelo entero.',
        retryable: false,
      };
    case 'mesa_cerrada':
      // Copy de Diseño, textual (§1.2-D, 2026-08-06). Genérica, sin nombrar
      // restaurante —misma cautela que A—, pero sí dice que ES esta mesa.
      return {
        title: 'Esta mesa ya cerró',
        body: 'Habla con quien te invitó si crees que es un error.',
        retryable: false,
        nota: 'Tu cuenta ya está lista — puedes abrir tu propia mesa cuando quieras.',
      };
    case 'unavailable':
      return {
        title: 'No pudimos verificar el link',
        body: 'No es que no sirva: no pudimos comprobarlo ahora. Prueba de nuevo en un momento.',
        retryable: true,
      };
    case 'error':
      return {
        title: 'No pudimos sumarte',
        body: 'Puede ser la conexión. Prueba de nuevo.',
        retryable: true,
      };
  }
}
