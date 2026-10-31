import { formatMXN } from '../utils/format';
import type { DesgloseDelTicket } from './desgloseDelTicket';

/**
 * D622 · AF-2 · mejora 4 (§5 de la especificación): cuánto sobra o falta para
 * cuadrar el ticket.
 *
 * Sólo NOMBRA lo que ya se medía: la regla de cuándo no cuadra es la de
 * `totalMismatch` en `CreateMesaFlow` (suma de las filas contra el total
 * IMPRESO, salvo que el desglose impreso cierre). Lo nuevo es el estado
 * «cuadra», que se afirma sólo con un total impreso y todas las filas
 * completas: sin eso no se dice nada, porque no se afirma lo que no se midió.
 * La tolerancia es el centavo exacto.
 */
export type EstadoDelCuadre =
  | { readonly tipo: 'cuadra'; readonly impresoCents: number }
  | {
    readonly tipo: 'sobran' | 'faltan';
    readonly sumaCents: number;
    readonly impresoCents: number;
    /** Siempre positiva: el signo lo dice `tipo`. */
    readonly diferenciaCents: number;
  };

export function estadoDelCuadre(entrada: {
  /** La suma de las filas actuales. */
  readonly sumaItems: number;
  /** `total_detected_cents` de la lectura; `null` si no vino. */
  readonly impreso: number | null;
  readonly desglose: DesgloseDelTicket;
  /** Todas las filas con nombre y precio (el `ticketValid` de la pantalla). */
  readonly filasCompletas: boolean;
}): EstadoDelCuadre | null {
  const { sumaItems, impreso, desglose, filasCompletas } = entrada;
  if (!filasCompletas || impreso === null) return null;
  if (sumaItems === impreso || desglose.tipo === 'cierra') return { tipo: 'cuadra', impresoCents: impreso };
  const diferencia = sumaItems - impreso;
  return {
    tipo: diferencia > 0 ? 'sobran' : 'faltan',
    sumaCents: sumaItems,
    impresoCents: impreso,
    diferenciaCents: Math.abs(diferencia),
  };
}

/** El texto de la franja, con la diferencia exacta en palabras (nunca sólo el color). */
export function textoDelCuadre(estado: EstadoDelCuadre, t: (s: string, ...a: unknown[]) => string): string {
  if (estado.tipo === 'cuadra') return t('Cuadra con el ticket: {0}.', formatMXN(estado.impresoCents));
  return estado.tipo === 'sobran'
    ? t('Tus platos suman {0} y el ticket dice {1}: sobran {2}.',
      formatMXN(estado.sumaCents), formatMXN(estado.impresoCents), formatMXN(estado.diferenciaCents))
    : t('Tus platos suman {0} y el ticket dice {1}: faltan {2}.',
      formatMXN(estado.sumaCents), formatMXN(estado.impresoCents), formatMXN(estado.diferenciaCents));
}
