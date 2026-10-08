import { sumaDeTipo } from '../api/contractResponses';
import type { TicketAdjustment, TicketTotals } from '../api/types';
import { formatMXN } from '../utils/format';

/**
 * D209 · D215 · D218 · el subtotal, el IVA y el descuento del ticket en «Ver el
 * ticket».
 *
 * El dueño publica `ticket_totals` y `ticket_adjustments` sólo cuando cierran
 * exacto con el total impreso. Acá se decide si cierran con la mesa TAL COMO
 * ESTÁ AHORA, con los ítems que la persona pudo haber corregido:
 *
 * - **incluido:** `ítems − descuentos = impreso`. El IVA, si lo hay, ya está en
 *   los precios.
 * - **IVA agregado (D215):** `ítems − descuentos + IVA = impreso`, con el
 *   subtotal igual a los ítems o a los ítems menos el descuento (App Backend
 *   2.164.0, la misma regla que adopta el dueño).
 * - **ninguno:** no hay nada que mostrar, o los ítems ya no cierran con nada.
 *   La pantalla queda como antes.
 *
 * Lo que se divide sigue siendo la suma de los ítems: ni el IVA agregado ni el
 * descuento se reparten (D215, D218). `aparte` dice qué queda afuera, para la
 * nota.
 *
 * D224 · el cargo por servicio impreso (App Backend 2.168.0) entra en las dos
 * identidades sumando: `ítems + servicio − descuentos (+ IVA) = impreso`. Va en
 * su propia fila, después del IVA y antes del descuento (si el descuento va
 * después del subtotal). Tampoco se reparte, y nunca es un plato.
 */
export type FilaDelDesglose =
  | { readonly clave: 'subtotal' | 'iva' | 'servicio' | 'total'; readonly cents: number }
  /** El descuento va en positivo; la pantalla lo muestra en negativo. */
  | { readonly clave: 'descuento'; readonly cents: number };

export type DesgloseDelTicket =
  | { readonly tipo: 'ninguno' }
  | {
    readonly tipo: 'cierra';
    /** En el orden de la cuenta: cada fila se lee sobre la anterior. */
    readonly filas: readonly FilaDelDesglose[];
    /** Lo que no entra en lo que paga cada uno. */
    readonly aparte: LoQueNoSeReparte;
  };

/** Lo que no entra en lo que paga cada uno: el IVA agregado, el cargo por servicio y el descuento. */
export interface LoQueNoSeReparte {
  readonly ivaCents: number;
  readonly descuentoCents: number;
  readonly servicioCents?: number;
}

const NINGUNO: DesgloseDelTicket = { tipo: 'ninguno' };

export function desgloseDelTicket(entrada: {
  /** La suma de los ítems actuales; 0 si alguno está incompleto. */
  readonly sumaItems: number;
  readonly ticketValido: boolean;
  /** `total_detected_cents` de la lectura; `null` si no vino. */
  readonly impreso: number | null;
  readonly totales: TicketTotals | null;
  readonly ajustes?: readonly TicketAdjustment[] | null;
}): DesgloseDelTicket {
  const { sumaItems, ticketValido, impreso, totales } = entrada;
  const descuento = sumaDeTipo(entrada.ajustes, 'discount');
  const servicio = sumaDeTipo(entrada.ajustes, 'service_charge');
  if (!ticketValido || impreso === null || (!totales && descuento === 0 && servicio === 0)) return NINGUNO;
  const iva = totales?.tax_cents;
  // Defensa: el decodificador ya exige que los totales cierren con el impreso
  // (con o sin el descuento, con el servicio), pero esta vista no lo presume.
  if (totales) {
    const conIva = totales.subtotal_cents + (iva ?? 0) + servicio;
    if (conIva !== impreso && !(descuento > 0 && conIva - descuento === impreso)) return NINGUNO;
  }
  const incluido = sumaItems + servicio - descuento === impreso;
  const agregado = !incluido && iva !== undefined && iva > 0
    && sumaItems + servicio - descuento + iva === impreso
    && totales !== null
    && (totales.subtotal_cents === sumaItems || totales.subtotal_cents === sumaItems - descuento);
  if (!incluido && !agregado) return NINGUNO;

  // El subtotal ya viene descontado si con el IVA (y el servicio) da el impreso:
  // el descuento va antes. Si no, va después del subtotal, del IVA y del servicio.
  const subtotalDescontado = descuento > 0 && totales !== null
    && totales.subtotal_cents + (iva ?? 0) + servicio === impreso;
  const filas: FilaDelDesglose[] = [];
  if (descuento > 0 && subtotalDescontado) filas.push({ clave: 'descuento', cents: descuento });
  if (totales) {
    filas.push({ clave: 'subtotal', cents: totales.subtotal_cents });
    if (iva !== undefined) filas.push({ clave: 'iva', cents: iva });
  }
  if (servicio > 0) filas.push({ clave: 'servicio', cents: servicio });
  if (descuento > 0 && !subtotalDescontado) filas.push({ clave: 'descuento', cents: descuento });
  filas.push({ clave: 'total', cents: impreso });
  return {
    tipo: 'cierra',
    filas,
    aparte: { ivaCents: agregado ? iva! : 0, descuentoCents: descuento, servicioCents: servicio },
  };
}

/** D218 · un descuento se muestra en negativo, con el signo menos tipográfico (U+2212). */
export function montoDeDescuento(cents: number): string {
  return `\u2212${formatMXN(cents)}`;
}

/**
 * D215 · D218 · la nota sin ámbar de lo que no entra en lo que paga cada uno.
 * Una sola, aunque sean el IVA agregado y el descuento a la vez. `null` si no
 * queda nada afuera. Los textos los aprobó el Bibliotecario (AF-NOCHE-DESCUENTO).
 * D224 · con el cargo por servicio, las siete combinaciones (plan C aprobado,
 * AF-SERVICIO-APARTE-VISIBLE): el servicio va entre el IVA y el descuento.
 */
export function notaDeLoQueNoSeReparte(
  aparte: LoQueNoSeReparte,
  t: (s: string, ...args: unknown[]) => string,
): string | null {
  const { ivaCents, descuentoCents } = aparte;
  const servicioCents = aparte.servicioCents ?? 0;
  if (servicioCents > 0) {
    const servicio = formatMXN(servicioCents);
    if (ivaCents > 0 && descuentoCents > 0) {
      return t('Lo que paga cada uno todavía no incluye el IVA ({0}), el cargo por servicio ({1}) ni el descuento ({2})',
        formatMXN(ivaCents), servicio, montoDeDescuento(descuentoCents));
    }
    if (ivaCents > 0) {
      return t('Lo que paga cada uno todavía no incluye el IVA ({0}) ni el cargo por servicio ({1})', formatMXN(ivaCents), servicio);
    }
    if (descuentoCents > 0) {
      return t('Lo que paga cada uno todavía no incluye el cargo por servicio ({0}) ni el descuento ({1})',
        servicio, montoDeDescuento(descuentoCents));
    }
    return t('Lo que paga cada uno todavía no incluye el cargo por servicio ({0})', servicio);
  }
  if (ivaCents > 0 && descuentoCents > 0) {
    return t('Lo que paga cada uno todavía no incluye el IVA ({0}) ni el descuento ({1})',
      formatMXN(ivaCents), montoDeDescuento(descuentoCents));
  }
  if (ivaCents > 0) return t('Lo que paga cada uno todavía no incluye el IVA ({0})', formatMXN(ivaCents));
  if (descuentoCents > 0) return t('Lo que paga cada uno todavía no incluye el descuento ({0})', montoDeDescuento(descuentoCents));
  return null;
}
