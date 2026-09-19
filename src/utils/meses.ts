/**
 * AF-31 · 2f · nombres de mes para las barras («Abr») y la comparación («abril»).
 *
 * Con `Intl` y no con el diccionario: «Mar» ya es la clave de «martes» en
 * `en.ts` («Tue») y marzo necesitaría otra traducción para el mismo texto.
 * `month_start` del dueño es el 1 a las 00:00 de México (06:00Z), así que el mes
 * UTC es el mismo.
 */
export function mesCorto(iso: string, idioma: 'es' | 'en'): string {
  const nombre = new Intl.DateTimeFormat(idioma === 'es' ? 'es-MX' : 'en-US', { month: 'short', timeZone: 'UTC' })
    .format(new Date(iso))
    .replace('.', '');
  const tres = nombre.slice(0, 3);
  return tres.charAt(0).toUpperCase() + tres.slice(1);
}

export function mesLargo(iso: string, idioma: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(idioma === 'es' ? 'es-MX' : 'en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(iso));
}

/** «$612»: pesos enteros redondeados, para las etiquetas de las barras. */
export function pesosCortos(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}
