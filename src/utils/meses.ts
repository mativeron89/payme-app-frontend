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

/** La zona de corte del dueño para los períodos de «Mis estadísticas». */
const ZONA_MEXICO = 'America/Mexico_City';

/** Año y mes (1–12) de un instante, leídos en hora de México. */
function mesDeMexico(instante: Date): { anio: number; mes: number } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_MEXICO, year: 'numeric', month: 'numeric' })
    .formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { anio: valor('year'), mes: valor('month') };
}

function nombreDeMes(anio: number, mes: number, idioma: 'es' | 'en'): string {
  // El día 15 al mediodía UTC cae en el mismo mes en cualquier zona: se formatea en UTC.
  const nombre = new Intl.DateTimeFormat(idioma === 'es' ? 'es-MX' : 'en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(anio, mes - 1, 15, 12)));
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}

/**
 * AF-36 · el mes en curso y el anterior en México, para la hoja del selector
 * («Este mes · Septiembre», «Mes pasado · Agosto»).
 */
export function mesesDeMexico(ahora: Date, idioma: 'es' | 'en'): { actual: string; anterior: string } {
  const { anio, mes } = mesDeMexico(ahora);
  const anteriorAnio = mes === 1 ? anio - 1 : anio;
  const anteriorMes = mes === 1 ? 12 : mes - 1;
  return { actual: nombreDeMes(anio, mes, idioma), anterior: nombreDeMes(anteriorAnio, anteriorMes, idioma) };
}

/**
 * AF-36 · el NOMBRE del período en la burbuja: «Septiembre», «Agosto», «2026».
 * `inicio` es `period.start` del dueño —ya confirmado— y se lee en hora de
 * México: el 1 a las 00:00 de México son las 06:00Z, y leído en otra zona podría
 * caer en el mes anterior. Sin `inicio` (el dueño no mandó `period`) vale el mes
 * en curso de México, que es lo que el dueño devuelve en ese caso.
 *
 * `last_3_months` no tiene un nombre de mes: devuelve `null` y la pantalla usa
 * su rótulo traducido.
 */
export function nombreDelPeriodo(
  clave: string,
  inicio: string | null,
  idioma: 'es' | 'en',
  ahora: Date,
): string | null {
  if (clave === 'last_3_months') return null;
  const instante = inicio !== null && Number.isFinite(Date.parse(inicio)) ? new Date(inicio) : null;
  if (clave === 'last_month' && instante === null) return mesesDeMexico(ahora, idioma).anterior;
  const { anio, mes } = mesDeMexico(instante ?? ahora);
  if (clave === 'this_year') return String(anio);
  return nombreDeMes(anio, mes, idioma);
}
