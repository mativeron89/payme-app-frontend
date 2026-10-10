import { useSyncExternalStore } from 'react';
import { extractApiError } from './errors';

/**
 * AF-VIAJES · decisión 242 de Mati, D240 punto 17, Roadmap n338 · App Backend
 * 2.171.0, contrato `contract-mirror/contract/viajes-v1.json`.
 *
 * Los gastos compartidos de un viaje. **PayMe no mueve dinero acá:** el dueño
 * calcula quién le debe a quién y cada uno transfiere desde su banco y lo
 * marca. El front espeja: **no calcula balances ni transferencias**, los
 * muestra tal como llegan. Todo importe, en centavos enteros.
 *
 * Sin la capacidad (`features.viajes` ausente, mal formada o con `enabled` en
 * `false`) la app queda exactamente como antes: ni la pestaña ni las rutas. Es
 * la única puerta: las pantallas la leen, y la fachada la vuelve a mirar antes
 * de pedir (`assertViajesHabilitado`).
 */

export const CONTRATO_VIAJES = 'payme.app.viajes/v1';

export const ESTADOS_VIAJE = ['abierto', 'esperando_pagos', 'cerrado'] as const;
export type EstadoViaje = (typeof ESTADOS_VIAJE)[number];

export const FORMAS_TICKET = ['consumo', 'iguales', 'total'] as const;
export type FormaTicket = (typeof FORMAS_TICKET)[number];

export const TIPOS_LUGAR = ['restaurante', 'bar', 'cafe', 'super', 'otro'] as const;
export type TipoLugar = (typeof TIPOS_LUGAR)[number];

/** D245 · de dónde salió un ticket del viaje (con `viaje_version=2`). */
export const ORIGENES_TICKET = ['escaneo', 'manual'] as const;
export type OrigenTicket = (typeof ORIGENES_TICKET)[number];

export const ESTADOS_TRANSFERENCIA = ['pendiente', 'marcada', 'pagada', 'anulada_por_baja'] as const;
export type EstadoTransferencia = (typeof ESTADOS_TRANSFERENCIA)[number];

export const ACCIONES_TRANSFERENCIA = ['pague', 'deshacer', 'recibi', 'no-llego'] as const;
export type AccionTransferencia = (typeof ACCIONES_TRANSFERENCIA)[number];

/** Los límites del dueño (`limites` del contrato). */
export const MAX_MIEMBROS_VIAJE = 20;
export const MAX_RENGLONES_TICKET = 100;
/** D244 · el tope del dueño para un gasto a mano (`gasto_manual.monto_maximo_cents`). */
export const MAX_GASTO_MANUAL_CENTS = 100_000_000;
export const MAX_DESCRIPCION_GASTO = 120;

/**
 * D255 · App Backend 2.174.0 · la paleta fija del color del viaje (`colores`
 * del contrato): todos con contraste ≥ 4.5:1 contra texto blanco. Se guarda la
 * clave; la app pinta con el hex. `null` es el color de la app.
 */
export const COLORES_VIAJE = {
  azul: '#1D4ED8',
  verde: '#15803D',
  violeta: '#6D28D9',
  rojo: '#B91C1C',
  naranja: '#C2410C',
  turquesa: '#0F766E',
} as const;
export type ColorViaje = keyof typeof COLORES_VIAJE;
export const CLAVES_COLOR_VIAJE = Object.keys(COLORES_VIAJE) as ColorViaje[];

// ─── La capacidad ─────────────────────────────────────────────────────────

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

/**
 * `features.viajes` → `{ supported, enabled }`, claves EXACTAS. Encendida sólo
 * con los dos en `true`; cualquier otra forma la apaga: puede ser otra semántica.
 */
export function decodeCapacidadViajes(config: unknown): boolean {
  if (!plainObject(config) || !plainObject(config.features)) return false;
  const raw = config.features.viajes;
  return plainObject(raw) && clavesExactas(raw, ['supported', 'enabled'])
    && raw.supported === true && raw.enabled === true;
}

/**
 * Sin request propia: lo alimenta `api.getConfig`, como `ocultar` y `username`.
 *
 * `pendiente` hasta la primera config: una ruta de Viajes no se monta ni se
 * redirige mientras no se sabe (entrar directo a `/viaje/…` no puede expulsar a
 * Inicio por llegar antes que la config). `apagada` cubre ausente, mal formada
 * y `enabled: false`.
 */
export type EstadoCapacidadViajes = 'pendiente' | 'encendida' | 'apagada';
let capacidad: EstadoCapacidadViajes = 'pendiente';
const oyentes = new Set<() => void>();

export function aplicarConfigViajes(config: unknown): boolean {
  const siguiente: EstadoCapacidadViajes = decodeCapacidadViajes(config) ? 'encendida' : 'apagada';
  if (siguiente !== capacidad) {
    capacidad = siguiente;
    for (const oyente of [...oyentes]) oyente();
  }
  return capacidad === 'encendida';
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

const instantanea = (): EstadoCapacidadViajes => capacidad;

export function useCapacidadViajes(): EstadoCapacidadViajes {
  return useSyncExternalStore(suscribir, instantanea, instantanea);
}

export function useViajesHabilitado(): boolean {
  return useCapacidadViajes() === 'encendida';
}

export function viajesHabilitado(): boolean {
  return capacidad === 'encendida';
}

/** La segunda capa: con la capacidad apagada (o sin saber), la fachada no pide nada. */
export function assertViajesHabilitado(): void {
  if (capacidad !== 'encendida') throw new Error('viajes_not_available');
}

export function reiniciarViajesParaTests(): void {
  capacidad = 'pendiente';
  for (const oyente of [...oyentes]) oyente();
}

// ─── Las formas (claves exactas del contrato) ─────────────────────────────

export interface PersonaViaje {
  readonly first_name: string | null;
  readonly last_name: string | null;
  /** El @ sin «@». `null` sin @, con la función apagada o con la cuenta eliminada. */
  readonly username: string | null;
  readonly eliminada: boolean;
}

export interface ViajeEnLista {
  readonly id: string;
  readonly nombre: string;
  readonly fecha_desde: string | null;
  readonly fecha_hasta: string | null;
  readonly estado: EstadoViaje;
  readonly personas: number;
  /** Mientras no está cerrado (positivo = te deben). */
  readonly mi_balance_cents: number | null;
  /** Sólo esperando pagos. */
  readonly transferencias_pendientes: number | null;
  /** Sólo cerrado. */
  readonly consumiste_cents: number | null;
  readonly terminado_en: string | null;
  /** D255 · `viaje_version=3`: una clave de la paleta, o `null` (el color de la app). */
  readonly color: ColorViaje | null;
  /** D255 · `viaje_version=3`: la foto sale por `GET /api/viajes/:id/foto`. */
  readonly has_photo: boolean;
}

export interface ListaDeViajes {
  readonly viajes: readonly ViajeEnLista[];
  readonly counts: { readonly abiertos: number; readonly cerrados: number };
}

export interface InvitacionAViaje {
  readonly viaje_id: string;
  readonly nombre: string;
  readonly fecha_desde: string | null;
  readonly fecha_hasta: string | null;
  readonly personas: number;
  readonly invitado_en: string | null;
  readonly invitado_por: PersonaViaje | null;
}

export interface MiembroViaje extends PersonaViaje {
  readonly id: string;
  readonly es_yo: boolean;
  /** `null` para los demás cuando el viaje está cerrado (D240-17). */
  readonly balance_cents: number | null;
  readonly falta_elegir: number;
  /** D245 · hay foto (la regla n164 del dueño: un menor nunca). Se pide aparte. */
  readonly has_avatar: boolean;
  /** D245 · «Lo que pagó»: lo que cargó de su bolsillo. `null` donde el balance es `null`. */
  readonly pagado_cents: number | null;
}

export interface InvitadoViaje extends PersonaViaje {
  readonly id: string;
}

export interface TicketEnViaje {
  readonly id: string;
  readonly lugar: string | null;
  readonly tipo_lugar: TipoLugar;
  readonly fecha_ticket: string | null;
  readonly hora_ticket: string | null;
  readonly cargado_en: string | null;
  readonly forma: FormaTicket;
  /** Id de miembro. */
  readonly pagado_por: string | null;
  readonly pagaste_tu: boolean;
  readonly te_toca_cents: number;
  readonly falta_que_elija: number;
  readonly sin_repartir_cents: number;
  /** D245 · el total del ticket (o del gasto a mano). */
  readonly monto_cents: number;
  readonly origen: OrigenTicket;
  /**
   * D256 · `viaje_version=4` (App Backend 2.175.0): si quien mira puede eliminarlo. Con el viaje abierto, quien lo cargó
   * o quien lo pagó (Mati: «Quien lo cargó o quien pagó»). Es a quien se le muestra «Eliminar».
   */
  readonly puede_eliminar: boolean;
}

export interface SinRepartir {
  readonly ticket_id: string;
  readonly lugar: string | null;
  readonly fecha_ticket: string | null;
  readonly monto_cents: number;
  /** Ids de miembro. */
  readonly faltan: readonly string[];
}

export interface TransferenciaViaje {
  readonly id: string;
  /** Ids de miembro. */
  readonly de: string | null;
  readonly a: string | null;
  readonly monto_cents: number;
  readonly estado: EstadoTransferencia;
  readonly mia: 'debo' | 'me_deben' | null;
}

export interface DetalleViaje {
  readonly id: string;
  readonly nombre: string;
  readonly fecha_desde: string | null;
  readonly fecha_hasta: string | null;
  readonly estado: EstadoViaje;
  readonly creado_en: string | null;
  readonly mi_miembro_id: string;
  readonly miembros: readonly MiembroViaje[];
  readonly invitados: readonly InvitadoViaje[];
  readonly mi_balance_cents: number;
  readonly gasto_del_grupo_cents: number;
  /** El más reciente primero. */
  readonly tickets: readonly TicketEnViaje[];
  readonly sin_repartir: readonly SinRepartir[];
  readonly transferencias: readonly TransferenciaViaje[];
  readonly transferencias_pendientes: number;
  /** D255 · `viaje_version=3`. */
  readonly color: ColorViaje | null;
  readonly has_photo: boolean;
}

export interface ItemDelTicket {
  readonly id: string;
  readonly name: string;
  readonly price_cents: number;
  readonly quantity: number;
  readonly line_cents: number;
  /** Agregado por plato: nunca qué eligió otro. */
  readonly remaining_bps: number;
  readonly my_bps: number;
  readonly my_amount_cents: number;
}

export interface PersonaDelTicket {
  readonly miembro_id: string | null;
  readonly ya_eligio: boolean;
  readonly presente: boolean;
}

export interface TicketDelViaje {
  readonly id: string;
  readonly lugar: string | null;
  readonly tipo_lugar: TipoLugar;
  readonly fecha_ticket: string | null;
  readonly hora_ticket: string | null;
  readonly cargado_en: string | null;
  readonly forma: FormaTicket;
  readonly monto_cents: number;
  readonly pagado_por: string | null;
  readonly pagaste_tu: boolean;
  readonly items: readonly ItemDelTicket[];
  readonly personas: readonly PersonaDelTicket[];
  readonly te_toca_cents: number;
  readonly sin_repartir_cents: number;
  readonly puedo_elegir: boolean;
  readonly puedo_marcar_presentes: boolean;
}

/** Quién cargó (y pagó) un ticket que ya estaba en el viaje (diseño 1k). */
export interface YaCargado extends PersonaViaje {
  readonly por: string | null;
  readonly en: string | null;
}

export interface Duplicado extends YaCargado {
  readonly ticket_id: string;
}

export interface TicketCargado {
  readonly ticket: TicketDelViaje;
  /** `null` si se cargó ahora (o es el reintento del mismo pedido). */
  readonly ya_cargado: YaCargado | null;
}

export interface VistaPreviaCierre {
  readonly todos_eligieron: boolean;
  readonly tickets: number;
  readonly asignaciones: ReadonlyArray<{
    readonly ticket_id: string;
    readonly lugar: string | null;
    readonly fecha_ticket: string | null;
    readonly miembro_id: string | null;
    readonly monto_cents: number;
  }>;
  readonly balances: ReadonlyArray<{ readonly miembro_id: string; readonly balance_cents: number }>;
  readonly transferencias: ReadonlyArray<{ readonly de: string | null; readonly a: string | null; readonly monto_cents: number }>;
}

export interface MarcaDeTransferencia {
  readonly transferencia: TransferenciaViaje;
  readonly viaje_estado: EstadoViaje;
  readonly transferencias_pendientes: number;
}

export interface ResumenDeViaje {
  readonly viaje_id: string;
  readonly nombre: string;
  readonly fecha_desde: string | null;
  readonly fecha_hasta: string | null;
  readonly personas: number;
  readonly consumiste_cents: number;
  readonly pagaste_en_tickets_cents: number;
  readonly te_transfirieron_cents: number;
  readonly transferiste_cents: number;
  readonly por_tipo_de_lugar: ReadonlyArray<{ readonly tipo_lugar: TipoLugar; readonly monto_cents: number }>;
  readonly lugares: ReadonlyArray<{
    readonly ticket_id: string;
    readonly lugar: string | null;
    readonly tipo_lugar: TipoLugar;
    readonly fecha_ticket: string | null;
    readonly forma: FormaTicket;
    readonly pagaste_tu: boolean;
    readonly mi_monto_cents: number;
    readonly asignado_al_cierre_cents: number;
    readonly items: ReadonlyArray<{ readonly name: string; readonly fraction_bps: number; readonly amount_cents: number }>;
  }>;
}

// ─── Los pedidos ──────────────────────────────────────────────────────────

/** Un amigo va por su id; cualquier otro, por el @ que mostró la búsqueda. */
export type MiembroPedido = { readonly user_id: string } | { readonly username: string };

export interface CrearViajePedido {
  readonly nombre: string;
  readonly fecha_desde: string | null;
  readonly fecha_hasta: string | null;
  readonly miembros: readonly MiembroPedido[];
  readonly idempotency_key: string;
}

export interface ItemPedido {
  readonly name: string;
  /** Unitario. */
  readonly price_cents: number;
  readonly quantity: number;
}

export interface CargarTicketPedido {
  readonly ocr_receipt: string;
  readonly idempotency_key: string;
  readonly forma: FormaTicket;
  readonly tipo_lugar: TipoLugar;
  readonly lugar: string | null;
  readonly fecha_ticket: string | null;
  readonly hora_ticket: string | null;
  readonly items: readonly ItemPedido[];
  /** D255-6 · un id de miembro activo, sólo si pagó OTRO; sin él, quien carga. */
  readonly pagado_por?: string;
}

/** D244 · `POST /api/viajes/:id/gastos`: quien lo carga pagó; se reparte en partes iguales entre `presentes`. */
export interface GastoManualPedido {
  readonly descripcion: string;
  readonly monto_cents: number;
  /** Ids de miembro (1..20, sin repetir). */
  readonly presentes: readonly string[];
  readonly idempotency_key: string;
  /** D255-6 · un id de miembro activo, sólo si pagó OTRO; sin él, quien carga. */
  readonly pagado_por?: string;
}

/** D255 · `PATCH /api/viajes/:id`: al menos uno; `null` borra una fecha o el color. */
export interface EditarViajePedido {
  readonly nombre?: string;
  readonly fecha_desde?: string | null;
  readonly fecha_hasta?: string | null;
  readonly color?: ColorViaje | null;
}

/** D255 · `PUT /api/viajes/:id/foto` → `{ foto }`. */
export interface FotoDeViaje {
  readonly revision: number;
  readonly width: number;
  readonly height: number;
  readonly updated_at: string;
}

export interface SeleccionPedido {
  readonly items: ReadonlyArray<{ readonly item_id: string; readonly fraction_bps: number }>;
  readonly listo: boolean;
}

// ─── Decodificadores ──────────────────────────────────────────────────────

export class ViajesResponseError extends Error {
  constructor(endpoint: string) {
    super(`viajes_response_invalid:${endpoint}`);
    this.name = 'ViajesResponseError';
  }
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

const entero = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const noNegativo = (v: unknown): v is number => entero(v) && v >= 0;
const texto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const textoONull = (v: unknown): v is string | null => v === null || texto(v);
const fechaONull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && FECHA.test(v));
const horaONull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && HORA.test(v));
const instanteONull = (v: unknown): v is string | null => v === null || (typeof v === 'string' && !Number.isNaN(Date.parse(v)));
const enteroONull = (v: unknown): v is number | null => v === null || entero(v);
const noNegativoONull = (v: unknown): v is number | null => v === null || noNegativo(v);
const de = <T extends string>(lista: readonly T[]) => (v: unknown): v is T => typeof v === 'string' && (lista as readonly string[]).includes(v);
const esEstado = de(ESTADOS_VIAJE);
const esForma = de(FORMAS_TICKET);
const esTipo = de(TIPOS_LUGAR);
const esEstadoTr = de(ESTADOS_TRANSFERENCIA);
const esColor = de(CLAVES_COLOR_VIAJE);
const colorONull = (v: unknown): v is ColorViaje | null => v === null || esColor(v);

/** El cuerpo de una respuesta: objeto con `contract` exacto y las claves dadas. */
function cuerpo(raw: unknown, claves: readonly string[], endpoint: string): Record<string, unknown> {
  if (!plainObject(raw) || !clavesExactas(raw, ['contract', ...claves]) || raw.contract !== CONTRATO_VIAJES) {
    throw new ViajesResponseError(endpoint);
  }
  return raw;
}

function objeto(raw: unknown, claves: readonly string[], endpoint: string): Record<string, unknown> {
  if (!plainObject(raw) || !clavesExactas(raw, claves)) throw new ViajesResponseError(endpoint);
  return raw;
}

function lista<T>(raw: unknown, endpoint: string, uno: (x: unknown) => T, max = 1000): T[] {
  if (!Array.isArray(raw) || raw.length > max) throw new ViajesResponseError(endpoint);
  return raw.map(uno);
}

function exigir(ok: boolean, endpoint: string): void {
  if (!ok) throw new ViajesResponseError(endpoint);
}

const CLAVES_PERSONA = ['first_name', 'last_name', 'username', 'eliminada'] as const;

/**
 * El nombre y el apellido llegan tal como están en la cuenta (`persona()` del
 * dueño): una cuenta sin apellido lo tiene vacío. Vacío y `null` se leen igual,
 * «sin dato»; cualquier otro tipo rompe la respuesta.
 */
const nombreONull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const vacioANull = (v: string | null): string | null => (v && v.trim() ? v : null);

function persona(o: Record<string, unknown>, endpoint: string): PersonaViaje {
  exigir(nombreONull(o.first_name) && nombreONull(o.last_name) && textoONull(o.username)
    && typeof o.eliminada === 'boolean', endpoint);
  return {
    first_name: vacioANull(o.first_name as string | null),
    last_name: vacioANull(o.last_name as string | null),
    // Una cuenta eliminada nunca muestra un @ (contrato `persona`).
    username: o.eliminada ? null : o.username as string | null,
    eliminada: o.eliminada as boolean,
  };
}

function viajeEnLista(raw: unknown): ViajeEnLista {
  const e = 'viajes.lista';
  const o = objeto(raw, ['id', 'nombre', 'fecha_desde', 'fecha_hasta', 'estado', 'personas', 'mi_balance_cents',
    'transferencias_pendientes', 'consumiste_cents', 'terminado_en', 'color', 'has_photo'], e);
  exigir(texto(o.id) && texto(o.nombre) && fechaONull(o.fecha_desde) && fechaONull(o.fecha_hasta)
    && esEstado(o.estado) && noNegativo(o.personas) && enteroONull(o.mi_balance_cents)
    && noNegativoONull(o.transferencias_pendientes) && noNegativoONull(o.consumiste_cents)
    && instanteONull(o.terminado_en) && colorONull(o.color) && typeof o.has_photo === 'boolean', e);
  // Lo que no aplica a su estado llega en null (nota del contrato).
  const cerrado = o.estado === 'cerrado';
  exigir(cerrado === (o.mi_balance_cents === null) && cerrado === (o.consumiste_cents !== null)
    && (o.estado === 'esperando_pagos') === (o.transferencias_pendientes !== null), e);
  return o as unknown as ViajeEnLista;
}

/** `GET /api/viajes?estado=…&viaje_version=3` → `{ contract, viajes, counts }`; cada viaje con `color` y `has_photo` (D255). */
export function decodeListaDeViajes(raw: unknown, estado: 'abiertos' | 'cerrados'): ListaDeViajes {
  const e = 'viajes.lista';
  const b = cuerpo(raw, ['viajes', 'counts'], e);
  const counts = objeto(b.counts, ['abiertos', 'cerrados'], e);
  exigir(noNegativo(counts.abiertos) && noNegativo(counts.cerrados), e);
  const viajes = lista(b.viajes, e, viajeEnLista, 100);
  // Abiertos trae los que no están cerrados; Cerrados, sólo los cerrados.
  exigir(viajes.every((v) => (v.estado === 'cerrado') === (estado === 'cerrados')), e);
  return { viajes, counts: { abiertos: counts.abiertos as number, cerrados: counts.cerrados as number } };
}

/** `GET /api/viajes/invitaciones` → `{ contract, invitaciones }`. */
export function decodeInvitacionesAViajes(raw: unknown): InvitacionAViaje[] {
  const e = 'viajes.invitaciones';
  const b = cuerpo(raw, ['invitaciones'], e);
  return lista(b.invitaciones, e, (x) => {
    const o = objeto(x, ['viaje_id', 'nombre', 'fecha_desde', 'fecha_hasta', 'personas', 'invitado_en', 'invitado_por'], e);
    exigir(texto(o.viaje_id) && texto(o.nombre) && fechaONull(o.fecha_desde) && fechaONull(o.fecha_hasta)
      && noNegativo(o.personas) && instanteONull(o.invitado_en), e);
    return {
      viaje_id: o.viaje_id as string,
      nombre: o.nombre as string,
      fecha_desde: o.fecha_desde as string | null,
      fecha_hasta: o.fecha_hasta as string | null,
      personas: o.personas as number,
      invitado_en: o.invitado_en as string | null,
      invitado_por: o.invitado_por === null ? null : persona(objeto(o.invitado_por, CLAVES_PERSONA, e), e),
    };
  }, 100);
}

function transferencia(raw: unknown, e: string): TransferenciaViaje {
  const o = objeto(raw, ['id', 'de', 'a', 'monto_cents', 'estado', 'mia'], e);
  exigir(texto(o.id) && textoONull(o.de) && textoONull(o.a) && noNegativo(o.monto_cents) && o.monto_cents > 0
    && esEstadoTr(o.estado) && (o.mia === null || o.mia === 'debo' || o.mia === 'me_deben'), e);
  return o as unknown as TransferenciaViaje;
}

function viajeDetalle(raw: unknown, e: string): DetalleViaje {
  const o = objeto(raw, ['id', 'nombre', 'fecha_desde', 'fecha_hasta', 'estado', 'creado_en', 'mi_miembro_id',
    'miembros', 'invitados', 'mi_balance_cents', 'gasto_del_grupo_cents', 'tickets', 'sin_repartir',
    'transferencias', 'transferencias_pendientes', 'color', 'has_photo'], e);
  exigir(texto(o.id) && texto(o.nombre) && fechaONull(o.fecha_desde) && fechaONull(o.fecha_hasta)
    && esEstado(o.estado) && instanteONull(o.creado_en) && texto(o.mi_miembro_id) && entero(o.mi_balance_cents)
    && noNegativo(o.gasto_del_grupo_cents) && noNegativo(o.transferencias_pendientes)
    && colorONull(o.color) && typeof o.has_photo === 'boolean', e);
  const cerrado = o.estado === 'cerrado';
  const miembros = lista(o.miembros, e, (x): MiembroViaje => {
    const m = objeto(x, ['id', ...CLAVES_PERSONA, 'es_yo', 'balance_cents', 'falta_elegir', 'has_avatar', 'pagado_cents'], e);
    exigir(texto(m.id) && typeof m.es_yo === 'boolean' && enteroONull(m.balance_cents) && noNegativo(m.falta_elegir)
      && typeof m.has_avatar === 'boolean' && noNegativoONull(m.pagado_cents)
      // Cerrado, cada uno ve sólo lo suyo (D240-17); lo que pagó, igual que el balance.
      && (m.balance_cents !== null || (cerrado && !m.es_yo))
      && (m.pagado_cents === null) === (m.balance_cents === null), e);
    return { id: m.id as string, ...persona(m, e), es_yo: m.es_yo as boolean,
      balance_cents: m.balance_cents as number | null, falta_elegir: m.falta_elegir as number,
      has_avatar: m.has_avatar as boolean, pagado_cents: m.pagado_cents as number | null };
  }, 40);
  exigir(miembros.filter((m) => m.es_yo).length === 1
    && miembros.find((m) => m.es_yo)?.id === o.mi_miembro_id, e);
  const invitados = lista(o.invitados, e, (x): InvitadoViaje => {
    const m = objeto(x, ['id', ...CLAVES_PERSONA], e);
    exigir(texto(m.id), e);
    return { id: m.id as string, ...persona(m, e) };
  }, 40);
  const tickets = lista(o.tickets, e, (x): TicketEnViaje => {
    const t = objeto(x, ['id', 'lugar', 'tipo_lugar', 'fecha_ticket', 'hora_ticket', 'cargado_en', 'forma',
      'pagado_por', 'pagaste_tu', 'te_toca_cents', 'falta_que_elija', 'sin_repartir_cents', 'monto_cents', 'origen',
      'puede_eliminar'], e);
    exigir(texto(t.id) && textoONull(t.lugar) && esTipo(t.tipo_lugar) && fechaONull(t.fecha_ticket)
      && horaONull(t.hora_ticket) && instanteONull(t.cargado_en) && esForma(t.forma) && textoONull(t.pagado_por)
      && typeof t.pagaste_tu === 'boolean' && noNegativo(t.te_toca_cents) && noNegativo(t.falta_que_elija)
      && noNegativo(t.sin_repartir_cents) && noNegativo(t.monto_cents)
      && (ORIGENES_TICKET as readonly unknown[]).includes(t.origen) && typeof t.puede_eliminar === 'boolean', e);
    return t as unknown as TicketEnViaje;
  }, 200);
  const sinRepartir = lista(o.sin_repartir, e, (x): SinRepartir => {
    const s = objeto(x, ['ticket_id', 'lugar', 'fecha_ticket', 'monto_cents', 'faltan'], e);
    exigir(texto(s.ticket_id) && textoONull(s.lugar) && fechaONull(s.fecha_ticket) && noNegativo(s.monto_cents)
      && Array.isArray(s.faltan) && s.faltan.every((f) => f === null || texto(f)), e);
    return { ticket_id: s.ticket_id as string, lugar: s.lugar as string | null, fecha_ticket: s.fecha_ticket as string | null,
      monto_cents: s.monto_cents as number, faltan: (s.faltan as Array<string | null>).filter((f): f is string => f !== null) };
  }, 200);
  const transferencias = lista(o.transferencias, e, (x) => transferencia(x, e), 400);
  return {
    id: o.id as string,
    nombre: o.nombre as string,
    fecha_desde: o.fecha_desde as string | null,
    fecha_hasta: o.fecha_hasta as string | null,
    estado: o.estado as EstadoViaje,
    creado_en: o.creado_en as string | null,
    mi_miembro_id: o.mi_miembro_id as string,
    miembros,
    invitados,
    mi_balance_cents: o.mi_balance_cents as number,
    gasto_del_grupo_cents: o.gasto_del_grupo_cents as number,
    tickets,
    sin_repartir: sinRepartir,
    transferencias,
    transferencias_pendientes: o.transferencias_pendientes as number,
    color: o.color as ColorViaje | null,
    has_photo: o.has_photo as boolean,
  };
}

/**
 * `GET /api/viajes/:id`, `POST /api/viajes`, `…/aceptar`, `…/miembros`, `…/cerrar` y `PATCH /api/viajes/:id`
 * → `{ contract, viaje }`. Sólo la forma de `viaje_version=3` (D255, App Backend 2.174.0: la 2 más `color` y
 * `has_photo`): la fachada la pide SIEMPRE en esas rutas, así las claves nuevas nunca llegan sin pedirlas.
 */
export function decodeDetalleViaje(raw: unknown, endpoint = 'viajes.detalle'): DetalleViaje {
  const b = cuerpo(raw, ['viaje'], endpoint);
  return viajeDetalle(b.viaje, endpoint);
}

/** `POST …/rechazar` y `…/salir` → `{ contract, viaje_id, estado }`. */
export function decodeRespuestaDeSalida(raw: unknown, viajeId: string, estado: 'rechazado' | 'salio'): void {
  const e = `viajes.${estado}`;
  const b = cuerpo(raw, ['viaje_id', 'estado'], e);
  exigir(b.viaje_id === viajeId && b.estado === estado, e);
}

function yaCargado(o: Record<string, unknown>, e: string): YaCargado {
  exigir(textoONull(o.por) && instanteONull(o.en), e);
  // Sin el miembro (un borde del dueño), sólo `por` y `en`.
  const p = 'eliminada' in o ? persona(o, e) : { first_name: null, last_name: null, username: null, eliminada: true };
  return { por: o.por as string | null, ...p, en: o.en as string | null };
}

/** `POST …/tickets/check` → `{ contract, duplicado }` (null si no está en el viaje). */
export function decodeRevisionDeTicket(raw: unknown): Duplicado | null {
  const e = 'viajes.check';
  const b = cuerpo(raw, ['duplicado'], e);
  if (b.duplicado === null) return null;
  if (!plainObject(b.duplicado)) throw new ViajesResponseError(e);
  const conPersona = clavesExactas(b.duplicado, ['ticket_id', 'por', ...CLAVES_PERSONA, 'en']);
  const sinPersona = clavesExactas(b.duplicado, ['ticket_id', 'por', 'en']);
  exigir((conPersona || sinPersona) && texto(b.duplicado.ticket_id), e);
  return { ticket_id: b.duplicado.ticket_id as string, ...yaCargado(b.duplicado, e) };
}

function ticketDetalle(raw: unknown, e: string): TicketDelViaje {
  const t = objeto(raw, ['id', 'lugar', 'tipo_lugar', 'fecha_ticket', 'hora_ticket', 'cargado_en', 'forma',
    'monto_cents', 'pagado_por', 'pagaste_tu', 'items', 'personas', 'te_toca_cents', 'sin_repartir_cents',
    'puedo_elegir', 'puedo_marcar_presentes'], e);
  exigir(texto(t.id) && textoONull(t.lugar) && esTipo(t.tipo_lugar) && fechaONull(t.fecha_ticket)
    && horaONull(t.hora_ticket) && instanteONull(t.cargado_en) && esForma(t.forma) && noNegativo(t.monto_cents)
    && textoONull(t.pagado_por) && typeof t.pagaste_tu === 'boolean' && noNegativo(t.te_toca_cents)
    && noNegativo(t.sin_repartir_cents) && typeof t.puedo_elegir === 'boolean'
    && typeof t.puedo_marcar_presentes === 'boolean', e);
  const items = lista(t.items, e, (x): ItemDelTicket => {
    const i = objeto(x, ['id', 'name', 'price_cents', 'quantity', 'line_cents', 'remaining_bps', 'my_bps', 'my_amount_cents'], e);
    exigir(texto(i.id) && texto(i.name) && noNegativo(i.price_cents) && noNegativo(i.quantity) && i.quantity >= 1
      && noNegativo(i.line_cents) && noNegativo(i.remaining_bps) && i.remaining_bps <= 10000
      && noNegativo(i.my_bps) && i.my_bps <= 10000 && noNegativo(i.my_amount_cents) && i.my_amount_cents <= i.line_cents, e);
    return i as unknown as ItemDelTicket;
  }, MAX_RENGLONES_TICKET);
  const personas = lista(t.personas, e, (x): PersonaDelTicket => {
    const p = objeto(x, ['miembro_id', 'ya_eligio', 'presente'], e);
    exigir(textoONull(p.miembro_id) && typeof p.ya_eligio === 'boolean' && typeof p.presente === 'boolean', e);
    return p as unknown as PersonaDelTicket;
  }, 40);
  return { ...(t as unknown as TicketDelViaje), items, personas };
}

/** `GET …/tickets/:tid`, `PUT …/seleccion`, `PUT …/presentes` → `{ contract, ticket }`. */
export function decodeTicketDelViaje(raw: unknown, endpoint = 'viajes.ticket'): TicketDelViaje {
  const b = cuerpo(raw, ['ticket'], endpoint);
  return ticketDetalle(b.ticket, endpoint);
}

/** `POST …/tickets` → `{ contract, ticket, ya_cargado }`. */
export function decodeTicketCargado(raw: unknown): TicketCargado {
  const e = 'viajes.cargar';
  const b = cuerpo(raw, ['ticket', 'ya_cargado'], e);
  let ya: YaCargado | null = null;
  if (b.ya_cargado !== null) {
    if (!plainObject(b.ya_cargado)) throw new ViajesResponseError(e);
    const conPersona = clavesExactas(b.ya_cargado, ['por', ...CLAVES_PERSONA, 'en']);
    exigir(conPersona || clavesExactas(b.ya_cargado, ['por', 'en']), e);
    ya = yaCargado(b.ya_cargado, e);
  }
  return { ticket: ticketDetalle(b.ticket, e), ya_cargado: ya };
}

/**
 * D244 · `POST …/gastos` → `{ contract, ticket, ya_cargado: null }`. Un gasto a
 * mano nunca es un duplicado; se guarda «En partes iguales», de tipo «Otro», y
 * lo pagó quien lo cargó (`gasto_manual.como_se_guarda` del contrato).
 */
/**
 * `POST …/gastos` → el gasto como ticket. D255-6 · `pagadoPor` es lo que se
 * pidió: sin él, lo pagó quien carga (`pagaste_tu`); con el id de otro, ese
 * miembro y no yo.
 */
export function decodeGastoCargado(raw: unknown, pagadoPor?: string): TicketDelViaje {
  const e = 'viajes.gasto';
  const b = cuerpo(raw, ['ticket', 'ya_cargado'], e);
  exigir(b.ya_cargado === null, e);
  const t = ticketDetalle(b.ticket, e);
  exigir(t.forma === 'iguales' && t.tipo_lugar === 'otro'
    && (pagadoPor === undefined ? t.pagaste_tu : !t.pagaste_tu && t.pagado_por === pagadoPor), e);
  return t;
}

/** `GET …/cierre` → la hoja 1m. */
export function decodeVistaPreviaCierre(raw: unknown): VistaPreviaCierre {
  const e = 'viajes.cierre';
  const b = cuerpo(raw, ['todos_eligieron', 'tickets', 'asignaciones', 'balances', 'transferencias'], e);
  exigir(typeof b.todos_eligieron === 'boolean' && noNegativo(b.tickets), e);
  const asignaciones = lista(b.asignaciones, e, (x) => {
    const a = objeto(x, ['ticket_id', 'lugar', 'fecha_ticket', 'miembro_id', 'monto_cents'], e);
    exigir(texto(a.ticket_id) && textoONull(a.lugar) && fechaONull(a.fecha_ticket) && textoONull(a.miembro_id)
      && noNegativo(a.monto_cents), e);
    return a as unknown as VistaPreviaCierre['asignaciones'][number];
  }, 4000);
  exigir(b.todos_eligieron === (asignaciones.length === 0), e);
  const balances = lista(b.balances, e, (x) => {
    const m = objeto(x, ['miembro_id', 'balance_cents'], e);
    exigir(texto(m.miembro_id) && entero(m.balance_cents), e);
    return m as unknown as VistaPreviaCierre['balances'][number];
  }, 40);
  const transferencias = lista(b.transferencias, e, (x) => {
    const t = objeto(x, ['de', 'a', 'monto_cents'], e);
    exigir(textoONull(t.de) && textoONull(t.a) && noNegativo(t.monto_cents) && t.monto_cents > 0, e);
    return t as unknown as VistaPreviaCierre['transferencias'][number];
  }, 40);
  return { todos_eligieron: b.todos_eligieron as boolean, tickets: b.tickets as number, asignaciones, balances, transferencias };
}

/** `POST …/transferencias/:trid/{accion}` → `{ contract, transferencia, viaje_estado, transferencias_pendientes }`. */
export function decodeMarcaDeTransferencia(raw: unknown, trid: string): MarcaDeTransferencia {
  const e = 'viajes.transferencia';
  const b = cuerpo(raw, ['transferencia', 'viaje_estado', 'transferencias_pendientes'], e);
  const tr = transferencia(b.transferencia, e);
  exigir(tr.id === trid && esEstado(b.viaje_estado) && noNegativo(b.transferencias_pendientes), e);
  return { transferencia: tr, viaje_estado: b.viaje_estado as EstadoViaje, transferencias_pendientes: b.transferencias_pendientes as number };
}

/** `GET …/resumen` → Cerrados (1s): sólo lo propio. */
export function decodeResumenDeViaje(raw: unknown, viajeId: string): ResumenDeViaje {
  const e = 'viajes.resumen';
  const b = cuerpo(raw, ['resumen'], e);
  const r = objeto(b.resumen, ['viaje_id', 'nombre', 'fecha_desde', 'fecha_hasta', 'personas', 'consumiste_cents',
    'pagaste_en_tickets_cents', 'te_transfirieron_cents', 'transferiste_cents', 'por_tipo_de_lugar', 'lugares'], e);
  exigir(r.viaje_id === viajeId && texto(r.nombre) && fechaONull(r.fecha_desde) && fechaONull(r.fecha_hasta)
    && noNegativo(r.personas) && noNegativo(r.consumiste_cents) && noNegativo(r.pagaste_en_tickets_cents)
    && noNegativo(r.te_transfirieron_cents) && noNegativo(r.transferiste_cents), e);
  const porTipo = lista(r.por_tipo_de_lugar, e, (x) => {
    const p = objeto(x, ['tipo_lugar', 'monto_cents'], e);
    exigir(esTipo(p.tipo_lugar) && noNegativo(p.monto_cents), e);
    return p as unknown as ResumenDeViaje['por_tipo_de_lugar'][number];
  }, TIPOS_LUGAR.length);
  const lugares = lista(r.lugares, e, (x) => {
    const l = objeto(x, ['ticket_id', 'lugar', 'tipo_lugar', 'fecha_ticket', 'forma', 'pagaste_tu', 'mi_monto_cents',
      'asignado_al_cierre_cents', 'items'], e);
    exigir(texto(l.ticket_id) && textoONull(l.lugar) && esTipo(l.tipo_lugar) && fechaONull(l.fecha_ticket)
      && esForma(l.forma) && typeof l.pagaste_tu === 'boolean' && noNegativo(l.mi_monto_cents)
      && noNegativo(l.asignado_al_cierre_cents), e);
    const items = lista(l.items, e, (y) => {
      const i = objeto(y, ['name', 'fraction_bps', 'amount_cents'], e);
      exigir(texto(i.name) && noNegativo(i.fraction_bps) && i.fraction_bps > 0 && i.fraction_bps <= 10000
        && noNegativo(i.amount_cents), e);
      return i as unknown as ResumenDeViaje['lugares'][number]['items'][number];
    }, MAX_RENGLONES_TICKET);
    return { ...(l as unknown as ResumenDeViaje['lugares'][number]), items };
  }, 200);
  return { ...(r as unknown as ResumenDeViaje), por_tipo_de_lugar: porTipo, lugares };
}

// ─── Lo que la pantalla hace con un error ─────────────────────────────────

/**
 * Qué dice la pantalla cuando el dueño no hace lo pedido. Puro: sale de
 * `extractApiError`. El 404 es uno solo (n325): «no existe» y «no sos
 * miembro» no se distinguen, y la pantalla tampoco los distingue.
 */
export type ErrorDeViaje =
  | { readonly tipo: 'no_disponible' }
  | { readonly tipo: 'no_abierto' }
  | { readonly tipo: 'recibo_usado' }
  | { readonly tipo: 'recibo_invalido' }
  | { readonly tipo: 'miembro_no_encontrado'; readonly username: string | null }
  | { readonly tipo: 'limite_miembros' }
  | { readonly tipo: 'demasiadas_invitaciones' }
  | { readonly tipo: 'no_puede_salir'; readonly motivo: 'selection' | 'paid_ticket' | 'present_in_equal_split' }
  /** H02 · App Backend 2.172.1: esperando pagos o cerrado, con transferencias propias sin confirmar. */
  | { readonly tipo: 'transferencias_pendientes'; readonly pendientes: number }
  | { readonly tipo: 'fraccion_excede'; readonly itemId: string | null }
  | { readonly tipo: 'limite_tickets' }
  /** D244 · alguien de los elegidos ya no está en el viaje. */
  | { readonly tipo: 'persona_desconocida' }
  /** D255-6 · quien pagó ya no es un miembro activo con cuenta. */
  | { readonly tipo: 'pagador_desconocido' }
  /** D255 · la foto: muchas seguidas, o el dueño la está procesando. */
  | { readonly tipo: 'foto_ocupada' }
  /** D255 · la foto: el tipo, el tamaño o la imagen no sirven (los `avatar_*` de la foto de perfil). */
  | { readonly tipo: 'foto_invalida' }
  | { readonly tipo: 'reintentar' };

const MOTIVOS_SALIDA = ['selection', 'paid_ticket', 'present_in_equal_split'] as const;

/** `PUT /api/viajes/:id/foto` → `{ foto: { revision, width, height, updated_at } }` (sin `contract`). */
export function decodeFotoDeViaje(raw: unknown): FotoDeViaje {
  const e = 'viajes.foto';
  if (!plainObject(raw) || !clavesExactas(raw, ['foto'])) throw new ViajesResponseError(e);
  const f = objeto(raw.foto, ['revision', 'width', 'height', 'updated_at'], e);
  exigir(noNegativo(f.revision) && noNegativo(f.width) && noNegativo(f.height)
    && typeof f.updated_at === 'string' && !Number.isNaN(Date.parse(f.updated_at)), e);
  return f as unknown as FotoDeViaje;
}

/**
 * D256 · lo que dice la pantalla al eliminar un ticket o un gasto
 * (`DELETE /api/viajes/:id/tickets/:tid`). Dos casos propios; el resto, como siempre:
 * - 403 `viaje_ticket_delete_forbidden`: no lo cargó ni lo pagó;
 * - 404 `viaje_ticket_not_found`: ya no estaba (otro lo eliminó). En las demás pantallas ese 404 es «no disponible»;
 *   acá el viaje sigue y se refresca.
 * El 404 del viaje (n325), el 409 `viaje_not_open` y lo demás siguen a `errorDeViaje`.
 */
export type ErrorAlEliminar =
  | { readonly tipo: 'eliminar_prohibido' }
  | { readonly tipo: 'ticket_no_encontrado' }
  | ErrorDeViaje;

export function errorAlEliminar(err: unknown): ErrorAlEliminar {
  const { status, code } = extractApiError(err);
  if (status === 403 && code === 'viaje_ticket_delete_forbidden') return { tipo: 'eliminar_prohibido' };
  if (status === 404 && code === 'viaje_ticket_not_found') return { tipo: 'ticket_no_encontrado' };
  return errorDeViaje(err);
}

export function errorDeViaje(err: unknown): ErrorDeViaje {
  const { code, extra, status } = extractApiError(err);
  if (status === 404 && (code === 'viaje_not_found' || code === 'viaje_ticket_not_found'
      || code === 'viaje_transfer_not_found')) return { tipo: 'no_disponible' };
  if (status === 409 && (code === 'viaje_not_open' || code === 'viaje_closed'
      || code === 'viaje_not_waiting_payments' || code === 'viaje_invitation_not_pending')) return { tipo: 'no_abierto' };
  if (status === 409 && code === 'viaje_ticket_receipt_used') return { tipo: 'recibo_usado' };
  if (status === 422 && code === 'viaje_ticket_receipt_invalid') return { tipo: 'recibo_invalido' };
  if (status === 422 && code === 'viaje_member_not_found') {
    const m = plainObject(extra.member) ? extra.member : null;
    return { tipo: 'miembro_no_encontrado', username: m && typeof m.username === 'string' ? m.username : null };
  }
  if (status === 409 && code === 'viaje_members_limit') return { tipo: 'limite_miembros' };
  if (status === 409 && code === 'viaje_tickets_limit') return { tipo: 'limite_tickets' };
  if (status === 422 && code === 'viaje_ticket_persona_unknown') return { tipo: 'persona_desconocida' };
  if (status === 422 && code === 'viaje_ticket_payer_unknown') return { tipo: 'pagador_desconocido' };
  if (status === 429 && (code === 'viaje_photo_rate_limited' || code === 'avatar_processing_busy')) return { tipo: 'foto_ocupada' };
  if ((status === 400 || status === 413 || status === 415 || status === 422) && code.startsWith('avatar_')) return { tipo: 'foto_invalida' };
  if (status === 429 && code === 'viajes_rate_limited') return { tipo: 'demasiadas_invitaciones' };
  if (status === 409 && code === 'viaje_member_cannot_leave'
      && (MOTIVOS_SALIDA as readonly unknown[]).includes(extra.reason)) {
    return { tipo: 'no_puede_salir', motivo: extra.reason as (typeof MOTIVOS_SALIDA)[number] };
  }
  if (status === 409 && code === 'viaje_member_transfers_pending'
      && typeof extra.pendientes === 'number' && Number.isSafeInteger(extra.pendientes) && extra.pendientes > 0) {
    return { tipo: 'transferencias_pendientes', pendientes: extra.pendientes };
  }
  if (status === 409 && code === 'viaje_fraction_exceeds_item') {
    return { tipo: 'fraccion_excede', itemId: typeof extra.item_id === 'string' ? extra.item_id : null };
  }
  return { tipo: 'reintentar' };
}
