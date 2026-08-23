/**
 * Rótulo de la fila de propina del comprobante (tanda 4 de fidelidad, ítem 4).
 *
 * Hoy dice **«Propina (al mesero)»**, genérico, y el paquete pide que traiga
 * el porcentaje elegido y **el nombre de la persona** a la que va. Los dos
 * datos existen —`tip` con su porcentaje y `mesa.active_staff[].display_name`
 * vía `staffId`—, **pero ninguno de los dos está garantizado**:
 *
 * - la propina puede ser un **monto libre**, y entonces no hay porcentaje;
 * - elegir destinatario es **opcional** (`staffId` puede quedar en `null`), y
 *   además la mesa puede no tener personal cargado.
 *
 * 🔴 Por eso esto es una función y no una plantilla: **lo que no se sabe no se
 * nombra.** Un «para —» o un «0%» de relleno en un comprobante es peor que la
 * versión genérica que vino a reemplazar — el comprobante es el papel que la
 * persona guarda.
 *
 * Devuelve la CLAVE en español con placeholders posicionales, que es como
 * funciona el i18n de este repo.
 */
export interface PropinaRecibo {
  /** Porcentaje elegido, o `null` si fue monto libre. */
  readonly pct: number | null;
  /** Nombre de la persona elegida, o `null` si no se eligió ninguna. */
  readonly nombre: string | null;
}

export type RotuloPropina =
  | { readonly clave: 'Propina'; readonly args: readonly [] }
  | { readonly clave: 'Propina ({0}%)'; readonly args: readonly [number] }
  | { readonly clave: 'Propina (para {0})'; readonly args: readonly [string] }
  | { readonly clave: 'Propina ({0}% · {1})'; readonly args: readonly [number, string] };

export function rotuloPropina({ pct, nombre }: PropinaRecibo): RotuloPropina {
  if (pct !== null && nombre !== null) return { clave: 'Propina ({0}% · {1})', args: [pct, nombre] };
  if (pct !== null) return { clave: 'Propina ({0}%)', args: [pct] };
  if (nombre !== null) return { clave: 'Propina (para {0})', args: [nombre] };
  return { clave: 'Propina', args: [] };
}

/**
 * 🔴 LA DECISIÓN COMPLETA DE LA FILA DE PROPINA, en un solo lugar: **si
 * aparece** y **cómo se llama**.
 *
 * Existe por el bloqueante 2 de la auditoría del 2026-08-20. La vista ya
 * aplicaba el rótulo nuevo y ocultaba la propina cero, pero `receiptText()`
 * —el que alimenta *compartir* y *descargar*— seguía emitiendo
 * `Propina (al mesero)` fijo, incluso con cero. **La misma operación se
 * contaba distinto en pantalla que en el papel que la persona manda.**
 *
 * `rotuloPropina` sola no alcanzaba para impedirlo: dejaba la mitad de la
 * decisión —el `tip > 0`— repetida en cada superficie, y una copia se
 * desincronizó. Acá viajan **las dos mitades juntas**: `null` significa
 * *«esta fila no va»*, y no hay forma de usar el rótulo sin pasar por la
 * omisión.
 */
export function filaPropina(
  tipCents: number,
  datos: PropinaRecibo,
): RotuloPropina | null {
  if (tipCents <= 0) return null;
  return rotuloPropina(datos);
}
