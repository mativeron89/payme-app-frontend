import {
  clearPendingInvitationLink,
  rememberInvitationLink,
  stripTokenFromUrl,
} from '../api/invitationLink';
import type { JoinLinkOutcome } from './joinLinkView';

/**
 * ORDEN 4B · la custodia del token de invitación, como secuencia ejecutable.
 *
 * ## Qué defecto cierra
 *
 * `JoinMesaScreen` soltaba la credencial por resultado —terminal suelta,
 * reintentable conserva— pero **soltar era sólo `clearPendingInvitationLink()`**.
 * Y el storage no es la única custodia: cuando el round-trip falla —modo
 * privado, cuota, un WebView con storage particionado— el token **se queda en
 * la URL a propósito**, porque preferimos un token visible a un token perdido.
 *
 * En ese estado, un 400 o un 403 limpiaban un storage que nunca tuvo nada y
 * dejaban el `?t=` vivo en el hash y en el historial. La credencial queda
 * expuesta —en la barra de direcciones de un teléfono que se pasa en la mesa,
 * en el historial, en lo que se comparte con un "mirá"— **después de que el
 * emisor ya dijo que no sirve para nada**. Soltar una credencial terminal
 * significa soltarla de las DOS custodias, no de una.
 *
 * ## Por qué vive acá y no adentro de la pantalla
 *
 * Esta suite no tiene librería de render —por ratificación de Mati— así que un
 * `useEffect` **no es ejercitable**: `renderToStaticMarkup` monta el árbol real
 * pero no corre efectos. Mientras la secuencia viviera dentro del efecto, lo
 * único testeable era el helper aislado, y el Auditor de Codex fue explícito en
 * que eso no alcanza: el defecto no estaba en `stripTokenFromUrl`, que funciona
 * perfecto, sino en **quién lo llama y cuándo**.
 *
 * Sacándola acá, el "cuándo" pasa a ser código ejecutable y se puede recorrer
 * la matriz entera con storage funcional, storage que lanza y storage que
 * acepta la escritura y no persiste. Lo que queda dentro de la pantalla son
 * tres llamadas, y que sigan siendo esas tres lo fija el guardarraíl de fuente
 * de `invitationCustody.test.ts`.
 *
 * ## La matriz, que es el contrato de este módulo
 *
 * ```
 * éxito                              ⇒ soltar storage Y URL
 * 400 invitation_token_required      ⇒ soltar storage Y URL   (terminal)
 * 403 invitation_link_not_valid      ⇒ soltar storage Y URL   (terminal)
 * 503 invitation_link_unavailable    ⇒ CONSERVAR              (reintentable)
 * red caída / timeout                ⇒ CONSERVAR              (reintentable)
 * 5xx genérico                       ⇒ CONSERVAR              (reintentable)
 * 2xx malformado                     ⇒ CONSERVAR              (reintentable)
 * ```
 *
 * Conservar de más y soltar de más rompen en direcciones opuestas: soltar un
 * token vivo deja a la persona sin poder reintentar entrar a la mesa a la que
 * la invitaron; conservar uno muerto deja esa mesa capturada por un link
 * inválido en cada visita, y encima expuesto.
 */

/**
 * Paso 1 del circuito: llega el link, hay que custodiar el token **antes** de
 * que la persona se vaya al alta.
 *
 * ⭐ EL ORDEN NO ES NEGOCIABLE: guardar → comprobar el round-trip → **sólo
 * entonces** retirar de la URL. `setItem` puede no tirar y aun así no
 * persistir, y si la URL ya se limpió no queda ninguna custodia: la persona se
 * registra y queda AFUERA de la mesa a la que la invitaron, que es peor que el
 * defecto que el cierre del pago sin cuenta vino a corregir.
 *
 * Devuelve si la credencial quedó realmente custodiada en storage. `false`
 * significa "la URL es la única custodia que hay" — no es un error, es el modo
 * degradado correcto.
 */
export function openInvitationCustody(code: string, token: string): boolean {
  const custodiado = rememberInvitationLink(code, token);
  if (custodiado) stripTokenFromUrl();
  return custodiado;
}

/**
 * El canje cerró. La credencial ya se usó y **no se conserva después de usarla**.
 *
 * El `stripTokenFromUrl` de acá es cinturón y tirantes: si el round-trip había
 * fallado, el token seguía en la URL, y éste es el momento en que ya no hace
 * falta para nada.
 */
export function closeInvitationCustody(): void {
  clearPendingInvitationLink();
  stripTokenFromUrl();
}

/**
 * El canje falló. Decide el estado visible **y ejecuta la custodia que le
 * corresponde**, en la misma función a propósito.
 *
 * Separarlas fue el origen del defecto: la decisión "esto es terminal" vivía en
 * un `const terminal` y la ejecución en dos llamadas sueltas, y una de las dos
 * faltaba. Acá no pueden divergir — no hay forma de agregar un estado terminal
 * nuevo sin pasar por el mismo `if`.
 *
 * `status` es el de `extractApiError`: `null` cubre red caída, timeout y
 * respuesta malformada, que es exactamente el conjunto que NO dice nada sobre
 * si el token sirve.
 */
export function settleInvitationFailure(status: number | null): JoinLinkOutcome {
  // TERMINAL = el emisor ya decidió que este canje no va a cerrar. Nada de lo
  // que haga la persona lo va a cambiar, así que la credencial se suelta
  // ENTERA. El 410 (v2.45.0, `mesa_not_joinable`) es terminal por lo mismo:
  // el token era genuino pero la mesa no revive — "no hay replay útil", dice
  // el propio emisor. En ESTA puerta el 410 sólo puede ser mesa_not_joinable
  // (el `invitation_expired` 410 vive en la puerta in-app, otra pantalla).
  const terminal = status === 400 || status === 403 || status === 410;
  if (terminal) {
    clearPendingInvitationLink();
    // ⭐ El arreglo de 4B. Antes esta línea no existía y la URL conservaba el
    // `?t=` de un token muerto cada vez que el storage no había persistido.
    stripTokenFromUrl();
  }
  return status === 400
    ? 'invalid'
    : status === 403
      ? 'rejected'
      : status === 410
        ? 'mesa_cerrada'
        : status === 503
          ? 'unavailable'
          : 'error';
}
