import { CLAVES_COLOR_VIAJE, CONTRATO_VIAJES, ViajesResponseError, type ColorViaje } from './viajes';

/**
 * D293 · los restaurantes de mis viajes, también en Mesas. App Backend 2.184.0, `GET /api/viajes/visitas`
 * (`contract-mirror/contract/viajes-v1.json`).
 *
 * Mati eligió «Un restaurante de un viaje» y «Sí, con el nombre del viaje (Recomendada)». El dueño publica mis tickets
 * de restaurante, bar o café de mis viajes con la regla de Estadísticas (D260, `estadisticas.que_cuenta`): de mis viajes
 * como miembro activo, en los que consumí algo, sin gastos a mano y sin un recibo que ya abrió una mesa que cuenta para
 * mí. Mesas los mezcla por fecha con sus mesas y sus pagos (`screens/mesasEnLinea.ts`).
 *
 * El front espeja: el monto es `te_toca_cents` tal como llega (el del detalle del ticket y el de Estadísticas), nunca
 * calculado acá. Claves EXACTAS, como el resto de Viajes: un sobre o una fila que no son los del dueño rompen la página,
 * y Mesas lo muestra con su aviso.
 */

/** Los tipos que el dueño publica en esta ruta (`TIPOS_EN_ESTADISTICAS`): nunca súper ni otro. */
export const TIPOS_DE_VISITA = ['restaurante', 'bar', 'cafe'] as const;
export type TipoDeVisita = (typeof TIPOS_DE_VISITA)[number];

/** El viaje de una visita, como lo muestra la lista de viajes (D255): para la marca con su nombre. */
export interface ViajeDeLaVisita {
  readonly id: string;
  readonly nombre: string;
  /** Una clave de la paleta, o `null` (el color de la app). */
  readonly color: ColorViaje | null;
  /** La foto sale por `GET /api/viajes/:id/foto`. */
  readonly has_photo: boolean;
}

export interface VisitaDeViaje {
  readonly ticket_id: string;
  readonly viaje: ViajeDeLaVisita;
  /** El lugar del ticket, o `null` (se muestra su tipo). */
  readonly lugar: string | null;
  readonly tipo_lugar: TipoDeVisita;
  /** El de Estadísticas: la fecha y hora impresas en México (sin hora, las 12:00); sin fecha, cuando se cargó. */
  readonly instante: string;
  /** Lo que me toca de ese ticket, en centavos. */
  readonly te_toca_cents: number;
}

export interface PaginaDeVisitas {
  readonly visitas: readonly VisitaDeViaje[];
  /** El `page.next_cursor` del dueño: opaco, se devuelve tal cual. `null` = no hay más. */
  readonly nextCursor: string | null;
}

/** El tope de una página según el contrato (`limit` 1..50). */
const LIMITE_MAXIMO = 50;
const ENDPOINT = 'viajes.visitas';

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(value: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const claves = Object.keys(value).sort();
  const quiero = [...esperadas].sort();
  return claves.length === quiero.length && claves.every((c, i) => c === quiero[i]);
}

function exigir(ok: boolean): void {
  if (!ok) throw new ViajesResponseError(ENDPOINT);
}

function objeto(raw: unknown, claves: readonly string[]): Record<string, unknown> {
  exigir(plainObject(raw) && clavesExactas(raw, claves));
  return raw as Record<string, unknown>;
}

const texto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const centavos = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const instante = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const esTipo = (v: unknown): v is TipoDeVisita => typeof v === 'string' && (TIPOS_DE_VISITA as readonly string[]).includes(v);
const colorONull = (v: unknown): v is ColorViaje | null =>
  v === null || (typeof v === 'string' && (CLAVES_COLOR_VIAJE as readonly string[]).includes(v));

function viajeDeLaVisita(raw: unknown): ViajeDeLaVisita {
  const o = objeto(raw, ['id', 'nombre', 'color', 'has_photo']);
  exigir(texto(o.id) && texto(o.nombre) && colorONull(o.color) && typeof o.has_photo === 'boolean');
  return { id: o.id as string, nombre: o.nombre as string, color: o.color as ColorViaje | null, has_photo: o.has_photo as boolean };
}

function visita(raw: unknown): VisitaDeViaje {
  const o = objeto(raw, ['ticket_id', 'viaje', 'lugar', 'tipo_lugar', 'instante', 'te_toca_cents']);
  exigir(texto(o.ticket_id) && (o.lugar === null || texto(o.lugar)) && esTipo(o.tipo_lugar) && instante(o.instante)
    && centavos(o.te_toca_cents));
  return {
    ticket_id: o.ticket_id as string,
    viaje: viajeDeLaVisita(o.viaje),
    lugar: o.lugar as string | null,
    tipo_lugar: o.tipo_lugar as TipoDeVisita,
    instante: o.instante as string,
    te_toca_cents: o.te_toca_cents as number,
  };
}

/** `GET /api/viajes/visitas` → `{ contract, visitas, page: { limit, next_cursor } }`. */
export function decodeVisitasDeViajes(raw: unknown): PaginaDeVisitas {
  const b = objeto(raw, ['contract', 'visitas', 'page']);
  exigir(b.contract === CONTRATO_VIAJES);
  const page = objeto(b.page, ['limit', 'next_cursor']);
  exigir(typeof page.limit === 'number' && Number.isSafeInteger(page.limit) && page.limit >= 1 && page.limit <= LIMITE_MAXIMO
    && (page.next_cursor === null || texto(page.next_cursor)));
  exigir(Array.isArray(b.visitas) && (b.visitas as unknown[]).length <= (page.limit as number));
  const visitas = (b.visitas as unknown[]).map(visita);
  // Un ticket aparece una sola vez: dos filas con el mismo id se repetirían en la lista de Mesas.
  exigir(new Set(visitas.map((v) => v.ticket_id)).size === visitas.length);
  // De la más reciente a la más vieja (el orden del contrato): la mezcla de Mesas lo necesita para no saltear nada.
  exigir(visitas.every((v, i) => i === 0 || Date.parse(visitas[i - 1]!.instante) >= Date.parse(v.instante)));
  return { visitas, nextCursor: page.next_cursor as string | null };
}
