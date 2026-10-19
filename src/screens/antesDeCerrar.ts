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
import { bpsLabel, bpsValido, restanteAlGuardar } from './mesaItemsView';
import { agruparIguales, nombreConCantidad } from './agruparIguales';
import { nombreDePlato } from '../utils/nombreDePlato';

/**
 * ¿Guardar este borrador cierra la mesa? La regla del dueño: todo plato queda
 * sin nada por elegir. Por plato, lo que queda más lo propio guardado (que el
 * borrador reemplaza en «igual»; en consumo, lo liberable del plato que el
 * borrador toca, `propioEnConsumo`) menos el borrador tiene que dar 0. Un borrador que ya no entra no cuenta (el dueño
 * lo rechaza). Ante un dato desconocido, `false`: no avisa, y «La mesa se
 * cerró» sigue siendo la red.
 *
 * F1 · «dar 0» es con la tolerancia del dueño (`restanteAlGuardar`): si el
 * borrador toca el plato y dejaría menos de 100 bps, el dueño lo da por
 * completo. Con 3 × ⅓, el tercero elige 3333 sobre 3334 y la mesa se cierra:
 * antes el front calculaba 1 y la hoja no salía. Viene de 0.227.0, no de D389.
 * «Ya no quedaba nada» lee lo publicado, que el dueño ya publica con la
 * tolerancia aplicada: sigue siendo `restante !== 0`.
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
  /**
   * Consumo: el dueño escribe con CUALQUIER borrador no vacío (`items/lock`
   * suelta y vuelve a tomar, y después cuenta), así que «cambia» es «hay
   * borrador», no «distinto de lo propio». En «igual» un reenvío idéntico sólo
   * lee (`replace`, `previous === desired`).
   */
  opciones: { readonly escribeConCualquierBorrador?: boolean } = {},
): boolean {
  if (!Array.isArray(mesa.items) || mesa.items.length === 0) return false;
  const ceroCubierto = mesa.guarantee_mode === false;
  let yaCompleta = true;
  let conImporte = false;
  let cambia = opciones.escribeConCualquierBorrador === true && borrador.size > 0;
  for (const item of mesa.items) {
    const restante = restanteDe(item);
    const propio = propioRegistrado(item);
    if (!bpsValido(restante) || !bpsValido(propio)) return false;
    if (restante !== 0) yaCompleta = false;
    const nuevo = borrador.get(item.id) ?? 0;
    // F1 · con la tolerancia del dueño: ⅓ sobre los 3334 que quedan completa el plato.
    const queda = restanteAlGuardar(restante, propio, nuevo);
    if (queda === null) return false;
    if (nuevo !== propio) cambia = true;
    if (ceroCubierto && item.price_cents === 0) continue;
    conImporte = true;
    if (queda !== 0) return false;
  }
  // Reenviar lo mismo no escribe nada: el dueño no la cierra.
  if (!cambia) return false;
  // D389 · sin ningún plato con importe, el dueño no la cierra por selección.
  if (!conImporte) return false;
  // Si ya no quedaba nada, la mesa no la cierra este pedido.
  return !yaCompleta;
}

/**
 * Lo propio de un plato en CONSUMO, como lo trata el dueño (`itemClaims.acquire`,
 * medido en 66659eae): el pedido que toca un plato suelta mis claims `locked`
 * liberables de ese plato y lo vuelve a tomar contra `10000 − Σ(los demás)`. Lo
 * que el detalle publica como `my_releasable_bps` es esa misma suma (la regla de
 * soltar, `sqlClaimLiberable`). Un plato que el borrador no toca no se suelta: 0.
 *
 * Hasta 0.253.1 el front daba siempre 0 («el borrador suma»). Difería sólo si el
 * borrador incluía un plato que esta cuenta ya registró (una respuesta perdida
 * de `items/lock`, dos pestañas), y en un sentido la mesa se cerraba sin la hoja.
 *
 * 🔴 Fail-safe al revés que el resto de la función: sin un `my_releasable_bps`
 * válido no se calla, se inclina por MOSTRAR la hoja. Una hoja de más se deshace
 * («Revisar»); un cierre sin hoja, no. Se supone lo propio que más acerca al
 * cierre: lo justo para que el borrador entre, `max(0, nuevo − restante)`. Con
 * eso queda `max(0, restante − nuevo)`: si el cierre es posible con algún valor
 * de lo liberable, la hoja sale. Un `restante` o un borrador inválidos siguen
 * siendo «dato desconocido» de `seleccionCierraLaMesa` (no avisa): sin
 * `remaining_bps` válido la fila queda «indeterminado» y no se puede elegir.
 */
export function propioEnConsumo(item: MesaItem, borrador: ReadonlyMap<string, number>): number {
  const nuevo = borrador.get(item.id);
  if (nuevo === undefined) return 0;
  if (bpsValido(item.my_releasable_bps)) return item.my_releasable_bps;
  if (!bpsValido(item.remaining_bps) || !bpsValido(nuevo)) return 0;
  return Math.max(0, nuevo - item.remaining_bps);
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
 * En consumo, si el borrador toca un plato donde ya tengo algo liberable, el
 * dueño lo suelta y lo vuelve a tomar (`propioEnConsumo`): ese liberable se
 * reemplaza, no se suma. Sin el dato, se suma como antes (es sólo la lista).
 */
export function elegidosAlGuardar(
  mesa: Pick<MesaDetail, 'items'>,
  esConsumo: boolean,
  borrador: ReadonlyMap<string, number>,
): Elegido[] {
  return mesa.items.flatMap((i) => {
    const registrado = esConsumo && i.status !== 'paid' && bpsValido(i.my_bps) ? i.my_bps : 0;
    const nuevo = borrador.get(i.id) ?? 0;
    const suelta = esConsumo && nuevo > 0 && bpsValido(i.my_releasable_bps) ? Math.min(registrado, i.my_releasable_bps) : 0;
    const bps = Math.min(10000, registrado - suelta + nuevo);
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
