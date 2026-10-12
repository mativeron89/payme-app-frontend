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
 * - 🔴 **El orden es el de la visita, no el de la carga** (W-01, auditoría de Codex; D281 y D278-1). Antes se seguía el
 *   orden del dueño, que es el de la carga: un ticket viejo escaneado después quedaba primero. Ahora se ordena por
 *   `instanteDeLaVisita` ANTES de agrupar: cada lugar va donde está su visita más reciente y, adentro, de la más reciente
 *   a la más vieja.
 */
export interface LugarConsumido {
  /** La clave de la fila: estable mientras no cambien los tickets del lugar. */
  readonly clave: string;
  /** La visita más reciente primero (`ordenarPorVisita`). */
  readonly tickets: readonly TicketEnViaje[];
  readonly total_cents: number;
}

/**
 * W-01 · el instante de la visita, en milisegundos, con la regla que el dueño ya usa en Estadísticas (contrato,
 * `instante`; D278-1):
 * - la fecha y la hora impresas, en hora de México;
 * - con fecha y sin hora, las 12:00 de ese día;
 * - sin fecha impresa, cuando se cargó. Un gasto a mano no lleva fecha: va siempre por la carga.
 *
 * México es UTC−6 fijo: el contrato no tiene horario de verano. `null` si no hay ni fecha ni carga.
 */
export function instanteDeLaVisita(tk: Pick<TicketEnViaje, 'fecha_ticket' | 'hora_ticket' | 'cargado_en'>): number | null {
  if (tk.fecha_ticket !== null) {
    const ms = Date.parse(`${tk.fecha_ticket}T${tk.hora_ticket ?? '12:00'}:00-06:00`);
    if (!Number.isNaN(ms)) return ms;
  }
  if (tk.cargado_en === null) return null;
  const ms = Date.parse(tk.cargado_en);
  return Number.isNaN(ms) ? null : ms;
}

/** De mayor a menor; `null` (sin instante) siempre al final. */
function masRecientePrimero(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * W-01 · la visita más reciente primero. Desempate estable: la carga y después el id, los dos de mayor a menor, como los
 * ordena el dueño. No cambia la lista que recibe.
 */
export function ordenarPorVisita<T extends Pick<TicketEnViaje, 'id' | 'fecha_ticket' | 'hora_ticket' | 'cargado_en'>>(
  tickets: readonly T[],
): T[] {
  const carga = (tk: T) => {
    if (tk.cargado_en === null) return null;
    const ms = Date.parse(tk.cargado_en);
    return Number.isNaN(ms) ? null : ms;
  };
  return [...tickets].sort((a, b) => masRecientePrimero(instanteDeLaVisita(a), instanteDeLaVisita(b))
    || masRecientePrimero(carga(a), carga(b))
    || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
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
  // W-01 · primero por la visita: así el primero de cada lugar es su visita más reciente, y adentro quedan en orden.
  for (const tk of ordenarPorVisita(tickets)) {
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
