import type { TicketTotals } from '../api/types';

/**
 * D209 · D215 · el subtotal y el IVA del ticket en «Ver el ticket».
 *
 * El dueño publica `ticket_totals` sólo con la pareja que cierra exacto con el
 * total impreso (`subtotal + IVA === total_detected`). Acá se decide si esa
 * pareja describe la mesa TAL COMO ESTÁ AHORA, con los ítems que la persona
 * pudo haber corregido:
 *
 * - `incluido`: los ítems suman el total impreso (el IVA ya está en los
 *   precios, el ticket lo desglosa). Subtotal e IVA son informativos.
 * - `agregado`: los ítems suman exactamente el subtotal y el IVA se suma al
 *   final (App Backend 2.157.0, `interpretacion: iva_agregado`). La diferencia
 *   contra el impreso NO es un error de lectura: subtotal + IVA cierra. Lo que
 *   se divide sigue siendo la suma de los ítems: el IVA no se reparte (D215,
 *   «Dejarlo para los pagos»).
 * - `ninguno`: sin totales, sin total impreso, ticket incompleto, o ítems que ya
 *   no cierran con ninguno de los dos. La pantalla queda como antes de D209.
 */
export type DesgloseDelTicket =
  | { readonly tipo: 'ninguno' }
  | {
    readonly tipo: 'incluido' | 'agregado';
    readonly subtotalCents: number;
    readonly ivaCents: number;
    /** El total impreso: subtotal + IVA. */
    readonly totalCents: number;
  };

const NINGUNO: DesgloseDelTicket = { tipo: 'ninguno' };

export function desgloseDelTicket(entrada: {
  /** La suma de los ítems actuales; 0 si alguno está incompleto. */
  readonly sumaItems: number;
  readonly ticketValido: boolean;
  /** `total_detected_cents` de la lectura; `null` si no vino. */
  readonly impreso: number | null;
  readonly totales: TicketTotals | null;
}): DesgloseDelTicket {
  const { sumaItems, ticketValido, impreso, totales } = entrada;
  if (!ticketValido || impreso === null || !totales) return NINGUNO;
  // Defensa: el decodificador ya lo exige, pero esta vista no lo presume.
  if (totales.subtotal_cents + totales.tax_cents !== impreso) return NINGUNO;
  const base = { subtotalCents: totales.subtotal_cents, ivaCents: totales.tax_cents, totalCents: impreso };
  if (sumaItems === impreso) return { tipo: 'incluido', ...base };
  if (sumaItems === totales.subtotal_cents && totales.tax_cents > 0) return { tipo: 'agregado', ...base };
  return NINGUNO;
}
