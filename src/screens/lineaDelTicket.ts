import { stringToCents } from '../utils/money';

/**
 * D360 · P04 · D371 · las líneas del ticket al abrir la mesa.
 *
 * Mati probó «Cuando pongo un consumo en $0 el total del ticket pasa
 * automáticamente a $0» y eligió «Sí, se queda en $0»: un plato en $0 es un
 * plato que no se cobra, y el total es la suma del resto.
 *
 * - Precio VACÍO (o ilegible) = la línea está incompleta: todavía no hay total.
 *   Antes el vacío se leía como «0» (`priceStr || '0'`) y el 0 hacía incompleta
 *   la línea, así que el total pasaba a $0 aunque los demás platos tuvieran
 *   precio.
 * - Precio «0» = un plato válido de $0. Lo acepta el dueño (`price_cents ≥ 0`) y
 *   lo acepta ya el corrector de tickets de Viajes («un plato de cortesía»).
 * - El ticket entero en $0 sigue sin poder abrirse: el dueño exige
 *   `total_cents > 0` y `ticketValid` lo mantiene.
 *
 * Que un plato de $0 que nadie marca deje la mesa en 99 % es del dueño y queda
 * para después (D371): acá no se toca.
 */

/** El precio de una línea en centavos, o `null` si la línea está incompleta (vacío o ilegible). */
export function precioDeLinea(priceStr: string): number | null {
  const limpio = priceStr.trim();
  if (limpio === '') return null;
  try {
    const centavos = stringToCents(limpio);
    return Number.isSafeInteger(centavos) && centavos >= 0 ? centavos : null;
  } catch {
    return null;
  }
}

/** El total de una línea (precio × cantidad), o `null` si está incompleta o no entra en un entero seguro. */
export function totalDeLinea(priceStr: string, quantity: number): number | null {
  const precio = precioDeLinea(priceStr);
  if (precio === null || !Number.isSafeInteger(quantity) || quantity < 1) return null;
  const total = BigInt(precio) * BigInt(quantity);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}
