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
 */
export type FilaDelDesglose =
  | { readonly clave: 'subtotal' | 'iva' | 'total'; readonly cents: number }
  /** El descuento va en positivo; la pantalla lo muestra en negativo. */
  | { readonly clave: 'descuento'; readonly cents: number };

export type DesgloseDelTicket =
  | { readonly tipo: 'ninguno' }
  | {
    readonly tipo: 'cierra';
    /** En el orden de la cuenta: cada fila se lee sobre la anterior. */
    readonly filas: readonly FilaDelDesglose[];
    /** Lo que no entra en lo que paga cada uno. */
    readonly aparte: { readonly ivaCents: number; readonly descuentoCents: number };
  };

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
  const descuento = (entrada.ajustes ?? []).reduce((s, a) => s + a.amount_cents, 0);
  if (!ticketValido || impreso === null || (!totales && descuento === 0)) return NINGUNO;
  const iva = totales?.tax_cents;
  // Defensa: el decodificador ya exige que los totales cierren con el impreso
  // (con o sin el descuento), pero esta vista no lo presume.
  if (totales) {
    const conIva = totales.subtotal_cents + (iva ?? 0);
    if (conIva !== impreso && !(descuento > 0 && conIva - descuento === impreso)) return NINGUNO;
  }
  const incluido = sumaItems - descuento === impreso;
  const agregado = !incluido && iva !== undefined && iva > 0
    && sumaItems - descuento + iva === impreso
    && totales !== null
    && (totales.subtotal_cents === sumaItems || totales.subtotal_cents === sumaItems - descuento);
  if (!incluido && !agregado) return NINGUNO;

  // El subtotal ya viene descontado si con el IVA da el impreso: el descuento va
  // antes. Si no, va después del subtotal y del IVA.
  const subtotalDescontado = descuento > 0 && totales !== null
    && totales.subtotal_cents + (iva ?? 0) === impreso;
  const filas: FilaDelDesglose[] = [];
  if (descuento > 0 && subtotalDescontado) filas.push({ clave: 'descuento', cents: descuento });
  if (totales) {
    filas.push({ clave: 'subtotal', cents: totales.subtotal_cents });
    if (iva !== undefined) filas.push({ clave: 'iva', cents: iva });
  }
  if (descuento > 0 && !subtotalDescontado) filas.push({ clave: 'descuento', cents: descuento });
  filas.push({ clave: 'total', cents: impreso });
  return {
    tipo: 'cierra',
    filas,
    aparte: { ivaCents: agregado ? iva! : 0, descuentoCents: descuento },
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
 */
export function notaDeLoQueNoSeReparte(
  aparte: { readonly ivaCents: number; readonly descuentoCents: number },
  t: (s: string, ...args: unknown[]) => string,
): string | null {
  const { ivaCents, descuentoCents } = aparte;
  if (ivaCents > 0 && descuentoCents > 0) {
    return t('Lo que paga cada uno todavía no incluye el IVA ({0}) ni el descuento ({1})',
      formatMXN(ivaCents), montoDeDescuento(descuentoCents));
  }
  if (ivaCents > 0) return t('Lo que paga cada uno todavía no incluye el IVA ({0})', formatMXN(ivaCents));
  if (descuentoCents > 0) return t('Lo que paga cada uno todavía no incluye el descuento ({0})', montoDeDescuento(descuentoCents));
  return null;
}
