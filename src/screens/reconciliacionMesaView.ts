import type { MesaCreationLookup } from '../api/types';

/**
 * P0 · QUÉ SE HACE CON UNA APERTURA CONGELADA — ORDEN 2A.
 *
 * ## De dónde viene este archivo
 *
 * Nació en la orden 1A.1 conteniendo un defecto: la reconciliación acreditaba
 * una creación **comparando nombres de restaurante** contra `GET /mesas/open`.
 * Tres escenarios, ninguno hipotético, daban "la mesa ya existe":
 * `undefined === undefined` cuando el objeto `restaurant` no venía, la mesa de
 * un amigo en el mismo restaurante (G-28 hace que `/mesas/open` las traiga), y
 * dos sucursales homónimas. La contención fue exigir el **código** de la mesa,
 * guardado como referencia en el journal.
 *
 * 🔴 **Y la mitad simétrica, que era peor:** la AUSENCIA en `/mesas/open`
 * tampoco probaba nada. Ese listado filtra `open | partially_paid`, así que
 * una mesa en `pending_auth` —justo el caso que se reconcilia— **no se lista**.
 * El código viejo leía esa ausencia como "no llegó a crearse" y ofrecía
 * desbloquear: reintentar una garantía sobre una mesa que podía existir con su
 * retención puesta. Se retiró el botón declarando su costo.
 *
 * ## Lo que cambió acá
 *
 * El dueño publicó la evidencia exacta (`GET /mesas/creations/:key`,
 * v2.47.0), resuelta por `(opener_user_id, idempotency_key)`. **Ya no se
 * infiere: se pregunta.** Y como el endpoint es de solo lectura —el dueño no
 * reusó `mesaReplayResponse` porque ésa reconduce holds contra Stripe—,
 * consultar no puede mover un centavo. Diagnóstico y acción, separados.
 *
 * ## La regla que gobierna todo lo de abajo
 *
 * **El journal se libera SÓLO ante prueba positiva exacta.** Liberar de más es
 * una segunda retención por el total de la mesa; liberar de menos es un
 * organizador trabado. Los dos males son reales y no son simétricos: el
 * segundo se arregla con una consulta más, el primero con un refund.
 *
 * 🔴 **`not_found` NO libera, y no es exceso de celo.** El 404 dice que ESA
 * CLAVE no creó nada; no dice nada de una generación anterior. El journal rota
 * la clave ante errores definitivos (`shouldRotateOnError`), así que una mesa
 * creada por la clave previa seguiría existiendo, con su hold, mientras esta
 * consulta contesta "no hay nada". Lo que sí habilita el contrato en ese caso
 * es **reintentar con la MISMA clave**, que por B-06 no puede duplicar: si el
 * 404 era cierto, crea por primera vez; si mintió, devuelve la mesa existente.
 */

export type VeredictoReconciliacion =
  /** La mesa existe y avanzó. Prueba positiva exacta: se libera y se navega. */
  | 'acreditada'
  /** `auth_failed | cancelled | expired`: la creación terminó y está muerta. */
  | 'muerta'
  /** La mesa existe en `pending_auth`: el hold quedó sin autorizar. */
  | 'a_medias'
  /** Esa clave no creó nada. NO se libera; se puede reintentar con ella. */
  | 'sin_rastro'
  /** La misma clave con otra intención económica. Nada que acreditar. */
  | 'conflicto'
  /** No se pudo verificar: red, 5xx o un cuerpo que no decodifica. */
  | 'no_concluyente';

export interface DecisionReconciliacion {
  readonly veredicto: VeredictoReconciliacion;
  /**
   * 🔴 El único campo que mueve plata indirectamente: `true` termina el intento
   * y devuelve al organizador la capacidad de abrir mesas. Sólo lo ponen
   * `acreditada` y `muerta`, que son las dos ramas con prueba exacta.
   */
  readonly liberaJournal: boolean;
  /** Adónde navegar. `null` cuando navegar no tiene sentido o no hay mesa. */
  readonly navegarA: string | null;
  /**
   * Habilita reenviar el POST **con la MISMA clave de idempotencia**. Lo dice
   * el contrato (`retry_with_same_idempotency_key`), no lo deduce esta vista.
   * Nunca autoriza una clave nueva: eso sí duplicaría la garantía.
   */
  readonly permiteReintento: boolean;
  /** `null` cuando la superficie es la navegación y no hace falta texto. */
  readonly copy: string | null;
}

const NO_CONCLUYENTE: DecisionReconciliacion = {
  veredicto: 'no_concluyente',
  liberaJournal: false,
  navegarA: null,
  permiteReintento: false,
  copy: 'No pudimos verificar cómo quedó esa apertura. Prueba de nuevo en un momento; no vamos a abrir otra mesa mientras tanto.',
};

/** Cuando no se pudo consultar (red, 5xx, cuerpo inválido): no se concluye. */
export function decisionSinRespuesta(): DecisionReconciliacion {
  return NO_CONCLUYENTE;
}

/**
 * @param referenciaGuardada  El `mesa_code` que el journal anotó cuando llegó
 *   la respuesta de creación, si llegó. **Es una SEGUNDA fuente independiente**
 *   y por eso se cruza: si el endpoint contesta un código distinto del que
 *   este navegador vio, alguna de las dos miente y no se acredita ninguna. El
 *   caso normal es que no haya referencia (la respuesta nunca llegó), y
 *   entonces no hay nada que cruzar.
 */
export function decisionReconciliacion(
  lookup: MesaCreationLookup,
  referenciaGuardada?: string | null,
): DecisionReconciliacion {
  const code = lookup.mesa?.code ?? null;
  const referencia = typeof referenciaGuardada === 'string' ? referenciaGuardada.trim() : '';
  if (referencia && code && code !== referencia) return NO_CONCLUYENTE;
  switch (lookup.outcome) {
    case 'open':
    case 'partially_paid':
    case 'replayable': {
      // Prueba positiva exacta. Sin código no se acredita: el código ES la
      // prueba, y sin él no habría a dónde llevar a la persona.
      if (!code) return NO_CONCLUYENTE;
      return { veredicto: 'acreditada', liberaJournal: true, navegarA: code, permiteReintento: false, copy: null };
    }
    case 'terminal':
      // La creación terminó y su mesa está muerta: no hay hold que duplicar.
      // Es la misma lectura que hace el dueño en `POST /mesas`, que ante un
      // estado muerto contesta 409 "rotá la clave" — o sea, abrí una nueva.
      return {
        veredicto: 'muerta',
        liberaJournal: true,
        navegarA: null,
        permiteReintento: false,
        copy: code
          ? `Esa apertura terminó sin quedar en pie (mesa ${code}). Ya puedes abrir una nueva.`
          : 'Esa apertura terminó sin quedar en pie. Ya puedes abrir una nueva.',
      };
    case 'requires_action':
      // La mesa existe con su hold SIN autorizar. No se libera nada: abrir
      // otra sería un segundo hold por el total.
      return {
        veredicto: 'a_medias',
        liberaJournal: false,
        navegarA: null,
        permiteReintento: lookup.retryWithSameKey,
        copy: code
          ? `La mesa ${code} se creó, pero su garantía quedó sin confirmar. Podemos retomar ESA misma garantía; no abrimos otra mesa.`
          : 'La mesa se creó, pero su garantía quedó sin confirmar. No abrimos otra mesa.',
      };
    case 'not_found':
      return {
        veredicto: 'sin_rastro',
        liberaJournal: false,
        navegarA: null,
        permiteReintento: lookup.retryWithSameKey,
        copy: 'No encontramos ninguna mesa creada con este intento. Podemos reenviarlo tal cual: si llegó a crearse, te devolvemos esa misma mesa en vez de retener el total otra vez.',
      };
    case 'payload_hash_conflict':
      // Llega sin datos de mesa a propósito. No se libera ni se reintenta: la
      // misma clave con otra intención económica no se resuelve sola.
      return {
        veredicto: 'conflicto',
        liberaJournal: false,
        navegarA: null,
        permiteReintento: false,
        copy: 'Este intento no coincide con la apertura que quedó pendiente. No vamos a reenviarlo ni a abrir otra mesa: escríbenos para resolverlo.',
      };
    case 'unknown':
      // 🔴 v2.48.0 · el emisor encontró un estado que su propia matriz no
      // clasifica y lo DICE en vez de inventarle una etiqueta. Del lado de
      // acá la conclusión es la misma que la de cualquier duda: no se libera
      // nada. Ojo con la tentación de tratarlo como `replayable` "porque la
      // mesa existe": si el emisor no sabe en qué quedó la creación, nosotros
      // tampoco, y liberar sería una segunda retención por el total.
      return NO_CONCLUYENTE;
  }
}
