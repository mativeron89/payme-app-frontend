import type { TicketEnViaje } from '../../api/viajes';

/**
 * D281 · Balance › Consumos: los tickets y gastos del mismo lugar, juntos en una fila (lo puro, sin React).
 *
 * - **La clave del lugar:** sin los espacios de los costados, con los repetidos en uno, sin mayúsculas y sin tilde,
 *   acento grave ni diéresis. La ñ se conserva: «Peña» y «Pena» son lugares distintos.
 * - **Sin lugar** (`lugar` null: «Restaurante sin identificar» y parecidos): cada uno es su propia fila. Dos lugares
 *   desconocidos nunca se juntan por compartir el rótulo.
 * - **El personal** (D276) no se mezcla con lo compartido: se junta sólo con otros personales del mismo lugar, así un
 *   total no suma plata del viaje con plata personal.
 * - **Ticket y gasto se juntan** si se llaman igual, aunque el tipo de lugar sea otro.
 * - **El total** es la suma de los totales impresos (`total_cents`, D278-2): con servicio, descuentos e IVA aparte.
 * - **El orden es el del dueño** (el más reciente primero): cada lugar va donde aparece su ticket más reciente y,
 *   adentro, en el mismo orden. El front no deriva fechas.
 */
export interface LugarConsumido {
  /** La clave de la fila: estable mientras no cambien los tickets del lugar. */
  readonly clave: string;
  /** El más reciente primero, como los manda el dueño. */
  readonly tickets: readonly TicketEnViaje[];
  readonly total_cents: number;
}

/** Tilde, acento grave y diéresis, ya separados por NFD. La virgulilla de la ñ (U+0303) no está: la ñ se conserva. */
const ACENTOS = /[\u0300\u0301\u0308]/g;

/** La clave de comparación de un lugar escrito, o `null` si no hay lugar (no se agrupa). */
export function claveDelLugar(lugar: string | null): string | null {
  if (lugar === null) return null;
  const limpio = lugar.normalize('NFD').replace(ACENTOS, '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es-MX');
  return limpio === '' ? null : limpio;
}

export function agruparConsumos(tickets: readonly TicketEnViaje[]): LugarConsumido[] {
  const porClave = new Map<string, TicketEnViaje[]>();
  const orden: string[] = [];
  for (const tk of tickets) {
    const lugar = claveDelLugar(tk.lugar);
    // Sin lugar, la fila es del ticket; con lugar, de su clave, separando el personal.
    const clave = lugar === null ? `ticket:${tk.id}` : `${tk.personal ? 'personal' : 'viaje'}:${lugar}`;
    const grupo = porClave.get(clave);
    if (grupo) grupo.push(tk);
    else {
      porClave.set(clave, [tk]);
      orden.push(clave);
    }
  }
  return orden.map((clave) => {
    const grupo = porClave.get(clave)!;
    // D278-2 · el total impreso de cada visita (sin ajustes, la suma de sus renglones).
    return { clave, tickets: grupo, total_cents: grupo.reduce((s, tk) => s + tk.total_cents, 0) };
  });
}
