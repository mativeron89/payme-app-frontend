/**
 * D240 punto 8 · Mati: «Que cuando un usuario al seleccionar sus consumos cierra
 * una mesa, le avise que se va a cerrar para que haga double check de lo que
 * seleccionó, luego sino no puede modificar».
 *
 * Una mesa sin garantía se cierra de dos maneras, y las dos pasan por la misma
 * hoja antes de cerrar:
 * - **por selección**: con «Listo», si lo elegido completa todos los platos, el
 *   dueño cierra la mesa en el mismo pedido (decisión 80). Hoy se entera
 *   después, en «La mesa se cerró»;
 * - **con «Cerrar mesa»** (sólo quien la organizó, AF-34).
 *
 * Todo se calcula con lo que el front ya tiene: no cambia el contrato.
 */
import type { MesaDetail, MesaItem } from '../api/types';
import { bpsLabel, bpsValido } from './mesaItemsView';
import { agruparIguales, nombreConCantidad } from './agruparIguales';

/**
 * ¿Guardar este borrador cierra la mesa? La regla del dueño: todo plato queda
 * sin nada por elegir. Por plato, lo que queda más lo propio guardado (que el
 * borrador reemplaza en «igual»; en consumo se suma, y lo propio es 0) menos
 * el borrador tiene que dar 0. Un borrador que ya no entra no cuenta (el dueño
 * lo rechaza). Ante un dato desconocido, `false`: no avisa, y «La mesa se
 * cerró» sigue siendo la red.
 */
export function seleccionCierraLaMesa(
  mesa: Pick<MesaDetail, 'items'>,
  restanteDe: (item: MesaItem) => unknown,
  propioRegistrado: (item: MesaItem) => number,
  borrador: ReadonlyMap<string, number>,
): boolean {
  if (!Array.isArray(mesa.items) || mesa.items.length === 0 || borrador.size === 0) return false;
  let yaCompleta = true;
  for (const item of mesa.items) {
    const restante = restanteDe(item);
    const propio = propioRegistrado(item);
    if (!bpsValido(restante) || !bpsValido(propio)) return false;
    if (restante !== 0) yaCompleta = false;
    const disponible = Math.min(10000, restante + propio);
    const nuevo = borrador.get(item.id) ?? 0;
    if (!bpsValido(nuevo) || nuevo > disponible) return false;
    if (disponible - nuevo !== 0) return false;
  }
  // Si ya no quedaba nada, la mesa no la cierra este pedido.
  return !yaCompleta;
}

export interface Elegido {
  readonly id: string;
  readonly name: string;
  readonly priceCents: number;
  readonly quantity: number;
  readonly bps: number;
}

/** Lo registrado de esta persona: consumo, `my_bps` sin pagar; «igual», lo guardado. */
export function elegidosRegistrados(
  mesa: Pick<MesaDetail, 'items'>,
  esConsumo: boolean,
  guardadas: ReadonlyMap<string, number>,
): Elegido[] {
  return mesa.items.flatMap((i) => {
    const bps = esConsumo ? (i.status !== 'paid' ? i.my_bps : 0) : (guardadas.get(i.id) ?? 0);
    return bpsValido(bps) && bps > 0
      ? [{ id: i.id, name: i.name, priceCents: i.price_cents, quantity: i.quantity, bps }]
      : [];
  });
}

/**
 * Lo que queda elegido si se guarda: en consumo, lo registrado más el borrador
 * (el pedido suma); en «igual», el borrador (el pedido reemplaza).
 */
export function elegidosAlGuardar(
  mesa: Pick<MesaDetail, 'items'>,
  esConsumo: boolean,
  borrador: ReadonlyMap<string, number>,
): Elegido[] {
  return mesa.items.flatMap((i) => {
    const registrado = esConsumo && i.status !== 'paid' && bpsValido(i.my_bps) ? i.my_bps : 0;
    const bps = Math.min(10000, registrado + (borrador.get(i.id) ?? 0));
    return bps > 0 ? [{ id: i.id, name: i.name, priceCents: i.price_cents, quantity: i.quantity, bps }] : [];
  });
}

/**
 * Los renglones de la hoja, con los iguales juntos y la cantidad antes, como
 * en Mesas (punto 16): «2 × Tiramisú», «Agua mineral · ½».
 */
export function lineasElegidas(elegidos: readonly Elegido[]): { key: string; texto: string }[] {
  return agruparIguales(elegidos, {
    nombre: (e) => e.name,
    unitario: (e) => e.priceCents,
    entera: (e) => e.bps === 10000,
    cantidad: (e) => e.quantity,
    monto: () => null,
    key: (e) => e.id,
  }).map((g) => ({
    key: g.key,
    texto: g.primero.bps >= 10000
      ? nombreConCantidad(g.cantidad, g.primero.name)
      : `${nombreConCantidad(g.cantidad, g.primero.name)} · ${bpsLabel(g.primero.bps)}`,
  }));
}
