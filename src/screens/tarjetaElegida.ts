/**
 * ORDEN 1-B · el sentinela «todavía nadie eligió», y §1.5 bis · el estado
 * «sin elegir» del selector de método.
 *
 * 🔴 **Vive acá, y no en cada pantalla, porque las dos lo necesitan y una
 * copia se desincroniza sin que nadie lo note.** Garantía lo estrenó
 * (`CreateMesaFlow`) y Pagar mi parte lo reusa (`MesaScreen`); la spec pide
 * explícitamente **reusar el identificador de la 1-B, no inventar uno nuevo**
 * (`diseno/SPEC_APP.md` §1.5 bis · «El selector de método de pago»).
 */

/**
 * No es `'new'` —que ya significa «voy a tipear otra»— ni el uuid de una
 * guardada: **los dos afirman algo**. El vacío es el único valor que no
 * afirma, y por eso es el sentinela.
 */
export const SIN_TARJETA_ELEGIDA = '';

/**
 * G-38 · traduce la referencia owner a una elección mostrable sin inventar.
 * Sólo devuelve el UUID si todavía pertenece al listado autenticado actual;
 * `null`, ausencia o una guardada eliminada conservan el sentinela honesto.
 */
export function fuenteGuardadaVigente(
  savedPaymentMethodId: string | null | undefined,
  cards: ReadonlyArray<{ readonly id: string }>,
): string {
  return typeof savedPaymentMethodId === 'string'
    && cards.some((card) => card.id === savedPaymentMethodId)
    ? savedPaymentMethodId
    : SIN_TARJETA_ELEGIDA;
}

/**
 * «Hay entre qué elegir y nadie eligió» — el estado que la spec dibuja con
 * borde punteado `--warning` y SIN nombrar ninguna tarjeta.
 *
 * 🔴 **`cantidadDeTarjetas > 0` no es un detalle: es la diferencia entre «no
 * elegiste» y «no hay nada que elegir».** Sin guardadas, el único camino es
 * tipear una y el sentinela NO debe frenar el pago — frenarlo ahí sería un
 * callejón sin salida, porque no existe la acción que el cartel pediría.
 */
export function metodoSinElegir(
  payType: string,
  cantidadDeTarjetas: number,
  cardChoice: string,
): boolean {
  return payType === 'card' && cantidadDeTarjetas > 0 && cardChoice === SIN_TARJETA_ELEGIDA;
}

/**
 * §1.5 bis · ¿el pago se FRENA porque no se eligió método?
 *
 * 🔴 Vive acá, pura, porque el caso que importa **no se puede alcanzar en el
 * navegador** y por lo tanto no hay dónde más probarlo. Medido: quitando el
 * corte entero de `doPay`, la suite queda verde salvo los oráculos de fuente
 * —1199 unitarios y 110 e2e— porque en el riel mock el estado «hay guardadas y
 * ninguna elegida» **no se alcanza con el CTA vivo**: lo único que impide la
 * autoselección es el campo de Stripe con contenido, y ese campo no monta en
 * mock. **El límite se declara; no se disfraza con un mock que finja el campo.**
 *
 * 🔴 `frozenTienePayload` NO es defensivo: sin eso, esto TRABA el reintento.
 * Un reenvío congelado manda el cuerpo ORIGINAL, que ya trae su método, así que
 * `cardChoice` no interviene — pero tras una recarga la pantalla arranca sin
 * selección y el freno cortaría **la única salida que ese estado tiene**.
 *
 * ⚠️ En Garantía la guarda equivalente **sí** corta el reenvío, y no es una
 * incoherencia: allá, con `not_found`, el reenvío CREA por primera vez y la
 * tarjeta que viaja ES la que respalda la garantía. **Misma regla, dos
 * consecuencias, porque «reenviar» no significa lo mismo en las dos pantallas.**
 */
export function frenoPorMetodo(input: {
  metodoPendiente: boolean;
  frozenTienePayload: boolean;
}): boolean {
  return !input.frozenTienePayload && input.metodoPendiente;
}
