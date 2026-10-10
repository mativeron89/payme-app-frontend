import { denominatorBps } from '../../api/mesaPresentation';
import type { OcrResponse } from '../../api/types';
import type {
  CargarTicketPedido,
  FormaTicket,
  ItemDelTicket,
  MiembroViaje,
  PersonaDelTicket,
  TicketDelViaje,
  TipoLugar,
} from '../../api/viajes';
import type { Idioma } from '../../i18n/idioma';
import { fractionPreview } from '../mesaItemsView';
import { porcionesDisponibles } from '../queConsumisteView';
import { fechaCortaViaje, listaDeNombres, nombreCompleto, nombreDePila, type T } from './viajesView';

/**
 * AF-VIAJES · D242 · lo puro de «Ticket nuevo» (1h, 1k y «¿Quiénes
 * estuvieron?») y del ticket del viaje (1i, 1j y partes iguales). Sin React ni
 * red: las pantallas lo usan y las pruebas lo ejercitan sin montarlas.
 *
 * El front no reparte: lo que te toca lo publica el dueño. Lo único que se
 * calcula acá es la VISTA PREVIA de «Te toca» mientras eliges, con las mismas
 * cuentas que la mesa (`fractionPreview`), y la suma impresa del ticket recién
 * escaneado (lo que todavía no está en el dueño).
 */

// ─── El ticket recién escaneado (1h) ──────────────────────────────────────

/** El total impreso del escaneo: Σ precio × cantidad, en centavos enteros. */
export function totalDelEscaneo(items: OcrResponse['items']): number {
  return items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
}

/** «9 oct · 14:20», «9 oct» sin hora, `null` sin fecha leída. */
export function fechaDelEscaneo(
  dt: { readonly date: string; readonly time: string | null } | undefined,
  idioma: Idioma,
): string | null {
  const fecha = dt ? fechaCortaViaje(dt.date, idioma) : null;
  if (!fecha) return null;
  return dt?.time ? `${fecha} · ${dt.time}` : fecha;
}

/**
 * El pedido de `POST …/tickets`, sin la llave de idempotencia (la pone la
 * pantalla: la misma mientras el pedido no cambie). La hora sólo viaja con la
 * fecha (el dueño rechaza una hora sin fecha).
 */
export function pedidoDeCarga(
  ocr: OcrResponse,
  forma: FormaTicket,
  tipo: TipoLugar,
): Omit<CargarTicketPedido, 'idempotency_key'> {
  const fecha = ocr.ticket_datetime?.date ?? null;
  return {
    ocr_receipt: ocr.receipt ?? '',
    forma,
    tipo_lugar: tipo,
    lugar: ocr.merchant?.name ?? null,
    fecha_ticket: fecha,
    hora_ticket: fecha ? ocr.ticket_datetime?.time ?? null : null,
    items: ocr.items.map(({ name, price_cents, quantity }) => ({ name, price_cents, quantity })),
  };
}

/**
 * La llave de idempotencia: la MISMA para el mismo pedido (un reintento no
 * carga dos tickets) y una nueva si el pedido cambió (el dueño contesta 409
 * `idempotency_key_conflict` a una llave vieja con otro contenido).
 */
export function llaveParaPedido(
  previa: { readonly json: string; readonly key: string } | null,
  pedido: unknown,
  nueva: () => string,
): { json: string; key: string } {
  const json = JSON.stringify(pedido);
  return previa && previa.json === json ? { json, key: previa.key } : { json, key: nueva() };
}

// ─── Quiénes estuvieron (partes iguales) ──────────────────────────────────

export interface Candidato {
  readonly id: string;
  readonly es_yo: boolean;
  readonly nombre: string;
  /** El @ sin «@», o `null`. */
  readonly arroba: string | null;
}

/** Los miembros que pueden estar en un ticket: los activos con cuenta. «Tú» primero. */
export function candidatosDelViaje(miembros: readonly MiembroViaje[], t: T): Candidato[] {
  const vivos = miembros.filter((m) => !m.eliminada);
  return [...vivos.filter((m) => m.es_yo), ...vivos.filter((m) => !m.es_yo)].map((m) => ({
    id: m.id,
    es_yo: m.es_yo,
    nombre: m.es_yo ? t('Tú') : nombreCompleto(m, t),
    arroba: m.username,
  }));
}

/** Las personas del ticket, con su nombre (de los miembros del viaje). «Tú» primero. */
export function candidatosDelTicket(
  personas: readonly PersonaDelTicket[],
  miembros: readonly MiembroViaje[],
  t: T,
): Candidato[] {
  const porId = new Map(miembros.map((m) => [m.id, m]));
  const lista = personas.flatMap((p): Candidato[] => {
    if (!p.miembro_id) return [];
    const m = porId.get(p.miembro_id);
    return [{
      id: p.miembro_id,
      es_yo: m?.es_yo ?? false,
      nombre: m ? (m.es_yo ? t('Tú') : nombreCompleto(m, t)) : t('Cuenta eliminada'),
      arroba: m?.username ?? null,
    }];
  });
  return [...lista.filter((c) => c.es_yo), ...lista.filter((c) => !c.es_yo)];
}

/**
 * Marca o desmarca a alguien. `ausentes` son los desmarcados. Al menos uno tiene
 * que quedar marcado: el último no se desmarca (el dueño exige un presente).
 */
export function alternarPresente(
  ausentes: ReadonlySet<string>,
  id: string,
  candidatos: readonly { readonly id: string }[],
): Set<string> {
  const next = new Set(ausentes);
  if (next.has(id)) {
    next.delete(id);
    return next;
  }
  const marcados = candidatos.filter((c) => !next.has(c.id)).length;
  if (marcados <= 1) return next;
  next.add(id);
  return next;
}

/** Los ids marcados, en el orden de los candidatos. */
export function idsPresentes(candidatos: readonly { readonly id: string }[], ausentes: ReadonlySet<string>): string[] {
  return candidatos.filter((c) => !ausentes.has(c.id)).map((c) => c.id);
}

/** Los desmarcados de un ticket ya cargado (para editar quiénes estuvieron). */
export function ausentesDelTicket(personas: readonly PersonaDelTicket[]): Set<string> {
  return new Set(personas.filter((p) => !p.presente && p.miembro_id).map((p) => p.miembro_id as string));
}

/** «Tú, Luis y Sofía»: los presentes, con la misma frase que la tarjeta del viaje. */
export function nombresPresentes(
  personas: readonly PersonaDelTicket[],
  miembros: readonly MiembroViaje[],
  t: T,
): string {
  const presentes = new Set(personas.filter((p) => p.presente).map((p) => p.miembro_id));
  return listaDeNombres(miembros.filter((m) => presentes.has(m.id)), t);
}

// ─── El ticket del viaje (1i, 1j, iguales) ────────────────────────────────

/** La forma de dividir, en palabras. */
export function textoDeLaForma(forma: FormaTicket, t: T): string {
  switch (forma) {
    case 'consumo': return t('Por lo que pidió cada uno');
    case 'iguales': return t('En partes iguales');
    case 'total': return t('Pagar el total');
  }
}

/** El miembro que pagó, o `null` (cuenta dada de baja o fuera del viaje). */
export function quienPago(ticket: Pick<TicketDelViaje, 'pagado_por'>, miembros: readonly MiembroViaje[]): MiembroViaje | null {
  return miembros.find((m) => m.id === ticket.pagado_por) ?? null;
}

/** «Pagaste tú», «Pagó Luis Pérez» o, con varios (D263), «Pagaron 3 personas». */
export function textoDelPago(
  ticket: Pick<TicketDelViaje, 'pagado_por' | 'pagaste_tu' | 'pagadores'>,
  miembros: readonly MiembroViaje[],
  t: T,
): string {
  // Con varios, `pagaste_tu` dice que estás entre ellos, no que pagaste tú solo.
  if (ticket.pagadores.length > 1) return t('Pagaron {0} personas', ticket.pagadores.length);
  if (ticket.pagaste_tu) return t('Pagaste tú');
  const m = quienPago(ticket, miembros);
  return t('Pagó {0}', m ? nombreCompleto(m, t) : t('Cuenta eliminada'));
}

/** «8 oct · Pagó Luis Pérez», y con `forma`, «… · Por lo que pidió cada uno». */
export function subtituloDelTicket(
  ticket: Pick<TicketDelViaje, 'fecha_ticket' | 'pagado_por' | 'pagaste_tu' | 'pagadores' | 'forma'>,
  miembros: readonly MiembroViaje[],
  idioma: Idioma,
  t: T,
  conForma = true,
): string {
  return [
    fechaCortaViaje(ticket.fecha_ticket, idioma),
    textoDelPago(ticket, miembros, t),
    conForma ? textoDeLaForma(ticket.forma, t) : null,
  ].filter(Boolean).join(' · ');
}

export interface PagadorEnLista {
  readonly clave: string;
  readonly nombre: string;
  readonly monto_cents: number;
}

/** D263 · quiénes pagaron y cuánto, en el orden del dueño (el primero es `pagado_por`): «Tú» o el nombre completo. */
export function pagadoresDelTicket(
  ticket: Pick<TicketDelViaje, 'pagadores'>,
  miembros: readonly MiembroViaje[],
  t: T,
): PagadorEnLista[] {
  const porId = new Map(miembros.map((m) => [m.id, m]));
  return ticket.pagadores.map((p, i) => {
    const m = p.miembro_id ? porId.get(p.miembro_id) : undefined;
    return {
      clave: p.miembro_id ?? `sin-${i}`,
      nombre: m ? (m.es_yo ? t('Tú') : nombreCompleto(m, t)) : t('Cuenta eliminada'),
      monto_cents: p.monto_cents,
    };
  });
}

export interface ChipDeEleccion {
  readonly clave: string;
  readonly nombre: string;
  readonly ya_eligio: boolean;
}

/** «Quién ya eligió» (1i): «Tú» o el nombre de pila, y si falta elegir. Nunca QUÉ eligió. */
export function chipsDeEleccion(
  personas: readonly PersonaDelTicket[],
  miembros: readonly MiembroViaje[],
  t: T,
): ChipDeEleccion[] {
  const porId = new Map(miembros.map((m) => [m.id, m]));
  const chips = personas.map((p, i) => {
    const m = p.miembro_id ? porId.get(p.miembro_id) : undefined;
    return {
      clave: p.miembro_id ?? `sin-${i}`,
      es_yo: m?.es_yo ?? false,
      nombre: m ? (m.es_yo ? t('Tú') : nombreDePila(m, t)) : t('Cuenta eliminada'),
      ya_eligio: p.ya_eligio,
    };
  });
  return [...chips.filter((c) => c.es_yo), ...chips.filter((c) => !c.es_yo)]
    .map(({ clave, nombre, ya_eligio }) => ({ clave, nombre, ya_eligio }));
}

/**
 * Lo más que puedo tomar de un plato: lo que queda más lo mío (al elegir de
 * nuevo, lo mío se reemplaza). Como el modo «igual» de la mesa.
 */
export function topeDelPlato(item: Pick<ItemDelTicket, 'remaining_bps' | 'my_bps'>): number {
  return Math.min(10000, item.remaining_bps + item.my_bps);
}

/** Las porciones que se ofrecen (Entero, ½, ⅓, ¼), con el tope y las personas del ticket. */
export function porcionesDelPlato(item: Pick<ItemDelTicket, 'remaining_bps' | 'my_bps'>, personas: number): number[] {
  return porcionesDisponibles(personas > 0 ? personas : null, topeDelPlato(item));
}

/** La porción con la que se toma un plato libre: la más grande que entra. `null` = no entra ninguna. */
export function porcionInicial(item: Pick<ItemDelTicket, 'remaining_bps' | 'my_bps'>, personas: number): number | null {
  const d = porcionesDelPlato(item, personas)[0];
  return d === undefined ? null : denominatorBps(d);
}

/** Lo que ya elegí (lo guardado en el dueño): plato → bps. */
export function seleccionGuardada(items: readonly ItemDelTicket[]): Map<string, number> {
  return new Map(items.filter((i) => i.my_bps > 0).map((i) => [i.id, i.my_bps]));
}

/** ¿La selección en pantalla es la guardada? */
export function seleccionSinCambios(items: readonly ItemDelTicket[], seleccion: ReadonlyMap<string, number>): boolean {
  return items.every((i) => (seleccion.get(i.id) ?? 0) === i.my_bps);
}

/** Lo que vale mi porción de un plato: lo del dueño si no cambió; si cambió, la vista previa de la mesa. */
export function montoDelPlato(item: ItemDelTicket, bps: number): number {
  if (bps === item.my_bps) return item.my_amount_cents;
  if (bps <= 0) return 0;
  return fractionPreview(item.line_cents, bps, topeDelPlato(item));
}

/**
 * «Te toca» en el pie de 1i: sin cambios, lo que publica el dueño; mientras
 * eliges, la vista previa (lo no tocado conserva el monto del dueño).
 */
export function teTocaConSeleccion(ticket: TicketDelViaje, seleccion: ReadonlyMap<string, number>): number {
  if (seleccionSinCambios(ticket.items, seleccion)) return ticket.te_toca_cents;
  return ticket.items.reduce((s, i) => s + montoDelPlato(i, seleccion.get(i.id) ?? 0), 0);
}

/** El cuerpo de «Listo»: lo elegido, en el orden del ticket. */
export function pedidoDeSeleccion(
  items: readonly ItemDelTicket[],
  seleccion: ReadonlyMap<string, number>,
): Array<{ item_id: string; fraction_bps: number }> {
  return items
    .filter((i) => (seleccion.get(i.id) ?? 0) > 0)
    .map((i) => ({ item_id: i.id, fraction_bps: seleccion.get(i.id) as number }));
}

// ─── Ticket duplicado (1k) ────────────────────────────────────────────────

/**
 * La fecha y la hora de un instante, en la hora del teléfono: «8 oct» y
 * «21:40». `null` si no hay instante o no se entiende.
 */
export function fechaYHoraLocal(instante: string | null, idioma: Idioma): { fecha: string; hora: string } | null {
  if (!instante) return null;
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) return null;
  const dos = (n: number) => String(n).padStart(2, '0');
  const ymd = `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
  const fecha = fechaCortaViaje(ymd, idioma);
  if (!fecha) return null;
  return { fecha, hora: `${dos(d.getHours())}:${dos(d.getMinutes())}` };
}
