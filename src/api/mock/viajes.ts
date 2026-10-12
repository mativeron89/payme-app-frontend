import type { AppNotification } from '../types';
import { INFORMATIVE_FRACTION_BPS } from '../types';
import { formatMXN } from '../../utils/format';
import {
  MockApiError,
  amigoParaViajesMock,
  jpegDeIniciales,
  arrobaParaViajesMock,
  latencia,
  usernameMock,
  yoParaViajesMock,
  type PersonaViajeMock,
} from './mockApi';
import { persist as persistirStore, state as store } from './store';
import {
  avisoEliminadoMock, CLAVE_ESTADO_VIAJES_MOCK, limiteDeViajesMock, seamDeCorregirMock, seamDeEliminarMock, seamDeGastoMock,
  seamDeNotasMock, seamDeSeleccionMock, seamDeVisitasMock, viajesMockEncendido,
} from './viajesSeam';
import {
  ajustesDeRecibo,
  balanceDelViaje,
  consumoDelTicket,
  esPersonal,
  pagadoresDe,
  totalDelTicket,
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
/** D244 · App Backend 2.172.0: el tope de un gasto a mano. */
const MAX_GASTO_CENTS = 100_000_000;
/** v2.173.2 · T-03 · el tope del total de un viaje (`MAX_TOTAL_CENTS` del dueño). */
const MAX_TOTAL_CENTS = MAX_TICKETS * MAX_GASTO_CENTS;
/** D244 · el id propio de un gasto a mano, donde uno escaneado guarda el de su recibo (`~` no es base64url). */
const PREFIJO_GASTO_MANUAL = 'm~';
const esManual = (t: TicketMock) => t.recibo_jti.startsWith(PREFIJO_GASTO_MANUAL);

/** D245 · `viaje_version=2`: sólo con la negociación el detalle suma foto, lo que pagó y el total de cada ticket. */
interface OpcionesDeVersion {
  /** 2: D245 (2.172.0); 3: la 2 más `color` y `has_photo` (D255, 2.174.0); 4: la 3 más `puede_eliminar` (D256, 2.175.0);
   *  5: la 4 más `pagadores`, también en el detalle de un ticket (D263, 2.177.0);
   *  6: la 5 más `presentes` y `personal` (D276, 2.179.0);
   *  7: la 6 sin claves nuevas; el detalle de un ticket con el viaje en Cerrados, en sólo lectura (V-02, 2.179.2);
   *  8: la 7 más `hora_cierre`, `puedo_cerrar` y `se_cierra_en` en el viaje, y `hora_cierre` en la lista (D279, 2.180.0);
   *  9: la 8 más el servicio, los descuentos, el IVA aparte y el total impreso en cada ticket, y `te_toca_platos_cents`
   *     en el detalle de un ticket; la lista, como la 8. Sólo un POST de ticket con la 9 guarda los ajustes (D278-2, D284,
   *     2.181.0);
   *  10: la 9 más `puedo_corregir` en el detalle de un ticket; fuera de él, como la 9 (D278-3, 2.182.0);
   *  11: la 10 más `notas` en el detalle del viaje; en la lista y en el detalle de un ticket, como la 10 (D290, 2.183.0). */
  readonly version?: Version;
}
type Version = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

/** D255 · la paleta del contrato (`colores`): se guarda la clave. */
const COLORES = ['azul', 'verde', 'violeta', 'rojo', 'naranja', 'turquesa'] as const;
/** D255 · los bytes de la foto de cada viaje, sólo en memoria (el mock no la guarda en el navegador). */
const fotosDeViajes = new Map<string, Blob>();
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
  /** D263 · con varios pagadores, lo que pagó cada uno (el primero es `pagado_por`). Con uno solo, no está. */
  pagadores?: Array<{ user_id: string; monto_cents: number }>;
  /** D255-6 · quien lo cargó, si no es quien pagó. Sin él (lo sembrado), quien pagó. */
  cargado_por?: string;
  forma: Forma;
  tipo_lugar: TipoLugar;
  lugar: string | null;
  fecha_ticket: string | null;
  hora_ticket: string | null;
  monto_cents: number;
  /** D278-2 · D284 · lo que el recibo trae aparte, guardado sólo con un cliente 9. Sin ellos (lo viejo), 0. */
  servicio_cents?: number;
  descuentos_cents?: number;
  iva_aparte_cents?: number;
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
  /** D255 · una clave de `COLORES`, o null. Sin él (lo sembrado), null. */
  color?: string | null;
  /** D255 · la foto: sus datos; los bytes viven en `fotosDeViajes`. */
  foto?: { revision: number; width: number; height: number; updated_at: string } | null;
  /** D279 · «HH:MM». Sin él (lo sembrado y lo anterior), 23:59. */
  hora_cierre?: string;
  /** D290 · cuándo se cerró (pasó a esperando pagos): el `cerrado_en` del pizarrón. Sin él (lo anterior), null. */
  cerrado_en?: string | null;
  /** D290 · el pizarrón: las entradas de todos, las de cada autor en su orden. Sin él (lo anterior), ninguna. */
  notas?: NotaMock[];
  /** D290 · la última visita de cada uno al pizarrón (`viaje_notas_vistas`). */
  vistas_notas?: Record<string, string>;
}

/** D290 · una nota o una lista del pizarrón (`viaje_notas` y `viaje_nota_items` del dueño). */
export interface NotaMock {
  id: string;
  user_id: string;
  tipo: 'nota' | 'lista';
  texto: string | null;
  titulo: string | null;
  items: Array<{ id: string; texto: string; tildado: boolean }>;
  version: number;
  creado_en: string;
  actualizado_en: string;
  idempotency_key: string;
  pedido_hash: string;
}

/** D255-6 · quien cargó el ticket (la idempotencia y marcar presentes son suyas). */
const cargadoPor = (t: TicketMock) => t.cargado_por ?? t.pagado_por;
/** D263 · si `u` pagó el ticket: con varios, cualquiera de ellos (como `esPagador` del dueño). */
const esPagador = (t: TicketMock, u: string) => t.pagado_por === u || (t.pagadores ?? []).some((p) => p.user_id === u);
/** D263 · `viaje_version=5`: los pagadores con lo que pagó cada uno, por su id de miembro. */
const pagadoresPublicos = (t: TicketMock, ids: ReadonlyMap<string, string>) =>
  pagadoresDe(t).map((p) => ({ miembro_id: ids.get(p.user_id) ?? null, monto_cents: p.monto_cents }));
/** D278-2 · D284 · la 9: los ajustes guardados y el total impreso (`ajustesPublicos` del dueño). */
const ajustesPublicos = (t: TicketMock) => ({
  servicio_cents: t.servicio_cents ?? 0, descuentos_cents: t.descuentos_cents ?? 0, iva_aparte_cents: t.iva_aparte_cents ?? 0,
  total_cents: totalDelTicket(t),
});

export interface EstadoViajesMock {
  version: 1;
  viajes: ViajeMock[];
  avisos_sembrados: boolean;
  /**
   * D282 · «la publicación» del mock: el momento en que se sembró. Un viaje sólo se cierra solo si su momento de
   * cierre es posterior. Un estado guardado antes no lo tiene: se fija al leerlo.
   */
  corte?: string;
}

let estado: EstadoViajesMock | null = null;

function cargar(): EstadoViajesMock {
  if (estado) return estado;
  try {
    const raw = JSON.parse(localStorage.getItem(CLAVE_ESTADO_VIAJES_MOCK) ?? 'null') as EstadoViajesMock | null;
    if (raw && raw.version === 1 && Array.isArray(raw.viajes)) {
      estado = raw;
      if (!estado.corte) {
        estado.corte = ahora();
        guardar();
      }
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
const horaDeCierre = (v: Pick<ViajeMock, 'hora_cierre'>) => v.hora_cierre ?? '23:59';

/** D279 · M: la fecha hasta más la hora de cierre, en hora de México (UTC−6 fijo, como el contrato). */
function momentoDeCierre(v: Pick<ViajeMock, 'fecha_hasta' | 'hora_cierre'>): number | null {
  return v.fecha_hasta ? Date.parse(`${v.fecha_hasta}T${horaDeCierre(v)}:00-06:00`) : null;
}

/**
 * D279 · D282 · se cierra solo (`SE_CIERRA_SOLO` del dueño): abierto, con fecha hasta, y M posterior a la creación (D-1)
 * y a la publicación (D282).
 */
function seCierraSolo(v: ViajeMock): number | null {
  const m = momentoDeCierre(v);
  const corte = estado?.corte ? Date.parse(estado.corte) : null;
  return v.estado === 'abierto' && m !== null && corte !== null && m > Date.parse(v.created_at) && m > corte ? m : null;
}

/**
 * `se_cierra_en` de la 8. El mock no cierra solo (eso es del dueño, al leer y con su barrido): pasado M deja de
 * anunciarlo, como el dueño, que a esa altura ya lo cerró.
 */
function seCierraEn(v: ViajeMock): string | null {
  const m = seCierraSolo(v);
  return m !== null && m > Date.now() ? new Date(m).toISOString() : null;
}

/** D-2 · ya venció: lo que un PATCH no puede dejar si no lo hace quien creó el viaje. */
function vencido(v: ViajeMock): boolean {
  const m = seCierraSolo(v);
  return m !== null && m <= Date.now();
}
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
/**
 * v2.172.1 · H02 (\`miembrosVisibles\` del dueño): abierto, los activos; en
 * esperando pagos o cerrado, también quien salió después de pagar y tiene montos
 * o transferencias, así los números de los demás no cambian cuando alguien sale.
 */
function miembrosVisibles(v: ViajeMock): MiembroMock[] {
  const activos = v.miembros.filter((m) => m.estado === 'activo');
  if (v.estado === 'abierto') return activos;
  const conMontos = new Set([
    ...v.tickets.flatMap((t) => [t.pagado_por, ...(t.pagadores ?? []).map((p) => p.user_id), ...t.personas.map((p) => p.user_id)]),
    ...v.transferencias.flatMap((t) => [t.de_user, t.a_user]),
  ]);
  return v.miembros.filter((m) => m.estado === 'activo' || (m.estado === 'salio' && conMontos.has(m.user_id)));
}
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
    ...(t.cargado_por && { cargado_por: t.cargado_por }),
    monto_cents: t.monto_cents,
    ...(t.pagadores && { pagadores: t.pagadores }),
    // D278-2 · D284 · los ajustes guardados (sólo con un cliente 9); sin ellos, 0.
    servicio_cents: t.servicio_cents ?? 0,
    descuentos_cents: t.descuentos_cents ?? 0,
    iva_aparte_cents: t.iva_aparte_cents ?? 0,
    items: t.items.map((i) => ({ id: i.id, line_cents: lineaDe(i) })),
    personas: t.personas.map((p) => ({ user_id: p.user_id, presente: p.presente, listo: !!p.listo_en, vivo: vivoUser(v, p.user_id) })),
    selecciones: porOrden(t.selecciones, (s) => s.user_id),
  };
}

const ticketsEnOrden = (v: ViajeMock) => porOrden(v.tickets, (t) => t.id);
/** D276 · el gasto personal, con la ÚNICA definición del dueño (`esPersonal` del cálculo). */
const esPersonalMock = (v: ViajeMock, t: TicketMock) => esPersonal(paraCalculo(v, t));
/** D276 · el personal de otro, para `u`, no existe (`loVe` del dueño). */
const loVe = (v: ViajeMock, t: TicketMock, u: string) => !esPersonalMock(v, t) || cargadoPor(t) === u;

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
    // D276: el personal quedó congelado entero a su dueño y no suma al grupo.
    if (esPersonalMock(v, t)) {
      porTicket.set(t.id, { consumo: new Map(t.personas.map((p) => [p.user_id, p.consumo_final_cents ?? 0])),
        platos: platosCongelados(v, t), asignado: new Map(), sinRepartir: 0, faltan: [], personal: true });
      continue;
    }
    // v2.181.0 · D278-2: el gasto es el total impreso.
    gasto += totalDelTicket(t);
    for (const p of pagadoresDe(t)) {
      sumar(pagado, p.user_id, p.monto_cents);
      sumar(bal, p.user_id, p.monto_cents);
    }
    const consumo = new Map<string, number>();
    const asignado = new Map<string, number>();
    for (const p of t.personas) {
      const c = p.consumo_final_cents ?? 0;
      consumo.set(p.user_id, c);
      if (p.asignado_cierre_cents) asignado.set(p.user_id, p.asignado_cierre_cents);
      sumar(consumido, p.user_id, c);
      sumar(bal, p.user_id, -c);
    }
    porTicket.set(t.id, { consumo, platos: platosCongelados(v, t), asignado, sinRepartir: 0, faltan: [] });
  }
  if ([...bal.values()].reduce((s, x) => s + x, 0) !== 0) throw new Error('viaje_balance_no_cuadra');
  return { balance: bal, pagado, consumido, gasto, porTicket, congelado: true };
}

/**
 * v2.181.0 · `platosCongelados` del dueño: cerrado, la parte de los renglones de cada uno (sin el ajuste). En «por lo que
 * pidió cada uno», lo elegido más lo asignado al cerrar; en las otras formas, el mismo cálculo; el personal, los
 * renglones enteros a su dueño.
 */
function platosCongelados(v: ViajeMock, t: TicketMock): Map<string, number> {
  if (esPersonalMock(v, t)) return new Map([[cargadoPor(t), t.monto_cents]]);
  if (t.forma !== 'consumo') return consumoDelTicket(paraCalculo(v, t)).platos;
  const platos = new Map<string, number>();
  const lineas = new Map(t.items.map((i) => [i.id, lineaDe(i)]));
  const acumulado = new Map<string, { bps: number; monto: number }>();
  for (const sel of porOrden(t.selecciones, (x) => x.user_id)) {
    const previo = acumulado.get(sel.item_id) ?? { bps: 0, monto: 0 };
    const precio = precioInformativo(lineas.get(sel.item_id)!, sel.fraction_bps, previo.bps, previo.monto);
    acumulado.set(sel.item_id, { bps: previo.bps + sel.fraction_bps, monto: previo.monto + precio });
    platos.set(sel.user_id, (platos.get(sel.user_id) ?? 0) + precio);
  }
  for (const p of t.personas) if (p.asignado_cierre_cents) platos.set(p.user_id, (platos.get(p.user_id) ?? 0) + p.asignado_cierre_cents);
  return platos;
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

function vistaViaje(v: ViajeMock, u: string, version: Version = 1) {
  const est = estadoEfectivo(v);
  const cerrado = est === 'cerrado';
  const b = balance(v);
  const ids = idPublico(v);
  const faltaElegir = new Map<string, number>();
  if (!b.congelado) {
    for (const r of b.porTicket.values()) for (const x of r.faltan) faltaElegir.set(x, (faltaElegir.get(x) ?? 0) + 1);
  }
  // D276: el personal de otro no existe para `u`; el propio sí se ve (y no suma).
  const tickets = ticketsEnOrden(v).filter((t) => loVe(v, t, u)).map((t) => {
    const r = b.porTicket.get(t.id)!;
    return {
      id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: t.fecha_ticket, hora_ticket: t.hora_ticket,
      cargado_en: t.created_at, forma: t.forma, pagado_por: ids.get(t.pagado_por) ?? null, pagaste_tu: esPagador(t, u),
      te_toca_cents: r.consumo.get(u) ?? 0,
      falta_que_elija: b.congelado ? 0 : r.faltan.length,
      sin_repartir_cents: b.congelado ? 0 : r.sinRepartir,
      ...(version >= 2 && { monto_cents: t.monto_cents, origen: esManual(t) ? 'manual' : 'escaneo' }),
      // D256 · con la 4: quien lo cargó o quien pagó, con el viaje abierto (el estado guardado, como el dueño).
      ...(version >= 4 && { puede_eliminar: v.estado === 'abierto' && (esPagador(t, u) || cargadoPor(t) === u) }),
      // D263 · con la 5: quiénes pagaron y cuánto.
      ...(version >= 5 && { pagadores: pagadoresPublicos(t, ids) }),
      // D276 · con la 6: quiénes estuvieron y si es un gasto personal.
      ...(version >= 6 && {
        presentes: t.personas.filter((p) => p.presente).map((p) => ids.get(p.user_id) ?? null),
        personal: esPersonalMock(v, t),
      }),
      // D278-2 · D284 · con la 9: los ajustes y el total impreso.
      ...(version >= 9 && ajustesPublicos(t)),
    };
  }).reverse();
  // D245: lo que pagó cada uno de su bolsillo, la suma de los tickets y gastos que cargó.
  // D276: sin los personales, que no son del viaje.
  const pagadoDe = (x: string) => v.tickets.filter((t) => !esPersonalMock(v, t)).flatMap((t) => pagadoresDe(t))
    .filter((p) => p.user_id === x).reduce((s, p) => s + p.monto_cents, 0);
  const sinRepartir = b.congelado ? [] : ticketsEnOrden(v).filter((t) => b.porTicket.get(t.id)!.sinRepartir > 0).map((t) => ({
    ticket_id: t.id, lugar: t.lugar, fecha_ticket: t.fecha_ticket,
    monto_cents: b.porTicket.get(t.id)!.sinRepartir,
    faltan: b.porTicket.get(t.id)!.faltan.map((x) => ids.get(x) ?? null),
  }));
  return {
    id: v.id, nombre: v.nombre, fecha_desde: v.fecha_desde, fecha_hasta: v.fecha_hasta, estado: est,
    creado_en: v.created_at, mi_miembro_id: ids.get(u),
    miembros: porOrden(miembrosVisibles(v), (m) => m.user_id).map((m) => ({
      id: m.id, ...persona(m), es_yo: m.user_id === u,
      balance_cents: cerrado && m.user_id !== u ? null : b.balance.get(m.user_id) ?? 0,
      falta_elegir: faltaElegir.get(m.user_id) ?? 0,
      ...(version >= 2 && {
        has_avatar: !m.eliminada && CON_FOTO.has(m.user_id),
        // Cerrado (D240-17): de los demás, nada, como el balance.
        pagado_cents: cerrado && m.user_id !== u ? null : pagadoDe(m.user_id),
      }),
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
    ...(version >= 3 && { color: v.color ?? null, has_photo: !!v.foto }),
    // D279 · con la 8: la hora de cierre, si cierro yo (quien lo creó, abierto) y cuándo se cierra solo.
    ...(version >= 8 && {
      hora_cierre: horaDeCierre(v),
      puedo_cerrar: est === 'abierto' && v.creado_por === u,
      se_cierra_en: seCierraEn(v),
    }),
    // D290 · con la 11: el resumen del pizarrón de notas, al final.
    ...(version >= 11 && { notas: resumenDeNotas(v, u) }),
  };
}

function vistaTicket(v: ViajeMock, t: TicketMock, u: string, version: Version = 1) {
  const b = balance(v);
  const r = b.porTicket.get(t.id)!;
  const ids = idPublico(v);
  const { mio, acumulado } = mioPorPlato(t, u);
  const abierto = v.estado === 'abierto';
  // D276: elige quien estuvo, y nunca en un personal (es todo de su dueño).
  const estuve = t.personas.some((p) => p.user_id === u && p.presente);
  const personal = esPersonalMock(v, t);
  return {
    id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: t.fecha_ticket, hora_ticket: t.hora_ticket,
    cargado_en: t.created_at, forma: t.forma, monto_cents: t.monto_cents,
    pagado_por: ids.get(t.pagado_por) ?? null, pagaste_tu: esPagador(t, u),
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
    puedo_elegir: abierto && t.forma === 'consumo' && estuve && !personal,
    // D276 · desde la 6, en las tres formas.
    puedo_marcar_presentes: abierto && (version >= 6 || t.forma === 'iguales') && (esPagador(t, u) || cargadoPor(t) === u),
    // D263 · con la 5, también en el detalle de un ticket.
    ...(version >= 5 && { pagadores: pagadoresPublicos(t, ids) }),
    // D276 · con la 6, si es un gasto personal.
    ...(version >= 6 && { personal }),
    // D278-2 · D284 · con la 9: los ajustes, el total impreso y lo tuyo de los renglones (`te_toca_cents` es tu parte del total).
    ...(version >= 9 && { ...ajustesPublicos(t), te_toca_platos_cents: r.platos.get(u) ?? 0 }),
    // D278-3 · con la 10: lo cargué o lo pagué, y el viaje está abierto (la misma condición que marcar presentes).
    ...(version >= 10 && { puedo_corregir: abierto && (esPagador(t, u) || cargadoPor(t) === u) }),
  };
}

function vistaEnLista(v: ViajeMock, u: string, version: 1 | 3 | 8 = 1) {
  const est = estadoEfectivo(v);
  const b = balance(v);
  return {
    id: v.id, nombre: v.nombre, fecha_desde: v.fecha_desde, fecha_hasta: v.fecha_hasta, estado: est,
    personas: miembrosVisibles(v).length,
    mi_balance_cents: est === 'cerrado' ? null : b.balance.get(u) ?? 0,
    transferencias_pendientes: est === 'esperando_pagos' ? pendientes(v).length : null,
    consumiste_cents: est === 'cerrado' ? b.consumido.get(u) ?? 0 : null,
    terminado_en: v.terminado_en,
    ...(version >= 3 && { color: v.color ?? null, has_photo: !!v.foto }),
    ...(version >= 8 && { hora_cierre: horaDeCierre(v) }),
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
  viaje_ticket_removed: 'Se eliminó un ticket de tu viaje',
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

export function mockListarViajes(estadoPedido: 'abiertos' | 'cerrados', { version = 1 }: { readonly version?: 1 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 } = {}) {
  return ruta(() => {
    const u = yo();
    const mios = cargar().viajes.filter((v) => esActivo(v, u))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const abiertos: Array<ReturnType<typeof vistaEnLista>> = [];
    const cerrados: Array<ReturnType<typeof vistaEnLista>> = [];
    for (const v of mios) {
      // D256 · en la lista la 4 sale como la 3 (como el dueño); D279 · la 8 suma `hora_cierre`; la 9, la 10 y la 11 salen
      // como la 8.
      const item = vistaEnLista(v, u, version >= 8 ? 8 : version >= 3 ? 3 : 1);
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

export function mockCrearViaje(body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    if (!objeto(body) || !soloClaves(body, ['nombre', 'fecha_desde', 'fecha_hasta', 'miembros', 'idempotency_key', 'hora_cierre'])) throw invalido();
    const nombre = textoNormal(body.nombre, 80);
    const desde = body.fecha_desde ?? null;
    const hasta = body.fecha_hasta ?? null;
    // D279 · la hora de cierre, opcional (en cualquier versión); sin ella, 23:59.
    const hora = body.hora_cierre;
    if (!nombre || (desde !== null && !esFecha(desde)) || (hasta !== null && !esFecha(hasta))
        || (desde && hasta && desde > hasta) || !clave(body.idempotency_key)
        || (hora !== undefined && !(typeof hora === 'string' && HORA.test(hora)))) throw invalido();
    const pedidos = miembrosPedidos(body.miembros);
    const u = yo();
    // Entra al hash del pedido sólo si vino (contrato).
    const pedido = hashDe({ nombre, fecha_desde: desde, fecha_hasta: hasta, miembros: pedidos, ...(hora !== undefined && { hora_cierre: hora }) });
    const previo = cargar().viajes.find((v) => v.creado_por === u && v.idempotency_key === body.idempotency_key);
    if (previo) {
      if (previo.pedido_hash !== pedido) throw conflicto('idempotency_key_conflict');
      return { contract: CONTRATO, viaje: vistaViaje(previo, u, version) };
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
      ...(typeof hora === 'string' && { hora_cierre: hora }),
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
    return { contract: CONTRATO, viaje: vistaViaje(v, u, version) };
  });
}

/**
 * D255-8 · `POST /api/viajes/:id/miembros`, como el dueño (`invitar`): 1..19 como
 * al crear; quien ya es miembro o está invitado se ignora y a quien rechazó o
 * salió se lo vuelve a invitar. Sólo con el viaje abierto.
 */
export function mockInvitarAlViaje(id: string, body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    if (!objeto(body) || !soloClaves(body, ['miembros'])) throw invalido();
    const pedidos = miembrosPedidos(body.miembros);
    const v = miViaje(id);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    if (limiteDeViajesMock()) throw new Respuesta(429, 'viajes_rate_limited');
    const resueltos = resolverMiembros(pedidos);
    const u = yo();
    const porUsuario = new Map(v.miembros.map((m) => [m.user_id, m]));
    const nuevos = resueltos.filter((p) => !['activo', 'invitado'].includes(porUsuario.get(p.user_id)?.estado ?? ''));
    const ocupados = v.miembros.filter((m) => ['activo', 'invitado'].includes(m.estado) && !m.eliminada).length;
    if (ocupados + nuevos.length > MAX_MIEMBROS) throw conflicto('viaje_members_limit', { limit: MAX_MIEMBROS });
    const t0 = Date.now();
    nuevos.forEach((p, i) => {
      const en = new Date(t0 + i).toISOString();
      const previo = porUsuario.get(p.user_id);
      if (previo) {
        previo.estado = 'invitado';
        previo.invitado_por = u;
        previo.invitado_en = en;
      } else {
        v.miembros.push({
          id: nuevoId(), user_id: p.user_id, estado: 'invitado', invitado_por: u, invitado_en: en, created_at: en,
          first_name: p.first_name, last_name: p.last_name, username: p.username, eliminada: false,
        });
      }
    });
    return { contract: CONTRATO, viaje: vistaViaje(v, u, version) };
  });
}

/**
 * D255 · `PATCH /api/viajes/:id`: nombre, fechas y color, para cualquier miembro
 * activo con el viaje abierto. Al menos un campo; `null` borra una fecha o el
 * color. Contra la fecha guardada, `fecha_desde <= fecha_hasta`.
 */
export function mockEditarViaje(id: string, body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const claves = ['nombre', 'fecha_desde', 'fecha_hasta', 'color', 'hora_cierre'];
    if (!objeto(body) || !soloClaves(body, claves) || Object.keys(body).length === 0) throw invalido();
    const nombre = body.nombre === undefined ? undefined : textoNormal(body.nombre, 80);
    if (body.nombre !== undefined && !nombre) throw invalido();
    for (const k of ['fecha_desde', 'fecha_hasta'] as const) {
      if (body[k] !== undefined && body[k] !== null && !esFecha(body[k])) throw invalido();
    }
    if (body.color !== undefined && body.color !== null && !(COLORES as readonly unknown[]).includes(body.color)) throw invalido();
    // D279 · la hora de cierre: «HH:MM», sin null.
    if (body.hora_cierre !== undefined && !(typeof body.hora_cierre === 'string' && HORA.test(body.hora_cierre))) throw invalido();
    const v = miViaje(id);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    const desde = body.fecha_desde !== undefined ? body.fecha_desde as string | null : v.fecha_desde;
    const hasta = body.fecha_hasta !== undefined ? body.fecha_hasta as string | null : v.fecha_hasta;
    if (desde && hasta && desde > hasta) throw invalido();
    const u = yo();
    if (v.creado_por !== u) {
      // D279 · la hora la elige quien creó el viaje; D-2 · y una fecha hasta que lo dejaría vencido ya es cerrarlo.
      if (body.hora_cierre !== undefined) throw new Respuesta(403, 'viaje_not_creator');
      if (body.fecha_hasta !== undefined && vencido({ ...v, fecha_hasta: hasta })) throw new Respuesta(403, 'viaje_not_creator');
    }
    if (nombre) v.nombre = nombre;
    v.fecha_desde = desde;
    v.fecha_hasta = hasta;
    if (body.color !== undefined) v.color = body.color as string | null;
    if (body.hora_cierre !== undefined) v.hora_cierre = body.hora_cierre as string;
    // Si quien lo creó lo dejó vencido, se cierra en este mismo pedido (como el dueño).
    if (vencido(v)) {
      cerrarInterno(v);
      terminarSiCorresponde(v);
    }
    return { contract: CONTRATO, viaje: vistaViaje(v, u, version) };
  });
}

const FOTO_TIPOS = ['image/jpeg', 'image/png', 'image/webp'];
const FOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * D255 · `PUT /api/viajes/:id/foto`: jpeg, png o webp, hasta 5 MiB. 201 si no
 * había, 200 si la reemplazó. El mock guarda los bytes en memoria (sin
 * re-codificar) y los mismos límites del tipo y el tamaño.
 */
export async function mockSubirFotoDeViaje(id: string, foto: Blob) {
  if (!viajesMockEncendido()) throw new MockApiError(404, 'not_found');
  const r = await ruta(() => {
    if (foto.size < 1) throw new Respuesta(400, 'avatar_file_required');
    if (foto.size > FOTO_MAX_BYTES) throw new Respuesta(413, 'avatar_input_too_large');
    if (!FOTO_TIPOS.includes(foto.type)) throw new Respuesta(415, 'avatar_media_type_unsupported');
    const v = miViaje(id);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    const habia = !!v.foto;
    v.foto = { revision: (v.foto?.revision ?? 0) + 1, width: 512, height: 512, updated_at: ahora() };
    fotosDeViajes.set(v.id, foto);
    return { habia, foto: { ...v.foto } };
  });
  return { status: r.habia ? 200 : 201, cuerpo: { foto: r.foto } };
}

/** D255 · `DELETE /api/viajes/:id/foto`: 204, también si no había. */
export function mockQuitarFotoDeViaje(id: string) {
  return ruta(() => {
    const v = miViaje(id);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    v.foto = null;
    fotosDeViajes.delete(v.id);
    return null;
  });
}

/**
 * D255 · `GET /api/viajes/:id/foto`: sólo a un miembro activo, en cualquier
 * estado. Toda negativa, el mismo 404 `viaje_photo_not_found`. Sin los bytes
 * guardados (lo sembrado o tras recargar), una foto hecha con la inicial.
 */
export async function mockFotoDeViaje(id: string): Promise<{ blob: Blob }> {
  if (!viajesMockEncendido()) throw new MockApiError(404, 'not_found');
  pedidosDeFotosDeViaje += 1;
  if (costuraDeFotos() === 'error') throw new MockApiError(500, 'internal_error');
  const v = viajeDe(id);
  await new Promise((r) => setTimeout(r, latencia()));
  if (!v || !esActivo(v, yo()) || !v.foto) throw new MockApiError(404, 'viaje_photo_not_found');
  return { blob: fotosDeViajes.get(v.id) ?? await jpegDeIniciales(v.nombre.charAt(0) || '?') };
}

export function mockDetalleViaje(id: string, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const v = miViaje(id);
    if (v.estado === 'esperando_pagos' && estadoEfectivo(v) === 'cerrado') terminarSiCorresponde(v);
    return { contract: CONTRATO, viaje: vistaViaje(v, yo(), version) };
  });
}

export function mockAceptarViaje(id: string, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const v = viajeDe(id);
    if (!v) throw noEncontrado();
    const m = v.miembros.find((x) => x.user_id === yo());
    if (m?.estado !== 'activo') {
      if (m?.estado !== 'invitado') throw noEncontrado();
      if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
      m.estado = 'activo';
    }
    return { contract: CONTRATO, viaje: vistaViaje(v, yo(), version) };
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
    const u = yo();
    if (v.estado !== 'abierto') {
      // v2.172.1 · H02 · D242-2: esperando pagos o cerrado, sale quien no tiene transferencias propias sin resolver
      // (como deudor o acreedor). Resuelta es «pagada» (confirmada con «Recibí», D242-1) o anulada por una baja.
      // Salir no borra nada: su miembro pasa a `salio` y sus montos y transferencias quedan.
      const pendientesMias = v.transferencias.filter((tr) => (tr.de_user === u || tr.a_user === u)
        && tr.estado !== 'pagada' && vivoUser(v, tr.de_user) && vivoUser(v, tr.a_user)).length;
      if (pendientesMias > 0) throw conflicto('viaje_member_transfers_pending', { pendientes: pendientesMias });
      v.miembros.find((x) => x.user_id === u)!.estado = 'salio';
      return { contract: CONTRATO, viaje_id: v.id, estado: 'salio' };
    }
    const eligio = v.tickets.some((t) => t.selecciones.some((s) => s.user_id === u));
    const pago = v.tickets.some((t) => esPagador(t, u));
    const presente = v.tickets.some((t) => t.forma === 'iguales' && t.personas.some((p) => p.user_id === u && p.presente));
    const motivo = eligio ? 'selection' : pago ? 'paid_ticket' : presente ? 'present_in_equal_split' : null;
    if (motivo) throw conflicto('viaje_member_cannot_leave', { reason: motivo });
    for (const t of v.tickets) t.personas = t.personas.filter((p) => p.user_id !== u);
    v.miembros.find((x) => x.user_id === u)!.estado = 'salio';
    return { contract: CONTRATO, viaje_id: v.id, estado: 'salio' };
  });
}

// ─── Tickets ──────────────────────────────────────────────────────────────

/**
 * El recibo del mock (`or1.<payload>.<firma>`): el mock no verifica la firma (no tiene la clave). D278-2 · D284 · los
 * ajustes salen del recibo (como el dueño, nunca del cuerpo).
 */
function verificarRecibo(raw: unknown): {
  id: string; huella: string | null; ajustes: { servicio_cents: number; descuentos_cents: number; iva_aparte_cents: number };
} {
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
  const t = Array.isArray(payload.t) ? payload.t as Array<number | null> : null;
  const ajustes = ajustesDeRecibo({
    items: Array.isArray(payload.items) ? payload.items as Array<[unknown, number, number]> : [],
    totales: t ? { subtotal_cents: t[0] as number, ...(t[1] !== null && t[1] !== undefined && { tax_cents: t[1] }) } : null,
    descuentos: Array.isArray(payload.d) ? payload.d as number[] : null,
    servicios: Array.isArray(payload.s) ? payload.s as number[] : null,
  });
  return { id: payload.jti, huella: typeof payload.h === 'string' ? payload.h : null, ajustes };
}

/**
 * D276 · sólo lo que quien escanea puede ver: si la huella es la del personal de otro, para él no existe y se devuelve
 * `personalAjeno`, para que la carga le libere la huella (como el dueño).
 */
function buscarDuplicado(v: ViajeMock, recibo: { id: string; huella: string | null }):
  { otroViaje?: true; ticket?: TicketMock; personalAjeno?: TicketMock } {
  for (const w of cargar().viajes) {
    const t = w.tickets.find((x) => x.recibo_jti === recibo.id);
    if (t) return w.id === v.id ? { ticket: t } : { otroViaje: true };
  }
  if (!recibo.huella) return {};
  const t = v.tickets.find((x) => x.huella === recibo.huella);
  if (!t) return {};
  return loVe(v, t, yo()) ? { ticket: t } : { personalAjeno: t };
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
  if (!objeto(body) || !soloClaves(body, ['ocr_receipt', 'idempotency_key', 'forma', 'tipo_lugar', 'lugar', 'fecha_ticket', 'hora_ticket', 'items', 'pagado_por', 'pagadores', 'presentes'])) throw invalido();
  // D276 · quiénes estuvieron: 1..20 ids de miembro, sin repetir. Sin el campo, todos.
  const presentes = body.presentes;
  if (presentes !== undefined && (!Array.isArray(presentes) || presentes.length < 1 || presentes.length > MAX_MIEMBROS
      || !presentes.every(esUuid) || new Set(presentes).size !== presentes.length)) throw invalido();
  if (body.pagado_por !== undefined && !esUuid(body.pagado_por)) throw invalido();
  const pagadores = pagadoresPedidos(body);
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
    pagado_por: body.pagado_por as string | undefined,
    pagadores,
    presentes: presentes as string[] | undefined,
  };
}

/**
 * D263 · `pagadores`, en lugar de `pagado_por` (los dos juntos: 400): 1..20 de `{miembro_id, monto_cents?}`, sin
 * repetir, todos con monto o ninguno, montos enteros 1..100000000. Si no, 400.
 */
type PagadorPedidoMock = { miembro_id: string; monto_cents?: number };
function pagadoresPedidos(body: Record<string, unknown>): PagadorPedidoMock[] | undefined {
  const xs = body.pagadores;
  if (xs === undefined) return undefined;
  if (body.pagado_por !== undefined || !Array.isArray(xs) || xs.length < 1 || xs.length > MAX_MIEMBROS) throw invalido();
  const lista = xs.map((x) => {
    if (!objeto(x) || !soloClaves(x, ['miembro_id', 'monto_cents']) || !esUuid(x.miembro_id)) throw invalido();
    const m = x.monto_cents;
    if (m !== undefined && (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > MAX_GASTO_CENTS)) throw invalido();
    return { miembro_id: x.miembro_id as string, ...(m !== undefined && { monto_cents: m as number }) };
  });
  if (new Set(lista.map((x) => x.miembro_id)).size !== lista.length) throw invalido();
  const conMonto = lista.filter((x) => x.monto_cents !== undefined).length;
  if (conMonto !== 0 && conMonto !== lista.length) throw invalido();
  return lista;
}

/**
 * D263 · quiénes pagaron, contra el total: cada uno un miembro activo (si no, 422 `viaje_ticket_payer_unknown` con su
 * id). Sin montos, partes iguales con el centavo de más a los primeros; con montos, tienen que sumar el total. Cada uno
 * paga al menos un centavo; si no, 422 `viaje_ticket_payers_total_mismatch` con el total. Con uno solo, es `pagado_por`.
 */
function pagadoresResueltos(v: ViajeMock, pagadoPor: string | undefined, pedidos: PagadorPedidoMock[] | undefined, u: string, total: number):
  { pagado_por: string; pagadores?: Array<{ user_id: string; monto_cents: number }> } {
  if (!pedidos) return { pagado_por: pagadorDe(v, pagadoPor, u) };
  const users = pedidos.map((p) => pagadorDe(v, p.miembro_id, u));
  let montos: number[];
  if (pedidos[0]!.monto_cents === undefined) {
    const base = Math.floor(total / pedidos.length);
    montos = pedidos.map((_, i) => base + (i < total - base * pedidos.length ? 1 : 0));
  } else {
    montos = pedidos.map((p) => p.monto_cents!);
  }
  if (montos.some((m) => m < 1) || montos.reduce((s, m) => s + m, 0) !== total) {
    throw new Respuesta(422, 'viaje_ticket_payers_total_mismatch', { monto_cents: total });
  }
  if (users.length === 1) return { pagado_por: users[0]! };
  return { pagado_por: users[0]!, pagadores: users.map((x, i) => ({ user_id: x, monto_cents: montos[i]! })) };
}

export function mockCargarTicket(id: string, body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const b = cuerpoTicket(body);
    const recibo = (() => { try { return { ok: verificarRecibo(b.ocr_receipt) } as const; } catch (e) { return { error: e } as const; } })();
    const v = miViaje(id);
    const u = yo();
    const pedido = hashDe({ forma: b.forma, tipo_lugar: b.tipo_lugar, lugar: b.lugar, fecha_ticket: b.fecha_ticket,
      hora_ticket: b.hora_ticket, items: b.items, recibo: b.ocr_receipt, pagado_por: b.pagado_por ?? null,
      // D263 · entra al hash sólo si vino.
      ...(b.pagadores !== undefined && { pagadores: b.pagadores }),
      // D276 · los presentes, sólo si vinieron.
      ...(b.presentes !== undefined && { presentes: b.presentes }) });
    // D255-6 · la idempotencia es de quien carga.
    const previo = v.tickets.find((t) => cargadoPor(t) === u && t.idempotency_key === b.idempotency_key);
    if (previo) {
      if (previo.pedido_hash !== pedido) throw conflicto('idempotency_key_conflict');
      return { contract: CONTRATO, ticket: vistaTicket(v, previo, u, version), ya_cargado: null };
    }
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    if ('error' in recibo) throw recibo.error;
    const dup = buscarDuplicado(v, recibo.ok);
    if (dup.otroViaje) throw conflicto('viaje_ticket_receipt_used');
    if (dup.ticket) return { contract: CONTRATO, ticket: vistaTicket(v, dup.ticket, u, version), ya_cargado: yaCargado(v, dup.ticket) };
    // D276 · la huella es del personal de otro: se le libera y este entra como nuevo.
    if (dup.personalAjeno) dup.personalAjeno.huella = null;
    if (v.tickets.length >= MAX_TICKETS) throw conflicto('viaje_tickets_limit', { limit: MAX_TICKETS });
    const monto = b.items.reduce((s, i) => s + lineaDe(i), 0);
    if (!Number.isSafeInteger(monto) || monto <= 0) throw new Respuesta(422, 'viaje_ticket_amount_invalid');
    // D278-2 · D284 · con un cliente 9, el servicio, los descuentos y el IVA aparte del recibo; con ≤ 8, ninguno.
    const ajustes = version >= 9 ? recibo.ok.ajustes : { servicio_cents: 0, descuentos_cents: 0, iva_aparte_cents: 0 };
    const total = monto + ajustes.servicio_cents + ajustes.iva_aparte_cents - ajustes.descuentos_cents;
    if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_GASTO_CENTS) throw new Respuesta(422, 'viaje_ticket_amount_invalid');
    // Los pagadores suman el total impreso (sin ajustes, los renglones, como siempre).
    const quien = pagadoresResueltos(v, b.pagado_por, b.pagadores, u, total);
    // D276 · quiénes estuvieron, ids de miembros activos (el 422 de siempre si no); sin el campo, todos.
    const activos = miembrosEnOrden(v).filter((m) => m.estado === 'activo' && !m.eliminada);
    const porMiembro = new Map(activos.map((m) => [m.id, m.user_id]));
    const desconocido = (b.presentes ?? []).find((x) => !porMiembro.has(x));
    if (desconocido) throw new Respuesta(422, 'viaje_ticket_persona_unknown', { miembro_id: desconocido });
    const estuvieron = new Set(b.presentes ? b.presentes.map((x) => porMiembro.get(x)) : activos.map((m) => m.user_id));
    const t: TicketMock = {
      id: nuevoId(), ...quien, ...(quien.pagado_por !== u && { cargado_por: u }), forma: b.forma, tipo_lugar: b.tipo_lugar, lugar: b.lugar,
      fecha_ticket: b.fecha_ticket, hora_ticket: b.hora_ticket, monto_cents: monto, created_at: ahora(),
      ...(version >= 9 && ajustes),
      huella: recibo.ok.huella, recibo_jti: recibo.ok.id, idempotency_key: b.idempotency_key, pedido_hash: pedido,
      items: b.items.map((i) => ({ id: nuevoId(), nombre: i.name, price_cents: i.price_cents, quantity: i.quantity })),
      personas: activos.map((m) => ({
        user_id: m.user_id, presente: estuvieron.has(m.user_id), listo_en: null, consumo_final_cents: null, asignado_cierre_cents: null,
      })),
      selecciones: [],
    };
    v.tickets.push(t);
    return { contract: CONTRATO, ticket: vistaTicket(v, t, u, version), ya_cargado: null };
  });
}

/**
 * D244 · `POST /api/viajes/:id/gastos` (App Backend 2.172.0, `cargarGasto`):
 * descripción, monto y entre quiénes. Lo pagó quien lo carga; se guarda como un
 * ticket «En partes iguales» de tipo «otro», con la descripción como lugar y
 * único renglón, y las personas activas con `presente` sólo en las elegidas.
 * La idempotencia es por la clave; la regla anti-duplicado del escaneo no aplica.
 */
/**
 * D255-6 · `pagado_por`: un id de miembro activo con la cuenta viva. Sin él,
 * quien carga. Si no vale, 422 `viaje_ticket_payer_unknown` con el id tal como
 * vino.
 */
function pagadorDe(v: ViajeMock, pagadoPor: string | undefined, u: string): string {
  if (pagadoPor === undefined) return u;
  const m = v.miembros.find((x) => x.id === pagadoPor && x.estado === 'activo' && !x.eliminada);
  if (!m) throw new Respuesta(422, 'viaje_ticket_payer_unknown', { miembro_id: pagadoPor });
  return m.user_id;
}

export function mockCargarGasto(id: string, body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const claves = ['descripcion', 'monto_cents', 'presentes', 'idempotency_key'];
    if (!objeto(body) || !soloClaves(body, [...claves, 'pagado_por', 'pagadores'])
        || !claves.every((k) => k in body)) throw invalido();
    if (body.pagado_por !== undefined && !esUuid(body.pagado_por)) throw invalido();
    const pagadoPor = body.pagado_por as string | undefined;
    const pagadores = pagadoresPedidos(body);
    const descripcion = textoNormal(body.descripcion, 120);
    const monto = body.monto_cents;
    const presentes = body.presentes;
    if (!descripcion || typeof monto !== 'number' || !Number.isInteger(monto) || monto < 1 || monto > MAX_GASTO_CENTS
        || !Array.isArray(presentes) || presentes.length < 1 || presentes.length > MAX_MIEMBROS
        || !presentes.every(esUuid) || new Set(presentes).size !== presentes.length
        || !clave(body.idempotency_key)) throw invalido();
    const v = miViaje(id);
    const u = yo();
    const pedido = hashDe({ gasto: true, descripcion, monto_cents: monto, presentes, pagado_por: pagadoPor ?? null,
      ...(pagadores !== undefined && { pagadores }) });
    // D255-6 · la idempotencia es de quien carga.
    const previo = v.tickets.find((t) => cargadoPor(t) === u && t.idempotency_key === body.idempotency_key);
    if (previo) {
      if (previo.pedido_hash !== pedido) throw conflicto('idempotency_key_conflict');
      return { contract: CONTRATO, ticket: vistaTicket(v, previo, u, version), ya_cargado: null };
    }
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    if (v.tickets.length >= MAX_TICKETS) throw conflicto('viaje_tickets_limit', { limit: MAX_TICKETS });
    if (seamDeGastoMock('alguien_salio')) {
      // El seam: el último elegido que no soy yo salió del viaje mientras se llenaba el formulario.
      const sale = [...miembrosEnOrden(v)].reverse().find((m) => m.estado === 'activo' && m.user_id !== u && presentes.includes(m.id));
      if (sale) sale.estado = 'salio';
    }
    const activos = miembrosEnOrden(v).filter((m) => m.estado === 'activo' && !m.eliminada);
    const porMiembro = new Map(activos.map((m) => [m.id, m.user_id]));
    const desconocido = presentes.find((x) => !porMiembro.has(x));
    if (desconocido) throw new Respuesta(422, 'viaje_ticket_persona_unknown', { miembro_id: desconocido });
    const elegidos = new Set(presentes.map((x) => porMiembro.get(x)));
    const quien = pagadoresResueltos(v, pagadoPor, pagadores, u, monto);
    const t: TicketMock = {
      id: nuevoId(), ...quien, ...(quien.pagado_por !== u && { cargado_por: u }), forma: 'iguales', tipo_lugar: 'otro', lugar: descripcion,
      fecha_ticket: null, hora_ticket: null, monto_cents: monto, created_at: ahora(), huella: null,
      recibo_jti: `${PREFIJO_GASTO_MANUAL}${nuevoId().replace(/-/g, '').slice(0, 20)}`,
      idempotency_key: body.idempotency_key, pedido_hash: pedido,
      items: [{ id: nuevoId(), nombre: descripcion, price_cents: monto, quantity: 1 }],
      personas: activos.map((m) => ({
        user_id: m.user_id, presente: elegidos.has(m.user_id), listo_en: null, consumo_final_cents: null, asignado_cierre_cents: null,
      })),
      selecciones: [],
    };
    v.tickets.push(t);
    // El seam: quedó guardado y la respuesta se perdió. El reintento con la misma llave es el mismo gasto.
    if (seamDeGastoMock('respuesta_perdida')) throw new Respuesta(500, 'internal_error');
    return { contract: CONTRATO, ticket: vistaTicket(v, t, u, version), ya_cargado: null };
  });
}

/**
 * D245 · `GET /api/viajes/:id/miembros/:mid/avatar`: sólo a un miembro activo y
 * de un miembro activo con foto. Toda negativa, el mismo 404. Costura de fotos
 * del mock (`payme.app.mock.fotos.v1 = error`): 500.
 */
export async function mockAvatarDeMiembro(id: string, miembroId: string): Promise<{ blob: Blob }> {
  if (!viajesMockEncendido()) throw new MockApiError(404, 'not_found');
  pedidosDeFotosDeViaje += 1;
  if (costuraDeFotos() === 'error') throw new MockApiError(500, 'internal_error');
  const v = viajeDe(id);
  const u = yo();
  const m = v && esActivo(v, u) ? v.miembros.find((x) => x.id === miembroId && x.estado === 'activo') : undefined;
  if (!m || m.eliminada || !CON_FOTO.has(m.user_id)) {
    await new Promise((r) => setTimeout(r, latencia()));
    throw new MockApiError(404, 'avatar_not_found');
  }
  const blob = await jpegDeIniciales(m.first_name.charAt(0) || '?');
  await new Promise((r) => setTimeout(r, latencia()));
  return { blob };
}

let pedidosDeFotosDeViaje = 0;
/** Para las pruebas: cuántas fotos de miembros se pidieron. */
export function pedidosDeFotosDeViajeMock(): number {
  return pedidosDeFotosDeViaje;
}

function costuraDeFotos(): string | null {
  try { return localStorage.getItem('payme.app.mock.fotos.v1'); } catch { return null; }
}

function ticketDe(v: ViajeMock, tid: unknown): TicketMock {
  const t = esUuid(tid) ? v.tickets.find((x) => x.id === tid) : undefined;
  // D276: el personal de otro es el mismo 404 de un ticket que no está.
  if (!t || !loVe(v, t, yo())) throw new Respuesta(404, 'viaje_ticket_not_found');
  return t;
}

export function mockVerTicket(id: string, tid: string, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const v = miViaje(id);
    const t = ticketDe(v, tid);
    // V-02 (2.179.2) · desde la 7, con el viaje en Cerrados, el mismo ticket en sólo lectura (la vista congelada:
    // sin elegir ni marcar, sin repartir 0); hasta la 6, el 409 de siempre.
    if (estadoEfectivo(v) === 'cerrado' && version < 7) throw conflicto('viaje_closed');
    return { contract: CONTRATO, ticket: vistaTicket(v, t, yo(), version) };
  });
}

export function mockElegirEnTicket(id: string, tid: string, body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
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
    // D276 · un personal es todo de su dueño, sin elegir (el de otro ya fue el 404 de `ticketDe`).
    if (esPersonalMock(v, t)) throw conflicto('viaje_ticket_personal');
    const p = t.personas.find((x) => x.user_id === u);
    if (!p) throw conflicto('viaje_ticket_not_in_snapshot');
    // D276-4 · el seam: me desmarcaron justo antes (sin elecciones mías, como exige el dueño).
    if (seamDeSeleccionMock('me_desmarcaron')) {
      p.presente = false;
      t.selecciones = t.selecciones.filter((x) => x.user_id !== u);
    }
    // D276 · sólo eligen los que estuvieron.
    if (!p.presente) throw conflicto('viaje_ticket_not_present');
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
    return { contract: CONTRATO, ticket: vistaTicket(v, t, u, version) };
  });
}

export function mockMarcarPresentes(id: string, tid: string, body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    if (!objeto(body) || !soloClaves(body, ['presentes']) || !Array.isArray(body.presentes)
        || body.presentes.length < 1 || body.presentes.length > MAX_MIEMBROS
        || !body.presentes.every(esUuid) || new Set(body.presentes).size !== body.presentes.length) throw invalido();
    const presentes = body.presentes as string[];
    const v = miViaje(id);
    const t = ticketDe(v, tid);
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    // D276 · en las tres formas (ya no sale `viaje_ticket_not_equal_split`).
    if (!esPagador(t, yo()) && cargadoPor(t) !== yo()) throw conflicto('viaje_ticket_not_yours');
    const porMiembro = new Map(t.personas.map((p) => [v.miembros.find((m) => m.user_id === p.user_id)?.id, p.user_id]));
    const desconocido = presentes.find((x) => !porMiembro.has(x));
    if (desconocido) throw new Respuesta(422, 'viaje_ticket_persona_unknown', { miembro_id: desconocido });
    const marcados = new Set(presentes.map((x) => porMiembro.get(x)));
    if (t.forma === 'consumo') {
      // D276 · no se desmarca a quien ya eligió algo: nunca se borran elecciones ajenas.
      const conEleccion = new Set(t.selecciones.map((x) => x.user_id));
      const quitado = t.personas.find((p) => conEleccion.has(p.user_id) && !marcados.has(p.user_id));
      if (quitado) {
        throw conflicto('viaje_ticket_persona_ya_eligio', { miembro_id: v.miembros.find((m) => m.user_id === quitado.user_id)?.id ?? null });
      }
    }
    for (const p of t.personas) p.presente = marcados.has(p.user_id);
    return { contract: CONTRATO, ticket: vistaTicket(v, t, yo(), version) };
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
      // D276 · sin los personales, que no son del viaje.
      tickets: v.tickets.filter((t) => !esPersonalMock(v, t)).length,
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
  v.cerrado_en = ahora();
}

/**
 * D256 · `DELETE /api/viajes/:id/tickets/:tid` (App Backend 2.175.0): eliminar un ticket escaneado o un gasto a mano.
 * El orden del dueño: no miembro → 404 del viaje (n325); el ticket no es del viaje → 404 `viaje_ticket_not_found`; el
 * viaje no está abierto → 409; no lo cargó ni lo pagó → 403. Se elimina aunque otros hayan elegido, y la cuenta se
 * recalcula al leer. El aviso `viaje_ticket_removed` va a los demás, que en el mock no tienen bandeja.
 */
export function mockEliminarTicket(id: string, ticketId: string, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const v = miViaje(id);
    if (seamDeEliminarMock('sin_viaje')) throw noEncontrado();
    const u = yo();
    // D276 · el personal de otro, para mí, no existe: el mismo 404.
    const i = v.tickets.findIndex((t) => t.id === ticketId && loVe(v, t, u));
    if (i >= 0 && seamDeEliminarMock('ya_no_estaba')) {
      // El seam: otro lo eliminó justo antes.
      v.tickets.splice(i, 1);
      guardar();
      throw new Respuesta(404, 'viaje_ticket_not_found');
    }
    if (i < 0) throw new Respuesta(404, 'viaje_ticket_not_found');
    if (v.estado !== 'abierto' || seamDeEliminarMock('cerrado')) {
      throw conflicto('viaje_not_open', { estado: v.estado === 'abierto' ? 'esperando_pagos' : v.estado });
    }
    const t = v.tickets[i]!;
    if ((!esPagador(t, u) && cargadoPor(t) !== u) || seamDeEliminarMock('prohibido')) {
      throw new Respuesta(403, 'viaje_ticket_delete_forbidden');
    }
    v.tickets.splice(i, 1);
    guardar();
    return { contract: CONTRATO, viaje: vistaViaje(v, u, version) };
  });
}

/**
 * D278-3 · D282-2 · el pedido de `PATCH …/tickets/:tid` (`cuerpoCorregirTicket` / `cuerpoCorregirGasto` del dueño): todo
 * opcional, al menos un campo, y sólo los de su tipo de ticket (una clave del otro da 400). Los renglones, la lista
 * completa de 1 a 100, sin repetir id.
 */
type RenglonPedidoMock = { id?: string; name: string; price_cents: number; quantity: number };
function cuerpoCorregir(body: unknown, manual: boolean) {
  const claves = manual
    ? ['descripcion', 'monto_cents', 'pagadores']
    : ['lugar', 'tipo_lugar', 'fecha_ticket', 'hora_ticket', 'items', 'servicio_cents', 'descuentos_cents', 'iva_aparte_cents', 'pagadores'];
  if (!objeto(body) || !soloClaves(body, claves) || Object.keys(body).length === 0) throw invalido();
  const pagadores = pagadoresPedidos(body);
  const importe = (x: unknown, min: number) => x === undefined
    || (typeof x === 'number' && Number.isSafeInteger(x) && x >= min && x <= MAX_GASTO_CENTS);
  const lugar = body.lugar === undefined || body.lugar === null ? body.lugar : textoNormal(body.lugar, 120);
  const descripcion = body.descripcion === undefined ? undefined : textoNormal(body.descripcion, 120);
  if (lugar === null && body.lugar !== null) throw invalido();
  if (descripcion === null) throw invalido();
  if (body.tipo_lugar !== undefined && !(TIPOS_LUGAR as readonly unknown[]).includes(body.tipo_lugar)) throw invalido();
  if (body.fecha_ticket !== undefined && body.fecha_ticket !== null && !esFecha(body.fecha_ticket)) throw invalido();
  if (body.hora_ticket !== undefined && body.hora_ticket !== null
      && !(typeof body.hora_ticket === 'string' && HORA.test(body.hora_ticket))) throw invalido();
  if (!importe(body.monto_cents, 1) || !importe(body.servicio_cents, 0) || !importe(body.descuentos_cents, 0)
      || !importe(body.iva_aparte_cents, 0)) throw invalido();
  let items: RenglonPedidoMock[] | undefined;
  if (body.items !== undefined) {
    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) throw invalido();
    items = body.items.map((i): RenglonPedidoMock => {
      if (!objeto(i) || !soloClaves(i, ['id', 'name', 'price_cents', 'quantity'])) throw invalido();
      const name = textoNormal(i.name, 200);
      if ((i.id !== undefined && !esUuid(i.id)) || !name || typeof i.price_cents !== 'number' || !Number.isSafeInteger(i.price_cents)
          || i.price_cents < 0 || typeof i.quantity !== 'number' || !Number.isInteger(i.quantity) || i.quantity < 1
          || i.quantity > 32767) throw invalido();
      return { ...(i.id !== undefined && { id: i.id as string }), name, price_cents: i.price_cents, quantity: i.quantity };
    });
    const ids = items.filter((i) => i.id).map((i) => i.id);
    if (new Set(ids).size !== ids.length) throw invalido();
  }
  return {
    lugar: lugar as string | null | undefined, descripcion, items, pagadores,
    tipo_lugar: body.tipo_lugar as TipoLugar | undefined,
    fecha_ticket: body.fecha_ticket as string | null | undefined, hora_ticket: body.hora_ticket as string | null | undefined,
    monto_cents: body.monto_cents as number | undefined, servicio_cents: body.servicio_cents as number | undefined,
    descuentos_cents: body.descuentos_cents as number | undefined, iva_aparte_cents: body.iva_aparte_cents as number | undefined,
  };
}

/**
 * D278-3 · D282-2 · `PATCH /api/viajes/:id/tickets/:tid` (App Backend 2.182.0, `corregirTicket`): corrige un ticket ya
 * cargado. Lo corrigen quien lo cargó o cualquiera de los que pagaron; un personal, su dueño; con el viaje abierto.
 *
 * - El orden de errores: 404 del viaje (n325) → 404 del ticket → 409 `viaje_not_open` → 403
 *   `viaje_ticket_edit_forbidden` → la validación (400/422). El mock no tiene cuentas suspendidas.
 * - Los topes de la carga: cada precio y la suma de los renglones hasta $1,000,000 y mayor que 0; el total impreso,
 *   mayor que 0 y hasta $1,000,000 (422 `viaje_ticket_amount_invalid`); y el viaje no pasa su tope, contando sólo lo que
 *   el ticket suma de más (409 `viaje_total_limit`).
 * - Con dos o más pagadores y otro total, `pagadores` es obligatorio y suma el total nuevo (422
 *   `viaje_ticket_payers_total_mismatch` con el total nuevo).
 * - Un renglón con otro precio o cantidad, o sacado, borra sus elecciones y quien las perdió pierde su «Listo». El nombre
 *   o el orden solos no borran nada.
 * - Idempotente por contenido: un renglón nuevo igual a uno existente que el pedido no nombra es ese mismo; sin cambios,
 *   el ticket como estaba.
 * - Si la corrección lo deja como el personal de otro (quien pagó lo deja sólo de quien lo cargó), se guarda y, como deja
 *   de verlo, el 404.
 * El aviso `viaje_ticket_corregido` va a los demás, que en el mock no tienen bandeja.
 */
export function mockCorregirTicket(id: string, tid: string, body: unknown, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const v = miViaje(id);
    const u = yo();
    const i = v.tickets.findIndex((t) => t.id === tid && loVe(v, t, u));
    if (i >= 0 && seamDeCorregirMock('ya_no_estaba')) {
      // El seam: otro lo eliminó justo antes.
      v.tickets.splice(i, 1);
      throw new Respuesta(404, 'viaje_ticket_not_found');
    }
    const t = ticketDe(v, tid);
    if (v.estado !== 'abierto' || seamDeCorregirMock('cerrado')) {
      throw conflicto('viaje_not_open', { estado: v.estado === 'abierto' ? 'esperando_pagos' : v.estado });
    }
    if ((!esPagador(t, u) && cargadoPor(t) !== u) || seamDeCorregirMock('prohibido')) {
      throw new Respuesta(403, 'viaje_ticket_edit_forbidden');
    }
    const manual = esManual(t);
    const b = cuerpoCorregir(body, manual);
    const ajusteViejo = { servicio_cents: t.servicio_cents ?? 0, descuentos_cents: t.descuentos_cents ?? 0, iva_aparte_cents: t.iva_aparte_cents ?? 0 };
    const nuevo = {
      lugar: manual ? (b.descripcion ?? t.lugar) : (b.lugar !== undefined ? b.lugar : t.lugar),
      tipo: b.tipo_lugar ?? t.tipo_lugar,
      fecha: b.fecha_ticket !== undefined ? b.fecha_ticket : t.fecha_ticket,
      hora: b.hora_ticket !== undefined ? b.hora_ticket : t.hora_ticket,
      servicio_cents: b.servicio_cents ?? ajusteViejo.servicio_cents,
      descuentos_cents: b.descuentos_cents ?? ajusteViejo.descuentos_cents,
      iva_aparte_cents: b.iva_aparte_cents ?? ajusteViejo.iva_aparte_cents,
    };
    if (nuevo.hora && !nuevo.fecha) throw invalido();
    // Los renglones: lo pedido contra lo que hay.
    const viejos = t.items;
    const porId = new Map(viejos.map((x) => [x.id, x]));
    const pedidos: RenglonPedidoMock[] | null = manual
      ? (b.descripcion !== undefined || b.monto_cents !== undefined
        ? [{ id: viejos[0]!.id, name: b.descripcion ?? viejos[0]!.nombre, price_cents: b.monto_cents ?? viejos[0]!.price_cents, quantity: 1 }]
        : null)
      : b.items ?? null;
    let plan: { final: Array<Omit<RenglonPedidoMock, 'id'> & { id: string | null }>; sacados: string[]; cambiados: string[] } | null = null;
    if (pedidos) {
      const desconocido = pedidos.find((p) => p.id && !porId.has(p.id));
      if (desconocido) throw new Respuesta(422, 'viaje_ticket_item_unknown', { item_id: desconocido.id });
      const nombrados = new Set(pedidos.filter((p) => p.id).map((p) => p.id));
      const libres = viejos.filter((x) => !nombrados.has(x.id));
      // Idempotencia por contenido: un renglón nuevo igual a uno existente que el pedido no nombra es ese mismo (en orden).
      const final = pedidos.map((p) => {
        if (p.id) return { ...p, id: p.id };
        const k = libres.findIndex((x) => x.nombre === p.name && x.price_cents === p.price_cents && x.quantity === p.quantity);
        return { ...p, id: k >= 0 ? libres.splice(k, 1)[0]!.id : null };
      });
      const quedan = new Set(final.filter((p) => p.id).map((p) => p.id));
      plan = {
        final,
        sacados: viejos.filter((x) => !quedan.has(x.id)).map((x) => x.id),
        // «Cambió»: el mismo renglón con otro precio o cantidad. El nombre solo, no.
        cambiados: final.filter((p) => p.id && (porId.get(p.id)!.price_cents !== p.price_cents || porId.get(p.id)!.quantity !== p.quantity))
          .map((p) => p.id!),
      };
    }
    const final = plan ? plan.final : viejos.map((x) => ({ id: x.id, name: x.nombre, price_cents: x.price_cents, quantity: x.quantity }));
    // Los topes de la carga.
    const montoInvalido = () => new Respuesta(422, 'viaje_ticket_amount_invalid');
    let monto = 0;
    for (const x of final) {
      if (x.price_cents > MAX_GASTO_CENTS) throw montoInvalido();
      monto += lineaDe(x);
    }
    if (!Number.isSafeInteger(monto) || monto <= 0 || monto > MAX_GASTO_CENTS) throw montoInvalido();
    const totalViejo = totalDelTicket(t);
    const total = monto + nuevo.servicio_cents + nuevo.iva_aparte_cents - nuevo.descuentos_cents;
    if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_GASTO_CENTS) throw montoInvalido();
    const delViaje = v.tickets.reduce((s, x) => s + totalDelTicket(x), 0);
    if ((total > totalViejo && delViaje + (total - totalViejo) > MAX_TOTAL_CENTS) || seamDeCorregirMock('tope_del_viaje')) {
      throw conflicto('viaje_total_limit', { limit: MAX_TOTAL_CENTS });
    }
    // Los pagadores: con dos o más y otro total, hay que mandarlos (no se reparte por inferencia lo que dijo cada uno).
    let pagos: Array<{ user_id: string; monto_cents: number }> | null = null;
    if (b.pagadores !== undefined) {
      const r = pagadoresResueltos(v, undefined, b.pagadores, u, total);
      pagos = r.pagadores ?? [{ user_id: r.pagado_por, monto_cents: total }];
    } else if ((total !== totalViejo && (t.pagadores?.length ?? 0) >= 2) || seamDeCorregirMock('cambio_el_total')) {
      throw new Respuesta(422, 'viaje_ticket_payers_total_mismatch', { monto_cents: total });
    }
    const listaVieja = t.pagadores && t.pagadores.length >= 2 ? t.pagadores : [{ user_id: t.pagado_por, monto_cents: totalViejo }];
    const cambianPagadores = !!pagos && (pagos.length !== listaVieja.length
      || pagos.some((p, k) => p.user_id !== listaVieja[k]!.user_id || p.monto_cents !== listaVieja[k]!.monto_cents));
    if (cambianPagadores && pagos![0]!.user_id !== t.pagado_por
        && v.tickets.some((x) => x.id !== t.id && x.pagado_por === pagos![0]!.user_id && x.idempotency_key === t.idempotency_key)) {
      throw conflicto('idempotency_key_conflict');
    }
    // ¿Cambia algo? Si no, el ticket como estaba, sin tocar nada.
    const cambiaElTicket = nuevo.lugar !== t.lugar || nuevo.tipo !== t.tipo_lugar || nuevo.fecha !== t.fecha_ticket
      || nuevo.hora !== t.hora_ticket || monto !== t.monto_cents
      || (['servicio_cents', 'descuentos_cents', 'iva_aparte_cents'] as const).some((k) => nuevo[k] !== ajusteViejo[k]);
    const cambianRenglones = !!plan && (plan.sacados.length > 0 || plan.final.some((p, k) => {
      const v0 = p.id ? porId.get(p.id) : undefined;
      return !v0 || v0.nombre !== p.name || v0.price_cents !== p.price_cents || v0.quantity !== p.quantity || viejos.indexOf(v0) !== k;
    }));
    if (!cambiaElTicket && !cambianRenglones && !cambianPagadores) return { contract: CONTRATO, ticket: vistaTicket(v, t, u, version) };
    // Las elecciones de lo que cambió o se sacó se borran; quien las perdió vuelve a «falta elegir».
    if (plan) {
      const tocados = new Set([...plan.sacados, ...plan.cambiados]);
      const perdieron = new Set(t.selecciones.filter((x) => tocados.has(x.item_id)).map((x) => x.user_id));
      t.selecciones = t.selecciones.filter((x) => !tocados.has(x.item_id));
      t.items = plan.final.map((p) => (p.id
        ? { ...porId.get(p.id)!, nombre: p.name, price_cents: p.price_cents, quantity: p.quantity }
        : { id: nuevoId(), nombre: p.name, price_cents: p.price_cents, quantity: p.quantity }));
      for (const p of t.personas) if (perdieron.has(p.user_id)) p.listo_en = null;
    }
    t.lugar = nuevo.lugar;
    t.tipo_lugar = nuevo.tipo;
    t.fecha_ticket = nuevo.fecha;
    t.hora_ticket = nuevo.hora;
    t.monto_cents = monto;
    t.servicio_cents = nuevo.servicio_cents;
    t.descuentos_cents = nuevo.descuentos_cents;
    t.iva_aparte_cents = nuevo.iva_aparte_cents;
    if (cambianPagadores) {
      // Quien lo cargó no cambia: sin `cargado_por`, era quien pagaba hasta ahora.
      if (!t.cargado_por) t.cargado_por = t.pagado_por;
      t.pagado_por = pagos![0]!.user_id;
      if (pagos!.length >= 2) t.pagadores = pagos!;
      else delete t.pagadores;
    }
    // Quedó como el personal de otro: se guardó, y quien corrige deja de verlo.
    if (!loVe(v, t, u)) throw new Respuesta(404, 'viaje_ticket_not_found');
    return { contract: CONTRATO, ticket: vistaTicket(v, t, u, version) };
  });
}

export function mockCerrarViaje(id: string, { version = 1 }: OpcionesDeVersion = {}) {
  return ruta(() => {
    const v = miViaje(id);
    // D279 · cierra sólo quien lo creó, en todas las versiones: después del 404 y antes del 409.
    if (v.creado_por !== yo()) throw new Respuesta(403, 'viaje_not_creator');
    if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
    cerrarInterno(v);
    terminarSiCorresponde(v);
    return { contract: CONTRATO, viaje: vistaViaje(v, yo(), version) };
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
    // D276 · decisión B: el personal no entra al resumen (ni a sus totales ni a `lugares`).
    for (const t of ticketsEnOrden(v).filter((x) => !esPersonalMock(v, x))) {
      const mio = b.porTicket.get(t.id)!.consumo.get(u) ?? 0;
      const pague = esPagador(t, u);
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
        personas: miembrosVisibles(v).length,
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

// ─── Mis restaurantes de viaje en Mesas (D293, App Backend 2.184.0) ─────────
// `services/viajesVisitas.js` del dueño: la regla de Estadísticas (D260). Mis tickets de restaurante, bar o café de mis
// viajes como miembro activo, sin gastos a mano y en los que me toca algo (el monto de la visita, mayor que 0), del más
// reciente al más viejo, con el cursor y los 400 del dueño. 🔴 Lo que el mock no replica, declarado: un ticket cuyo
// recibo abrió una mesa mía (el mock no abre mesas desde el recibo de un ticket de viaje).

const TIPOS_DE_VISITA: readonly TipoLugar[] = ['restaurante', 'bar', 'cafe'];
const LIMITE_VISITAS = 20;
const LIMITE_VISITAS_MAXIMO = 50;

/** El instante del dueño (`INSTANTE_DEL_TICKET`): la fecha y hora impresas en México (sin hora, las 12:00); sin fecha, cuando se cargó. */
function instanteDelTicket(t: TicketMock): string {
  return t.fecha_ticket ? new Date(`${t.fecha_ticket}T${t.hora_ticket ?? '12:00'}:00-06:00`).toISOString() : t.created_at;
}

interface VisitaMock {
  ticket_id: string;
  viaje: { id: string; nombre: string; color: string | null; has_photo: boolean };
  lugar: string | null;
  tipo_lugar: TipoLugar;
  instante: string;
  te_toca_cents: number;
}

/** `seamDeVisitasMock() === 'muchas'`: 25 visitas sintéticas, una cada hora desde hace media hora. */
function visitasSinteticas(cancun: ViajeMock | undefined): VisitaMock[] {
  const t0 = Date.now();
  return Array.from({ length: 25 }, (_, k) => ({
    ticket_id: `d2000000-0000-4000-8000-${String(900 + k).padStart(12, '0')}`,
    viaje: { id: VIAJES_SEMILLA.cancun, nombre: cancun?.nombre ?? 'Cancún 2026', color: cancun?.color ?? null, has_photo: !!cancun?.foto },
    lugar: `Restaurante de viaje ${k + 1}`,
    tipo_lugar: 'restaurante',
    instante: new Date(t0 - (k + 0.5) * 3_600_000).toISOString(),
    te_toca_cents: 10_000 + k * 100,
  }));
}

function cursorDeVisitas(raw: unknown): { t: string; id: string } | null | undefined {
  if (raw === undefined) return null;
  if (typeof raw !== 'string' || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return undefined;
  try {
    const json = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))) as unknown;
    if (!json || typeof json !== 'object' || Array.isArray(json)) return undefined;
    const o = json as Record<string, unknown>;
    if (Object.keys(o).sort().join(',') !== 'id,t' || typeof o.t !== 'string' || Number.isNaN(Date.parse(o.t))
      || typeof o.id !== 'string') return undefined;
    return { t: o.t, id: o.id };
  } catch {
    return undefined;
  }
}

const emitirCursorDeVisitas = (v: VisitaMock) =>
  btoa(JSON.stringify({ t: v.instante, id: v.ticket_id })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let pedidosDeVisitas = 0;
/** Para las pruebas: cuántas veces se pidieron mis visitas (Mesas las vuelve a pedir después de ocultar una mesa). */
export function pedidosDeVisitasMock(): number {
  return pedidosDeVisitas;
}

/** `GET /api/viajes/visitas?limit=&cursor=` — sólo esas dos claves; `limit` de 1 a 50 (20 por defecto). */
export function mockVisitasDeViajes(query: Record<string, unknown> = {}) {
  pedidosDeVisitas += 1;
  return ruta(() => {
    if (seamDeVisitasMock() === 'error') throw new Respuesta(500, 'internal_error');
    if (Object.keys(query).some((k) => k !== 'limit' && k !== 'cursor')) throw invalido();
    let limit = LIMITE_VISITAS;
    if (query.limit !== undefined) {
      if (typeof query.limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(query.limit) || Number(query.limit) > LIMITE_VISITAS_MAXIMO) {
        throw invalido();
      }
      limit = Number(query.limit);
    }
    const cursor = cursorDeVisitas(query.cursor);
    if (cursor === undefined) throw invalido();
    const u = yo();
    const todas: VisitaMock[] = [];
    for (const v of cargar().viajes) {
      if (!v.miembros.some((m) => m.user_id === u && m.estado === 'activo')) continue;
      const b = balance(v);
      for (const t of v.tickets) {
        if (esManual(t) || !TIPOS_DE_VISITA.includes(t.tipo_lugar)) continue;
        const teToca = b.porTicket.get(t.id)?.consumo.get(u) ?? 0;
        if (teToca <= 0) continue;
        todas.push({
          ticket_id: t.id,
          viaje: { id: v.id, nombre: v.nombre, color: v.color ?? null, has_photo: !!v.foto },
          lugar: t.lugar, tipo_lugar: t.tipo_lugar, instante: instanteDelTicket(t), te_toca_cents: teToca,
        });
      }
    }
    if (seamDeVisitasMock() === 'muchas') todas.push(...visitasSinteticas(cargar().viajes.find((x) => x.id === VIAJES_SEMILLA.cancun)));
    // `instante` DESC y, en un empate, `ticket_id` DESC; el cursor, por las dos (el keyset del dueño).
    todas.sort((a, c) => Date.parse(c.instante) - Date.parse(a.instante) || c.ticket_id.localeCompare(a.ticket_id));
    const despues = cursor === null ? todas : todas.filter((x) => {
      const d = Date.parse(x.instante) - Date.parse(cursor.t);
      return d < 0 || (d === 0 && x.ticket_id < cursor.id);
    });
    const pagina = despues.slice(0, limit);
    const ultima = pagina[pagina.length - 1];
    return {
      contract: CONTRATO,
      visitas: pagina,
      page: { limit, next_cursor: despues.length > limit && ultima ? emitirCursorDeVisitas(ultima) : null },
    };
  });
}

// ─── El pizarrón de notas (D290, App Backend 2.183.0) ─────────────────────
// Las reglas de `services/viajesNotas.js` del dueño: todos los miembros activos leen todo, cada uno escribe lo suyo; con
// el viaje esperando pagos o cerrado, todo queda para leer. Los mismos límites, el mismo orden de errores y la misma
// concurrencia (la `version` que vi, la clave de idempotencia y el apartado en los 409).

const LIMITES_NOTAS = Object.freeze({
  entradas_por_miembro: 20, caracteres_nota: 500, items_por_lista: 30, caracteres_item: 80, caracteres_titulo: 80,
});
// Los controles C0 y C1, salvo el tab y el salto de línea (`CONTROLES` del dueño).
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u;

class NotaInvalida extends Error {
  constructor(readonly issues: Array<{ path: string; message: string }>) {
    super('validation_error');
  }
}
const notaInvalida = (path: string, message: string) => new NotaInvalida([{ path, message }]);

/** Una nota: NFC, `\r\n` → `\n`, sin los extremos; conserva saltos y tabs. */
function textoDeNota(raw: unknown, path: string): string {
  if (typeof raw !== 'string') throw notaInvalida(path, 'invalido');
  const s = raw.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (s.length < 1) throw notaInvalida(path, 'texto_vacio');
  if (s.length > LIMITES_NOTAS.caracteres_nota) throw notaInvalida(path, 'texto_max_500');
  if (CONTROLES.test(s)) throw notaInvalida(path, 'texto_control');
  return s;
}

/** Un título o un ítem: de una línea, con los espacios colapsados. */
function lineaDeNota(raw: unknown, path: string, max: number, mensajeMax: string): string {
  if (typeof raw !== 'string') throw notaInvalida(path, 'invalido');
  const s = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (s.length < 1) throw notaInvalida(path, 'texto_vacio');
  if (s.length > max) throw notaInvalida(path, mensajeMax);
  if (CONTROLES.test(s)) throw notaInvalida(path, 'texto_control');
  return s;
}

function objetoEstricto(raw: unknown, permitidas: readonly string[], path = ''): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw notaInvalida(path, 'invalido');
  const extra = Object.keys(raw).find((k) => !permitidas.includes(k));
  if (extra !== undefined) throw notaInvalida(path, 'unrecognized_keys');
  return raw as Record<string, unknown>;
}

function itemsDeNota(raw: unknown, conId: boolean): Array<{ id?: string; texto: string }> {
  if (!Array.isArray(raw)) throw notaInvalida('items', 'invalido');
  const items = raw.map((x, k) => {
    const o = objetoEstricto(x, conId ? ['id', 'texto'] : ['texto'], `items.${k}`);
    if (o.id !== undefined && !esUuid(o.id)) throw notaInvalida(`items.${k}.id`, 'invalido');
    const texto = lineaDeNota(o.texto, `items.${k}.texto`, LIMITES_NOTAS.caracteres_item, 'item_max_80');
    return o.id !== undefined ? { id: o.id as string, texto } : { texto };
  });
  if (items.length < 1) throw notaInvalida('items', 'items_min_1');
  if (items.length > LIMITES_NOTAS.items_por_lista) throw notaInvalida('items', 'items_max_30');
  const ids = items.flatMap((i) => (i.id ? [i.id] : []));
  if (new Set(ids).size !== ids.length) throw notaInvalida('items', 'item_repetido');
  return items;
}

function versionDeNota(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 2147483647) throw notaInvalida('version', 'invalido');
  return raw;
}

/** Corre la validación y la convierte en el 400 del dueño. */
function validarNota<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof NotaInvalida) throw new Respuesta(400, 'validation_error', { issues: err.issues });
    throw err;
  }
}

/** Quiénes tienen apartado: los miembros activos con cuenta viva, en el orden de los miembros (`autoresDelPizarron`). */
const autoresDelPizarron = (v: ViajeMock) => miembrosEnOrden(v).filter((m) => m.estado === 'activo' && !m.eliminada);
const notasDe = (v: ViajeMock, u: string) => (v.notas ?? []).filter((n) => n.user_id === u);
/** La última vez que escribió (crear o editar), o null. */
const ultimaEscritura = (xs: readonly NotaMock[]) => xs.reduce<string | null>((max, n) => (!max || n.actualizado_en > max ? n.actualizado_en : max), null);

function vistaEntrada(n: NotaMock) {
  const cola = { version: n.version, creado_en: n.creado_en, actualizado_en: n.actualizado_en };
  if (n.tipo === 'nota') return { id: n.id, tipo: 'nota', texto: n.texto, ...cola };
  return { id: n.id, tipo: 'lista', titulo: n.titulo, items: n.items.map((i) => ({ id: i.id, texto: i.texto, tildado: i.tildado })), ...cola };
}

function vistaApartado(m: MiembroMock, u: string, v: ViajeMock) {
  const entradas = notasDe(v, m.user_id);
  return { miembro_id: m.id, ...persona(m), has_avatar: !m.eliminada && CON_FOTO.has(m.user_id), es_yo: m.user_id === u,
    actualizado_en: ultimaEscritura(entradas), entradas: entradas.map(vistaEntrada) };
}

/** `viaje_version=11` · el resumen de la fila «Notas»: lo de quien salió no cuenta. */
function resumenDeNotas(v: ViajeMock, u: string) {
  const autores = new Set(autoresDelPizarron(v).map((m) => m.user_id));
  const visita = v.vistas_notas?.[u] ?? null;
  const visibles = (v.notas ?? []).filter((n) => autores.has(n.user_id));
  return {
    escribieron: new Set(visibles.map((n) => n.user_id)).size,
    total: autores.size,
    nuevo: visibles.some((n) => n.user_id !== u && (visita === null || n.actualizado_en > visita)),
  };
}

/** Mi apartado; el viaje dejó de tenerme como activo en el medio: el 404 del viaje. */
function miApartadoDeNotas(v: ViajeMock, u: string) {
  const m = autoresDelPizarron(v).find((x) => x.user_id === u);
  if (!m) throw noEncontrado();
  return vistaApartado(m, u, v);
}

/** `GET /api/viajes/:id/notas` · el pizarrón. Marca mi visita, también cerrado. */
export function mockNotasDeViaje(id: string) {
  return ruta(() => {
    const v = miViaje(id);
    const u = yo();
    v.vistas_notas = { ...v.vistas_notas, [u]: ahora() };
    const autores = autoresDelPizarron(v);
    const posicion = new Map(autores.map((m, k) => [m.user_id, k]));
    const ultima = (m: MiembroMock) => ultimaEscritura(notasDe(v, m.user_id));
    const otros = autores.filter((m) => m.user_id !== u);
    const conNotas = otros.filter((m) => ultima(m) !== null)
      .sort((a, b) => ultima(b)!.localeCompare(ultima(a)!) || posicion.get(a.user_id)! - posicion.get(b.user_id)!);
    const sinNotas = otros.filter((m) => ultima(m) === null);
    const orden = [...autores.filter((m) => m.user_id === u), ...conNotas, ...sinNotas];
    const r = resumenDeNotas(v, u);
    return {
      contract: CONTRATO,
      pizarron: {
        viaje_id: v.id, nombre: v.nombre, estado: estadoEfectivo(v), cerrado_en: v.cerrado_en ?? null,
        // El mock no tiene cuentas suspendidas: con el viaje abierto, escribo.
        editable: v.estado === 'abierto',
        total: r.total, escribieron: r.escribieron, limites: LIMITES_NOTAS,
        apartados: orden.map((m) => vistaApartado(m, u, v)),
      },
    };
  });
}

/** La respuesta de una escritura, con mi apartado (y en un 409 de concurrencia, también). */
function conMiApartado(v: ViajeMock, u: string, extra: Record<string, unknown> = {}) {
  return { contract: CONTRATO, ...extra, apartado: miApartadoDeNotas(v, u) };
}
const conflictoConApartado = (v: ViajeMock, u: string, error: string) =>
  new Respuesta(409, error, { apartado: miApartadoDeNotas(v, u) });

/** Los cuatro primeros pasos de una escritura sobre una nota (`puedoEscribir` del dueño). */
function notaParaEscribir(v: ViajeMock, u: string, nid: unknown): NotaMock {
  const n = esUuid(nid) ? (v.notas ?? []).find((x) => x.id === nid) : undefined;
  // La de quien salió no existe para nadie mientras esté afuera.
  const autor = n ? v.miembros.find((m) => m.user_id === n.user_id) : undefined;
  if (!n || autor?.estado !== 'activo') throw new Respuesta(404, 'viaje_nota_not_found');
  if (seamDeNotasMock('ya_no_estaba')) {
    v.notas = (v.notas ?? []).filter((x) => x.id !== n.id);
    guardar();
    throw new Respuesta(404, 'viaje_nota_not_found');
  }
  abiertaParaNotas(v);
  if (n.user_id !== u || seamDeNotasMock('no_es_tuya')) throw new Respuesta(403, 'viaje_nota_not_yours');
  if (seamDeNotasMock('suspendida')) throw new Respuesta(403, 'user_suspended');
  return n;
}

/** El 409 de un viaje que no está abierto (con el seam, quien lo creó lo cerró justo antes). */
function abiertaParaNotas(v: ViajeMock): void {
  if (v.estado === 'abierto' && seamDeNotasMock('se_cerro')) {
    cerrarInterno(v);
    terminarSiCorresponde(v);
    guardar();
  }
  if (v.estado !== 'abierto') throw conflicto('viaje_not_open', { estado: v.estado });
}

/** `POST /api/viajes/:id/notas` · una nota o una lista mía, al final de mi apartado. */
export function mockCrearNota(id: string, body: unknown) {
  return ruta(() => {
    const v = miViaje(id);
    const u = yo();
    abiertaParaNotas(v);
    if (seamDeNotasMock('suspendida')) throw new Respuesta(403, 'user_suspended');
    const pedido = validarNota(() => {
      if (seamDeNotasMock('invalido')) throw notaInvalida('texto', 'texto_control');
      const tipo = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).tipo : undefined;
      if (tipo !== 'nota' && tipo !== 'lista') throw notaInvalida('tipo', 'tipo_invalido');
      const o = objetoEstricto(body, tipo === 'nota' ? ['idempotency_key', 'tipo', 'texto'] : ['idempotency_key', 'tipo', 'titulo', 'items']);
      if (typeof o.idempotency_key !== 'string' || o.idempotency_key.length < 8 || o.idempotency_key.length > 100) {
        throw notaInvalida('idempotency_key', 'invalido');
      }
      return tipo === 'nota'
        ? { clave: o.idempotency_key, tipo: 'nota' as const, texto: textoDeNota(o.texto, 'texto') }
        : { clave: o.idempotency_key, tipo: 'lista' as const, titulo: lineaDeNota(o.titulo, 'titulo', LIMITES_NOTAS.caracteres_titulo, 'titulo_max_80'),
          items: itemsDeNota(o.items, false) };
    });
    const { clave, ...sinClave } = pedido;
    const hash = JSON.stringify(sinClave);
    // El reintento va antes que el tope: la que ya está no choca con él.
    const ya = (v.notas ?? []).find((n) => n.user_id === u && n.idempotency_key === clave);
    if (ya) {
      if (ya.pedido_hash !== hash) throw conflicto('idempotency_key_conflict');
      return conMiApartado(v, u, { entrada_id: ya.id });
    }
    if (notasDe(v, u).length >= LIMITES_NOTAS.entradas_por_miembro) {
      throw conflicto('viaje_notas_limit', { limit: LIMITES_NOTAS.entradas_por_miembro });
    }
    const en = ahora();
    const n: NotaMock = {
      id: nuevoId(), user_id: u, tipo: pedido.tipo, texto: pedido.tipo === 'nota' ? pedido.texto : null,
      titulo: pedido.tipo === 'lista' ? pedido.titulo : null,
      items: pedido.tipo === 'lista' ? pedido.items.map((i) => ({ id: nuevoId(), texto: i.texto, tildado: false })) : [],
      version: 1, creado_en: en, actualizado_en: en, idempotency_key: clave, pedido_hash: hash,
    };
    v.notas = [...(v.notas ?? []), n];
    if (seamDeNotasMock('respuesta_perdida')) {
      guardar();
      throw new Respuesta(500, 'internal_error');
    }
    return conMiApartado(v, u, { entrada_id: n.id });
  });
}

/** `PATCH /api/viajes/:id/notas/:nid` · con la `version` que vi. */
export function mockEditarNota(id: string, nid: string, body: unknown) {
  return ruta(() => {
    const v = miViaje(id);
    const u = yo();
    const n = notaParaEscribir(v, u, nid);
    type Edicion = { version: number; texto?: string; titulo?: string; items?: Array<{ id?: string; texto: string }> };
    const b = validarNota((): Edicion => {
      if (seamDeNotasMock('invalido')) throw notaInvalida('texto', 'texto_control');
      if (n.tipo === 'nota') {
        const o = objetoEstricto(body, ['version', 'texto']);
        return { version: versionDeNota(o.version), texto: textoDeNota(o.texto, 'texto') };
      }
      const o = objetoEstricto(body, ['version', 'titulo', 'items']);
      const version = versionDeNota(o.version);
      const titulo = o.titulo === undefined ? undefined
        : lineaDeNota(o.titulo, 'titulo', LIMITES_NOTAS.caracteres_titulo, 'titulo_max_80');
      const items = o.items === undefined ? undefined : itemsDeNota(o.items, true);
      if (titulo === undefined && items === undefined) throw notaInvalida('', 'nada_para_editar');
      return { version, titulo, items };
    });
    const items = b.items ?? null;
    if (n.tipo === 'lista' && items) {
      const ajeno = items.find((i) => i.id && !n.items.some((x) => x.id === i.id));
      if (ajeno) throw new Respuesta(422, 'viaje_nota_item_unknown', { item_id: ajeno.id });
    }
    if (seamDeNotasMock('otra_pestana')) {
      // Otra pestaña la editó justo antes.
      n.version += 1;
      n.actualizado_en = ahora();
      if (n.tipo === 'nota') n.texto = `${n.texto} (editada en otra pestaña)`.slice(0, LIMITES_NOTAS.caracteres_nota);
      else n.titulo = `${n.titulo} ·`.slice(0, LIMITES_NOTAS.caracteres_titulo);
      guardar();
    }
    if (b.version !== n.version) throw conflictoConApartado(v, u, 'viaje_nota_version_conflict');
    const nuevoTitulo = n.tipo === 'lista' ? (b.titulo ?? n.titulo) : null;
    const cambia = n.tipo === 'nota'
      ? b.texto !== n.texto
      : nuevoTitulo !== n.titulo || (items !== null && (items.length !== n.items.length
        || items.some((i, k) => (i.id ?? null) !== n.items[k]!.id || i.texto !== n.items[k]!.texto)));
    if (!cambia) return conMiApartado(v, u);
    if (n.tipo === 'nota' && b.texto !== undefined) n.texto = b.texto;
    if (n.tipo === 'lista') {
      n.titulo = nuevoTitulo ?? n.titulo;
      // Con `id`, conserva su tilde; sin `id`, uno nuevo sin tildar; el que no viene, se saca.
      if (items) n.items = items.map((i) => (i.id ? { ...n.items.find((x) => x.id === i.id)!, texto: i.texto } : { id: nuevoId(), texto: i.texto, tildado: false }));
    }
    n.version += 1;
    n.actualizado_en = ahora();
    return conMiApartado(v, u);
  });
}

/** `DELETE /api/viajes/:id/notas/:nid?version=N` · con la `version` que vi. No es «nuevo». */
export function mockBorrarNota(id: string, nid: string, query: unknown) {
  return ruta(() => {
    const v = miViaje(id);
    const u = yo();
    const n = notaParaEscribir(v, u, nid);
    const version = validarNota(() => {
      const o = objetoEstricto(query, ['version']);
      if (typeof o.version !== 'string' || !/^[1-9][0-9]{0,9}$/.test(o.version)) throw notaInvalida('version', 'version_invalida');
      return Number(o.version);
    });
    if (seamDeNotasMock('otra_pestana')) {
      n.version += 1;
      n.actualizado_en = ahora();
      guardar();
    }
    if (version !== n.version) throw conflictoConApartado(v, u, 'viaje_nota_version_conflict');
    v.notas = (v.notas ?? []).filter((x) => x.id !== n.id);
    return conMiApartado(v, u);
  });
}

/** `PUT /api/viajes/:id/notas/:nid/items/:iid` · un estado: dos veces es un solo efecto. No sube la versión. */
export function mockTildarItemDeNota(id: string, nid: string, iid: string, body: unknown) {
  return ruta(() => {
    const v = miViaje(id);
    const u = yo();
    const n = notaParaEscribir(v, u, nid);
    const tildado = validarNota(() => {
      const o = objetoEstricto(body, ['tildado']);
      if (typeof o.tildado !== 'boolean') throw notaInvalida('tildado', 'invalido');
      return o.tildado;
    });
    const item = n.items.find((i) => i.id === iid);
    if (!item) throw new Respuesta(404, 'viaje_nota_item_not_found');
    item.tildado = tildado;
    return conMiApartado(v, u);
  });
}

/** `PUT /api/viajes/:id/notas/orden` · todas las mías, en el orden nuevo. No es «nuevo». */
export function mockOrdenarNotas(id: string, body: unknown) {
  return ruta(() => {
    const v = miViaje(id);
    const u = yo();
    abiertaParaNotas(v);
    if (seamDeNotasMock('suspendida')) throw new Respuesta(403, 'user_suspended');
    const ids = validarNota(() => {
      const o = objetoEstricto(body, ['ids']);
      if (!Array.isArray(o.ids) || o.ids.length < 1 || o.ids.length > LIMITES_NOTAS.entradas_por_miembro
        || !o.ids.every(esUuid) || new Set(o.ids).size !== o.ids.length) throw notaInvalida('ids', 'invalido');
      return o.ids as string[];
    });
    const mias = notasDe(v, u);
    if (ids.length !== mias.length || !mias.every((m) => ids.includes(m.id))) throw conflictoConApartado(v, u, 'viaje_notas_order_mismatch');
    const otras = (v.notas ?? []).filter((n) => n.user_id !== u);
    v.notas = [...otras, ...ids.map((x) => mias.find((m) => m.id === x)!)];
    return conMiApartado(v, u);
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
/** D245 · quiénes tienen foto en el modo de ejemplo (como `FOTOS_MOCK` de las mesas: Luis y Sofía). */
const CON_FOTO: ReadonlySet<string> = new Set([PERSONAS.luis.user_id, PERSONAS.sofia.user_id]);

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

  // D290 · cuándo se cerró cada uno (el `cerrado_en` del pizarrón), fijo para la semilla.
  monterrey.cerrado_en = '2026-09-22T15:00:00.000Z';
  oaxaca.cerrado_en = '2026-08-18T15:00:00.000Z';
  valle.cerrado_en = '2026-07-07T15:00:00.000Z';
  // D290 · el pizarrón, al final para no correr los ids de lo de arriba. Cancún (2b): la nota larga de Luis y la lista de
  // Sofía; el mío y el de Diego, vacíos. Oaxaca, cerrado (2h): mi nota y mi lista, y la nota de Carla.
  const nota = (v: ViajeMock, p: PersonaViajeMock, en: string, e: { texto: string } | { titulo: string; items: Array<[string, boolean]> }) => {
    const n: NotaMock = {
      id: id('d9'), user_id: p.user_id, tipo: 'texto' in e ? 'nota' : 'lista', texto: 'texto' in e ? e.texto : null,
      titulo: 'titulo' in e ? e.titulo : null,
      items: 'items' in e ? e.items.map(([texto, tildado]) => ({ id: id('d9'), texto, tildado })) : [],
      version: 1, creado_en: en, actualizado_en: en, idempotency_key: id('d7'), pedido_hash: 'semilla',
    };
    v.notas = [...(v.notas ?? []), n];
  };
  nota(cancun, sofia, '2026-10-08T20:00:00.000Z', { titulo: 'Súper del lunes',
    items: [['Agua (6 litros)', true], ['Fruta', false], ['Hielo', true], ['Tortillas', false], ['Salsa', false]] });
  nota(cancun, luis, '2026-10-09T14:00:00.000Z', { texto: 'Llegamos el domingo a las 14:20 en el vuelo Y4 312. Ya tengo una '
    + 'camioneta para seis en el aeropuerto: la recojo yo y paso por ustedes al hotel. El lunes vamos al cenote Ik Kil; '
    + 'salimos a las 7:30 para ganarle a la fila. La entrada se paga en efectivo, no aceptan tarjeta. Si alguien se marea '
    + 'en carretera, avísenme y le guardo el asiento de adelante.' });
  nota(oaxaca, Y, '2026-08-13T18:00:00.000Z', { texto: 'Llevo la bocina y el cargador grande.' });
  nota(oaxaca, Y, '2026-08-13T18:05:00.000Z', { titulo: 'Para llevar',
    items: [['Protector solar', true], ['Gorra', true], ['Efectivo', false]] });
  nota(oaxaca, carla, '2026-08-18T16:00:00.000Z', { texto: 'Gracias por organizar. Las fotos están en el álbum compartido del grupo.' });

  return { version: 1, viajes: [cancun, monterrey, oaxaca, valle, mazatlan], avisos_sembrados: false, corte: new Date().toISOString() };
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
    // D256 · sólo con su seam (no cambia la bandeja de las demás pruebas).
    ...(avisoEliminadoMock() ? [{ type: 'viaje_ticket_removed', viajeId: VIAJES_SEMILLA.cancun, porPersona: luis.user_id,
      en: hace(30), body: 'Luis Pérez eliminó un gasto de Cancún 2026: Taxi al aeropuerto.',
      payload: { viaje_id: VIAJES_SEMILLA.cancun } }] : []),
  ];
  for (const a of avisos) avisarme(a);
  guardar();
}
