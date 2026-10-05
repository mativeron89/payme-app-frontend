import { formatMXN } from '../utils/format';
import { splitEqual } from '../utils/money';

/**
 * D181 · el ancho que reserva «¿Cuántos pagan?» para el monto por persona.
 *
 * El «+» no se mueve bajo el dedo (pedidos 127 y 136) porque la caja del monto
 * mide siempre lo mismo: una copia invisible del monto MÁS ANCHO posible, con
 * los dígitos en 0 (con cifras tabulares todos miden igual). Hasta D181 todos
 * los montos tenían la misma forma («$840.00», «$93.34») y bastaba el total.
 * Ahora un entero va sin centavos («$840») y un reparto puede llevarlos
 * («$93.34»): el más ancho sale de recorrer los repartos posibles, de 1 a 20
 * (el tope del selector), con el mismo formateador que se ve.
 *
 * `reparte`: «Pagar el total» y «En partes iguales» muestran la parte mayor del
 * reparto exacto; «Por lo que pidió cada uno», el redondeo del promedio.
 */
export function reservaDelMonto(total: number, reparte: boolean, hasta = 20): string {
  let masAncho = '';
  for (let n = 1; n <= hasta; n += 1) {
    const monto = formatMXN(reparte ? splitEqual(total, n)[0]! : Math.round(total / n));
    if (monto.length > masAncho.length) masAncho = monto;
  }
  return masAncho.replace(/[0-9]/g, '0');
}
