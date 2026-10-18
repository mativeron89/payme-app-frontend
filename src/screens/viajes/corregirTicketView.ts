import {
  MAX_DESCRIPCION_GASTO,
  MAX_GASTO_MANUAL_CENTS,
  type CorreccionDeEscaneado,
  type CorreccionDeGasto,
  type CorreccionDeTicket,
  type MiembroViaje,
  type OrigenTicket,
  type PagadorPedido,
  type RenglonCorregido,
  type TicketDelViaje,
  type TipoLugar,
} from '../../api/viajes';
import { formatMXN } from '../../utils/format';
import { leerMonto, type MontoLeido } from '../../utils/montoEscrito';
import { montoParaEscribir, partesIguales } from './QuienPago';
import type { ConAjustes } from './ticketView';
import { unirNombres } from './viajeView';
import { nombreCompleto, type T } from './viajesView';
import { nombreDePlato } from '../../utils/nombreDePlato';

/**
 * D278-3 · D282-2 · corregir un ticket ya cargado (`PATCH /api/viajes/:id/tickets/:tid`, App Backend 2.182.0), puro: sin
 * React ni red.
 *
 * - El borrador sale del ticket tal como está; la pantalla lo edita y acá se evalúa: el total nuevo, el primer problema
 *   y el pedido con SÓLO lo que cambió (el dueño acepta cualquier subconjunto, y sin cambios no se manda nada).
 * - Los montos se leen con `leerMonto` (F-03), el lector de Carga manual y «¿Quién pagó?». Un renglón y los ajustes
 *   aceptan $0 (el dueño acepta `price_cents ≥ 0`: un plato de cortesía); `leerMonto` no, y por eso `leerMontoOCero`.
 * - Los topes son los del dueño: cada precio y la suma de los renglones hasta $1,000,000 y mayor que 0; el total impreso
 *   (renglones + servicio + IVA aparte − descuentos), mayor que 0 y hasta $1,000,000.
 * - El aviso previo (P1 del plan, OK del Bibliotecario): por renglón y SIN nombres. El contrato no dice quién eligió qué
 *   renglón, sólo cuánto queda y lo mío; nombrar a «los que ya eligieron» sería falso o revelaría qué eligió cada uno.
 * - Los pagadores (P2): con dos o más y otro total, los montos nuevos, arrancando con los de antes. No se cambia QUIÉN
 *   pagó (P3).
 */

/** El tope del dueño para un precio, la suma de los renglones y el total de un ticket: $1,000,000. */
export const TOPE_DEL_TICKET_CENTS = MAX_GASTO_MANUAL_CENTS;
export const MAX_RENGLONES = 100;
export const MAX_CANTIDAD = 32767;
export const MAX_LUGAR = 120;
export const MAX_NOMBRE_RENGLON = 200;

export interface RenglonEnEdicion {
  /** La clave de React: el id del renglón, o una propia para uno nuevo. */
  readonly clave: string;
  /** `null`: un renglón nuevo. */
  readonly id: string | null;
  readonly name: string;
  readonly quantity: number;
  /** Lo escrito. */
  readonly precio: string;
}

export interface BorradorEscaneado {
  readonly tipo: 'escaneado';
  readonly lugar: string;
  readonly tipo_lugar: TipoLugar;
  /** `YYYY-MM-DD` o vacío. */
  readonly fecha: string;
  /** `HH:MM` o vacío. */
  readonly hora: string;
  readonly renglones: readonly RenglonEnEdicion[];
  readonly servicio: string;
  readonly descuentos: string;
  readonly iva: string;
}

export interface BorradorGasto {
  readonly tipo: 'gasto';
  readonly descripcion: string;
  readonly monto: string;
}

export type Borrador = BorradorEscaneado | BorradorGasto;

/** Como el dueño (`texto` de su esquema): NFC, los espacios seguidos en uno, sin espacios en las puntas. */
export function nombreNormal(s: string): string {
  return s.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** Un ajuste guardado en 0 se ve vacío (con «$0» de guía); uno mayor, como se escribe. */
const ajusteParaEscribir = (cents: number) => (cents === 0 ? '' : montoParaEscribir(cents));

export function borradorDe(ticket: TicketDelViaje, origen: OrigenTicket): Borrador {
  if (origen === 'manual') {
    return { tipo: 'gasto', descripcion: ticket.lugar ?? ticket.items[0]?.name ?? '', monto: montoParaEscribir(ticket.monto_cents) };
  }
  return {
    tipo: 'escaneado',
    lugar: ticket.lugar ?? '',
    tipo_lugar: ticket.tipo_lugar,
    fecha: ticket.fecha_ticket ?? '',
    hora: ticket.hora_ticket ?? '',
    renglones: ticket.items.map((i) => ({ clave: i.id, id: i.id, name: i.name, quantity: i.quantity, precio: montoParaEscribir(i.price_cents) })),
    servicio: ajusteParaEscribir(ticket.servicio_cents),
    descuentos: ajusteParaEscribir(ticket.descuentos_cents),
    iva: ajusteParaEscribir(ticket.iva_aparte_cents),
  };
}

const CERO = /^0+(?:[.,]0{1,2})?$/;

/** `leerMonto`, más el cero («0», «$0», «0.00»): un precio de cortesía o un ajuste en 0. */
export function leerMontoOCero(texto: string): MontoLeido {
  const limpio = texto.trim().replace(/[$\s]/g, '');
  if (limpio === '') return { tipo: 'vacio' };
  if (CERO.test(limpio)) return { tipo: 'ok', cents: 0 };
  return leerMonto(texto);
}

// ─── Editar los renglones ─────────────────────────────────────────────────

/** Uno vacío al final, con cantidad 1. Hasta 100. */
export function agregarRenglon(b: BorradorEscaneado, clave: string): BorradorEscaneado {
  if (b.renglones.length >= MAX_RENGLONES) return b;
  return { ...b, renglones: [...b.renglones, { clave, id: null, name: '', quantity: 1, precio: '' }] };
}

/** El último no se saca: un ticket tiene al menos un renglón. */
export function sacarRenglon(b: BorradorEscaneado, clave: string): BorradorEscaneado {
  if (b.renglones.length <= 1) return b;
  return { ...b, renglones: b.renglones.filter((r) => r.clave !== clave) };
}

export function cambiarRenglon(
  b: BorradorEscaneado,
  clave: string,
  cambio: Partial<Pick<RenglonEnEdicion, 'name' | 'quantity' | 'precio'>>,
): BorradorEscaneado {
  const quantity = cambio.quantity === undefined ? undefined : Math.min(MAX_CANTIDAD, Math.max(1, Math.trunc(cambio.quantity)));
  return {
    ...b,
    renglones: b.renglones.map((r) => (r.clave === clave ? { ...r, ...cambio, ...(quantity !== undefined && { quantity }) } : r)),
  };
}

// ─── Evaluar ──────────────────────────────────────────────────────────────

export type ProblemaDeCorreccion =
  | 'renglon_sin_nombre'
  | 'monto_invalido'
  | 'monto_ambiguo'
  | 'total_fuera_de_rango'
  | 'descripcion_vacia';

export interface EvaluacionDeCorreccion {
  /** El primer problema, en el orden de la pantalla; `null` si se puede mandar. */
  readonly problema: ProblemaDeCorreccion | null;
  /** Sólo lo que cambió (`{}` sin cambios); `null` con un problema. */
  readonly pedido: CorreccionDeTicket | null;
  readonly cambios: boolean;
  /** El total impreso nuevo; `null` si todavía no se puede calcular. */
  readonly total: number | null;
  readonly cambiaTotal: boolean;
  /** De un escaneado: los renglones y los ajustes, para mostrar cómo se llega al total. */
  readonly cuenta: ConAjustes | null;
}

function problemaDeMonto(m: MontoLeido): ProblemaDeCorreccion {
  return m.tipo === 'ambiguo' ? 'monto_ambiguo' : 'monto_invalido';
}

function conProblema(problema: ProblemaDeCorreccion, total: number | null = null): EvaluacionDeCorreccion {
  return { problema, pedido: null, cambios: false, total, cambiaTotal: false, cuenta: null };
}

export function evaluarCorreccion(ticket: TicketDelViaje, borrador: Borrador): EvaluacionDeCorreccion {
  return borrador.tipo === 'gasto' ? evaluarGasto(ticket, borrador) : evaluarEscaneado(ticket, borrador);
}

function evaluarGasto(ticket: TicketDelViaje, b: BorradorGasto): EvaluacionDeCorreccion {
  const descripcion = nombreNormal(b.descripcion);
  if (descripcion === '' || descripcion.length > MAX_DESCRIPCION_GASTO) return conProblema('descripcion_vacia');
  const m = leerMonto(b.monto);
  if (m.tipo !== 'ok') return conProblema(problemaDeMonto(m));
  if (m.cents > TOPE_DEL_TICKET_CENTS) return conProblema('total_fuera_de_rango');
  const pedido: { -readonly [K in keyof CorreccionDeGasto]: CorreccionDeGasto[K] } = {};
  if (descripcion !== (ticket.lugar ?? ticket.items[0]?.name)) pedido.descripcion = descripcion;
  if (m.cents !== ticket.monto_cents) pedido.monto_cents = m.cents;
  return { problema: null, pedido, cambios: Object.keys(pedido).length > 0, total: m.cents, cambiaTotal: m.cents !== ticket.total_cents, cuenta: null };
}

function evaluarEscaneado(ticket: TicketDelViaje, b: BorradorEscaneado): EvaluacionDeCorreccion {
  // Los renglones, en el orden de la pantalla.
  const renglones: Array<RenglonCorregido & { readonly id?: string }> = [];
  for (const r of b.renglones) {
    const name = nombreNormal(r.name);
    if (name === '' || name.length > MAX_NOMBRE_RENGLON) return conProblema('renglon_sin_nombre');
    const p = leerMontoOCero(r.precio);
    if (p.tipo !== 'ok') return conProblema(problemaDeMonto(p));
    if (p.cents > TOPE_DEL_TICKET_CENTS) return conProblema('total_fuera_de_rango');
    renglones.push({ ...(r.id !== null && { id: r.id }), name, price_cents: p.cents, quantity: r.quantity });
  }
  const ajustes: Record<'servicio_cents' | 'descuentos_cents' | 'iva_aparte_cents', number> = {
    servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0,
  };
  for (const [k, texto] of [['servicio_cents', b.servicio], ['descuentos_cents', b.descuentos], ['iva_aparte_cents', b.iva]] as const) {
    const m = leerMontoOCero(texto);
    if (m.tipo === 'vacio') continue;
    if (m.tipo !== 'ok') return conProblema(problemaDeMonto(m));
    if (m.cents > TOPE_DEL_TICKET_CENTS) return conProblema('total_fuera_de_rango');
    ajustes[k] = m.cents;
  }
  const monto = renglones.reduce((s, r) => s + r.price_cents * r.quantity, 0);
  const total = monto + ajustes.servicio_cents + ajustes.iva_aparte_cents - ajustes.descuentos_cents;
  if (monto <= 0 || monto > TOPE_DEL_TICKET_CENTS || total <= 0 || total > TOPE_DEL_TICKET_CENTS) {
    return conProblema('total_fuera_de_rango');
  }

  const pedido: { -readonly [K in keyof CorreccionDeEscaneado]: CorreccionDeEscaneado[K] } = {};
  const lugar = nombreNormal(b.lugar);
  if ((lugar === '' ? null : lugar) !== ticket.lugar) pedido.lugar = lugar === '' ? null : lugar;
  if (b.tipo_lugar !== ticket.tipo_lugar) pedido.tipo_lugar = b.tipo_lugar;
  const fecha = b.fecha === '' ? null : b.fecha;
  // El dueño pide una fecha para la hora: sin fecha, la hora se va con ella.
  const hora = fecha === null || b.hora === '' ? null : b.hora;
  if (fecha !== ticket.fecha_ticket) pedido.fecha_ticket = fecha;
  if (hora !== ticket.hora_ticket) pedido.hora_ticket = hora;
  // La lista completa si cambió cualquier renglón, su orden, o se agregó o sacó alguno.
  const cambianRenglones = renglones.length !== ticket.items.length || renglones.some((r, k) => {
    const v = ticket.items[k]!;
    return r.id !== v.id || r.name !== v.name || r.price_cents !== v.price_cents || r.quantity !== v.quantity;
  });
  if (cambianRenglones) pedido.items = renglones;
  if (ajustes.servicio_cents !== ticket.servicio_cents) pedido.servicio_cents = ajustes.servicio_cents;
  if (ajustes.descuentos_cents !== ticket.descuentos_cents) pedido.descuentos_cents = ajustes.descuentos_cents;
  if (ajustes.iva_aparte_cents !== ticket.iva_aparte_cents) pedido.iva_aparte_cents = ajustes.iva_aparte_cents;
  return {
    problema: null, pedido, cambios: Object.keys(pedido).length > 0, total, cambiaTotal: total !== ticket.total_cents,
    cuenta: { monto_cents: monto, ...ajustes },
  };
}

export function textoDelProblema(p: ProblemaDeCorreccion, t: T): string {
  switch (p) {
    case 'renglon_sin_nombre': return t('Cada renglón necesita un nombre.');
    case 'monto_invalido': return t('Revisa los montos: escribe sólo números, como 120 o 120.50.');
    case 'monto_ambiguo': return t('No sabemos si es con decimales o con miles. Escríbelo sin separador de miles: 1250 o 12.50.');
    case 'total_fuera_de_rango': return t('El total tiene que ser mayor que $0 y de hasta $1,000,000.');
    case 'descripcion_vacia': return t('Escribe una descripción.');
  }
}

// ─── El aviso previo (P1) ─────────────────────────────────────────────────

type Toque = 'precio' | 'cantidad' | 'sacado';

/**
 * Antes de guardar: si la corrección va a borrar elecciones (un renglón con otro precio o cantidad, o sacado, que alguien
 * ya eligió), decirlo. Por renglón y sin nombres: «otros» sale de lo que queda (`remaining_bps`) menos lo mío (`my_bps`).
 * Sólo en «por lo que pidió cada uno» y en un ticket que no es personal; un renglón que no se puede leer todavía no
 * cuenta (manda el problema).
 */
export function avisoPrevio(ticket: TicketDelViaje, borrador: Borrador, t: T): string | null {
  if (borrador.tipo !== 'escaneado' || ticket.forma !== 'consumo' || ticket.personal) return null;
  const deOtros: Array<{ nombre: string; toque: Toque }> = [];
  const mios: string[] = [];
  for (const i of ticket.items) {
    const r = borrador.renglones.find((x) => x.id === i.id);
    let toque: Toque | null = null;
    if (!r) toque = 'sacado';
    else {
      const p = leerMontoOCero(r.precio);
      if (p.tipo === 'ok' && p.cents !== i.price_cents) toque = 'precio';
      else if (r.quantity !== i.quantity) toque = 'cantidad';
    }
    if (!toque) continue;
    const elegido = 10000 - i.remaining_bps;
    // D360-5b · D370 · el aviso nombra el plato como se muestra; el borrador
    // (lo que se guarda) sigue con el nombre tal cual.
    if (elegido - i.my_bps > 0) deOtros.push({ nombre: nombreDePlato(i.name), toque });
    if (i.my_bps > 0) mios.push(nombreDePlato(i.name));
  }
  if (deOtros.length === 0) return mios.length > 0 ? t('Vas a tener que volver a elegir {0}.', unirNombres(mios, t)) : null;
  let texto: string;
  if (deOtros.length === 1) {
    const { nombre, toque } = deOtros[0]!;
    texto = toque === 'precio'
      ? t('Cambiaste el precio de {0}: quienes lo eligieron van a tener que volver a elegir.', nombre)
      : toque === 'cantidad'
        ? t('Cambiaste la cantidad de {0}: quienes lo eligieron van a tener que volver a elegir.', nombre)
        : t('Sacaste {0}: quienes lo eligieron van a tener que volver a elegir.', nombre);
  } else {
    texto = t('Cambiaste {0} renglones que ya se eligieron ({1}): quienes los eligieron van a tener que volver a elegir.',
      deOtros.length, unirNombres(deOtros.map((x) => x.nombre), t));
  }
  return mios.length > 0 ? `${texto} ${t('Tú también.')}` : texto;
}

// ─── Los pagadores (P2) ───────────────────────────────────────────────────

/** Lo que cada uno tenía, en el orden del ticket: el punto de partida de los montos nuevos. */
export function montosIniciales(ticket: TicketDelViaje): string[] {
  return ticket.pagadores.map((p) => montoParaEscribir(p.monto_cents));
}

/** «Partes iguales» del total nuevo, como el dueño: el piso y el centavo de más a los primeros. */
export function montosEnPartesIguales(total: number, cuantos: number): string[] {
  return partesIguales(total, cuantos).map(montoParaEscribir);
}

export interface EvaluacionDePagadores {
  /** Con dos o más pagadores y otro total. */
  readonly pide: boolean;
  /** Se puede mandar: no se piden, o los montos suman el total nuevo. */
  readonly valido: boolean;
  /** Lo que se manda (`null` si no se piden o no valen). */
  readonly pagadores: readonly PagadorPedido[] | null;
  /** Lo que suman los montos escritos (`null` si alguno no vale). */
  readonly suma: number | null;
  /** El aviso junto a «Guardar», o `null`. */
  readonly aviso: string | null;
  /** Alguien que pagó ya no está en el viaje: el total no se puede cambiar (y no hay montos que pedir). */
  readonly ausente: boolean;
}

const NO_SE_PIDEN: EvaluacionDePagadores = { pide: false, valido: true, pagadores: null, suma: null, aviso: null, ausente: false };

export function evaluarPagadores(
  ticket: TicketDelViaje,
  montos: readonly string[],
  total: number | null,
  miembros: readonly MiembroViaje[],
  t: T,
): EvaluacionDePagadores {
  if (total === null || ticket.pagadores.length < 2 || total === ticket.total_cents) return NO_SE_PIDEN;
  // Alguien que pagó salió del viaje o dio de baja su cuenta: el dueño no lo aceptaría como pagador (422).
  const ausente = ticket.pagadores.some((p) => p.miembro_id === null || !miembros.some((m) => m.id === p.miembro_id && !m.eliminada));
  if (ausente) {
    return { pide: true, valido: false, pagadores: null, suma: null, ausente: true,
      aviso: t('Alguien que pagó ya no está en el viaje: el total no se puede cambiar.') };
  }
  const leidos = ticket.pagadores.map((_, i) => leerMonto(montos[i] ?? ''));
  const partes = leidos.map((m) => (m.tipo === 'ok' ? m.cents : null));
  const suma = partes.every((p) => p !== null) ? partes.reduce<number>((s, p) => s + p!, 0) : null;
  const valido = suma === total;
  let aviso: string | null = null;
  if (leidos.some((m) => m.tipo === 'ambiguo')) {
    aviso = t('No sabemos si es con decimales o con miles. Escríbelo sin separador de miles: 1250 o 12.50.');
  } else if (suma === null) {
    aviso = t('Escribe cuánto pagó cada uno. Tienen que sumar {0}.', formatMXN(total));
  } else if (!valido) {
    aviso = t('Los montos tienen que sumar {0}. Ahora suman {1}.', formatMXN(total), formatMXN(suma));
  }
  return {
    pide: true, valido, suma, aviso, ausente: false,
    pagadores: valido ? ticket.pagadores.map((p, i) => ({ miembro_id: p.miembro_id!, monto_cents: partes[i]! })) : null,
  };
}

/** «Tú» o el nombre completo del que pagó (como «¿Quién pagó?»). */
export function nombreDePagador(miembroId: string | null, miembros: readonly MiembroViaje[], t: T): string {
  const m = miembros.find((x) => x.id === miembroId);
  if (!m) return t('Cuenta eliminada');
  return m.es_yo ? t('Tú') : nombreCompleto(m, t);
}

/** Lo que se manda: lo corregido y, si hacen falta, los pagadores. `null` si todavía no se puede guardar. */
export function pedidoFinal(e: EvaluacionDeCorreccion, p: EvaluacionDePagadores): CorreccionDeTicket | null {
  if (e.problema !== null || e.pedido === null || !e.cambios || !p.valido) return null;
  return p.pide && p.pagadores ? { ...e.pedido, pagadores: p.pagadores } : e.pedido;
}
