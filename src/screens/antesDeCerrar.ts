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
import { nombreDePlato } from '../utils/nombreDePlato';

/**
 * ¿Guardar este borrador cierra la mesa? La regla del dueño: todo plato queda
 * sin nada por elegir. Por plato, lo que queda más lo propio guardado (que el
 * borrador reemplaza en «igual»; en consumo se suma, y lo propio es 0) menos
 * el borrador tiene que dar 0. Un borrador que ya no entra no cuenta (el dueño
 * lo rechaza). Ante un dato desconocido, `false`: no avisa, y «La mesa se
 * cerró» sigue siendo la red.
 *
 * D389 · en una mesa SIN garantía, un plato de $0 (`price_cents === 0`) cuenta
 * como cubierto aunque nadie lo elija, y una mesa sin ningún plato con importe
 * no se cierra por selección. Es la regla del dueño 2.188.0
 * (`LINEA_CON_IMPORTE_SQL`, en `items/lock` y en `complete()`), con la guarda
 * de `confirmedConsumptionProgress`: `guarantee_mode === false`. Sin esto, con
 * el agua en $0 sin elegir, el último «Listo» cerraba la mesa sin esta hoja y
 * ya no se podía corregir lo elegido.
 * - El $0 se puede seguir eligiendo: su borrador se valida igual (no puede
 *   pedir más de lo que queda), pero no hace falta que lo complete.
 * - «Ya no quedaba nada» se sigue midiendo sobre TODOS los platos, también los
 *   de $0. Una mesa abierta de antes de 2.188.0, con todo lo de importe elegido
 *   y el agua libre, la cierra el próximo pedido del dueño (el que elige el
 *   agua), y este aviso tiene que salir.
 * - Por la misma mesa, en «igual» un borrador VACÍO también puede cerrarla:
 *   quien había guardado ½ del agua la suelta, y el PUT que reemplaza escribe y
 *   el dueño la da por cubierta. Por eso ya no se corta por `borrador.size`: lo
 *   que no cierra es reenviar lo mismo, que el dueño sólo lee
 *   (`informativeSelections.replace`, `previous === desired`). En consumo lo
 *   propio es 0, así que un borrador vacío sigue sin cerrar nada.
 */
export function seleccionCierraLaMesa(
  mesa: Pick<MesaDetail, 'items' | 'guarantee_mode'>,
  restanteDe: (item: MesaItem) => unknown,
  propioRegistrado: (item: MesaItem) => number,
  borrador: ReadonlyMap<string, number>,
): boolean {
  if (!Array.isArray(mesa.items) || mesa.items.length === 0) return false;
  const ceroCubierto = mesa.guarantee_mode === false;
  let yaCompleta = true;
  let conImporte = false;
  let cambia = false;
  for (const item of mesa.items) {
    const restante = restanteDe(item);
    const propio = propioRegistrado(item);
    if (!bpsValido(restante) || !bpsValido(propio)) return false;
    if (restante !== 0) yaCompleta = false;
    const disponible = Math.min(10000, restante + propio);
    const nuevo = borrador.get(item.id) ?? 0;
    if (!bpsValido(nuevo) || nuevo > disponible) return false;
    if (nuevo !== propio) cambia = true;
    if (ceroCubierto && item.price_cents === 0) continue;
    conImporte = true;
    if (disponible - nuevo !== 0) return false;
  }
  // Reenviar lo mismo no escribe nada: el dueño no la cierra.
  if (!cambia) return false;
  // D389 · sin ningún plato con importe, el dueño no la cierra por selección.
  if (!conImporte) return false;
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
      ? nombreConCantidad(g.cantidad, nombreDePlato(g.primero.name))
      : `${nombreConCantidad(g.cantidad, nombreDePlato(g.primero.name))} · ${bpsLabel(g.primero.bps)}`,
  }));
}
