import type { IconName } from '../../components/Icon';
import type { Idioma } from '../../i18n/idioma';
import type { MiembroViaje, PersonaViaje, TipoLugar } from '../../api/viajes';

/**
 * AF-VIAJES · lo que comparten las pantallas de Viajes, puro (sin React ni
 * red). Todo texto visible sale por `t()`: estos helpers devuelven la CLAVE y
 * sus argumentos, o reciben el `t` de la pantalla.
 *
 * El front no calcula balances: sólo elige la frase según el signo que publica
 * el dueño (positivo = te deben).
 */

export type T = (texto: string, ...args: unknown[]) => string;

const MESES_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `YYYY-MM-DD` → partes de calendario, sin zona: es una fecha impresa, no un instante. */
function partes(fecha: string): { dia: number; mes: number; anio: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  return { anio: Number(m[1]), mes: Number(m[2]) - 1, dia: Number(m[3]) };
}

/** «8 oct» / «Oct 8». Con `anio`, «5 oct 2026» / «Oct 5, 2026». */
export function fechaCortaViaje(fecha: string | null, idioma: Idioma, anio = false): string | null {
  const p = fecha ? partes(fecha) : null;
  if (!p) return null;
  if (idioma === 'en') return `${MESES_EN[p.mes]} ${p.dia}${anio ? `, ${p.anio}` : ''}`;
  return `${p.dia} ${MESES_ES[p.mes]}${anio ? ` ${p.anio}` : ''}`;
}

/**
 * Las fechas del viaje (opcionales, D242-5): «5–11 oct», «28 sep – 2 oct»,
 * «5 oct» si hay una sola, `null` si no hay ninguna.
 */
export function rangoDeFechas(desde: string | null, hasta: string | null, idioma: Idioma): string | null {
  const a = desde ? partes(desde) : null;
  const b = hasta ? partes(hasta) : null;
  if (!a && !b) return null;
  if (!a || !b) return fechaCortaViaje(desde ?? hasta, idioma);
  if (desde === hasta) return fechaCortaViaje(desde, idioma);
  if (a.mes === b.mes && a.anio === b.anio) {
    return idioma === 'en' ? `${MESES_EN[a.mes]} ${a.dia}–${b.dia}` : `${a.dia}–${b.dia} ${MESES_ES[a.mes]}`;
  }
  return `${fechaCortaViaje(desde, idioma)} – ${fechaCortaViaje(hasta, idioma)}`;
}

/** El nombre de una persona del viaje; una cuenta dada de baja es «Cuenta eliminada». */
export function nombreCompleto(p: PersonaViaje, t: T): string {
  if (p.eliminada) return t('Cuenta eliminada');
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || t('Cuenta eliminada');
}

export function nombreDePila(p: PersonaViaje, t: T): string {
  if (p.eliminada) return t('Cuenta eliminada');
  return p.first_name || p.last_name || t('Cuenta eliminada');
}

/** «Tú» para mí; si no, el nombre completo. */
export function nombreDeMiembro(m: MiembroViaje, t: T): string {
  return m.es_yo ? t('Tú') : nombreCompleto(m, t);
}

/** Las iniciales del avatar («LP»); sin nombre, nada. */
export function iniciales(p: PersonaViaje): string {
  if (p.eliminada) return '';
  return [p.first_name, p.last_name].map((x) => (x ?? '').trim().charAt(0)).join('').toUpperCase();
}

/** «Tú, Luis, Sofía y Diego»: yo primero, los demás por su nombre de pila, en el orden del dueño. */
export function listaDeNombres(miembros: readonly MiembroViaje[], t: T): string {
  const nombres = [
    ...miembros.filter((m) => m.es_yo).map(() => t('Tú')),
    ...miembros.filter((m) => !m.es_yo).map((m) => nombreDePila(m, t)),
  ];
  if (nombres.length <= 1) return nombres.join('');
  return t('{0} y {1}', nombres.slice(0, -1).join(', '), nombres[nombres.length - 1]);
}

/**
 * El balance propio en una frase (1c, 1g): «Debes $542», «Te deben $1,819» o
 * «Estás a mano». Positivo = te deben (contrato). `monto` formatea centavos.
 */
export function textoDeMiBalance(cents: number, t: T, monto: (c: number) => string): string {
  if (cents < 0) return t('Debes {0}', monto(-cents));
  if (cents > 0) return t('Te deben {0}', monto(cents));
  return t('Estás a mano');
}

/**
 * El tipo de lugar, ya traducido: «Restaurante» o, para «Por tipo de lugar»
 * (1s), «Restaurantes». Cada texto es un `t('…')` literal a propósito: así el
 * extractor de `traduccion.test.ts` los ve y no hace falta una familia.
 */
export function etiquetaTipoLugar(tipo: TipoLugar, t: T, plural = false): string {
  switch (tipo) {
    case 'restaurante': return plural ? t('Restaurantes') : t('Restaurante');
    case 'bar': return plural ? t('Bares') : t('Bar');
    case 'cafe': return plural ? t('Cafés') : t('Café');
    case 'super': return t('Súper');
    case 'otro': return plural ? t('Otros') : t('Otro');
  }
}

const ICONO: Record<TipoLugar, IconName> = {
  restaurante: 'dining',
  bar: 'glass',
  cafe: 'coffee',
  super: 'cart',
  otro: 'receipt',
};

export function iconoTipoLugar(tipo: TipoLugar): IconName {
  return ICONO[tipo];
}

/** El nombre del lugar del ticket, o su tipo si no se leyó el comercio. */
export function nombreDelLugar(lugar: string | null, tipo: TipoLugar, t: T): string {
  return lugar ?? etiquetaTipoLugar(tipo, t);
}

/** El parámetro de la ruta de un ticket: `<viaje>.<ticket>` (el router admite un solo parámetro; un UUID no tiene puntos). */
export function parametroDeTicket(viajeId: string, ticketId: string): string {
  return `${viajeId}.${ticketId}`;
}

export function leerParametroDeTicket(param: string | null): { viajeId: string; ticketId: string } | null {
  if (!param) return null;
  const [viajeId, ticketId, ...resto] = param.split('.');
  if (!viajeId || !ticketId || resto.length) return null;
  return { viajeId, ticketId };
}
