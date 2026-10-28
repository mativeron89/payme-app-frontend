import { sumaDeTipo } from '../api/contractResponses';
import type { TicketAdjustment, TicketTotals } from '../api/types';

/**
 * D509 · validación de números de la lectura del ticket. Mati: «Medir solo y
 * mejorar ya».
 *
 * Lo que YA existía (medido en `CreateMesaFlow.tsx` antes de esta entrega):
 * - la suma de los platos contra el total impreso (`totalMismatch`), con el
 *   aviso «Checa que el total coincida con el total del ticket» y la hoja del
 *   ticket abierta a la fuerza;
 * - subtotal, IVA (incluido o agregado), servicio y descuento contra el
 *   impreso (`desgloseDelTicket`, D209/D215/D218/D224);
 * - el «?» de los platos que el lector marcó con poca confianza.
 *
 * Lo que suma esta entrega: cuando la suma NO cierra con el ticket, se buscan
 * las filas que explican la diferencia y se marcan para revisar. **No se
 * corrige nada sola**: la persona decide (el spec prohíbe ajustar en silencio).
 *
 * ⚠️ «Cantidad × precio unitario contra el importe de la línea» no se puede
 * comprobar acá: el contrato del lector (`ocr-merchant-v2.json`) trae por plato
 * el precio unitario y la cantidad, no el importe impreso de la línea. Lo que
 * sí se puede: una cantidad que, cambiada, cierra la cuenta.
 *
 * Los motivos, del más al menos claro:
 * - `repetida`: la línea vale exactamente lo que sobra (un renglón leído dos
 *   veces, típico del solape entre fotos).
 * - `cantidad`: cambiando sólo la cantidad de esa línea, la cuenta cierra.
 * - `precio`: el precio tiene un dígito de más o de menos (×10 o ÷10) y,
 *   corregido, la cuenta cierra.
 * - `imposible`: una línea que sola vale más que todo el ticket.
 *
 * Para no llenar la pantalla de dudas: si la diferencia la explican más de tres
 * filas, no se marca ninguna (el aviso del total ya está).
 */

export type MotivoDeDuda = 'repetida' | 'cantidad' | 'precio' | 'imposible';

export interface FilaParaValidar {
  /** Precio por unidad en centavos; `null` si la fila está incompleta. */
  readonly precioCents: number | null;
  readonly cantidad: number;
}

export const MAXIMO_DE_FILAS_DUDOSAS = 3;

/**
 * La suma de platos que haría cerrar el ticket: con el IVA incluido en los
 * precios y, si el ticket trae IVA, con el IVA agregado al final. Los mismos
 * dos casos que `desgloseDelTicket`.
 */
export function sumasQueCierran(
  impreso: number,
  totales: TicketTotals | null,
  ajustes: readonly TicketAdjustment[] | null,
): number[] {
  const servicio = sumaDeTipo(ajustes, 'service_charge');
  const descuento = sumaDeTipo(ajustes, 'discount');
  const incluido = impreso - servicio + descuento;
  const iva = totales?.tax_cents;
  const sumas = [incluido];
  if (iva !== undefined && iva > 0) sumas.push(incluido - iva);
  return sumas.filter((s) => s > 0);
}

/**
 * Las filas dudosas, por índice. Vacío si la cuenta cierra con alguna de las
 * sumas posibles, si no hay total impreso o si alguna fila está incompleta (ahí
 * ya hay otro aviso).
 */
export function filasDudosas(entrada: {
  readonly filas: readonly FilaParaValidar[];
  /** `total_detected_cents` de la lectura; `null` si no vino. */
  readonly impreso: number | null;
  readonly totales: TicketTotals | null;
  readonly ajustes: readonly TicketAdjustment[] | null;
}): ReadonlyMap<number, MotivoDeDuda> {
  const { filas, impreso } = entrada;
  const marcas = new Map<number, MotivoDeDuda>();
  if (impreso === null || impreso <= 0 || filas.length === 0) return marcas;
  if (filas.some((f) => f.precioCents === null || !Number.isSafeInteger(f.cantidad) || f.cantidad < 1)) return marcas;
  const lineas = filas.map((f) => (f.precioCents as number) * f.cantidad);
  const suma = lineas.reduce((s, l) => s + l, 0);
  const objetivos = sumasQueCierran(impreso, entrada.totales, entrada.ajustes);
  if (objetivos.includes(suma)) return marcas;

  // Una línea que sola vale más que todo el ticket.
  lineas.forEach((l, i) => { if (l > impreso) marcas.set(i, 'imposible'); });

  for (const objetivo of objetivos) {
    const sobra = suma - objetivo;
    filas.forEach((f, i) => {
      if (marcas.has(i)) return;
      const precio = f.precioCents as number;
      const linea = lineas[i]!;
      if (sobra > 0 && linea === sobra) {
        marcas.set(i, 'repetida');
        return;
      }
      const lineaQueCierra = linea - sobra;
      // Un dígito de más o de menos en el precio. Va antes que la cantidad: un
      // precio leído ÷10 también «cierra» con diez unidades, y lo probable es el dígito.
      if (lineaQueCierra > 0 && lineaQueCierra % f.cantidad === 0) {
        const precioQueCierra = lineaQueCierra / f.cantidad;
        if (precioQueCierra * 10 === precio || precio * 10 === precioQueCierra) {
          marcas.set(i, 'precio');
          return;
        }
      }
      // Cambiando sólo la cantidad: la línea tendría que valer `linea − sobra`, un múltiplo positivo del precio.
      if (precio > 0 && lineaQueCierra > 0 && lineaQueCierra % precio === 0 && lineaQueCierra / precio !== f.cantidad) {
        marcas.set(i, 'cantidad');
      }
    });
  }
  return marcas.size > MAXIMO_DE_FILAS_DUDOSAS ? new Map() : marcas;
}
