import type { AppNotification } from '../../api/types';
import type { InvitacionAViaje } from '../../api/viajes';
import type { Idioma } from '../../i18n/idioma';
import { relTime } from '../../utils/format';
import type { DestinoDeAviso } from '../../utils/labels';
import { nombreCompleto, parametroDeTicket, rangoDeFechas, type T } from './viajesView';

/**
 * AF-VIAJES · los avisos de un viaje en la bandeja (diseño 1f y 1t), puro: sin
 * React ni red. Los textos los arma el dueño en español en `body`
 * (`contract/viajes-v1.json` → `avisos`) y la fila los muestra tal cual, como
 * los de las mesas. Lo que se decide acá es adónde lleva cada uno y qué línea
 * va debajo del texto.
 *
 * El viaje siempre viene en `payload.viaje_id`; `viaje_ticket_added` trae además
 * `ticket_id`. Abrir la pantalla del viaje la vuelve a pedir: el acceso lo
 * decide el dueño en ese momento, no el aviso (igual que `mesaDelAviso`).
 */

export const TIPOS_AVISO_VIAJE = [
  'viaje_invitation_received',
  'viaje_invitation_rejected',
  'viaje_ticket_added',
  // D256 · App Backend 2.175.0: alguien eliminó un ticket o un gasto. Lleva al viaje.
  'viaje_ticket_removed',
  'viaje_closed',
  'viaje_transfer_marked',
  'viaje_transfer_not_received',
  'viaje_finished',
] as const;

/**
 * Por prefijo y no por la lista: un tipo `viaje_*` que este front todavía no
 * conoce también es de Viajes, y queda como fila quieta (sin destino) en vez de
 * caer en la lógica de las mesas.
 */
export function esAvisoDeViaje(type: string): boolean {
  return type.startsWith('viaje_');
}

/** Un id del dueño (UUID): sin puntos ni barras, que romperían la ruta del ticket. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

function idValido(raw: unknown): string | null {
  return typeof raw === 'string' && ID.test(raw) ? raw : null;
}

export function viajeDelAviso(n: { readonly payload: Record<string, unknown> | null }): string | null {
  return idValido(n.payload?.viaje_id);
}

/** ¿La bandeja trae alguna invitación a un viaje? Sólo entonces se piden las pendientes. */
export function hayInvitacionAViaje(notifs: readonly AppNotification[] | null): boolean {
  return notifs?.some((n) => n.type === 'viaje_invitation_received') ?? false;
}

/** Las invitaciones pendientes (`GET /api/viajes/invitaciones`) por viaje. */
export function invitacionesPorViaje(lista: readonly InvitacionAViaje[]): ReadonlyMap<string, InvitacionAViaje> {
  return new Map(lista.map((inv) => [inv.viaje_id, inv]));
}

export type RespuestaAViaje = 'aceptada' | 'rechazada';

/**
 * El estado de una invitación a un viaje, visto desde su aviso.
 *
 * - `pendiente`: está en la lista de pendientes ⇒ «Rechazar» / «Aceptar».
 * - `respondida`: se respondió AHORA, en esta pantalla ⇒ «Aceptaste» /
 *   «Rechazaste». Después (otra visita) ya no está pendiente y la fila queda
 *   sin botones: las palabras son sólo para justo después de responder.
 * - `no_pendiente`: la lista llegó y no la trae ⇒ ya se respondió antes.
 * - `sin_saber`: la lista no llegó (cargando o error) ⇒ ni botones ni destino.
 */
export type EstadoInvitacionAViaje =
  | { readonly tipo: 'pendiente'; readonly invitacion: InvitacionAViaje }
  | { readonly tipo: 'respondida'; readonly respuesta: RespuestaAViaje; readonly invitacion: InvitacionAViaje | null }
  | { readonly tipo: 'no_pendiente' }
  | { readonly tipo: 'sin_saber' };

export function estadoDeInvitacionAViaje(
  viajeId: string | null,
  pendientes: ReadonlyMap<string, InvitacionAViaje> | null,
  respuestas: ReadonlyMap<string, RespuestaAViaje>,
): EstadoInvitacionAViaje {
  if (viajeId === null) return { tipo: 'sin_saber' };
  const invitacion = pendientes?.get(viajeId) ?? null;
  const respuesta = respuestas.get(viajeId);
  if (respuesta) return { tipo: 'respondida', respuesta, invitacion };
  if (pendientes === null) return { tipo: 'sin_saber' };
  return invitacion ? { tipo: 'pendiente', invitacion } : { tipo: 'no_pendiente' };
}

/**
 * Adónde lleva tocar un aviso de viaje. `null` = la fila no navega.
 *
 * Sin la capacidad de Viajes, ninguno navega: la fila queda quieta. Una
 * invitación pendiente tampoco: la persona todavía no es miembro, y lo que se hace con
 * ella son sus botones. Una rechazada recién, tampoco.
 */
export function destinoDeAvisoDeViaje(
  n: { readonly type: string; readonly payload: Record<string, unknown> | null },
  habilitado: boolean,
  invitacion: EstadoInvitacionAViaje,
): DestinoDeAviso | null {
  if (!habilitado || !esAvisoDeViaje(n.type)) return null;
  const viaje = viajeDelAviso(n);
  if (viaje === null) return null;
  switch (n.type) {
    case 'viaje_invitation_received':
      if (invitacion.tipo === 'respondida') return invitacion.respuesta === 'aceptada' ? { page: 'viaje', param: viaje } : null;
      return invitacion.tipo === 'no_pendiente' ? { page: 'viaje', param: viaje } : null;
    case 'viaje_ticket_added': {
      const ticket = idValido(n.payload?.ticket_id);
      // Sin `ticket_id` (no debería pasar: el contrato lo trae) el viaje sigue sirviendo.
      return ticket === null ? { page: 'viaje', param: viaje } : { page: 'viaje-ticket', param: parametroDeTicket(viaje, ticket) };
    }
    case 'viaje_invitation_rejected':
    case 'viaje_ticket_removed':
    case 'viaje_closed':
    case 'viaje_transfer_marked':
    case 'viaje_transfer_not_received':
      return { page: 'viaje', param: viaje };
    case 'viaje_finished':
      return { page: 'viaje-cerrado', param: viaje };
    default:
      return null;
  }
}

/** ¿El aviso lleva el botón «Revisar» (1t)? Sólo «marcó que te pagó», y sólo si navega. */
export function llevaRevisar(type: string, destino: DestinoDeAviso | null): boolean {
  return type === 'viaje_transfer_marked' && destino !== null;
}

/** Cada tramo de la línea va entero: a 375 px corta en un « · », nunca adentro de «hace 5 min». */
const sinCortes = (s: string) => s.replace(/ /g, '\u00a0');

/**
 * La línea debajo del texto de una invitación a un viaje, en lugar de la hora
 * sola: «5–11 oct · 4 personas · hace 5 min» mientras está pendiente;
 * «hace 5 min · Aceptaste» justo después de responder (1t). `null` ⇒ la fila
 * muestra la hora como cualquier otra.
 */
export function lineaDeInvitacionAViaje(
  estado: EstadoInvitacionAViaje,
  creadoEn: string,
  idioma: Idioma,
  t: T,
  ahora: Date = new Date(),
): string | null {
  const hace = relTime(creadoEn, ahora, t);
  if (estado.tipo === 'respondida') {
    return [hace, estado.respuesta === 'aceptada' ? t('Aceptaste') : t('Rechazaste')].map(sinCortes).join(' · ');
  }
  if (estado.tipo !== 'pendiente') return null;
  const inv = estado.invitacion;
  const partes: string[] = [];
  const fechas = rangoDeFechas(inv.fecha_desde, inv.fecha_hasta, idioma);
  if (fechas) partes.push(fechas);
  partes.push(inv.personas === 1 ? t('1 persona') : t('{0} personas', inv.personas));
  partes.push(hace);
  return partes.map(sinCortes).join(' · ');
}

/**
 * El nombre de quien invita en negrita, como la invitación a una mesa: sólo
 * si el `body` del dueño empieza con ese nombre. Si no coincide, el texto va
 * entero, sin negrita: nunca se reescribe lo que dijo el dueño.
 */
export function negritaDeInvitacionAViaje(
  body: string,
  estado: EstadoInvitacionAViaje,
  t: T,
): { readonly nombre: string; readonly resto: string } | null {
  const inv = estado.tipo === 'pendiente' || estado.tipo === 'respondida' ? estado.invitacion : null;
  const quien = inv?.invitado_por ?? null;
  if (!quien || quien.eliminada) return null;
  const nombre = nombreCompleto(quien, t);
  return nombre && body.startsWith(`${nombre} `) ? { nombre, resto: body.slice(nombre.length) } : null;
}
