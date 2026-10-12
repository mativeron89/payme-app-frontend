import type { TuMesa } from '../api/misMesas';
import type { EstadoCapacidadViajes } from '../api/viajes';
import type { VisitaDeViaje } from '../api/viajesVisitas';
import { personalMonth } from '../utils/personalDates';
import type { HistorialMesa } from './historialView';

/**
 * D293 · Mesas en UNA lista por fecha: las mesas (`GET /api/mesas/mine`, con cursor), los pagos (`GET /account/history`,
 * completos) y los restaurantes de mis viajes (`GET /api/viajes/visitas`, con cursor), de la más reciente a la más
 * vieja, en sus grupos por mes. Vista pura, fuera de la pantalla: sin librería de render es la única forma de matar la
 * mezcla en la suite.
 *
 * ## Nunca saltea ni repite al cargar más
 *
 * Cada lista llega de a páginas, ya ordenada por el dueño. Una lista que todavía tiene más NO dice nada de lo que viene:
 * su página siguiente puede traer algo más nuevo que lo último que se cargó de otra. Por eso se muestra un renglón sólo
 * mientras ninguna lista que participa está sin renglones cargados por mostrar y con más por pedir (o todavía
 * cargando): lo visible es siempre un PREFIJO de la mezcla completa. «Ver más» pide la página siguiente de la lista que
 * frena, y lo visible sólo crece por abajo: lo que ya se veía no se mueve, y nada aparece arriba de ello.
 *
 * Una lista que falló o que no existe (Viajes apagado) no participa: las otras se siguen viendo, y la pantalla muestra
 * su aviso.
 */

export type EstadoDeFuente = 'cargando' | 'lista' | 'fallo' | 'ausente';

export interface FuenteDeLinea<K extends string, R> {
  readonly clave: K;
  readonly estado: EstadoDeFuente;
  /** Lo cargado, en el orden del dueño (de la más reciente a la más vieja). */
  readonly renglones: readonly R[];
  /** El dueño tiene más (un cursor). Una lista completa, `false`. */
  readonly hayMas: boolean;
}

export interface MezclaDeLinea<K extends string, R> {
  /** Lo que se puede mostrar: un prefijo de la mezcla completa. */
  readonly renglones: readonly R[];
  /** Las listas que frenan porque tienen más por pedir: lo que pide «Ver más». */
  readonly conMas: readonly K[];
  /** Alguna lista que frena todavía está cargando. */
  readonly cargando: boolean;
}

/**
 * La mezcla por fecha. `instante` da los milisegundos de un renglón, o `null` si no tiene una fecha legible: ese
 * renglón conserva su lugar en su lista (toma el instante del anterior de la misma lista). En un empate, primero la
 * lista que viene antes en `fuentes`; dentro de una lista, siempre su orden.
 */
export function mezclarPorFecha<K extends string, R>(
  fuentes: ReadonlyArray<FuenteDeLinea<K, R>>,
  instante: (r: R) => number | null,
): MezclaDeLinea<K, R> {
  const participan = fuentes.filter((f) => f.estado === 'lista' || f.estado === 'cargando');
  const claves = participan.map((f) => {
    let anterior = Number.POSITIVE_INFINITY;
    return f.renglones.map((r) => {
      const ms = instante(r);
      if (ms !== null && Number.isFinite(ms)) anterior = ms;
      return anterior;
    });
  });
  const indice = participan.map(() => 0);
  const salida: R[] = [];
  for (;;) {
    let elegida = -1;
    const frenan: number[] = [];
    participan.forEach((f, i) => {
      if (indice[i]! < f.renglones.length) {
        if (elegida === -1 || claves[i]![indice[i]!]! > claves[elegida]![indice[elegida]!]!) elegida = i;
      } else if (f.estado === 'cargando' || f.hayMas) {
        frenan.push(i);
      }
    });
    if (frenan.length > 0) {
      return {
        renglones: salida,
        conMas: frenan.filter((i) => participan[i]!.estado === 'lista').map((i) => participan[i]!.clave),
        cargando: frenan.some((i) => participan[i]!.estado === 'cargando'),
      };
    }
    if (elegida === -1) return { renglones: salida, conMas: [], cargando: false };
    salida.push(participan[elegida]!.renglones[indice[elegida]!]!);
    indice[elegida]! += 1;
  }
}

// ─── Las visitas de viaje como fuente ──────────────────────

/**
 * En qué está la lista de mis restaurantes de viaje para la mezcla:
 * - Viajes apagado: no existe (`ausente`), sin aviso. Mesas queda como antes.
 * - Sin saber todavía si está encendido: `cargando` (frena, porque sus renglones pueden ir arriba de todo). Si la config
 *   no llega, `ausente`: Mesas no se queda esperando para siempre.
 * - Encendido: `fallo` con su aviso, `cargando` hasta la primera página, o `lista`.
 */
export function estadoDeLasVisitas(e: {
  readonly capacidad: EstadoCapacidadViajes;
  readonly configFallo: boolean;
  readonly fallo: boolean;
  readonly cargadas: boolean;
}): EstadoDeFuente {
  if (e.capacidad === 'apagada') return 'ausente';
  if (e.capacidad === 'pendiente') return e.configFallo ? 'ausente' : 'cargando';
  if (e.fallo) return 'fallo';
  return e.cargadas ? 'lista' : 'cargando';
}

/**
 * La página siguiente de visitas, al final de lo cargado. Un ticket cuya fecha se corrigió entre dos páginas (D278-3)
 * podría volver a venir: se muestra una sola vez, donde ya estaba.
 */
export function agregarSinRepetir(actual: readonly VisitaDeViaje[] | null, nuevas: readonly VisitaDeViaje[]): VisitaDeViaje[] {
  const ya = new Set((actual ?? []).map((v) => v.ticket_id));
  return [...(actual ?? []), ...nuevas.filter((v) => !ya.has(v.ticket_id))];
}

// ─── Los renglones de Mesas ────────────────────────────────

export type RenglonDeMesas =
  | { readonly tipo: 'mesa'; readonly mesa: TuMesa }
  | { readonly tipo: 'pago'; readonly mesa: HistorialMesa }
  | { readonly tipo: 'viaje'; readonly visita: VisitaDeViaje };

export type FuenteDeMesas = 'mesas' | 'viajes' | 'pagos';

/** La fecha por la que se ordena y se agrupa cada renglón: la de la fila, la misma que se muestra. */
export function fechaDeRenglon(r: RenglonDeMesas): string | null {
  switch (r.tipo) {
    case 'mesa': return r.mesa.createdAt;
    case 'pago': return r.mesa.date;
    case 'viaje': return r.visita.instante;
  }
}

/** Una clave estable por renglón (las tres listas no comparten ids, pero se prefijan igual). */
export function claveDeRenglon(r: RenglonDeMesas): string {
  switch (r.tipo) {
    case 'mesa': return `mesa:${r.mesa.id}`;
    case 'pago': return `pago:${r.mesa.mesa_code}`;
    case 'viaje': return `viaje:${r.visita.ticket_id}`;
  }
}

export function instanteDeRenglon(r: RenglonDeMesas): number | null {
  const f = fechaDeRenglon(r);
  if (f === null) return null;
  const ms = Date.parse(f);
  return Number.isNaN(ms) ? null : ms;
}

export interface MesDeLinea {
  /** `YYYY-MM` de presentación, o `sin-fecha`. */
  readonly key: string;
  /** «octubre de 2026». La MAYÚSCULA la pone el CSS. */
  readonly label: string;
  readonly renglones: readonly RenglonDeMesas[];
}

/**
 * Los grupos por mes, con la regla del historial (`agruparPorMes`, D158): el mes personal en la zona elegida, el mismo
 * de la fecha de la fila. Un renglón sin fecha legible va a «Sin fecha». Los meses quedan en el orden en que aparecen,
 * que es el de la mezcla.
 */
export function agruparLineaPorMes(renglones: readonly RenglonDeMesas[], locale: string, zone: string | null): MesDeLinea[] {
  const grupos = new Map<string, { key: string; label: string; renglones: RenglonDeMesas[] }>();
  for (const r of renglones) {
    const { key, label } = personalMonth(fechaDeRenglon(r) ?? '', locale, zone);
    const g = grupos.get(key);
    if (g) g.renglones.push(r);
    else grupos.set(key, { key, label, renglones: [r] });
  }
  return [...grupos.values()];
}
