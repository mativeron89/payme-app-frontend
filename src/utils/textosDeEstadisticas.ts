import { categoryLabel } from './labels';

type T = (s: string, ...a: unknown[]) => string;

/**
 * Textos compartidos por «Mis estadísticas» (2a) y «Tus restaurantes» (2b).
 *
 * `nombreDeCocina` es el ÚNICO `t()` no literal de las cocinas: `labels.ts` es
 * constante de MÓDULO, devuelve español y se traduce acá, en un solo sitio para
 * el chip de favorita, el anillo y la lista de restaurantes. El censo de
 * `traduccion.test.ts` lo cuenta como uno.
 */
export function nombreDeCocina(category: string | null | undefined, t: T): string | null {
  const crudo = categoryLabel(category);
  return crudo === null ? null : t(crudo);
}

/** Visitas con su palabra: «1 visita», «3 visitas». */
export function visitasTexto(n: number, t: T): string {
  return `${n} ${n === 1 ? t('visita') : t('visitas')}`;
}

/** «5 lugares · 10 visitas», con sus singulares. */
export function lugaresYVisitas(lugares: number, visitas: number, t: T): string {
  return `${lugares} ${lugares === 1 ? t('lugar') : t('lugares')} · ${visitasTexto(visitas, t)}`;
}

/** AF-31 · el nombre del período, como aparece en la burbuja y en el selector. */
export function etiquetaDePeriodo(clave: string, t: T): string {
  if (clave === 'last_month') return t('Mes pasado');
  if (clave === 'last_3_months') return t('Últimos 3 meses');
  if (clave === 'this_year') return t('Este año');
  return t('Este mes');
}

/** AF-31 · el cierre de frases como «3 lugares · 6 visitas este mes». */
export function sufijoDePeriodo(clave: string, t: T): string {
  if (clave === 'last_month') return t('el mes pasado');
  if (clave === 'last_3_months') return t('en los últimos 3 meses');
  if (clave === 'this_year') return t('este año');
  return t('este mes');
}

/** «1 vez», «4 veces». En platos, `times` son visitas (handoff v2.107.0). */
export function vecesTexto(n: number, t: T): string {
  return `${n} ${n === 1 ? t('vez') : t('veces')}`;
}

/** AF-36 · «7 platos», con su singular: la cifra de la burbuja de 2c. */
export function platosTexto(n: number, t: T): string {
  return `${n} ${n === 1 ? t('plato') : t('platos')}`;
}

/** «15 platos distintos», con su singular. */
export function platosDistintos(n: number, t: T): string {
  return `${n} ${n === 1 ? t('plato distinto') : t('platos distintos')}`;
}

// ─── D479/D482 · AF-1 · textos del rediseño de Claude Design (0.261) ──────────

const ZONA_MEXICO = 'America/Mexico_City';

/** Año y mes (1–12) de un instante en hora de México: el corte de los períodos del dueño. */
function mesDeMexico(instante: Date): { anio: number; mes: number } {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_MEXICO, year: 'numeric', month: 'numeric' })
    .formatToParts(instante);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
  return { anio: valor('year'), mes: valor('month') };
}

/** El nombre del mes en minúscula, como lo da Intl («agosto», «August»). El 15 al mediodía UTC no cambia de mes en ninguna zona. */
function nombreDeMes(anio: number, mes: number, idioma: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(idioma === 'es' ? 'es-MX' : 'en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(anio, mes - 1, 15, 12)));
}

function conMayuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * «Agosto a octubre» / «August to October»: dos meses (año y mes 1–12) unidos.
 * Mayúscula inicial sola en español; en inglés los meses van con mayúscula.
 */
export function rangoDeMeses(
  desde: { anio: number; mes: number },
  hasta: { anio: number; mes: number },
  idioma: 'es' | 'en',
): string {
  const a = nombreDeMes(desde.anio, desde.mes, idioma);
  const b = nombreDeMes(hasta.anio, hasta.mes, idioma);
  return idioma === 'es' ? `${conMayuscula(a)} a ${b}` : `${conMayuscula(a)} to ${conMayuscula(b)}`;
}

/** «Agosto a octubre»: los últimos 3 meses de México, contando el actual (el segundo texto del desplegable). */
export function ultimosTresMeses(ahora: Date, idioma: 'es' | 'en'): string {
  const { anio, mes } = mesDeMexico(ahora);
  const indice = anio * 12 + (mes - 1) - 2;
  return rangoDeMeses({ anio: Math.floor(indice / 12), mes: (indice % 12) + 1 }, { anio, mes }, idioma);
}

/** El año en curso de México: el segundo texto de «Este año · 2026». */
export function anioDeMexico(ahora: Date): string {
  return String(mesDeMexico(ahora).anio);
}

/**
 * T4 · «Agosto 2026» con mayúscula inicial sola (antes «Agosto De 2026», por un
 * `text-transform: capitalize` sobre «agosto de 2026»). `monthStart` es el 1 a las
 * 00:00 de México: se lee en esa zona.
 */
export function mesYAnio(monthStart: string, idioma: 'es' | 'en'): string {
  const { anio, mes } = mesDeMexico(new Date(monthStart));
  return `${conMayuscula(nombreDeMes(anio, mes, idioma))} ${anio}`;
}

/** Un mes en minúscula dentro de una frase en español («agosto»); en inglés, con mayúscula. */
export function mesEnFrase(monthStart: string, idioma: 'es' | 'en'): string {
  const { anio, mes } = mesDeMexico(new Date(monthStart));
  const nombre = nombreDeMes(anio, mes, idioma);
  return idioma === 'es' ? nombre : conMayuscula(nombre);
}

/** «Mayo a octubre»: el primero y el último de los meses de Evolución. */
export function rangoDeEvolucion(primero: string, ultimo: string, idioma: 'es' | 'en'): string {
  return rangoDeMeses(mesDeMexico(new Date(primero)), mesDeMexico(new Date(ultimo)), idioma);
}

/**
 * K1 (D482) · el estado del período, en letra chica junto al mes: el mes pasado
 * está cerrado; los demás incluyen el mes en curso.
 */
export function estadoDelPeriodo(clave: string, t: T): string {
  return clave === 'last_month' ? t('Mes completo') : t('En curso');
}

/** «Agosto» / «August»: el mes solo, con mayúscula inicial (las filas de la mezcla de Evolución). */
export function mesConMayuscula(monthStart: string, idioma: 'es' | 'en'): string {
  const { anio, mes } = mesDeMexico(new Date(monthStart));
  return conMayuscula(nombreDeMes(anio, mes, idioma));
}

/**
 * La fila de la base en Meses completos: «Consumo» / «Gasto», en inglés «Orders»
 * / «Spending» (D482, TEXTOS-ES-EN.md). Sin `t()` A PROPÓSITO, como los meses de
 * `meses.ts`: la clave de `en.ts` es el español, y «Consumo» ya se traduce
 * «Item» (la línea del ticket al crear la mesa) y «Gasto» «Expense» (Viajes). El
 * mismo español con otro sentido necesita otra traducción.
 */
export function rotuloDeLaBase(basis: 'consumption' | 'payments', idioma: 'es' | 'en'): string {
  if (idioma === 'en') return basis === 'consumption' ? 'Orders' : 'Spending';
  return basis === 'consumption' ? 'Consumo' : 'Gasto';
}
