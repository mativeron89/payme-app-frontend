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
