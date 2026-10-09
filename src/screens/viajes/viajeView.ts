import type { Idioma } from '../../i18n/idioma';
import type {
  DetalleViaje,
  MiembroViaje,
  TicketEnViaje,
  TransferenciaViaje,
  VistaPreviaCierre,
} from '../../api/viajes';
import { fechaCortaViaje, nombreCompleto, nombreDePila, nombreDelLugar, type T } from './viajesView';

/**
 * AF-VIAJES · D242 · lo puro del viaje abierto (1g), el cierre (1m), la salida
 * (1q), los pagos (1n, 1o, 1p) y el balance en vivo (1l). Sin React ni red.
 *
 * El front no calcula nada de plata: elige la frase y ordena lo que publica el
 * dueño. Los montos se suman sólo para decir, en la hoja de cierre, cuánto de
 * un mismo ticket se le asigna a quienes no eligieron: son las filas que el
 * dueño ya calculó, agrupadas por ticket.
 */

export type Monto = (cents: number) => string;

// ─── Plantillas con partes en negrita ─────────────────────────────────────

/** Un tramo de una plantilla ya traducida: texto fijo o el índice de un `{n}`. */
export type Pieza = { readonly texto: string } | { readonly indice: number };

/**
 * Parte «Tú le transfieres {0} a {1}» en tramos, para poner en negrita sólo el
 * monto. La plantilla sale de `t('…')` SIN argumentos (devuelve la plantilla ya
 * traducida, con sus `{n}`): así el inglés también se parte bien.
 */
export function partirPlantilla(plantilla: string): Pieza[] {
  const out: Pieza[] = [];
  let desde = 0;
  for (const m of plantilla.matchAll(/\{(\d+)\}/g)) {
    const i = m.index ?? 0;
    if (i > desde) out.push({ texto: plantilla.slice(desde, i) });
    out.push({ indice: Number(m[1]) });
    desde = i + m[0].length;
  }
  if (desde < plantilla.length) out.push({ texto: plantilla.slice(desde) });
  return out;
}

// ─── Personas ─────────────────────────────────────────────────────────────

export function miembroPorId(miembros: readonly MiembroViaje[], id: string | null): MiembroViaje | null {
  if (!id) return null;
  return miembros.find((m) => m.id === id) ?? null;
}

/** Nombre completo por id; quien ya no es miembro (o no vino) es «Cuenta eliminada». */
export function nombreCompletoDeId(miembros: readonly MiembroViaje[], id: string | null, t: T): string {
  const m = miembroPorId(miembros, id);
  return m ? nombreCompleto(m, t) : t('Cuenta eliminada');
}

/** Nombre de pila por id, con el mismo respaldo. */
export function nombreDePilaDeId(miembros: readonly MiembroViaje[], id: string | null, t: T): string {
  const m = miembroPorId(miembros, id);
  return m ? nombreDePila(m, t) : t('Cuenta eliminada');
}

/** «Diego», «Diego y Sofía», «Ana, Diego y Sofía». */
export function unirNombres(nombres: readonly string[], t: T): string {
  if (nombres.length <= 1) return nombres.join('');
  return t('{0} y {1}', nombres.slice(0, -1).join(', '), nombres[nombres.length - 1]);
}

// ─── 1g · los tickets ─────────────────────────────────────────────────────

/** La fecha impresa del ticket o, sin ella, el día en que se cargó. */
export function fechaDelTicket(
  ticket: Pick<TicketEnViaje, 'fecha_ticket' | 'cargado_en'>,
  idioma: Idioma,
): string | null {
  return fechaCortaViaje(ticket.fecha_ticket ?? ticket.cargado_en?.slice(0, 10) ?? null, idioma);
}

/** «Pagaste tú» o «Pagó Luis Pérez» (sin el miembro: «Pagó Cuenta eliminada»). */
export function quienPagoElTicket(ticket: TicketEnViaje, miembros: readonly MiembroViaje[], t: T): string {
  if (ticket.pagaste_tu) return t('Pagaste tú');
  return t('Pagó {0}', nombreCompletoDeId(miembros, ticket.pagado_por, t));
}

/** «8 oct · Pagó Luis Pérez». */
export function metaDelTicket(ticket: TicketEnViaje, miembros: readonly MiembroViaje[], t: T, idioma: Idioma): string {
  return [fechaDelTicket(ticket, idioma), quienPagoElTicket(ticket, miembros, t)].filter(Boolean).join(' · ');
}

// ─── 1q · por qué no puedo salir ──────────────────────────────────────────

export type MotivoSalida = 'selection' | 'paid_ticket' | 'present_in_equal_split';

/** Por qué el dueño no deja salir: abierto, con consumos (1q); esperando pagos o cerrado, transferencias sin confirmar (H02). */
export type PorQueNoPuedeSalir =
  | { readonly tipo: 'motivo'; readonly motivo: MotivoSalida }
  | { readonly tipo: 'pendientes'; readonly pendientes: number };

/**
 * H02 · App Backend 2.172.1 · D242-1: con el viaje en esperando pagos o cerrado
 * se sale con las transferencias propias confirmadas (con «Recibí»); marcar
 * «Ya pagué» solo no alcanza.
 */
export function textoTransferenciasPendientes(n: number, t: T): string {
  if (n === 1) return t('Tienes 1 transferencia sin confirmar. Podrás salir cuando esté confirmada.');
  return t('Tienes {0} transferencias sin confirmar. Podrás salir cuando todas estén confirmadas.', n);
}

/** Los tickets «por lo que pidió cada uno» en los que ya me tocó algo. */
export function ticketsConConsumoMio(tickets: readonly TicketEnViaje[]): number {
  return tickets.filter((tk) => tk.forma === 'consumo' && tk.te_toca_cents > 0).length;
}

export function textoNoPuedeSalir(motivo: MotivoSalida, tickets: readonly TicketEnViaje[], t: T): string {
  switch (motivo) {
    case 'selection': {
      const n = ticketsConConsumoMio(tickets);
      if (n === 0) return t('Ya elegiste consumos en este viaje. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.');
      if (n === 1) return t('Ya elegiste consumos en 1 ticket. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.');
      return t('Ya elegiste consumos en {0} tickets. Podrás salir cuando se cierre el viaje y tus transferencias estén confirmadas.', n);
    }
    case 'paid_ticket':
      return t('Pagaste un ticket de este viaje. Podrás salir cuando se cierre el viaje y quede todo pagado.');
    case 'present_in_equal_split':
      return t('Estás entre los que estuvieron en un ticket en partes iguales. Podrás salir cuando se cierre el viaje y quede todo pagado.');
  }
}

// ─── 1m · la hoja de cierre ───────────────────────────────────────────────

interface Lugar {
  readonly lugar: string;
  readonly fecha: string;
}

/** El lugar y la fecha de un ticket del viaje, con el tipo de lugar si no se leyó el comercio. */
function lugarDelTicket(
  viaje: DetalleViaje,
  ticketId: string,
  lugar: string | null,
  fecha: string | null,
  t: T,
  idioma: Idioma,
): Lugar {
  const tk = viaje.tickets.find((x) => x.id === ticketId);
  return {
    lugar: nombreDelLugar(lugar ?? tk?.lugar ?? null, tk?.tipo_lugar ?? 'otro', t),
    fecha: fechaCortaViaje(fecha, idioma) ?? (tk ? fechaDelTicket(tk, idioma) : null) ?? '',
  };
}

/** Para empezar la frase: yo primero («Tú»), después los nombres completos. */
function sujetos(viaje: DetalleViaje, ids: readonly (string | null)[], t: T): string {
  const yo = ids.filter((id) => id === viaje.mi_miembro_id).map(() => t('Tú'));
  const otros = ids.filter((id) => id !== viaje.mi_miembro_id).map((id) => nombreCompletoDeId(viaje.miembros, id, t));
  return unirNombres([...yo, ...otros], t);
}

/** Dentro de la frase: los nombres de pila y yo al final («Diego y tú»). */
function complementos(viaje: DetalleViaje, ids: readonly (string | null)[], t: T): string {
  const otros = ids.filter((id) => id !== viaje.mi_miembro_id).map((id) => nombreDePilaDeId(viaje.miembros, id, t));
  const yo = ids.filter((id) => id === viaje.mi_miembro_id).map(() => t('tú'));
  return unirNombres([...otros, ...yo], t);
}

/**
 * Lo que dice la hoja de cierre (1m) sobre quién no eligió: una frase por
 * ticket, en el orden del dueño. Varias personas en un mismo ticket se reparten
 * en partes iguales lo que falta (D242-4); el monto es la suma de sus filas.
 */
export function avisosDeCierre(
  preview: VistaPreviaCierre,
  viaje: DetalleViaje,
  t: T,
  idioma: Idioma,
  monto: Monto,
): string[] {
  if (preview.todos_eligieron || preview.asignaciones.length === 0) {
    if (preview.tickets <= 0) return [];
    if (preview.tickets === 1) return [t('Todos eligieron lo suyo en el ticket.')];
    return [t('Todos eligieron lo suyo en los {0} tickets.', preview.tickets)];
  }
  const grupos = new Map<string, { lugar: string | null; fecha: string | null; ids: (string | null)[]; cents: number }>();
  for (const a of preview.asignaciones) {
    const g = grupos.get(a.ticket_id) ?? { lugar: a.lugar, fecha: a.fecha_ticket, ids: [], cents: 0 };
    g.ids.push(a.miembro_id);
    g.cents += a.monto_cents;
    grupos.set(a.ticket_id, g);
  }
  return [...grupos].map(([ticketId, g]) => {
    const { lugar, fecha } = lugarDelTicket(viaje, ticketId, g.lugar, g.fecha, t, idioma);
    const [unico] = g.ids;
    if (g.ids.length === 1 && unico === viaje.mi_miembro_id) {
      return t('Todavía no elegiste en {0} del {1}. Si cierras ahora, los {2} que faltan se te asignan a ti.', lugar, fecha, monto(g.cents));
    }
    if (g.ids.length === 1) {
      return t('{0} todavía no eligió en {1} del {2}. Si cierras ahora, los {3} que faltan se le asignan a {4}.',
        nombreCompletoDeId(viaje.miembros, unico ?? null, t), lugar, fecha, monto(g.cents), nombreDePilaDeId(viaje.miembros, unico ?? null, t));
    }
    return t('{0} todavía no eligieron en {1} del {2}. Si cierras ahora, los {3} que faltan se reparten en partes iguales entre {4}.',
      sujetos(viaje, g.ids, t), lugar, fecha, monto(g.cents), complementos(viaje, g.ids, t));
  });
}

// ─── 1n · 1o · 1p · esperando pagos ───────────────────────────────────────

/** Lo que todavía se puede marcar: ni pagada ni anulada por una baja. */
export function sePuedeMarcar(tr: TransferenciaViaje): boolean {
  return tr.estado === 'pendiente' || tr.estado === 'marcada';
}

/**
 * Qué ve quien entra a un viaje esperando pagos:
 * - `debo` (1n): tengo una transferencia mía por hacer o por confirmar;
 * - `me_deben` (1o): me deben y falta que confirme;
 * - `resto` (1p): lo mío ya está, sólo queda mirar cuántas faltan.
 */
export type VistaDePagos = 'debo' | 'me_deben' | 'resto';

export function vistaDePagos(transferencias: readonly TransferenciaViaje[]): VistaDePagos {
  if (transferencias.some((tr) => tr.mia === 'debo' && sePuedeMarcar(tr))) return 'debo';
  if (transferencias.some((tr) => tr.mia === 'me_deben' && sePuedeMarcar(tr))) return 'me_deben';
  return 'resto';
}

/**
 * «Faltan {0} de {1}» y la barra partida (1p): una parte por transferencia
 * viva —la anulada por una baja no suma a «faltan» (contrato)—, llena cuando
 * está pagada. Lo que falta es el número del dueño.
 */
export function progresoDePagos(viaje: Pick<DetalleViaje, 'transferencias' | 'transferencias_pendientes'>): {
  readonly faltan: number;
  readonly total: number;
  readonly partes: readonly boolean[];
} {
  const vivas = viaje.transferencias.filter((tr) => tr.estado !== 'anulada_por_baja');
  return { faltan: viaje.transferencias_pendientes, total: vivas.length, partes: vivas.map((tr) => tr.estado === 'pagada') };
}

/** El estado de una transferencia que no puedo marcar: «marcada» sigue siendo «Pendiente» (cuenta cuando confirma quien recibe). */
export function estadoDeTransferencia(tr: TransferenciaViaje, t: T): string {
  if (tr.estado === 'anulada_por_baja') return t('Anulada: una de las cuentas se dio de baja.');
  if (tr.estado === 'pagada') return t('Pagado');
  return t('Pendiente');
}

/**
 * Las transferencias que me pagan, partidas en tramos para dibujarlas: cada
 * marcada va sola y destacada (pide «Recibí» o «No me llegó»); las demás
 * seguidas comparten tarjeta. Mantiene el orden del dueño.
 */
export function tramosDeTransferencias(
  transferencias: readonly TransferenciaViaje[],
): ReadonlyArray<{ readonly destacada: boolean; readonly filas: readonly TransferenciaViaje[] }> {
  const out: { destacada: boolean; filas: TransferenciaViaje[] }[] = [];
  for (const tr of transferencias) {
    const destacada = tr.estado === 'marcada';
    const ultimo = out[out.length - 1];
    if (!destacada && ultimo && !ultimo.destacada) ultimo.filas.push(tr);
    else out.push({ destacada, filas: [tr] });
  }
  return out;
}
