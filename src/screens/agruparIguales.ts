/**
 * D240 punto 16 · Mati: «En el detalle de Mesas, si se seleccionaron dos ítems
 * iguales juntarlos y poner la cantidad antes de la descripción (es correcto que
 * si el ticket dice "2 aguas" cuando se escanee, que el ocr lo separe en dos
 * aguas distintas para que cada comensal seleccione su consumo)».
 *
 * Sólo se junta AL DIBUJAR: el dueño publica una línea por plato elegido y los
 * decodificadores verifican esa forma (cantidad de líneas, suma de montos), así
 * que la agrupación no puede vivir ahí. La lista viva de «¿Qué consumiste?» no
 * se agrupa: ahí cada unidad se elige por separado.
 *
 * Iguales = el mismo nombre (sin espacios de más) y el mismo precio UNITARIO, y
 * los dos enteros. Una porción («½») queda en su renglón: dos mitades pueden
 * diferir en centavos y «2 × ½» no dice qué se comió. Ante un dato que no
 * alcanza para afirmar que son iguales, la línea no se junta con nada.
 */

import type { ItemPropioDeMesa } from '../api/misMesas';
import type { MovementDetailItem } from '../api/types';

export interface RenglonAgrupado<T> {
  /** La key de React del primero del grupo. */
  readonly key: string;
  /** De ahí salen el nombre, la porción y lo declarado. */
  readonly primero: T;
  /** La suma de las cantidades. */
  readonly cantidad: number;
  /** La suma de los montos; `null` si alguna línea no tiene monto. */
  readonly montoCents: number | null;
}

export interface LecturaDeRenglon<T> {
  nombre(item: T): string;
  /** Precio UNITARIO en centavos; `null` ⇒ no se puede afirmar ⇒ no se junta. */
  unitario(item: T): number | null;
  /** Sólo se juntan unidades enteras. */
  entera(item: T): boolean;
  cantidad(item: T): number;
  monto(item: T): number | null;
  key(item: T, index: number): string;
  /** Algo más que tiene que coincidir (en «igual», la porción declarada). */
  extra?(item: T): string;
}

/** El nombre sin espacios de más: «Agua mineral » es «Agua mineral». */
function nombreNormal(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ');
}

function enteroPositivo(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0;
}

export function agruparIguales<T>(items: readonly T[], lectura: LecturaDeRenglon<T>): RenglonAgrupado<T>[] {
  const salida: { key: string; primero: T; cantidad: number; montoCents: number | null }[] = [];
  const grupos = new Map<string, number>();
  items.forEach((item, index) => {
    const unitario = lectura.unitario(item);
    const cantidad = lectura.cantidad(item);
    const monto = lectura.monto(item);
    const juntable = unitario !== null
      && Number.isSafeInteger(unitario) && unitario >= 0
      && enteroPositivo(cantidad)
      && lectura.entera(item);
    const clave = juntable
      ? JSON.stringify([nombreNormal(lectura.nombre(item)), unitario, lectura.extra?.(item) ?? ''])
      : null;
    const en = clave === null ? undefined : grupos.get(clave);
    if (en === undefined) {
      if (clave !== null) grupos.set(clave, salida.length);
      salida.push({ key: lectura.key(item, index), primero: item, cantidad, montoCents: monto });
      return;
    }
    const grupo = salida[en];
    grupo.cantidad += cantidad;
    grupo.montoCents = grupo.montoCents === null || monto === null ? null : grupo.montoCents + monto;
  });
  return salida;
}

/** «2 × Agua mineral»: la cantidad ANTES del nombre, como pidió Mati. */
export function nombreConCantidad(cantidad: number, nombre: string): string {
  return cantidad > 1 ? `${cantidad} × ${nombre}` : nombre;
}

/**
 * «Tus mesas»: el dueño no publica el precio unitario de la línea, así que se
 * deduce del monto entero; si no divide exacto, la línea no se junta.
 */
export function agruparPropios(items: readonly ItemPropioDeMesa[]): RenglonAgrupado<ItemPropioDeMesa>[] {
  return agruparIguales(items, {
    nombre: (i) => i.name,
    unitario: (i) => i.fractionBps === 10000 && Number.isSafeInteger(i.amountCents) && i.quantity > 0
      && i.amountCents % i.quantity === 0
      ? i.amountCents / i.quantity
      : null,
    entera: (i) => i.fractionBps === 10000,
    cantidad: (i) => i.quantity,
    monto: (i) => i.amountCents,
    key: (i) => i.itemId,
  });
}

/**
 * El historial: se junta DENTRO de cada pago, nunca entre pagos, para que cada
 * «Pago N» siga sumando lo suyo. En «igual» también tiene que coincidir lo
 * declarado: «entero» con «entero», y sin declaración con sin declaración.
 */
export function agruparDelPago(
  movementId: string,
  items: readonly MovementDetailItem[],
): RenglonAgrupado<MovementDetailItem>[] {
  return agruparIguales(items, {
    nombre: (i) => i.name,
    unitario: (i) => i.price_cents,
    entera: (i) => i.amount_cents !== null
      ? i.fraction_bps === 10000
      : i.declared_fraction_bps === null || i.declared_fraction_bps === 10000,
    cantidad: (i) => i.quantity,
    monto: (i) => i.amount_cents,
    key: (_, index) => `${movementId}:${index}`,
    extra: (i) => String(i.declared_fraction_bps),
  });
}
