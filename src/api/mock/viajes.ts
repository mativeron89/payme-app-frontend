import type { AppNotification } from '../types';
import { INFORMATIVE_FRACTION_BPS } from '../types';
import { formatMXN } from '../../utils/format';
import {
  MockApiError,
  amigoParaViajesMock,
  arrobaParaViajesMock,
  latencia,
  usernameMock,
  yoParaViajesMock,
  type PersonaViajeMock,
} from './mockApi';
import { persist as persistirStore, state as store } from './store';
import { CLAVE_ESTADO_VIAJES_MOCK, limiteDeViajesMock, viajesMockEncendido } from './viajesSeam';
import {
  balanceDelViaje,
  precioInformativo,
  restanteDe,
  transferenciasMinimas,
  type BalanceDelViaje,
  type ConsumoDelTicket,
  type TicketParaCalculo,
} from './viajesCalculo';

/**
 * AF-VIAJES · el «dueño» de Viajes en el modo de ejemplo: las 14 rutas de App
 * Backend 2.171.0 (`contract-mirror/services/viajes.js`), con sus claves, sus
 * errores y su cálculo (`viajesCalculo.ts`). Devuelve los cuerpos crudos; la
 * fachada los decodifica igual que los del dueño.
 *
 * El estado vive aparte del store de siempre (`CLAVE_ESTADO_VIAJES_MOCK`), así
 * las pruebas pueden poner a los demás miembros a elegir, marcar o confirmar
 * escribiendo ese JSON. Los demás miembros son personas sintéticas del mock.
 */

const CONTRATO = 'payme.app.viajes/v1';
const MAX_MIEMBROS = 20;
const MAX_TICKETS = 200;
const MAX_LISTA = 100;
const FORMAS = ['consumo', 'iguales', 'total'] as const;
const TIPOS_LUGAR = ['restaurante', 'bar', 'cafe', 'super', 'otro'] as const;
type Forma = (typeof FORMAS)[number];
type TipoLugar = (typeof TIPOS_LUGAR)[number];
type EstadoViaje = 'abierto' | 'esperando_pagos' | 'cerrado';

// ─── El estado ────────────────────────────────────────────────────────────

export interface MiembroMock {
  /** El id propio del viaje: el que publica la API. */
  id: string;
  user_id: string;
  estado: 'activo' | 'invitado' | 'rechazado' | 'salio';
  invitado_por: string | null;
  invitado_en: string | null;
  created_at: string;
  first_name: string;
  last_name: string;
  username: string | null;
  /** Una cuenta dada de baja (V5). */
  eliminada: boolean;
}

export interface TicketMock {
  id: string;
  pagado_por: string;
  forma: Forma;
  tipo_lugar: TipoLugar;
  lugar: string | null;
  fecha_ticket: string | null;
  hora_ticket: string | null;
  monto_cents: number;
  created_at: string;
  huella: string | null;
  recibo_jti: string;
  idempotency_key: string;
  pedido_hash: string;
  items: Array<{ id: string; nombre: string; price_cents: number; quantity: number }>;
  personas: Array<{
    user_id: string;
    presente: boolean;
    listo_en: string | null;
    consumo_final_cents: number | null;
    asignado_cierre_cents: number | null;
  }>;
  selecciones: Array<{ item_id: string; user_id: string; fraction_bps: number; created_at: string }>;
}

export interface TransferenciaMock {
  id: string;
  orden: number;
  de_user: string;
  a_user: string;
  monto_cents: number;
  estado: 'pendiente' | 'marcada' | 'pagada';
}

export interface ViajeMock {
  id: string;
  nombre: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  estado: EstadoViaje;
  created_at: string;
  terminado_en: string | null;
  creado_por: string;
  idempotency_key: string | null;
  pedido_hash: string | null;
  miembros: MiembroMock[];
  tickets: TicketMock[];
  transferencias: TransferenciaMock[];
}

export interface EstadoViajesMock {
  version: 1;
  viajes: ViajeMock[];
  avisos_sembrados: boolean;
}

let estado: EstadoViajesMock | null = null;

function cargar(): EstadoViajesMock {
  if (estado) return estado;
  try {
    const raw = JSON.parse(localStorage.getItem(CLAVE_ESTADO_VIAJES_MOCK) ?? 'null') as EstadoViajesMock | null;
    if (raw && raw.version === 1 && Array.isArray(raw.viajes)) {
      estado = raw;
      return estado;
    }
  } catch {
    // JSON roto: se vuelve a sembrar
  }
  estado = semilla(yoParaViajesMock());
  guardar();
  return estado;
}

function guardar(): void {
  try { localStorage.setItem(CLAVE_ESTADO_VIAJES_MOCK, JSON.stringify(estado)); } catch { /* demo */ }
}

/** Para las pruebas: olvida el estado en memoria (el próximo pedido lo relee). */
export function olvidarViajesMockParaTests(): void {
  estado = null;
}

// ─── Respuestas ───────────────────────────────────────────────────────────

/** El cuerpo, copiado: la pantalla nunca comparte objetos con el estado. */
function responder<T>(cuerpo: T): Promise<T> {
  guardar();
  const copia = JSON.parse(JSON.stringify(cuerpo)) as T;
  return new Promise((resolve) => setTimeout(() => resolve(copia), latencia()));
}

class Respuesta extends Error {
  constructor(readonly status: number, readonly error: string, readonly extra: Record<string, unknown> = {}) {
    super(error);
  }
}

const noEncontrado = () => new Respuesta(404, 'viaje_not_found');
const conflicto = (error: string, extra: Record<string, unknown> = {}) => new Respuesta(409, error, extra);
const invalido = () => new Respuesta(400, 'validation_error');

/** Corre la ruta: con Viajes apagado, el 404 de siempre (la ruta no existe). */
async function ruta<T>(fn: () => T): Promise<T> {
  if (!viajesMockEncendido()) {
    await new Promise((r) => setTimeout(r, latencia()));
    throw new MockApiError(404, 'not_found');
  }
  try {
    return await responder(fn());
  } catch (err) {
    if (err instanceof Respuesta) {
      guardar();
      await new Promise((r) => setTimeout(r, latencia()));
      throw new MockApiError(err.status, err.error, err.extra);
    }
    throw err;
  }
}

// ─── Lectura ──────────────────────────────────────────────────────────────

const ahora = () => new Date().toISOString();
const esUuid = (s: unknown): s is string => typeof s === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const nuevoId = () => crypto.randomUUID();
const porOrden = <T extends { created_at: string }>(xs: readonly T[], clave: (x: T) => string) =>
  [...xs].sort((a, b) => a.created_at.localeCompare(b.created_at) || clave(a).localeCompare(clave(b)));

function yo(): string {
  return store.user.id;
}

function viajeDe(id: unknown): ViajeMock | null {
  if (!esUuid(id)) return null;
  return cargar().viajes.find((v) => v.id === id) ?? null;
}

const miembrosEnOrden = (v: ViajeMock) => porOrden(v.miembros, (m) => m.user_id);
const esActivo = (v: ViajeMock, u: string) => v.miembros.some((m) => m.user_id === u && m.estado === 'activo');
const vivoUser = (v: ViajeMock, u: string) => !(v.miembros.find((m) => m.user_id === u)?.eliminada ?? false);

function persona(m: MiembroMock) {
  return {
    first_name: m.eliminada ? null : m.first_name,
    last_name: m.eliminada ? null : m.last_name,
    username: !m.eliminada && usernameMock() ? m.username : null,
    eliminada: m.eliminada,
  };
}

function estadoPublico(v: ViajeMock, tr: TransferenciaMock): string {
  const baja = !vivoUser(v, tr.de_user) || !vivoUser(v, tr.a_user);
  return baja ? (tr.estado === 'pagada' ? 'pagada' : 'anulada_por_baja') : tr.estado;
}

const pendientes = (v: ViajeMock) => v.transferencias.filter((t) => {
  const e = estadoPublico(v, t);
  return e === 'pendiente' || e === 'marcada';
});

function estadoEfectivo(v: ViajeMock): EstadoViaje {
  return v.estado === 'esperando_pagos' && pendientes(v).length === 0 ? 'cerrado' : v.estado;
}

const lineaDe = (i: { price_cents: number; quantity: number }) => i.price_cents * i.quantity;

function paraCalculo(v: ViajeMock, t: TicketMock): TicketParaCalculo {
  return {
    id: t.id,
    forma: t.forma,
    pagado_por: t.pagado_por,
    monto_cents: t.monto_cents,
    items: t.items.map((i) => ({ id: i.id, line_cents: lineaDe(i) })),
    personas: t.personas.map((p) => ({ user_id: p.user_id, presente: p.presente, listo: !!p.listo_en, vivo: vivoUser(v, p.user_id) })),
    selecciones: porOrden(t.selecciones, (s) => s.user_id),
  };
}

const ticketsEnOrden = (v: ViajeMock) => porOrden(v.tickets, (t) => t.id);

type Balance = BalanceDelViaje & { congelado: boolean };

/** En vivo mientras está abierto; congelado al cerrar (`consumo_final_cents`). */
function balance(v: ViajeMock, { cierre = false } = {}): Balance {
  const orden = miembrosEnOrden(v).map((m) => m.user_id);
  if (v.estado === 'abierto') {
    return { ...balanceDelViaje(orden, ticketsEnOrden(v).map((t) => paraCalculo(v, t)), { cierre }), congelado: false };
  }
  const bal = new Map(orden.map((u) => [u, 0]));
  const pagado = new Map<string, number>();
  const consumido = new Map<string, number>();
  const porTicket = new Map<string, ConsumoDelTicket>();
  let gasto = 0;
  const sumar = (m: Map<string, number>, k: string, x: number) => m.set(k, (m.get(k) ?? 0) + x);
  for (const t of ticketsEnOrden(v)) {
    gasto += t.monto_cents;
    sumar(pagado, t.pagado_por, t.monto_cents);
    sumar(bal, t.pagado_por, t.monto_cents);
    const consumo = new Map<string, number>();
    const asignado = new Map<string, number>();
    for (const p of t.personas) {
      const c = p.consumo_final_cents ?? 0;
      consumo.set(p.user_id, c);
      if (p.asignado_cierre_cents) asignado.set(p.user_id, p.asignado_cierre_cents);
      sumar(consumido, p.user_id, c);
      sumar(bal, p.user_id, -c);
    }
    porTicket.set(t.id, { consumo, asignado, sinRepartir: 0, faltan: [] });
  }
  if ([...bal.values()].reduce((s, x) => s + x, 0) !== 0) throw new Error('viaje_balance_no_cuadra');
  return { balance: bal, pagado, consumido, gasto, porTicket, congelado: true };
}

function mioPorPlato(t: TicketMock, u: string) {
  const acumulado = new Map<string, { bps: number; monto: number }>();
  const mio = new Map<string, { bps: number; monto: number }>();
  const lineas = new Map(t.items.map((i) => [i.id, lineaDe(i)]));
  for (const s of porOrden(t.selecciones, (x) => x.user_id)) {
    const previo = acumulado.get(s.item_id) ?? { bps: 0, monto: 0 };
    const precio = precioInformativo(lineas.get(s.item_id)!, s.fraction_bps, previo.bps, previo.monto);
    acumulado.set(s.item_id, { bps: previo.bps + s.fraction_bps, monto: previo.monto + precio });
    if (s.user_id === u) mio.set(s.item_id, { bps: s.fraction_bps, monto: precio });
  }
  return { mio, acumulado };
}

function idPublico(v: ViajeMock): Map<string, string> {
  return new Map(v.miembros.map((m) => [m.user_id, m.id]));
}

function vistaTransferencia(v: ViajeMock, tr: TransferenciaMock, u: string) {
  const ids = idPublico(v);
  return {
    id: tr.id, de: ids.get(tr.de_user) ?? null, a: ids.get(tr.a_user) ?? null,
    monto_cents: tr.monto_cents, estado: estadoPublico(v, tr),
    mia: tr.de_user === u ? 'debo' : tr.a_user === u ? 'me_deben' : null,
  };
}

function vistaViaje(v: ViajeMock, u: string) {
  const est = estadoEfectivo(v);
  const cerrado = est === 'cerrado';
  const b = balance(v);
  const ids = idPublico(v);
  const faltaElegir = new Map<string, number>();
  if (!b.congelado) {
    for (const r of b.porTicket.values()) for (const x of r.faltan) faltaElegir.set(x, (faltaElegir.get(x) ?? 0) + 1);
  }
  const tickets = ticketsEnOrden(v).map((t) => {
    const r = b.porTicket.get(t.id)!;
    return {
      id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: t.fecha_ticket, hora_ticket: t.hora_ticket,
      cargado_en: t.created_at, forma: t.forma, pagado_por: ids.get(t.pagado_por) ?? null, pagaste_tu: t.pagado_por === u,
      te_toca_cents: r.consumo.get(u) ?? 0,
      falta_que_elija: b.congelado ? 0 : r.faltan.length,
      sin_repartir_cents: b.congelado ? 0 : r.sinRepartir,
    };
  }).reverse();
  const sinRepartir = b.congelado ? [] : ticketsEnOrden(v).filter((t) => b.porTicket.get(t.id)!.sinRepartir > 0).map((t) => ({
    ticket_id: t.id, lugar: t.lugar, fecha_ticket: t.fecha_ticket,
    monto_cents: b.porTicket.get(t.id)!.sinRepartir,
    faltan: b.porTicket.get(t.id)!.faltan.map((x) => ids.get(x) ?? null),
  }));
  return {
    id: v.id, nombre: v.nombre, fecha_desde: v.fecha_desde, fecha_hasta: v.fecha_hasta, estado: est,
    creado_en: v.created_at, mi_miembro_id: ids.get(u),
    miembros: miembrosEnOrden(v).filter((m) => m.estado === 'activo').map((m) => ({
      id: m.id, ...persona(m), es_yo: m.user_id === u,
      balance_cents: cerrado && m.user_id !== u ? null : b.balance.get(m.user_id) ?? 0,
      falta_elegir: faltaElegir.get(m.user_id) ?? 0,
    })),
    invitados: miembrosEnOrden(v).filter((m) => m.estado === 'invitado' && !m.eliminada).map((m) => ({ id: m.id, ...persona(m) })),
    mi_balance_cents: b.balance.get(u) ?? 0,
    gasto_del_grupo_cents: b.gasto,
    tickets,
    sin_repartir: sinRepartir,
    transferencias: [...v.transferencias].sort((a, c) => a.orden - c.orden)
      .filter((tr) => !cerrado || tr.de_user === u || tr.a_user === u)
      .map((tr) => vistaTransferencia(v, tr, u)),
    transferencias_pendientes: pendientes(v).length,
  };
}

function vistaTicket(v: ViajeMock, t: TicketMock, u: string) {
  const b = balance(v);
  const r = b.porTicket.get(t.id)!;
  const ids = idPublico(v);
  const { mio, acumulado } = mioPorPlato(t, u);
  const abierto = v.estado === 'abierto';
  const soyPersona = t.personas.some((p) => p.user_id === u);
  return {
    id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: t.fecha_ticket, hora_ticket: t.hora_ticket,
    cargado_en: t.created_at, forma: t.forma, monto_cents: t.monto_cents,
    pagado_por: ids.get(t.pagado_por) ?? null, pagaste_tu: t.pagado_por === u,
    items: t.items.map((i) => ({
      id: i.id, name: i.nombre, price_cents: i.price_cents, quantity: i.quantity, line_cents: lineaDe(i),
      remaining_bps: restanteDe(acumulado.get(i.id)?.bps ?? 0),
      my_bps: mio.get(i.id)?.bps ?? 0, my_amount_cents: mio.get(i.id)?.monto ?? 0,
    })),
    personas: t.personas.map((p) => ({
      miembro_id: ids.get(p.user_id) ?? null,
      ya_eligio: t.forma !== 'consumo' || !!p.listo_en, presente: p.presente,
    })),
    te_toca_cents: r.consumo.get(u) ?? 0,
    sin_repartir_cents: b.congelado ? 0 : r.sinRepartir,
    puedo_elegir: abierto && t.forma === 'consumo' && soyPersona,
    puedo_marcar_presentes: abierto && t.forma === 'iguales' && t.pagado_por === u,
  };
}

function vistaEnLista(v: ViajeMock, u: string) {
  const est = estadoEfectivo(v);
  const b = balance(v);
  return {
    id: v.id, nombre: v.nombre, fecha_desde: v.fecha_desde, fecha_hasta: v.fecha_hasta, estado: est,
    personas: v.miembros.filter((m) => m.estado === 'activo').length,
    mi_balance_cents: est === 'cerrado' ? null : b.balance.get(u) ?? 0,
    transferencias_pendientes: est === 'esperando_pagos' ? pendientes(v).length : null,
    consumiste_cents: est === 'cerrado' ? b.consumido.get(u) ?? 0 : null,
    terminado_en: v.terminado_en,
  };
}

/** El viaje del que soy miembro activo, o el 404 de n325. */
function miViaje(id: unknown): ViajeMock {
  const v = viajeDe(id);
  if (!v || !esActivo(v, yo())) throw noEncontrado();
  return v;
}

// ─── Avisos ───────────────────────────────────────────────────────────────

const TITULOS: Record<string, string> = {
  viaje_invitation_received: 'Te invitaron a un viaje',
  viaje_invitation_rejected: 'Rechazaron tu invitación',
  viaje_ticket_added: 'Ticket nuevo en tu viaje',
  viaje_closed: 'Se cerró un viaje',
  viaje_transfer_marked: 'Te marcaron un pago',
  viaje_transfer_not_received: 'Un pago no llegó',
  viaje_finished: 'Viaje cerrado',
};

/** Un aviso en MI bandeja (los demás miembros no tienen bandeja en el mock). */
function avisarme(a: { type: string; body: string; payload: Record<string, unknown>; porPersona?: string | null; viajeId: string; en?: string }): void {
  const n: AppNotification = {
    id: nuevoId(),
    type: a.type,
    title: TITULOS[a.type] ?? null,
    body: a.body,
    payload: a.payload,
    related_entity_type: a.porPersona ? 'user' : 'viaje',
    related_entity_id: a.porPersona ?? a.viajeId,
    read_at: null,
    created_at: a.en ?? ahora(),
  };
  store.notifications.unshift(n);
  persistirStore();
}

// ─── Validación ───────────────────────────────────────────────────────────

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
function esFecha(s: unknown): s is string {
  if (typeof s !== 'string' || !FECHA.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function textoNormal(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const t = s.normalize('NFC').replace(/\s+/gu, ' ').trim();
  return t.length >= 1 && t.length <= max ? t : null;
}
const objeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const soloClaves = (o: Record<string, unknown>, permitidas: readonly string[]) => Object.keys(o).every((k) => permitidas.includes(k));
const clave = (s: unknown): s is string => typeof s === 'string' && s.length >= 8 && s.length <= 100;

/** Igual que el dueño: el hash del pedido decide si la misma clave es el mismo pedido. */
const hashDe = (x: unknown) => JSON.stringify(x);

function miembrosPedidos(raw: unknown): Array<{ user_id: string } | { username: string }> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_MIEMBROS - 1) throw invalido();
  return raw.map((p) => {
    if (!objeto(p)) throw invalido();
    const k = Object.keys(p);
    if (k.length === 1 && k[0] === 'user_id' && esUuid(p.user_id)) return { user_id: p.user_id };
    if (k.length === 1 && k[0] === 'username' && typeof p.username === 'string' && p.username.length >= 1 && p.username.length <= 40) {
      return { username: p.username };
    }
    throw invalido();
  });
}

/** D119: por id, un amigo aceptado; por @, lo que muestra la búsqueda. El faltante, tal como vino. */
function resolverMiembros(pedidos: ReadonlyArray<{ user_id: string } | { username: string }>): PersonaViajeMock[] {
  const out: PersonaViajeMock[] = [];
  for (const p of pedidos) {
    const quien = 'user_id' in p ? amigoParaViajesMock(p.user_id) : arrobaParaViajesMock(p.username);
    if (!quien) throw new Respuesta(422, 'viaje_member_not_found', { member: p });
    if (quien.user_id !== yo() && !out.some((x) => x.user_id === quien.user_id)) out.push(quien);
  }
  return out;
}

// ─── Rutas: viajes y miembros ─────────────────────────────────────────────

export function mockListarViajes(estadoPedido: 'abiertos' | 'cerrados') {
  return ruta(() => {
    const u = yo();
    const mios = cargar().viajes.filter((v) => esActivo(v, u))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const abiertos: Array<ReturnType<typeof vistaEnLista>> = [];
    const cerrados: Array<ReturnType<typeof vistaEnLista>> = [];
    for (const v of mios) {
      const item = vistaEnLista(v, u);
      (item.estado === 'cerrado' ? cerrados : abiertos).push(item);
    }
    cerrados.sort((a, b) => (b.fecha_desde || b.terminado_en || '').localeCompare(a.fecha_desde || a.terminado_en || ''));
    return {
      contract: CONTRATO,
      viajes: (estadoPedido === 'cerrados' ? cerrados : abiertos).slice(0, MAX_LISTA),
      counts: { abiertos: abiertos.length, cerrados: cerrados.length },
    };
  });
}

export function mockInvitacionesAViajes() {
  return ruta(() => {
    const u = yo();
    const filas = cargar().viajes.flatMap((v) => {
      const m = v.miembros.find((x) => x.user_id === u && x.estado === 'invitado');
      return m && v.estado === 'abierto' ? [{ v, m }] : [];
    }).sort((a, b) => (b.m.invitado_en ?? '').localeCompare(a.m.invitado_en ?? '') || b.v.id.localeCompare(a.v.id));
    return {
      contract: CONTRATO,
      invitaciones: filas.slice(0, MAX_LISTA).map(({ v, m }) => {
        const quien = v.miembros.find((x) => x.user_id === m.invitado_por);
        return {
          viaje_id: v.id, nombre: v.nombre, fecha_desde: v.fecha_desde, fecha_hasta: v.fecha_hasta,
          personas: v.miembros.filter((x) => x.estado === 'activo').length,
          invitado_en: m.invitado_en,
          invitado_por: quien ? persona(quien) : null,
        };
      }),
    };
  });
}

export function mockCrearViaje(body: unknown) {
  return ruta(() => {
    if (!objeto(body) || !soloClaves(body, ['nombre', 'fecha_desde', 'fecha_hasta', 'miembros', 'idempotency_key'])) throw invalido();
    const nombre = textoNormal(body.nombre, 80);
    const desde = body.fecha_desde ?? null;
    const hasta = body.fecha_hasta ?? null;
    if (!nombre || (desde !== null && !esFecha(desde)) || (hasta !== null && !esFecha(hasta))
        || (desde && hasta && desde > hasta) || !clave(body.idempotency_key)) throw invalido();
    const pedidos = miembrosPedidos(body.miembros);
    const u = yo();
    const pedido = hashDe({ nombre, fecha_desde: desde, fecha_hasta: hasta, miembros: pedidos });
    const previo = cargar().viajes.find((v) => v.creado_por === u && v.idempotency_key === body.idempotency_key);
    if (previo) {
      if (previo.pedido_hash !== pedido) throw conflicto('idempotency_key_conflict');
      return { contract: CONTRATO, viaje: vistaViaje(previo, u) };
    }
    if (limiteDeViajesMock()) throw new Respuesta(429, 'viajes_rate_limited');
    const invitados = resolverMiembros(pedidos);
    if (invitados.length + 1 > MAX_MIEMBROS) throw conflicto('viaje_members_limit', { limit: MAX_MIEMBROS });
    const t0 = Date.now();
    const yoMismo = yoParaViajesMock();
    const v: ViajeMock = {
      id: nuevoId(), nombre, fecha_desde: desde as string | null, fecha_hasta: hasta as string | null,
      estado: 'abierto', created_at: new Date(t0).toISOString(), terminado_en: null, creado_por: u,
      idempotency_key: body.idempotency_key, pedido_hash: pedido,
      miembros: [
        { id: nuevoId(), user_id: u, estado: 'activo', invitado_por: null, invitado_en: null, created_at: new Date(t0).toISOString(),
          first_name: yoMismo.first_name, last_name: yoMismo.last_name, username: yoMismo.username, eliminada: false },
        ...invitados.map((p, i): MiembroMock => ({
          id: nuevoId(), user_id: p.user_id, estado: 'invitado', invitado_por: u, invitado_en: new Date(t0 + i + 1).toISOString(),
          created_at: new Date(t0 + i + 1).toISOString(), first_name: p.first_name, last_name: p.last_name,
          username: p.username, eliminada: false,
        })),
      ],
      tickets: [],
      transferencias: [],
    };
    cargar().viajes.push(v);
    return { contract: CONTRATO, viaje: vistaViaje(v, u) };
  });
}

export function mockDetalleViaje(id: string) {
  return ruta(() => {
    const v = miViaje(id);
    if (v.estado === 'esperando_pagos' && estadoEfectivo(v) === 'cerrado') terminarSiCorresponde(v);
    return { contract: CONTRATO, viaje: vistaViaje(v, yo()) };
  });
}

export function mockAceptarViaje(id: string) {
  return ruta(() => {
    const v = viajeDe(id);
    if (!v) throw noEncontrado();
    const m = v.miembros.find((x) => x.user_id === yo());
    if (m?.estado !== 'activo') {
      if (m?.estado !== 'invitado') throw noEncontrado();
      if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
      m.estado = 'activo';
    }
    return { contract: CONTRATO, viaje: vistaViaje(v, yo()) };
  });
}

export function mockRechazarViaje(id: string) {
  return ruta(() => {
    const v = viajeDe(id);
    if (!v) throw noEncontrado();
    const m = v.miembros.find((x) => x.user_id === yo());
    if (m?.estado === 'rechazado') return { contract: CONTRATO, viaje_id: v.id, estado: 'rechazado' };
    if (m?.estado === 'activo') throw conflicto('viaje_invitation_not_pending');
    if (m?.estado !== 'invitado') throw noEncontrado();
    m.estado = 'rechazado';
    return { contract: CONTRATO, viaje_id: v.id, estado: 'rechazado' };
  });
}

export function mockSalirDeViaje(id: string) {
  return ruta(() => {
    const v = miViaje(id);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    const u = yo();
    const eligio = v.tickets.some((t) => t.selecciones.some((s) => s.user_id === u));
    const pago = v.tickets.some((t) => t.pagado_por === u);
    const presente = v.tickets.some((t) => t.forma === 'iguales' && t.personas.some((p) => p.user_id === u && p.presente));
    const motivo = eligio ? 'selection' : pago ? 'paid_ticket' : presente ? 'present_in_equal_split' : null;
    if (motivo) throw conflicto('viaje_member_cannot_leave', { reason: motivo });
    for (const t of v.tickets) t.personas = t.personas.filter((p) => p.user_id !== u);
    v.miembros.find((x) => x.user_id === u)!.estado = 'salio';
    return { contract: CONTRATO, viaje_id: v.id, estado: 'salio' };
  });
}

// ─── Tickets ──────────────────────────────────────────────────────────────

/** El recibo del mock (`or1.<payload>.<firma>`): el mock no verifica la firma (no tiene la clave). */
function verificarRecibo(raw: unknown): { id: string; huella: string | null } {
  if (typeof raw !== 'string') throw new Respuesta(422, 'viaje_ticket_receipt_invalid', { reason: 'malformed' });
  const partes = raw.split('.');
  let payload: Record<string, unknown> | null = null;
  try {
    if (partes.length === 3 && partes[0] === 'or1') {
      const b64 = partes[1]!.replace(/-/g, '+').replace(/_/g, '/');
      payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))) as Record<string, unknown>;
    }
  } catch {
    payload = null;
  }
  if (!payload || typeof payload.jti !== 'string' || typeof payload.exp !== 'number') {
    throw new Respuesta(422, 'viaje_ticket_receipt_invalid', { reason: 'malformed' });
  }
  if (payload.exp * 1000 < Date.now()) throw new Respuesta(422, 'viaje_ticket_receipt_invalid', { reason: 'expired' });
  return { id: payload.jti, huella: typeof payload.h === 'string' ? payload.h : null };
}

function buscarDuplicado(v: ViajeMock, recibo: { id: string; huella: string | null }): { otroViaje?: true; ticket?: TicketMock } {
  for (const w of cargar().viajes) {
    const t = w.tickets.find((x) => x.recibo_jti === recibo.id);
    if (t) return w.id === v.id ? { ticket: t } : { otroViaje: true };
  }
  if (!recibo.huella) return {};
  const t = v.tickets.find((x) => x.huella === recibo.huella);
  return t ? { ticket: t } : {};
}

function yaCargado(v: ViajeMock, t: TicketMock) {
  const m = v.miembros.find((x) => x.user_id === t.pagado_por);
  return { por: m?.id ?? null, ...(m ? persona(m) : {}), en: t.created_at };
}

export function mockRevisarTicket(id: string, body: unknown) {
  return ruta(() => {
    if (!objeto(body) || !soloClaves(body, ['ocr_receipt']) || typeof body.ocr_receipt !== 'string'
        || body.ocr_receipt.length < 1 || body.ocr_receipt.length > 16384) throw invalido();
    const v = miViaje(id);
    const recibo = verificarRecibo(body.ocr_receipt);
    const dup = buscarDuplicado(v, recibo);
    if (dup.otroViaje) throw conflicto('viaje_ticket_receipt_used');
    return { contract: CONTRATO, duplicado: dup.ticket ? { ticket_id: dup.ticket.id, ...yaCargado(v, dup.ticket) } : null };
  });
}

function cuerpoTicket(body: unknown) {
  if (!objeto(body) || !soloClaves(body, ['ocr_receipt', 'idempotency_key', 'forma', 'tipo_lugar', 'lugar', 'fecha_ticket', 'hora_ticket', 'items'])) throw invalido();
  const lugar = body.lugar === undefined || body.lugar === null ? null : textoNormal(body.lugar, 120);
  const fecha = body.fecha_ticket ?? null;
  const hora = body.hora_ticket ?? null;
  if (typeof body.ocr_receipt !== 'string' || body.ocr_receipt.length < 1 || body.ocr_receipt.length > 16384
      || !clave(body.idempotency_key) || !(FORMAS as readonly unknown[]).includes(body.forma)
      || !(TIPOS_LUGAR as readonly unknown[]).includes(body.tipo_lugar)
      || (body.lugar !== undefined && body.lugar !== null && lugar === null)
      || (fecha !== null && !esFecha(fecha)) || (hora !== null && !(typeof hora === 'string' && HORA.test(hora)))
      || (hora !== null && fecha === null)
      || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw invalido();
  const items = body.items.map((i) => {
    if (!objeto(i) || !soloClaves(i, ['name', 'price_cents', 'quantity'])) throw invalido();
    const name = textoNormal(i.name, 200);
    if (!name || typeof i.price_cents !== 'number' || !Number.isSafeInteger(i.price_cents) || i.price_cents < 0
        || typeof i.quantity !== 'number' || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 32767) throw invalido();
    return { name, price_cents: i.price_cents, quantity: i.quantity };
  });
  return {
    ocr_receipt: body.ocr_receipt, idempotency_key: body.idempotency_key, forma: body.forma as Forma,
    tipo_lugar: body.tipo_lugar as TipoLugar, lugar, fecha_ticket: fecha as string | null, hora_ticket: hora as string | null, items,
  };
}

export function mockCargarTicket(id: string, body: unknown) {
  return ruta(() => {
    const b = cuerpoTicket(body);
    const recibo = (() => { try { return { ok: verificarRecibo(b.ocr_receipt) } as const; } catch (e) { return { error: e } as const; } })();
    const v = miViaje(id);
    const u = yo();
    const pedido = hashDe({ forma: b.forma, tipo_lugar: b.tipo_lugar, lugar: b.lugar, fecha_ticket: b.fecha_ticket,
      hora_ticket: b.hora_ticket, items: b.items, recibo: b.ocr_receipt });
    const previo = v.tickets.find((t) => t.pagado_por === u && t.idempotency_key === b.idempotency_key);
    if (previo) {
      if (previo.pedido_hash !== pedido) throw conflicto('idempotency_key_conflict');
      return { contract: CONTRATO, ticket: vistaTicket(v, previo, u), ya_cargado: null };
    }
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    if ('error' in recibo) throw recibo.error;
    const dup = buscarDuplicado(v, recibo.ok);
    if (dup.otroViaje) throw conflicto('viaje_ticket_receipt_used');
    if (dup.ticket) return { contract: CONTRATO, ticket: vistaTicket(v, dup.ticket, u), ya_cargado: yaCargado(v, dup.ticket) };
    if (v.tickets.length >= MAX_TICKETS) throw conflicto('viaje_tickets_limit', { limit: MAX_TICKETS });
    const monto = b.items.reduce((s, i) => s + lineaDe(i), 0);
    if (!Number.isSafeInteger(monto) || monto <= 0) throw new Respuesta(422, 'viaje_ticket_amount_invalid');
    const t: TicketMock = {
      id: nuevoId(), pagado_por: u, forma: b.forma, tipo_lugar: b.tipo_lugar, lugar: b.lugar,
      fecha_ticket: b.fecha_ticket, hora_ticket: b.hora_ticket, monto_cents: monto, created_at: ahora(),
      huella: recibo.ok.huella, recibo_jti: recibo.ok.id, idempotency_key: b.idempotency_key, pedido_hash: pedido,
      items: b.items.map((i) => ({ id: nuevoId(), nombre: i.name, price_cents: i.price_cents, quantity: i.quantity })),
      personas: miembrosEnOrden(v).filter((m) => m.estado === 'activo' && !m.eliminada).map((m) => ({
        user_id: m.user_id, presente: true, listo_en: null, consumo_final_cents: null, asignado_cierre_cents: null,
      })),
      selecciones: [],
    };
    v.tickets.push(t);
    return { contract: CONTRATO, ticket: vistaTicket(v, t, u), ya_cargado: null };
  });
}

function ticketDe(v: ViajeMock, tid: unknown): TicketMock {
  const t = esUuid(tid) ? v.tickets.find((x) => x.id === tid) : undefined;
  if (!t) throw new Respuesta(404, 'viaje_ticket_not_found');
  return t;
}

export function mockVerTicket(id: string, tid: string) {
  return ruta(() => {
    const v = miViaje(id);
    const t = ticketDe(v, tid);
    if (estadoEfectivo(v) === 'cerrado') throw conflicto('viaje_closed');
    return { contract: CONTRATO, ticket: vistaTicket(v, t, yo()) };
  });
}

export function mockElegirEnTicket(id: string, tid: string, body: unknown) {
  return ruta(() => {
    if (!objeto(body) || !soloClaves(body, ['items', 'listo']) || typeof body.listo !== 'boolean'
        || !Array.isArray(body.items) || body.items.length > 100) throw invalido();
    const items = body.items.map((i) => {
      if (!objeto(i) || !soloClaves(i, ['item_id', 'fraction_bps']) || !esUuid(i.item_id)
          || !(INFORMATIVE_FRACTION_BPS as readonly unknown[]).includes(i.fraction_bps)) throw invalido();
      return { item_id: i.item_id, fraction_bps: i.fraction_bps as number };
    });
    if (new Set(items.map((i) => i.item_id)).size !== items.length) throw invalido();
    const v = miViaje(id);
    const t = ticketDe(v, tid);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    if (t.forma !== 'consumo') throw conflicto('viaje_ticket_not_selectable', { forma: t.forma });
    const u = yo();
    const p = t.personas.find((x) => x.user_id === u);
    if (!p) throw conflicto('viaje_ticket_not_in_snapshot');
    const desconocido = items.find((i) => !t.items.some((x) => x.id === i.item_id));
    if (desconocido) throw new Respuesta(422, 'viaje_ticket_item_unknown', { item_id: desconocido.item_id });
    const previa = new Map(t.selecciones.filter((s) => s.user_id === u).map((s) => [s.item_id, s.fraction_bps]));
    for (const i of items.filter((x) => x.fraction_bps > (previa.get(x.item_id) ?? 0))) {
      const otros = t.selecciones.filter((s) => s.item_id === i.item_id && s.user_id !== u).reduce((s, x) => s + x.fraction_bps, 0);
      if (otros + i.fraction_bps > 10000) {
        throw conflicto('viaje_fraction_exceeds_item', { item_id: i.item_id, remaining_bps: restanteDe(otros) });
      }
    }
    const en = ahora();
    t.selecciones = t.selecciones.filter((s) => s.user_id !== u || items.some((i) => i.item_id === s.item_id));
    for (const i of items) {
      const s = t.selecciones.find((x) => x.user_id === u && x.item_id === i.item_id);
      if (s) s.fraction_bps = i.fraction_bps;
      else t.selecciones.push({ item_id: i.item_id, user_id: u, fraction_bps: i.fraction_bps, created_at: en });
    }
    p.listo_en = body.listo ? p.listo_en ?? en : null;
    return { contract: CONTRATO, ticket: vistaTicket(v, t, u) };
  });
}

export function mockMarcarPresentes(id: string, tid: string, body: unknown) {
  return ruta(() => {
    if (!objeto(body) || !soloClaves(body, ['presentes']) || !Array.isArray(body.presentes)
        || body.presentes.length < 1 || body.presentes.length > MAX_MIEMBROS
        || !body.presentes.every(esUuid) || new Set(body.presentes).size !== body.presentes.length) throw invalido();
    const presentes = body.presentes as string[];
    const v = miViaje(id);
    const t = ticketDe(v, tid);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    if (t.forma !== 'iguales') throw conflicto('viaje_ticket_not_equal_split', { forma: t.forma });
    if (t.pagado_por !== yo()) throw conflicto('viaje_ticket_not_yours');
    const porMiembro = new Map(t.personas.map((p) => [v.miembros.find((m) => m.user_id === p.user_id)?.id, p.user_id]));
    const desconocido = presentes.find((x) => !porMiembro.has(x));
    if (desconocido) throw new Respuesta(422, 'viaje_ticket_persona_unknown', { miembro_id: desconocido });
    const marcados = new Set(presentes.map((x) => porMiembro.get(x)));
    for (const p of t.personas) p.presente = marcados.has(p.user_id);
    return { contract: CONTRATO, ticket: vistaTicket(v, t, yo()) };
  });
}

// ─── Cierre y transferencias ──────────────────────────────────────────────

function planDeCierre(v: ViajeMock) {
  const orden = miembrosEnOrden(v).map((m) => m.user_id);
  const b = balanceDelViaje(orden, ticketsEnOrden(v).map((t) => paraCalculo(v, t)), { cierre: true });
  const transferencias = transferenciasMinimas(orden.map((x) => ({ id: x, cents: b.balance.get(x) ?? 0 })));
  return { b, transferencias };
}

export function mockVistaPreviaCierre(id: string) {
  return ruta(() => {
    const v = miViaje(id);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: estadoEfectivo(v) });
    const { b, transferencias } = planDeCierre(v);
    const ids = idPublico(v);
    const asignaciones = [];
    for (const t of ticketsEnOrden(v)) {
      for (const [x, c] of b.porTicket.get(t.id)!.asignado) {
        asignaciones.push({ ticket_id: t.id, lugar: t.lugar, fecha_ticket: t.fecha_ticket, miembro_id: ids.get(x) ?? null, monto_cents: c });
      }
    }
    return {
      contract: CONTRATO,
      todos_eligieron: asignaciones.length === 0,
      tickets: v.tickets.length,
      asignaciones,
      balances: miembrosEnOrden(v).filter((m) => m.estado === 'activo').map((m) => ({ miembro_id: m.id, balance_cents: b.balance.get(m.user_id) ?? 0 })),
      transferencias: transferencias.map((x) => ({ de: ids.get(x.de) ?? null, a: ids.get(x.a) ?? null, monto_cents: x.monto_cents })),
    };
  });
}

/** Si no queda nada por pagar, pasa a Cerrados y avisa (a mí: los demás no tienen bandeja en el mock). */
function terminarSiCorresponde(v: ViajeMock): boolean {
  if (pendientes(v).length > 0 || v.estado !== 'esperando_pagos') return false;
  v.estado = 'cerrado';
  v.terminado_en = ahora();
  if (esActivo(v, yo())) {
    avisarme({ type: 'viaje_finished', viajeId: v.id, body: `${v.nombre} quedó cerrado. Todos pagaron y ya está en Cerrados.`,
      payload: { viaje_id: v.id } });
  }
  return true;
}

/** El cierre: congela lo consumido, crea las transferencias y pasa a esperando pagos. */
function cerrarInterno(v: ViajeMock): void {
  const { b, transferencias } = planDeCierre(v);
  for (const t of v.tickets) {
    const r = b.porTicket.get(t.id)!;
    for (const p of t.personas) {
      p.consumo_final_cents = r.consumo.get(p.user_id) ?? 0;
      p.asignado_cierre_cents = r.asignado.get(p.user_id) ?? 0;
    }
  }
  v.transferencias = transferencias.map((x, k) => ({ id: nuevoId(), orden: k, de_user: x.de, a_user: x.a, monto_cents: x.monto_cents, estado: 'pendiente' }));
  v.estado = 'esperando_pagos';
}

export function mockCerrarViaje(id: string) {
  return ruta(() => {
    const v = miViaje(id);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    cerrarInterno(v);
    terminarSiCorresponde(v);
    return { contract: CONTRATO, viaje: vistaViaje(v, yo()) };
  });
}

const TRANSICIONES: Record<string, { rol: 'de' | 'a'; desde: readonly string[]; a: TransferenciaMock['estado']; igual: readonly string[] }> = {
  pague: { rol: 'de', desde: ['pendiente'], a: 'marcada', igual: ['marcada'] },
  deshacer: { rol: 'de', desde: ['marcada'], a: 'pendiente', igual: ['pendiente'] },
  recibi: { rol: 'a', desde: ['pendiente', 'marcada'], a: 'pagada', igual: ['pagada'] },
  'no-llego': { rol: 'a', desde: ['marcada'], a: 'pendiente', igual: ['pendiente'] },
};

export function mockMarcarTransferencia(id: string, trid: string, accion: string) {
  return ruta(() => {
    const a = TRANSICIONES[accion];
    if (!a) throw new Respuesta(404, 'not_found');
    const v = miViaje(id);
    if (v.estado !== 'esperando_pagos') throw conflicto('viaje_not_waiting_payments', { estado: v.estado });
    const tr = esUuid(trid) ? v.transferencias.find((x) => x.id === trid) : undefined;
    if (!tr) throw new Respuesta(404, 'viaje_transfer_not_found');
    const u = yo();
    if ((a.rol === 'de' ? tr.de_user : tr.a_user) !== u) throw conflicto('viaje_transfer_not_yours');
    if (!vivoUser(v, tr.de_user) || !vivoUser(v, tr.a_user)) throw conflicto('viaje_transfer_voided');
    if (!a.igual.includes(tr.estado)) {
      if (!a.desde.includes(tr.estado)) throw conflicto('viaje_transfer_state', { estado: tr.estado });
      tr.estado = a.a;
      if (a.a === 'pagada') terminarSiCorresponde(v);
    }
    return { contract: CONTRATO, transferencia: vistaTransferencia(v, tr, u), viaje_estado: estadoEfectivo(v),
      transferencias_pendientes: pendientes(v).length };
  });
}

export function mockResumenDeViaje(id: string) {
  return ruta(() => {
    const v = miViaje(id);
    if (v.estado === 'esperando_pagos' && estadoEfectivo(v) === 'cerrado') terminarSiCorresponde(v);
    if (estadoEfectivo(v) !== 'cerrado') throw conflicto('viaje_not_closed', { estado: estadoEfectivo(v) });
    const u = yo();
    const b = balance(v);
    const porTipo = new Map<string, number>(TIPOS_LUGAR.map((t) => [t, 0]));
    const lugares = [];
    for (const t of ticketsEnOrden(v)) {
      const mio = b.porTicket.get(t.id)!.consumo.get(u) ?? 0;
      const pague = t.pagado_por === u;
      if (!mio && !pague) continue;
      porTipo.set(t.tipo_lugar, porTipo.get(t.tipo_lugar)! + mio);
      const { mio: platos } = mioPorPlato(t, u);
      lugares.push({
        ticket_id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: t.fecha_ticket, forma: t.forma,
        pagaste_tu: pague, mi_monto_cents: mio,
        asignado_al_cierre_cents: b.porTicket.get(t.id)!.asignado.get(u) ?? 0,
        items: t.forma === 'consumo' ? t.items.filter((i) => platos.has(i.id)).map((i) => ({
          name: i.nombre, fraction_bps: platos.get(i.id)!.bps, amount_cents: platos.get(i.id)!.monto })) : [],
      });
    }
    const pagadas = v.transferencias.filter((tr) => tr.estado === 'pagada');
    const suma = (xs: TransferenciaMock[]) => xs.reduce((s, tr) => s + tr.monto_cents, 0);
    return {
      contract: CONTRATO,
      resumen: {
        viaje_id: v.id, nombre: v.nombre, fecha_desde: v.fecha_desde, fecha_hasta: v.fecha_hasta,
        personas: v.miembros.filter((m) => m.estado === 'activo').length,
        consumiste_cents: b.consumido.get(u) ?? 0,
        pagaste_en_tickets_cents: b.pagado.get(u) ?? 0,
        te_transfirieron_cents: suma(pagadas.filter((tr) => tr.a_user === u)),
        transferiste_cents: suma(pagadas.filter((tr) => tr.de_user === u)),
        por_tipo_de_lugar: TIPOS_LUGAR.filter((t) => porTipo.get(t)! > 0).map((t) => ({ tipo_lugar: t, monto_cents: porTipo.get(t)! })),
        lugares,
      },
    };
  });
}

// ─── La semilla: el viaje del prototipo de Mati ───────────────────────────

/**
 * Los números del diseño (App-Viajes, «Datos del ejemplo»): Cancún 2026, 4
 * personas, 5 tickets, $6,660.00. En vivo: Debes $542.00, Sofía debe $230.00,
 * Diego debe $1,047.00 (falta que elija en el del 8 oct: quedan $565.00), Luis
 * le deben $1,819.00. Al cerrar: los $565.00 se le asignan a Diego, y las tres
 * transferencias van a Luis ($542.00, $230.00 y $1,612.00).
 */
const PERSONAS = {
  luis: { user_id: 'c1000000-0000-4000-8000-000000000001', first_name: 'Luis', last_name: 'Pérez', username: 'luis.perez' },
  sofia: { user_id: 'c1000000-0000-4000-8000-000000000002', first_name: 'Sofía', last_name: 'Ramírez', username: 'sofia.ramirez' },
  diego: { user_id: 'c1000000-0000-4000-8000-000000000003', first_name: 'Diego', last_name: 'Torres', username: 'diego.torres' },
  carla: { user_id: 'c1000000-0000-4000-8000-000000000004', first_name: 'Carla', last_name: 'Méndez', username: 'carla.mendez' },
  pablo: { user_id: 'c1000000-0000-4000-8000-000000000005', first_name: 'Pablo', last_name: 'Núñez', username: 'pablo.nunez' },
} as const satisfies Record<string, PersonaViajeMock>;

/** Los ids fijos de la semilla, para que las pruebas los nombren. */
export const VIAJES_SEMILLA = {
  cancun: 'd1000000-0000-4000-8000-000000000001',
  monterrey: 'd1000000-0000-4000-8000-000000000002',
  oaxaca: 'd1000000-0000-4000-8000-000000000003',
  valle: 'd1000000-0000-4000-8000-000000000004',
  mazatlan: 'd1000000-0000-4000-8000-000000000005',
  /** El ticket del 8 oct, donde Diego todavía no eligió. */
  cancunMariscos: 'd2000000-0000-4000-8000-000000000105',
} as const;
export const PERSONAS_SEMILLA = PERSONAS;

function semilla(yoMismo: PersonaViajeMock): EstadoViajesMock {
  let n = 0;
  const id = (p: string) => `${p}000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const miembro = (p: PersonaViajeMock, en: string, estadoM: MiembroMock['estado'] = 'activo', por: string | null = null): MiembroMock => ({
    id: id('d4'), user_id: p.user_id, estado: estadoM, invitado_por: por, invitado_en: por ? en : null, created_at: en,
    first_name: p.first_name, last_name: p.last_name, username: p.username, eliminada: false,
  });
  type Renglon = [nombre: string, precio: number, cantidad: number, eligen?: Array<[PersonaViajeMock, number]>];
  const ticket = (v: ViajeMock, t: {
    id?: string; pago: PersonaViajeMock; forma: Forma; tipo: TipoLugar; lugar: string; fecha: string; hora: string | null;
    en: string; renglones: Renglon[]; noListos?: PersonaViajeMock[];
  }) => {
    const items = t.renglones.map(([nombre, price_cents, quantity]) => ({ id: id('d3'), nombre, price_cents, quantity }));
    const tk: TicketMock = {
      id: t.id ?? id('d2'), pagado_por: t.pago.user_id, forma: t.forma, tipo_lugar: t.tipo, lugar: t.lugar,
      fecha_ticket: t.fecha, hora_ticket: t.hora, monto_cents: items.reduce((s, i) => s + lineaDe(i), 0), created_at: t.en,
      huella: null, recibo_jti: id('d6'), idempotency_key: id('d7'), pedido_hash: 'semilla',
      items,
      personas: miembrosEnOrden(v).filter((m) => m.estado === 'activo').map((m) => ({
        user_id: m.user_id, presente: true,
        listo_en: t.forma === 'consumo' && (t.noListos ?? []).some((p) => p.user_id === m.user_id) ? null : t.en,
        consumo_final_cents: null, asignado_cierre_cents: null,
      })),
      selecciones: [],
    };
    let k = 0;
    t.renglones.forEach(([, , , eligen], i) => {
      for (const [p, bps] of eligen ?? []) {
        tk.selecciones.push({ item_id: items[i]!.id, user_id: p.user_id, fraction_bps: bps,
          created_at: new Date(Date.parse(t.en) + 60_000 + (k++) * 1000).toISOString() });
      }
    });
    v.tickets.push(tk);
    return tk;
  };
  const viaje = (vid: string, nombre: string, desde: string, hasta: string, en: string, personas: PersonaViajeMock[]): ViajeMock => ({
    id: vid, nombre, fecha_desde: desde, fecha_hasta: hasta, estado: 'abierto', created_at: en, terminado_en: null,
    creado_por: personas[0]!.user_id, idempotency_key: null, pedido_hash: null,
    miembros: personas.map((p, i) => miembro(p, new Date(Date.parse(en) + i * 1000).toISOString())),
    tickets: [], transferencias: [],
  });
  const { luis, sofia, diego, carla, pablo } = PERSONAS;
  const Y = yoMismo;

  // Cancún 2026 · abierto (1g, 1i, 1l, 1m).
  const cancun = viaje(VIAJES_SEMILLA.cancun, 'Cancún 2026', '2026-10-05', '2026-10-11', '2026-10-01T15:00:00.000Z', [Y, luis, sofia, diego]);
  ticket(cancun, { pago: luis, forma: 'consumo', tipo: 'restaurante', lugar: 'Fonda Doña Mary', fecha: '2026-10-06', hora: '21:30',
    en: '2026-10-07T03:30:00.000Z', renglones: [
      ['Enchiladas suizas', 21200, 1, [[Y, 10000]]], ['Michelada', 20000, 1, [[Y, 10000]]],
      ['Sopa de lima', 11100, 1, [[luis, 10000]]], ['Cochinita pibil', 43000, 1, [[sofia, 10000]]],
      ['Margarita', 40000, 1, [[sofia, 10000]]], ['Arrachera', 48700, 1, [[diego, 10000]]],
    ] });
  ticket(cancun, { pago: Y, forma: 'iguales', tipo: 'bar', lugar: 'Bar La Ola', fecha: '2026-10-06', hora: '23:50',
    en: '2026-10-07T05:50:00.000Z', renglones: [['Cubetazo de cerveza', 48000, 1], ['Nachos', 18000, 1], ['Mezcalitas', 7500, 4]] });
  ticket(cancun, { pago: sofia, forma: 'iguales', tipo: 'super', lugar: 'Súper del Caribe', fecha: '2026-10-07', hora: '11:20',
    en: '2026-10-07T17:20:00.000Z', renglones: [['Agua 6 L', 6500, 2], ['Fruta', 21000, 1], ['Botanas', 18000, 1], ['Hielo', 4000, 2],
      ['Cerveza 12 pack', 34000, 1], ['Pan dulce', 9000, 1], ['Café molido', 25000, 1]] });
  ticket(cancun, { pago: diego, forma: 'total', tipo: 'cafe', lugar: 'Café Caribe', fecha: '2026-10-07', hora: '17:45',
    en: '2026-10-07T23:45:00.000Z', renglones: [['Café americano', 4500, 4], ['Chilaquiles', 20000, 1]] });
  ticket(cancun, { id: VIAJES_SEMILLA.cancunMariscos, pago: luis, forma: 'consumo', tipo: 'restaurante', lugar: 'Mariscos El Faro',
    fecha: '2026-10-08', hora: '21:40', en: '2026-10-09T03:40:00.000Z', noListos: [diego], renglones: [
      ['Ceviche de camarón', 32000, 1, [[luis, 10000]]], ['Tacos de pescado (3)', 28500, 1],
      ['Aguachile', 31000, 1, [[Y, 10000]]], ['Pescado a la talla', 52500, 1, [[luis, 10000]]],
      ['Guacamole', 16000, 1, [[sofia, 5000], [Y, 5000]]], ['Margarita', 14000, 4, [[luis, 2500], [Y, 2500]]],
      ['Agua mineral', 4000, 1, [[sofia, 10000]]],
    ] });

  // Monterrey fin de semana · esperando pagos: me deben (1o).
  const monterrey = viaje(VIAJES_SEMILLA.monterrey, 'Monterrey fin de semana', '2026-09-19', '2026-09-21', '2026-09-15T15:00:00.000Z', [Y, luis, sofia]);
  ticket(monterrey, { pago: Y, forma: 'iguales', tipo: 'restaurante', lugar: 'El Rey del Cabrito', fecha: '2026-09-19', hora: '21:10',
    en: '2026-09-20T03:10:00.000Z', renglones: [['Cabrito al pastor', 120000, 1], ['Frijoles charros', 30000, 1], ['Cerveza', 7500, 4]] });
  ticket(monterrey, { pago: sofia, forma: 'iguales', tipo: 'cafe', lugar: 'Café Barrio Antiguo', fecha: '2026-09-20', hora: '10:30',
    en: '2026-09-20T16:30:00.000Z', renglones: [['Café de olla', 5000, 3], ['Pan de elote', 10000, 3]] });
  cerrarInterno(monterrey);
  const marcada = monterrey.transferencias.find((t) => t.de_user === luis.user_id);
  if (marcada) marcada.estado = 'marcada';

  // Oaxaca puente · cerrado (1r, 1s).
  const oaxaca = viaje(VIAJES_SEMILLA.oaxaca, 'Oaxaca puente', '2026-08-14', '2026-08-17', '2026-08-10T15:00:00.000Z', [Y, luis, sofia, carla, pablo]);
  ticket(oaxaca, { pago: luis, forma: 'iguales', tipo: 'restaurante', lugar: 'La Olla', fecha: '2026-08-14', hora: '15:00',
    en: '2026-08-14T21:00:00.000Z', renglones: [['Mole negro', 48000, 5]] });
  ticket(oaxaca, { pago: carla, forma: 'iguales', tipo: 'bar', lugar: 'Mezcalería Los Amantes', fecha: '2026-08-14', hora: '22:00',
    en: '2026-08-15T04:00:00.000Z', renglones: [['Mezcal', 16000, 10]] });
  ticket(oaxaca, { pago: Y, forma: 'consumo', tipo: 'restaurante', lugar: 'Tlayudas Libres', fecha: '2026-08-15', hora: '23:15',
    en: '2026-08-16T05:15:00.000Z', renglones: [
      ['Tlayuda', 21000, 1, [[Y, 10000]]], ['Mezcal', 13000, 2, [[Y, 10000]]], ['Chapulines', 28000, 1, [[Y, 5000], [sofia, 5000]]],
      ['Tasajo', 30000, 1, [[luis, 10000]]], ['Agua de horchata', 3500, 4, [[carla, 10000]]], ['Memelas', 22000, 1, [[pablo, 10000]]],
    ] });
  ticket(oaxaca, { pago: sofia, forma: 'iguales', tipo: 'super', lugar: 'Súper Oaxaca', fecha: '2026-08-15', hora: null,
    en: '2026-08-15T18:00:00.000Z', renglones: [['Despensa', 250000, 1]] });
  ticket(oaxaca, { pago: pablo, forma: 'iguales', tipo: 'bar', lugar: 'Café Brújula Bar', fecha: '2026-08-16', hora: '20:00',
    en: '2026-08-17T02:00:00.000Z', renglones: [['Cerveza artesanal', 8000, 20]] });
  cerrarInterno(oaxaca);
  for (const tr of oaxaca.transferencias) tr.estado = 'pagada';
  oaxaca.estado = 'cerrado';
  oaxaca.terminado_en = '2026-08-20T15:00:00.000Z';

  // Valle de Bravo · cerrado.
  const valle = viaje(VIAJES_SEMILLA.valle, 'Valle de Bravo', '2026-07-04', '2026-07-06', '2026-07-01T15:00:00.000Z', [Y, luis, diego]);
  ticket(valle, { pago: diego, forma: 'iguales', tipo: 'restaurante', lugar: 'Los Pericos', fecha: '2026-07-05', hora: '14:30',
    en: '2026-07-05T20:30:00.000Z', renglones: [['Trucha empapelada', 30000, 3], ['Limonada', 6000, 3], ['Postre', 8000, 3]] });
  cerrarInterno(valle);
  for (const tr of valle.transferencias) tr.estado = 'pagada';
  valle.estado = 'cerrado';
  valle.terminado_en = '2026-07-08T15:00:00.000Z';

  // Mazatlán diciembre · Sofía me invitó (1f).
  const mazatlan = viaje(VIAJES_SEMILLA.mazatlan, 'Mazatlán diciembre', '2026-12-18', '2026-12-22', '2026-10-09T01:00:00.000Z', [sofia, diego]);
  mazatlan.miembros.push(miembro(Y, '2026-10-09T01:05:00.000Z', 'invitado', sofia.user_id));

  return { version: 1, viajes: [cancun, monterrey, oaxaca, valle, mazatlan], avisos_sembrados: false };
}

/**
 * Siembra los avisos del viaje en mi bandeja, una sola vez (1t). Lo llama la
 * fachada al pedir la config con Viajes encendido.
 */
export function sembrarViajesMock(): void {
  if (!viajesMockEncendido()) return;
  const e = cargar();
  if (e.avisos_sembrados) return;
  e.avisos_sembrados = true;
  const t = Date.now();
  const hace = (min: number) => new Date(t - min * 60_000).toISOString();
  const { luis, sofia } = PERSONAS;
  const monterrey = e.viajes.find((v) => v.id === VIAJES_SEMILLA.monterrey);
  const marcada = monterrey?.transferencias.find((x) => x.de_user === luis.user_id);
  const avisos = [
    { type: 'viaje_finished', viajeId: VIAJES_SEMILLA.oaxaca, en: hace(3 * 24 * 60),
      body: 'Oaxaca puente quedó cerrado. Todos pagaron y ya está en Cerrados.', payload: { viaje_id: VIAJES_SEMILLA.oaxaca } },
    { type: 'viaje_ticket_added', viajeId: VIAJES_SEMILLA.cancun, porPersona: luis.user_id, en: hace(6 * 60),
      body: 'Luis Pérez cargó un ticket nuevo en Cancún 2026: Mariscos El Faro. Elige lo que consumiste.',
      payload: { viaje_id: VIAJES_SEMILLA.cancun, ticket_id: VIAJES_SEMILLA.cancunMariscos } },
    { type: 'viaje_closed', viajeId: VIAJES_SEMILLA.monterrey, en: hace(2 * 60),
      body: `Se cerró Monterrey fin de semana. Te deben ${formatMXN(105000)}.`, payload: { viaje_id: VIAJES_SEMILLA.monterrey } },
    ...(marcada ? [{ type: 'viaje_transfer_marked', viajeId: VIAJES_SEMILLA.monterrey, porPersona: luis.user_id, en: hace(60),
      body: `Luis Pérez marcó que te pagó ${formatMXN(marcada.monto_cents)} en Monterrey fin de semana.`,
      payload: { viaje_id: VIAJES_SEMILLA.monterrey, transferencia_id: marcada.id } }] : []),
    { type: 'viaje_invitation_received', viajeId: VIAJES_SEMILLA.mazatlan, porPersona: sofia.user_id, en: hace(5),
      body: 'Sofía Ramírez te invitó al viaje Mazatlán diciembre.', payload: { viaje_id: VIAJES_SEMILLA.mazatlan } },
  ];
  for (const a of avisos) avisarme(a);
  guardar();
}

