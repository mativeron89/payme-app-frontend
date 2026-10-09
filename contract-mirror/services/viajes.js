/**
 * services/viajes.js — v2.171.0 · AB-VIAJES · los gastos compartidos de un viaje (decisión 242 de Mati; D240
 * punto 17; Roadmap n338; plan OK del Bibliotecario 2026-10-09T03:31:25Z, con S y V1–V7).
 *
 * PayMe NO mueve dinero en Viajes: calcula quién le debe a quién; cada uno transfiere desde su banco y lo marca.
 * Nada de pagos, Stripe ni saldos. El cálculo es puro y vive en services/viajesCalculo.js.
 *
 * ─── Lo que decidió Mati (D242) y cómo queda ───────────────────────────────────────────────────────────────────
 *   1. Pago: «Ya pagué» marca; cuenta como pagada recién con «Recibí» de quien recibe. «No me llegó» la vuelve a
 *      pendiente y le avisa a quien pagó. «Deshacer» la vuelve a pendiente sin aviso.
 *   2. Salir: sólo sin consumos. Quien eligió algo, pagó un ticket o está entre los presentes de un ticket en partes
 *      iguales no puede salir (`viaje_member_cannot_leave`, con el motivo).
 *   3. Cerrar: cualquier miembro activo, con aviso a todos los demás.
 *   4. Lo que nadie eligió: al cerrar, en partes iguales entre quienes no eligieron en ese ticket (y, si todos
 *      eligieron, entre todos los del ticket: V4).
 *   5. Fechas opcionales.
 *   6. Partes iguales: todos los del ticket marcados; quien lo pagó destilda a quien no estuvo.
 *   7. Tablas nuevas y aditivas (db/migrate_viajes_v2.171.0.sql).
 *
 * ─── Quién ve qué ──────────────────────────────────────────────────────────────────────────────────────────────
 *   · Un viaje que no existe, o del que no sos miembro activo (invitado, rechazado, saliste o ajeno), contesta el
 *     MISMO 404, byte por byte (n325). Una invitación pendiente se ve por GET /api/viajes/invitaciones.
 *   · Los miembros ven de los demás: nombre y @usuario (sin foto: no hay regla para quien no es amigo), quién pagó
 *     cada ticket, quién ya eligió y el balance de cada uno. NUNCA qué eligió otro, ni el RFC ni el folio.
 *     Declarado: el balance de quien elige cambia exactamente en su monto, así que la API no expone la selección
 *     ajena, pero el monto se infiere.
 *   · Esperando pagos: todos ven todas las transferencias (de, a, monto, estado).
 *   · Cerrado (D240-17): cada uno ve sólo lo suyo; los balances y las transferencias ajenas no salen.
 *   · La API nunca publica el id interno de una cuenta: cada miembro tiene un id propio del viaje.
 *
 * ─── La capacidad (V1) ─────────────────────────────────────────────────────────────────────────────────────────
 *   `features.viajes.enabled` es la constante HABILITADO = false hasta que Mati apruebe el texto del Aviso (el 3.0.0
 *   servido no nombra viajes, @usuario ni lo que uno le debe a otro). Es la única fuente: con ella en false, las
 *   rutas de /api/viajes no existen (el 404 de siempre) y el OCR ignora `trip_version`. Encenderla es un commit de
 *   una línea. Los tests la encienden con el seam.
 *
 * ─── El ticket duplicado (V2) ──────────────────────────────────────────────────────────────────────────────────
 *   Quien carga primero un ticket es quien lo pagó. Un segundo escaneo del mismo ticket devuelve el ya cargado, con
 *   quién y cuándo. Dos señales:
 *     · un mismo recibo del OCR carga un solo ticket, en cualquier viaje (UNIQUE de recibo_jti); siempre vale;
 *     · la huella del ticket: HMAC-SHA256, con una llave derivada por HKDF de JWT_SECRET (la variable que el
 *       servicio ya tiene, como el recibo) y la etiqueta propia `payme/viajes/huella/v1`. Sin variable nueva.
 *         – con folio: RFC + folio + total + fecha (si está);
 *         – sin folio: RFC + fecha y hora completas + total + renglones (precio y cantidad);
 *         – sin RFC (o con el genérico XAXX010101000 / XEXX010101000), o sin folio ni fecha y hora: sin huella.
 *       Así, dos pedidos iguales en el mismo café en días distintos no se bloquean. El total es el TOTAL impreso
 *       o, si no se leyó, la suma de los renglones. Nunca se guarda ni se publica el RFC ni el folio: sólo la huella.
 *       La firma el servidor en el recibo (clave `h`, con `trip_version=1`); el cliente no la puede elegir.
 *
 * ─── La baja de cuenta (V5) ────────────────────────────────────────────────────────────────────────────────────
 *   No se toca services/accountAnonymization.js. Todo se deriva al leer:
 *     · una transferencia cuya otra parte es una cuenta dada de baja se publica `anulada_por_baja`: no suma a
 *       «faltan n», no se marca y no frena el paso a Cerrados;
 *     · el miembro dado de baja queda como «Cuenta eliminada» con sus tickets, selecciones y balance; no entra en la
 *       foto de los tickets nuevos ni recibe lo no elegido mientras quede alguien vivo;
 *     · una invitación pendiente a una cuenta dada de baja no se lista ni se cuenta;
 *     · los avisos que nombran a alguien van con `related_entity_type='user'` y el id de quien actúa: la
 *       anonimización de hoy los vacía (AVISOS_AJENOS_QUE_LA_NOMBRAN). El viaje va en el payload, sin nombres.
 *
 * ─── Bloqueos ──────────────────────────────────────────────────────────────────────────────────────────────────
 *   Siempre en este orden: (al crear, el turno de quien crea) → el viaje (`FOR UPDATE`) → (al cargar un ticket, el
 *   recibo, por su id) → las cuentas que se escriben o reciben un aviso (`FOR SHARE`, por id) → las hijas. Todo el
 *   que escribe en un viaje toma su lock y vuelve a mirar el estado bajo el lock: «cerrar» y «elegir» se ordenan.
 *
 * Cada función devuelve `{ status, body }`; la ruta sólo lo escribe. Los registros llevan ids y códigos cerrados.
 */
'use strict';

const { createHash, createHmac, hkdfSync } = require('node:crypto');
const { z } = require('zod');
const pool = require('../db/pool');
const notifs = require('./notifications');
const usernameSvc = require('./username');
const origenItems = require('./origenItems');
const { montoEnTexto } = require('./montoEnTexto');
const { lineTotalCents } = require('./itemClaims');
const { precioInformativo } = require('./consumoPropio');
const { FRACCIONES_INFORMATIVAS } = require('./mesaPresentation');
const { restanteDe } = require('./informativeSelections');
const calc = require('./viajesCalculo');
const { esFechaCalendario } = require('../utils/fechas');
const logger = require('../utils/logger');

// 🔴 V1: apagado hasta que Mati apruebe el texto del Aviso. Encenderlo es cambiar esta línea.
const HABILITADO = false;
const CONTRATO = 'payme.app.viajes/v1';
const MAX_MIEMBROS = calc.MAX_MIEMBROS;
const MAX_TICKETS = 200;
const MAX_LISTA = 100;
const FORMAS = Object.freeze(['consumo', 'iguales', 'total']);
const TIPOS_LUGAR = Object.freeze(['restaurante', 'bar', 'cafe', 'super', 'otro']);
const ESTADOS = Object.freeze(['abierto', 'esperando_pagos', 'cerrado']);
const ESTADOS_TRANSFERENCIA = Object.freeze(['pendiente', 'marcada', 'pagada', 'anulada_por_baja']);
const ETIQUETA_HUELLA = 'payme/viajes/huella/v1';
const RFC_GENERICOS = new Set(['XAXX010101000', 'XEXX010101000']);

let forzadoEnTests = null;
function habilitado() {
  return forzadoEnTests === null ? HABILITADO : forzadoEnTests;
}
/** Seam de tests: enciende o apaga Viajes y devuelve la función que restaura. */
function forzarParaTests(valor) {
  if (process.env.NODE_ENV !== 'test') throw new Error('viajes_test_seam_forbidden');
  if (typeof valor !== 'boolean') throw new Error('viajes_test_seam_valor_invalido');
  const anterior = forzadoEnTests;
  forzadoEnTests = valor;
  return () => { forzadoEnTests = anterior; };
}

/** Lo que publica `GET /api/config` en `features.viajes`. */
function capacidad() {
  return { supported: true, enabled: habilitado() };
}

const respuesta = (status, body) => ({ status, body });
// n325: un solo objeto para «no existe» y «no sos miembro», byte por byte.
const NO_ENCONTRADO = Object.freeze({ error: 'viaje_not_found' });
const noEncontrado = () => respuesta(404, NO_ENCONTRADO);
const conflicto = (error, extra = {}) => respuesta(409, { error, ...extra });

// ─── La huella del ticket (V2) ─────────────────────────────────────────────────────────────────────────────────

function claveHuella(secret = process.env.JWT_SECRET) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) throw new Error('viaje_huella_secret_invalid');
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(ETIQUETA_HUELLA, 'utf8'), 32));
}

/**
 * La huella de un ticket leído, o null. `rfc` y `folio` sólo en memoria: nunca se guardan ni salen.
 * @param {{rfc?:string, folio?:string|null, fecha?:string|null, hora?:string|null, totalCents:number,
 *   items:Array<{price_cents:number, quantity:number}>}} t
 */
function huellaDelTicket({ rfc, folio, fecha, hora, totalCents, items }, { secret } = {}) {
  if (typeof rfc !== 'string' || !rfc || RFC_GENERICOS.has(rfc)) return null;
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return null;
  let partes;
  if (typeof folio === 'string' && folio) {
    partes = ['folio', rfc, folio, totalCents, typeof fecha === 'string' ? fecha : ''];
  } else if (typeof fecha === 'string' && fecha && typeof hora === 'string' && hora) {
    const renglones = (items || []).map((i) => `${i.price_cents}x${i.quantity ?? 1}`).sort();
    partes = ['fecha', rfc, `${fecha}T${hora}`, totalCents, renglones];
  } else {
    return null;
  }
  return createHmac('sha256', claveHuella(secret)).update(JSON.stringify(partes)).digest('base64url');
}

/**
 * La huella de lo que devolvió Textract (`analyzeExpense`), con su identidad en memoria. Nunca rompe la lectura del
 * ticket: si no se puede calcular, null (y el ticket del viaje vale sólo por su recibo).
 */
function huellaDeLectura(result, identidad, opciones) {
  if (!result || !Array.isArray(result.items) || !result.items.length) return null;
  const total = Number.isSafeInteger(result.total_detected_cents) && result.total_detected_cents > 0
    ? result.total_detected_cents : result.total_cents;
  try {
    return huellaDelTicket({ rfc: result.merchant?.rfc, folio: identidad?.folio, fecha: identidad?.fecha,
      hora: identidad?.hora, totalCents: total, items: result.items }, opciones);
  } catch (_) {
    return null;
  }
}

// ─── Validación de cuerpos ─────────────────────────────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const fecha = z.string().refine(esFechaCalendario, 'fecha YYYY-MM-DD');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora HH:MM');
const idempotencyKey = z.string().min(8).max(100);
const texto = (max) => z.string().transform((s) => s.normalize('NFC').replace(/\s+/gu, ' ').trim())
  .pipe(z.string().min(1).max(max));
const miembro = z.union([
  z.object({ user_id: uuid }).strict(),
  z.object({ username: z.string().min(1).max(40) }).strict(),
]);
const cuerpoCrear = z.object({
  nombre: texto(80),
  fecha_desde: fecha.nullable().optional(),
  fecha_hasta: fecha.nullable().optional(),
  miembros: z.array(miembro).min(1).max(MAX_MIEMBROS - 1),
  idempotency_key: idempotencyKey,
}).strict().refine((b) => !b.fecha_desde || !b.fecha_hasta || b.fecha_desde <= b.fecha_hasta,
  { message: 'fecha_desde <= fecha_hasta', path: ['fecha_hasta'] });
const cuerpoInvitar = z.object({ miembros: z.array(miembro).min(1).max(MAX_MIEMBROS - 1) }).strict();
const cuerpoRecibo = z.object({ ocr_receipt: z.string().min(1).max(16384) }).strict();
const cuerpoTicket = z.object({
  ocr_receipt: z.string().min(1).max(16384),
  idempotency_key: idempotencyKey,
  forma: z.enum(FORMAS),
  tipo_lugar: z.enum(TIPOS_LUGAR),
  lugar: texto(120).nullable().optional(),
  fecha_ticket: fecha.nullable().optional(),
  hora_ticket: hora.nullable().optional(),
  items: z.array(z.object({
    name: texto(200),
    price_cents: z.number().int().safe().min(0),
    quantity: z.number().int().min(1).max(32767),
  }).strict()).min(1).max(100),
}).strict().refine((b) => !b.hora_ticket || b.fecha_ticket, { message: 'hora_ticket requiere fecha_ticket', path: ['hora_ticket'] });
const cuerpoSeleccion = z.object({
  items: z.array(z.object({
    item_id: uuid,
    fraction_bps: z.number().int().refine((n) => FRACCIONES_INFORMATIVAS.includes(n), 'fracción de la mesa'),
  }).strict()).max(100)
    .refine((xs) => new Set(xs.map((x) => x.item_id)).size === xs.length, 'item_id repetido'),
  listo: z.boolean(),
}).strict();
const cuerpoPresentes = z.object({
  presentes: z.array(uuid).min(1).max(MAX_MIEMBROS)
    .refine((xs) => new Set(xs).size === xs.length, 'miembro repetido'),
}).strict();
const consultaLista = z.object({ estado: z.enum(['abiertos', 'cerrados']).default('abiertos') }).strict();

function validar(schema, valor) {
  const r = schema.safeParse(valor ?? {});
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, res: respuesta(400, { error: 'validation_error',
    issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }) };
}

const hashDe = (x) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

// ─── Lectura ───────────────────────────────────────────────────────────────────────────────────────────────────

const vivo = (u) => u.user_status !== 'deleted';
const ts = (d) => (d ? new Date(d).toISOString() : null);
const fechaDe = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);
const horaDe = (h) => (h ? String(h).slice(0, 5) : null);

function persona(u) {
  const eliminada = !vivo(u);
  return {
    first_name: u.first_name, last_name: u.last_name,
    username: !eliminada && usernameSvc.habilitado() ? u.username ?? null : null,
    eliminada,
  };
}
const nombreDe = (u) => (vivo(u) ? [u.first_name, u.last_name].filter(Boolean).join(' ') : 'Cuenta eliminada');
const recortar = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** Todo lo de un viaje, con el `db` dado (pool o el cliente de la transacción). */
async function cargar(db, viajeId) {
  const { rows: [viaje] } = await db.query(`SELECT * FROM viajes WHERE id=$1`, [viajeId]);
  if (!viaje) return null;
  const { rows: miembros } = await db.query(
    `SELECT m.id, m.user_id, m.estado, m.invitado_por, m.invitado_en, m.created_at,
            u.first_name, u.last_name, u.username, u.status AS user_status
       FROM viaje_miembros m JOIN users u ON u.id = m.user_id
      WHERE m.viaje_id=$1 ORDER BY m.created_at, m.user_id`, [viajeId]);
  const { rows: tickets } = await db.query(
    `SELECT * FROM viaje_tickets WHERE viaje_id=$1 ORDER BY created_at, id`, [viajeId]);
  const ids = tickets.map((t) => t.id);
  const [{ rows: items }, { rows: personas }, { rows: selecciones }, { rows: transferencias }] = await Promise.all([
    db.query(`SELECT * FROM viaje_ticket_items WHERE ticket_id = ANY($1::uuid[]) ORDER BY ticket_id, orden`, [ids]),
    db.query(`SELECT p.*, u.status AS user_status FROM viaje_ticket_personas p JOIN users u ON u.id = p.user_id
               WHERE p.ticket_id = ANY($1::uuid[]) ORDER BY p.ticket_id, p.orden`, [ids]),
    db.query(`SELECT s.item_id, s.user_id, s.fraction_bps, i.ticket_id
                FROM viaje_selecciones s JOIN viaje_ticket_items i ON i.id = s.item_id
               WHERE i.ticket_id = ANY($1::uuid[]) ORDER BY s.created_at, s.user_id`, [ids]),
    db.query(`SELECT t.*, ud.status AS de_status, ua.status AS a_status
                FROM viaje_transferencias t JOIN users ud ON ud.id = t.de_user JOIN users ua ON ua.id = t.a_user
               WHERE t.viaje_id=$1 ORDER BY t.orden`, [viajeId]),
  ]);
  for (const t of tickets) {
    t.monto_cents = Number(t.monto_cents);
    t.items = items.filter((i) => i.ticket_id === t.id).map((i) => ({ ...i, price_cents: Number(i.price_cents),
      line_cents: lineTotalCents(Number(i.price_cents), i.quantity) }));
    t.personas = personas.filter((p) => p.ticket_id === t.id).map((p) => ({ ...p,
      consumo_final_cents: p.consumo_final_cents === null ? null : Number(p.consumo_final_cents),
      asignado_cierre_cents: p.asignado_cierre_cents === null ? null : Number(p.asignado_cierre_cents) }));
    t.selecciones = selecciones.filter((s) => s.ticket_id === t.id);
  }
  for (const tr of transferencias) {
    tr.monto_cents = Number(tr.monto_cents);
    tr.estado_publico = tr.de_status === 'deleted' || tr.a_status === 'deleted'
      ? (tr.estado === 'pagada' ? 'pagada' : 'anulada_por_baja') : tr.estado;
  }
  return { viaje, miembros, tickets, transferencias };
}

const pendientes = (d) => d.transferencias.filter((t) => t.estado_publico === 'pendiente' || t.estado_publico === 'marcada');

/** El estado que se publica: un viaje esperando pagos sin nada pendiente ya está cerrado (V5). */
function estadoEfectivo(d) {
  return d.viaje.estado === 'esperando_pagos' && pendientes(d).length === 0 ? 'cerrado' : d.viaje.estado;
}

/** La entrada del cálculo puro. */
function paraCalculo(t) {
  return {
    id: t.id, forma: t.forma, pagado_por: t.pagado_por, monto_cents: t.monto_cents,
    items: t.items.map((i) => ({ id: i.id, line_cents: i.line_cents })),
    personas: t.personas.map((p) => ({ user_id: p.user_id, presente: p.presente, listo: !!p.listo_en, vivo: vivo(p) })),
    selecciones: t.selecciones.map((s) => ({ item_id: s.item_id, user_id: s.user_id, fraction_bps: s.fraction_bps })),
  };
}

/**
 * El balance: en vivo mientras el viaje está abierto; congelado al cerrar (lo que cada uno consumió quedó guardado
 * en `consumo_final_cents`, así una baja posterior no cambia el cierre).
 */
function balance(d, { cierre = false } = {}) {
  const orden = d.miembros.map((m) => m.user_id);
  if (d.viaje.estado === 'abierto') {
    const r = calc.balanceDelViaje(orden, d.tickets.map(paraCalculo), { cierre });
    return { ...r, congelado: false };
  }
  const bal = new Map(orden.map((u) => [u, 0]));
  const pagado = new Map(); const consumido = new Map(); const porTicket = new Map();
  let gasto = 0;
  const sumar = (m, k, v) => m.set(k, (m.get(k) || 0) + v);
  for (const t of d.tickets) {
    gasto += t.monto_cents;
    sumar(pagado, t.pagado_por, t.monto_cents);
    sumar(bal, t.pagado_por, t.monto_cents);
    const consumo = new Map(); const asignado = new Map();
    for (const p of t.personas) {
      consumo.set(p.user_id, p.consumo_final_cents);
      if (p.asignado_cierre_cents) asignado.set(p.user_id, p.asignado_cierre_cents);
      sumar(consumido, p.user_id, p.consumo_final_cents);
      sumar(bal, p.user_id, -p.consumo_final_cents);
    }
    porTicket.set(t.id, { consumo, asignado, sinRepartir: 0, faltan: [] });
  }
  if ([...bal.values()].reduce((s, x) => s + x, 0) !== 0) throw new Error('viaje_balance_no_cuadra');
  return { balance: bal, pagado, consumido, gasto, porTicket, congelado: true };
}

/** Lo propio de un ticket, plato por plato (el mismo recorrido que el cálculo, filtrado a mí). */
function mioPorPlato(t, userId) {
  const acumulado = new Map();
  const mio = new Map();
  const lineas = new Map(t.items.map((i) => [i.id, i.line_cents]));
  for (const s of t.selecciones) {
    const previo = acumulado.get(s.item_id) || { bps: 0, monto: 0 };
    const precio = precioInformativo(lineas.get(s.item_id), s.fraction_bps, previo.bps, previo.monto);
    acumulado.set(s.item_id, { bps: previo.bps + s.fraction_bps, monto: previo.monto + precio });
    if (s.user_id === userId) mio.set(s.item_id, { bps: s.fraction_bps, monto: precio });
  }
  return { mio, acumulado };
}

function vistaTicketEnLista(t, d, b, yo, idPublico) {
  const r = b.porTicket.get(t.id);
  return {
    id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: fechaDe(t.fecha_ticket),
    hora_ticket: horaDe(t.hora_ticket), cargado_en: ts(t.created_at), forma: t.forma,
    pagado_por: idPublico.get(t.pagado_por) ?? null, pagaste_tu: t.pagado_por === yo,
    te_toca_cents: r.consumo.get(yo) || 0,
    falta_que_elija: b.congelado ? 0 : r.faltan.length,
    sin_repartir_cents: b.congelado ? 0 : r.sinRepartir,
  };
}

function vistaTransferencia(tr, idPublico, yo) {
  return { id: tr.id, de: idPublico.get(tr.de_user) ?? null, a: idPublico.get(tr.a_user) ?? null,
    monto_cents: tr.monto_cents, estado: tr.estado_publico,
    mia: tr.de_user === yo ? 'debo' : tr.a_user === yo ? 'me_deben' : null };
}

/** El detalle que ve un miembro activo. */
function vistaViaje(d, yo) {
  const estado = estadoEfectivo(d);
  const cerrado = estado === 'cerrado';
  const b = balance(d);
  const idPublico = new Map(d.miembros.map((m) => [m.user_id, m.id]));
  const activos = d.miembros.filter((m) => m.estado === 'activo');
  const faltaElegir = new Map();
  if (!b.congelado) {
    for (const r of b.porTicket.values()) for (const u of r.faltan) faltaElegir.set(u, (faltaElegir.get(u) || 0) + 1);
  }
  const tickets = d.tickets.map((t) => vistaTicketEnLista(t, d, b, yo, idPublico)).reverse();
  const sinRepartir = b.congelado ? [] : d.tickets.filter((t) => b.porTicket.get(t.id).sinRepartir > 0).map((t) => ({
    ticket_id: t.id, lugar: t.lugar, fecha_ticket: fechaDe(t.fecha_ticket),
    monto_cents: b.porTicket.get(t.id).sinRepartir,
    faltan: b.porTicket.get(t.id).faltan.map((u) => idPublico.get(u)),
  }));
  const transferencias = d.transferencias
    .filter((tr) => !cerrado || tr.de_user === yo || tr.a_user === yo)
    .map((tr) => vistaTransferencia(tr, idPublico, yo));
  return {
    id: d.viaje.id, nombre: d.viaje.nombre, fecha_desde: fechaDe(d.viaje.fecha_desde),
    fecha_hasta: fechaDe(d.viaje.fecha_hasta), estado, creado_en: ts(d.viaje.created_at),
    mi_miembro_id: idPublico.get(yo),
    miembros: activos.map((m) => ({
      id: m.id, ...persona(m), es_yo: m.user_id === yo,
      balance_cents: cerrado && m.user_id !== yo ? null : b.balance.get(m.user_id) || 0,
      falta_elegir: faltaElegir.get(m.user_id) || 0,
    })),
    invitados: d.miembros.filter((m) => m.estado === 'invitado' && vivo(m)).map((m) => ({ id: m.id, ...persona(m) })),
    mi_balance_cents: b.balance.get(yo) || 0,
    gasto_del_grupo_cents: b.gasto,
    tickets, sin_repartir: sinRepartir,
    transferencias, transferencias_pendientes: pendientes(d).length,
  };
}

/** El detalle de un ticket que ve un miembro activo. Nunca qué eligió otro. */
function vistaTicket(t, d, yo) {
  const b = balance(d);
  const r = b.porTicket.get(t.id);
  const idPublico = new Map(d.miembros.map((m) => [m.user_id, m.id]));
  const { mio, acumulado } = mioPorPlato(t, yo);
  const abierto = d.viaje.estado === 'abierto';
  const soyPersona = t.personas.some((p) => p.user_id === yo);
  return {
    id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: fechaDe(t.fecha_ticket),
    hora_ticket: horaDe(t.hora_ticket), cargado_en: ts(t.created_at), forma: t.forma, monto_cents: t.monto_cents,
    pagado_por: idPublico.get(t.pagado_por) ?? null, pagaste_tu: t.pagado_por === yo,
    items: t.items.map((i) => ({
      id: i.id, name: i.nombre, price_cents: i.price_cents, quantity: i.quantity, line_cents: i.line_cents,
      remaining_bps: restanteDe(acumulado.get(i.id)?.bps || 0),
      my_bps: mio.get(i.id)?.bps || 0, my_amount_cents: mio.get(i.id)?.monto || 0,
    })),
    personas: t.personas.map((p) => ({ miembro_id: idPublico.get(p.user_id) ?? null,
      ya_eligio: t.forma !== 'consumo' || !!p.listo_en, presente: p.presente })),
    te_toca_cents: r.consumo.get(yo) || 0,
    sin_repartir_cents: b.congelado ? 0 : r.sinRepartir,
    puedo_elegir: abierto && t.forma === 'consumo' && soyPersona,
    puedo_marcar_presentes: abierto && t.forma === 'iguales' && t.pagado_por === yo,
  };
}

function vistaEnLista(d, yo) {
  const estado = estadoEfectivo(d);
  const b = balance(d);
  return {
    id: d.viaje.id, nombre: d.viaje.nombre, fecha_desde: fechaDe(d.viaje.fecha_desde),
    fecha_hasta: fechaDe(d.viaje.fecha_hasta), estado,
    personas: d.miembros.filter((m) => m.estado === 'activo').length,
    mi_balance_cents: estado === 'cerrado' ? null : b.balance.get(yo) || 0,
    transferencias_pendientes: estado === 'esperando_pagos' ? pendientes(d).length : null,
    consumiste_cents: estado === 'cerrado' ? b.consumido.get(yo) || 0 : null,
    terminado_en: ts(d.viaje.terminado_en),
  };
}

const esActivo = (d, userId) => d.miembros.some((m) => m.user_id === userId && m.estado === 'activo');

// ─── Avisos ────────────────────────────────────────────────────────────────────────────────────────────────────

const ENTIDAD_PERSONA = 'user';
const ENTIDAD_VIAJE = 'viaje';
const cuerpo = (s) => recortar(s, 500);

async function avisar(client, { userId, type, body, payload, porPersona = null, viajeId }) {
  await notifs.create({
    user_id: userId, type, body: cuerpo(body), payload,
    // Un aviso que nombra a alguien queda atado a esa persona: si se da de baja, la anonimización lo vacía.
    related_entity_type: porPersona ? ENTIDAD_PERSONA : ENTIDAD_VIAJE,
    related_entity_id: porPersona || viajeId,
    client,
  });
}

// ─── Bloqueos ──────────────────────────────────────────────────────────────────────────────────────────────────

async function bloquearViaje(client, viajeId) {
  const { rows: [v] } = await client.query(`SELECT id, estado FROM viajes WHERE id=$1 FOR UPDATE`, [viajeId]);
  return v || null;
}

async function bloquearCuentas(client, ids) {
  const { rows } = await client.query(
    `SELECT id, status FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE`, [[...new Set(ids)]]);
  return new Map(rows.map((u) => [u.id, u.status]));
}

async function miembroDe(client, viajeId, userId) {
  const { rows: [m] } = await client.query(
    `SELECT id, estado, invitado_por FROM viaje_miembros WHERE viaje_id=$1 AND user_id=$2`, [viajeId, userId]);
  return m || null;
}

const esUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);

/**
 * Abre la transacción del viaje: lo bloquea y exige un miembro activo. Si no, el 404 de n325.
 * `fn(client, viaje)` devuelve `{status, body}`.
 */
async function enViaje(viajeId, userId, fn) {
  if (!esUuid(viajeId)) return noEncontrado();
  return pool.tx(async (client) => {
    const viaje = await bloquearViaje(client, viajeId);
    if (!viaje) return noEncontrado();
    const m = await miembroDe(client, viajeId, userId);
    if (!m || m.estado !== 'activo') return noEncontrado();
    return fn(client, viaje);
  });
}

// ─── Miembros: resolver a quién se invita (D119) ───────────────────────────────────────────────────────────────

/**
 * Resuelve cada miembro pedido a una cuenta. Por id: sólo un amigo aceptado y activo. Por @: lo mismo que la
 * búsqueda por @ de hoy (activo, con @, no uno mismo, sin bloqueo en ninguna dirección): un @ inexistente y uno no
 * invitable contestan igual. Devuelve `{ ids }` o `{ faltante }` con la entrada tal como vino.
 */
async function resolverMiembros(client, yo, pedidos) {
  const ids = [];
  for (const p of pedidos) {
    let id = null;
    if (p.user_id !== undefined) {
      const { rows: [r] } = await client.query(
        `SELECT f.friend_user_id AS id FROM friendships f JOIN users u ON u.id = f.friend_user_id
          WHERE f.user_id=$1 AND f.friend_user_id=$2 AND f.status='accepted' AND u.status='active'`, [yo, p.user_id]);
      id = r ? r.id : null;
    } else if (usernameSvc.habilitado()) {
      id = await usernameSvc.idVisibleEnBusqueda(yo, p.username, client);
    }
    if (!id) return { faltante: p };
    if (id !== yo && !ids.includes(id)) ids.push(id);
  }
  return { ids };
}

const MIEMBRO_NO_ENCONTRADO = (p) => respuesta(422, { error: 'viaje_member_not_found', member: p });

async function invitarEn(client, viajeId, yo, ids, nombreViaje) {
  const { rows: actuales } = await client.query(
    `SELECT m.user_id, m.estado, u.status FROM viaje_miembros m JOIN users u ON u.id = m.user_id
      WHERE m.viaje_id=$1`, [viajeId]);
  const porId = new Map(actuales.map((m) => [m.user_id, m]));
  const nuevos = ids.filter((id) => !['activo', 'invitado'].includes(porId.get(id)?.estado));
  const ocupados = actuales.filter((m) => ['activo', 'invitado'].includes(m.estado) && m.status !== 'deleted').length;
  if (ocupados + nuevos.length > MAX_MIEMBROS) return { error: conflicto('viaje_members_limit', { limit: MAX_MIEMBROS }) };
  const cuentas = await bloquearCuentas(client, [yo, ...nuevos]);
  if (nuevos.some((id) => cuentas.get(id) !== 'active')) {
    return { error: MIEMBRO_NO_ENCONTRADO({ user_id: null }) };
  }
  for (const id of nuevos) {
    if (porId.has(id)) {
      await client.query(
        `UPDATE viaje_miembros SET estado='invitado', invitado_por=$3, invitado_en=clock_timestamp(), respondido_en=NULL
          WHERE viaje_id=$1 AND user_id=$2`, [viajeId, id, yo]);
    } else {
      await client.query(
        `INSERT INTO viaje_miembros (viaje_id, user_id, estado, invitado_por) VALUES ($1, $2, 'invitado', $3)`,
        [viajeId, id, yo]);
    }
  }
  const { rows: [quien] } = await client.query(
    `SELECT first_name, last_name, status AS user_status FROM users WHERE id=$1`, [yo]);
  for (const id of nuevos) {
    await avisar(client, { userId: id, type: 'viaje_invitation_received', porPersona: yo, viajeId,
      body: `${nombreDe(quien)} te invitó al viaje ${nombreViaje}.`, payload: { viaje_id: viajeId } });
  }
  return { nuevos };
}

// ─── Rutas: viajes y miembros ──────────────────────────────────────────────────────────────────────────────────

/** GET /api/viajes?estado=abiertos|cerrados */
async function listar(userId, query) {
  const v = validar(consultaLista, query);
  if (!v.ok) return v.res;
  const { rows } = await pool.query(
    `SELECT v.id FROM viajes v JOIN viaje_miembros m ON m.viaje_id = v.id
      WHERE m.user_id=$1 AND m.estado='activo'
      ORDER BY v.created_at DESC, v.id DESC`, [userId]);
  const abiertos = []; const cerrados = [];
  for (const { id } of rows) {
    const d = await cargar(pool, id);
    const item = vistaEnLista(d, userId);
    (item.estado === 'cerrado' ? cerrados : abiertos).push(item);
  }
  cerrados.sort((a, b) => (b.fecha_desde || b.terminado_en || '').localeCompare(a.fecha_desde || a.terminado_en || ''));
  return respuesta(200, {
    contract: CONTRATO,
    viajes: (v.data.estado === 'cerrados' ? cerrados : abiertos).slice(0, MAX_LISTA),
    counts: { abiertos: abiertos.length, cerrados: cerrados.length },
  });
}

/** GET /api/viajes/invitaciones — las pendientes, de viajes abiertos. */
async function invitaciones(userId) {
  const { rows } = await pool.query(
    `SELECT v.id, v.nombre, v.fecha_desde, v.fecha_hasta, m.invitado_en,
            i.first_name, i.last_name, i.username, i.status AS user_status,
            (SELECT COUNT(*)::int FROM viaje_miembros x WHERE x.viaje_id = v.id AND x.estado='activo') AS personas
       FROM viaje_miembros m JOIN viajes v ON v.id = m.viaje_id
       LEFT JOIN users i ON i.id = m.invitado_por
      WHERE m.user_id=$1 AND m.estado='invitado' AND v.estado='abierto'
      ORDER BY m.invitado_en DESC, v.id DESC LIMIT ${MAX_LISTA}`, [userId]);
  return respuesta(200, { contract: CONTRATO, invitaciones: rows.map((r) => ({
    viaje_id: r.id, nombre: r.nombre, fecha_desde: fechaDe(r.fecha_desde), fecha_hasta: fechaDe(r.fecha_hasta),
    personas: r.personas, invitado_en: ts(r.invitado_en),
    invitado_por: r.user_status ? persona(r) : null,
  })) });
}

/** POST /api/viajes */
async function crear(userId, body) {
  const v = validar(cuerpoCrear, body);
  if (!v.ok) return v.res;
  const b = v.data;
  const pedido = hashDe({ nombre: b.nombre, fecha_desde: b.fecha_desde ?? null, fecha_hasta: b.fecha_hasta ?? null,
    miembros: b.miembros });
  const r = await pool.tx(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`payme/viajes/crear/${userId}`]);
    const { rows: [previo] } = await client.query(
      `SELECT id, pedido_hash FROM viajes WHERE creado_por=$1 AND idempotency_key=$2`, [userId, b.idempotency_key]);
    if (previo) {
      if (previo.pedido_hash !== pedido) return { res: conflicto('idempotency_key_conflict') };
      return { id: previo.id, status: 200 };
    }
    const resueltos = await resolverMiembros(client, userId, b.miembros);
    if (resueltos.faltante) return { res: MIEMBRO_NO_ENCONTRADO(resueltos.faltante) };
    if (resueltos.ids.length + 1 > MAX_MIEMBROS) return { res: conflicto('viaje_members_limit', { limit: MAX_MIEMBROS }) };
    const cuentas = await bloquearCuentas(client, [userId]);
    if (cuentas.get(userId) !== 'active') return { res: respuesta(403, { error: 'user_suspended' }) };
    const { rows: [viaje] } = await client.query(
      `INSERT INTO viajes (nombre, fecha_desde, fecha_hasta, creado_por, idempotency_key, pedido_hash)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [b.nombre, b.fecha_desde ?? null, b.fecha_hasta ?? null, userId, b.idempotency_key, pedido]);
    await client.query(
      `INSERT INTO viaje_miembros (viaje_id, user_id, estado, respondido_en) VALUES ($1, $2, 'activo', clock_timestamp())`,
      [viaje.id, userId]);
    const inv = await invitarEn(client, viaje.id, userId, resueltos.ids, b.nombre);
    if (inv.error) throw Object.assign(new Error('viaje_invitar_rollback'), { respuesta: inv.error });
    return { id: viaje.id, status: 201 };
  }).catch((err) => {
    if (err.respuesta) return { res: err.respuesta };
    throw err;
  });
  if (r.res) return r.res;
  logger.audit('viaje_created', { viaje_id: r.id, replay: r.status === 200 });
  return respuesta(r.status, { contract: CONTRATO, viaje: vistaViaje(await cargar(pool, r.id), userId) });
}

/** GET /api/viajes/:id — y, si el viaje ya no tiene nada pendiente (V5), lo pasa a Cerrados. */
async function detalle(userId, viajeId) {
  if (!esUuid(viajeId)) return noEncontrado();
  let d = await cargar(pool, viajeId);
  if (!d || !esActivo(d, userId)) return noEncontrado();
  if (d.viaje.estado === 'esperando_pagos' && estadoEfectivo(d) === 'cerrado') {
    await pool.tx(async (client) => {
      if (await bloquearViaje(client, viajeId)) await terminarSiCorresponde(client, viajeId);
    });
    d = await cargar(pool, viajeId);
  }
  return respuesta(200, { contract: CONTRATO, viaje: vistaViaje(d, userId) });
}

/** POST /api/viajes/:id/miembros */
async function invitar(userId, viajeId, body) {
  const v = validar(cuerpoInvitar, body);
  if (!v.ok) return v.res;
  const r = await enViaje(viajeId, userId, async (client, viaje) => {
    if (viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: viaje.estado });
    const resueltos = await resolverMiembros(client, userId, v.data.miembros);
    if (resueltos.faltante) return MIEMBRO_NO_ENCONTRADO(resueltos.faltante);
    const { rows: [vj] } = await client.query(`SELECT nombre FROM viajes WHERE id=$1`, [viajeId]);
    const inv = await invitarEn(client, viajeId, userId, resueltos.ids, vj.nombre);
    if (inv.error) throw Object.assign(new Error('viaje_invitar_rollback'), { respuesta: inv.error });
    return respuesta(200, null);
  }).catch((err) => {
    if (err.respuesta) return err.respuesta;
    throw err;
  });
  if (r.status !== 200) return r;
  return respuesta(200, { contract: CONTRATO, viaje: vistaViaje(await cargar(pool, viajeId), userId) });
}

/** POST /api/viajes/:id/aceptar — la invitación propia. */
async function aceptar(userId, viajeId) {
  if (!esUuid(viajeId)) return noEncontrado();
  const r = await pool.tx(async (client) => {
    const viaje = await bloquearViaje(client, viajeId);
    if (!viaje) return noEncontrado();
    const m = await miembroDe(client, viajeId, userId);
    if (m?.estado === 'activo') return respuesta(200, null);
    if (m?.estado !== 'invitado') return noEncontrado();
    if (viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: viaje.estado });
    const cuentas = await bloquearCuentas(client, [userId]);
    if (cuentas.get(userId) !== 'active') return respuesta(403, { error: 'user_suspended' });
    await client.query(
      `UPDATE viaje_miembros SET estado='activo', respondido_en=clock_timestamp() WHERE viaje_id=$1 AND user_id=$2`,
      [viajeId, userId]);
    return respuesta(200, null);
  });
  if (r.status !== 200) return r;
  return respuesta(200, { contract: CONTRATO, viaje: vistaViaje(await cargar(pool, viajeId), userId) });
}

/** POST /api/viajes/:id/rechazar — avisa a quien invitó (diseño 1f). */
async function rechazar(userId, viajeId) {
  if (!esUuid(viajeId)) return noEncontrado();
  return pool.tx(async (client) => {
    const viaje = await bloquearViaje(client, viajeId);
    if (!viaje) return noEncontrado();
    const m = await miembroDe(client, viajeId, userId);
    if (m?.estado === 'rechazado') return respuesta(200, { contract: CONTRATO, viaje_id: viajeId, estado: 'rechazado' });
    if (m?.estado === 'activo') return conflicto('viaje_invitation_not_pending');
    if (m?.estado !== 'invitado') return noEncontrado();
    const cuentas = await bloquearCuentas(client, [userId, ...(m.invitado_por ? [m.invitado_por] : [])]);
    await client.query(
      `UPDATE viaje_miembros SET estado='rechazado', respondido_en=clock_timestamp() WHERE viaje_id=$1 AND user_id=$2`,
      [viajeId, userId]);
    if (m.invitado_por && cuentas.get(m.invitado_por) === 'active') {
      const { rows: [yo] } = await client.query(
        `SELECT first_name, last_name, status AS user_status FROM users WHERE id=$1`, [userId]);
      const { rows: [vj] } = await client.query(`SELECT nombre FROM viajes WHERE id=$1`, [viajeId]);
      await avisar(client, { userId: m.invitado_por, type: 'viaje_invitation_rejected', porPersona: userId, viajeId,
        body: `${nombreDe(yo)} rechazó tu invitación al viaje ${vj.nombre}.`, payload: { viaje_id: viajeId } });
    }
    return respuesta(200, { contract: CONTRATO, viaje_id: viajeId, estado: 'rechazado' });
  });
}

/** POST /api/viajes/:id/salir — D242-2: sólo sin consumos. */
async function salir(userId, viajeId) {
  return enViaje(viajeId, userId, async (client, viaje) => {
    if (viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: viaje.estado });
    const { rows: [c] } = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM viaje_selecciones s JOIN viaje_ticket_items i ON i.id = s.item_id
                   JOIN viaje_tickets t ON t.id = i.ticket_id WHERE t.viaje_id=$1 AND s.user_id=$2) AS eligio,
         EXISTS (SELECT 1 FROM viaje_tickets t WHERE t.viaje_id=$1 AND t.pagado_por=$2) AS pago,
         EXISTS (SELECT 1 FROM viaje_ticket_personas p JOIN viaje_tickets t ON t.id = p.ticket_id
                  WHERE t.viaje_id=$1 AND p.user_id=$2 AND t.forma='iguales' AND p.presente) AS presente`,
      [viajeId, userId]);
    const motivo = c.eligio ? 'selection' : c.pago ? 'paid_ticket' : c.presente ? 'present_in_equal_split' : null;
    if (motivo) return conflicto('viaje_member_cannot_leave', { reason: motivo });
    await bloquearCuentas(client, [userId]);
    await client.query(
      `DELETE FROM viaje_ticket_personas p USING viaje_tickets t
        WHERE t.id = p.ticket_id AND t.viaje_id=$1 AND p.user_id=$2`, [viajeId, userId]);
    await client.query(
      `UPDATE viaje_miembros SET estado='salio', respondido_en=clock_timestamp() WHERE viaje_id=$1 AND user_id=$2`,
      [viajeId, userId]);
    return respuesta(200, { contract: CONTRATO, viaje_id: viajeId, estado: 'salio' });
  });
}

// ─── Tickets ───────────────────────────────────────────────────────────────────────────────────────────────────

const RECIBO_INVALIDO = (reason) => respuesta(422, { error: 'viaje_ticket_receipt_invalid', reason });

/** El ticket ya cargado en este viaje por ese recibo o esa huella, o la marca de que el recibo es de otro viaje. */
async function buscarDuplicado(db, viajeId, recibo) {
  const { rows: [porRecibo] } = await db.query(
    `SELECT id, viaje_id, pagado_por, created_at FROM viaje_tickets WHERE recibo_jti=$1`, [recibo.id]);
  if (porRecibo && porRecibo.viaje_id !== viajeId) return { otroViaje: true };
  if (porRecibo) return { ticket: porRecibo };
  if (!recibo.huella) return {};
  const { rows: [porHuella] } = await db.query(
    `SELECT id, viaje_id, pagado_por, created_at FROM viaje_tickets WHERE viaje_id=$1 AND huella=$2`,
    [viajeId, recibo.huella]);
  return porHuella ? { ticket: porHuella } : {};
}

function yaCargado(t, d) {
  const m = d.miembros.find((x) => x.user_id === t.pagado_por);
  return { por: m?.id ?? null, ...(m ? persona(m) : {}), en: ts(t.created_at) };
}

/** POST /api/viajes/:id/tickets/check — ¿este escaneo ya está en el viaje? (diseño 1k) */
async function revisarTicket(userId, viajeId, body) {
  const v = validar(cuerpoRecibo, body);
  if (!v.ok) return v.res;
  if (!esUuid(viajeId)) return noEncontrado();
  const d = await cargar(pool, viajeId);
  if (!d || !esActivo(d, userId)) return noEncontrado();
  const recibo = origenItems.verificarRecibo(v.data.ocr_receipt, { userId });
  if (recibo.status !== 'accepted') return RECIBO_INVALIDO(recibo.reason || 'malformed');
  const dup = await buscarDuplicado(pool, viajeId, recibo);
  if (dup.otroViaje) return conflicto('viaje_ticket_receipt_used');
  return respuesta(200, { contract: CONTRATO,
    duplicado: dup.ticket ? { ticket_id: dup.ticket.id, ...yaCargado(dup.ticket, d) } : null });
}

/** POST /api/viajes/:id/tickets — quien carga es quien pagó (regla 3). */
async function cargarTicket(userId, viajeId, body) {
  const v = validar(cuerpoTicket, body);
  if (!v.ok) return v.res;
  const b = v.data;
  if (!esUuid(viajeId)) return noEncontrado();
  // El recibo se verifica antes de la transacción (es puro); su uso único, adentro.
  const recibo = origenItems.verificarRecibo(b.ocr_receipt, { userId });
  const pedido = hashDe({ forma: b.forma, tipo_lugar: b.tipo_lugar, lugar: b.lugar ?? null,
    fecha_ticket: b.fecha_ticket ?? null, hora_ticket: b.hora_ticket ?? null, items: b.items, recibo: b.ocr_receipt });
  const r = await enViaje(viajeId, userId, async (client, viaje) => {
    const { rows: [previo] } = await client.query(
      `SELECT id, pedido_hash FROM viaje_tickets WHERE viaje_id=$1 AND pagado_por=$2 AND idempotency_key=$3`,
      [viajeId, userId, b.idempotency_key]);
    if (previo) {
      return previo.pedido_hash === pedido ? { ticketId: previo.id, status: 200 } : conflicto('idempotency_key_conflict');
    }
    if (viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: viaje.estado });
    if (recibo.status !== 'accepted') return RECIBO_INVALIDO(recibo.reason || 'malformed');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`payme/viajes/recibo/${recibo.id}`]);
    const dup = await buscarDuplicado(client, viajeId, recibo);
    if (dup.otroViaje) return conflicto('viaje_ticket_receipt_used');
    if (dup.ticket) return { ticketId: dup.ticket.id, status: 200, duplicado: dup.ticket };
    const { rows: [{ n }] } = await client.query(`SELECT COUNT(*)::int AS n FROM viaje_tickets WHERE viaje_id=$1`, [viajeId]);
    if (n >= MAX_TICKETS) return conflicto('viaje_tickets_limit', { limit: MAX_TICKETS });
    let monto = 0;
    for (const i of b.items) monto += lineTotalCents(i.price_cents, i.quantity);
    if (!Number.isSafeInteger(monto) || monto <= 0) return respuesta(422, { error: 'viaje_ticket_amount_invalid' });
    const { rows: miembros } = await client.query(
      `SELECT m.user_id FROM viaje_miembros m JOIN users u ON u.id = m.user_id
        WHERE m.viaje_id=$1 AND m.estado='activo' AND u.status <> 'deleted' ORDER BY m.created_at, m.user_id`, [viajeId]);
    const cuentas = await bloquearCuentas(client, miembros.map((m) => m.user_id));
    if (cuentas.get(userId) !== 'active') return respuesta(403, { error: 'user_suspended' });
    const { rows: [t] } = await client.query(
      `INSERT INTO viaje_tickets (viaje_id, pagado_por, forma, tipo_lugar, lugar, fecha_ticket, hora_ticket, monto_cents,
                                  huella, recibo_jti, idempotency_key, pedido_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [viajeId, userId, b.forma, b.tipo_lugar, b.lugar ?? null, b.fecha_ticket ?? null, b.hora_ticket ?? null, monto,
        recibo.huella ?? null, recibo.id, b.idempotency_key, pedido]);
    for (const [k, i] of b.items.entries()) {
      await client.query(
        `INSERT INTO viaje_ticket_items (ticket_id, orden, nombre, price_cents, quantity) VALUES ($1, $2, $3, $4, $5)`,
        [t.id, k, i.name, i.price_cents, i.quantity]);
    }
    for (const [k, m] of miembros.entries()) {
      await client.query(`INSERT INTO viaje_ticket_personas (ticket_id, user_id, orden) VALUES ($1, $2, $3)`,
        [t.id, m.user_id, k]);
    }
    const { rows: [quien] } = await client.query(
      `SELECT u.first_name, u.last_name, u.status AS user_status, v.nombre
         FROM users u, viajes v WHERE u.id=$1 AND v.id=$2`, [userId, viajeId]);
    const donde = b.lugar ? `: ${b.lugar}` : '';
    const accion = b.forma === 'consumo' ? ' Elige lo que consumiste.'
      : b.forma === 'iguales' ? ' Se divide en partes iguales.' : ' Lo paga todo.';
    for (const m of miembros) {
      if (m.user_id === userId) continue;
      await avisar(client, { userId: m.user_id, type: 'viaje_ticket_added', porPersona: userId, viajeId,
        body: `${nombreDe(quien)} cargó un ticket nuevo en ${quien.nombre}${donde}.${accion}`,
        payload: { viaje_id: viajeId, ticket_id: t.id } });
    }
    return { ticketId: t.id, status: 201 };
  });
  if (!r.ticketId) return r;
  const d = await cargar(pool, viajeId);
  const t = d.tickets.find((x) => x.id === r.ticketId);
  logger.audit('viaje_ticket', { viaje_id: viajeId, ticket_id: r.ticketId, resultado: r.duplicado ? 'duplicado'
    : r.status === 201 ? 'cargado' : 'reintento' });
  return respuesta(r.status, { contract: CONTRATO, ticket: vistaTicket(t, d, userId),
    ya_cargado: r.duplicado ? yaCargado(r.duplicado, d) : null });
}

async function ticketDe(userId, viajeId, ticketId) {
  if (!esUuid(viajeId)) return { res: noEncontrado() };
  const d = await cargar(pool, viajeId);
  if (!d || !esActivo(d, userId)) return { res: noEncontrado() };
  const t = esUuid(ticketId) ? d.tickets.find((x) => x.id === ticketId) : null;
  if (!t) return { res: respuesta(404, { error: 'viaje_ticket_not_found' }) };
  return { d, t };
}

/** GET /api/viajes/:id/tickets/:tid */
async function verTicket(userId, viajeId, ticketId) {
  const { res, d, t } = await ticketDe(userId, viajeId, ticketId);
  if (res) return res;
  if (estadoEfectivo(d) === 'cerrado') return conflicto('viaje_closed');
  return respuesta(200, { contract: CONTRATO, ticket: vistaTicket(t, d, userId) });
}

/** Bajo el lock del viaje: el ticket, sus personas y sus renglones. */
async function ticketBloqueado(client, viajeId, ticketId) {
  if (!esUuid(ticketId)) return null;
  const { rows: [t] } = await client.query(
    `SELECT id, forma, pagado_por FROM viaje_tickets WHERE id=$1 AND viaje_id=$2`, [ticketId, viajeId]);
  return t || null;
}

/** PUT /api/viajes/:id/tickets/:tid/seleccion — lo que consumí, con porciones como en la mesa. */
async function elegir(userId, viajeId, ticketId, body) {
  const v = validar(cuerpoSeleccion, body);
  if (!v.ok) return v.res;
  const r = await enViaje(viajeId, userId, async (client, viaje) => {
    const t = await ticketBloqueado(client, viajeId, ticketId);
    if (!t) return respuesta(404, { error: 'viaje_ticket_not_found' });
    // Bajo el lock del viaje: si alguien lo cerró mientras elegía, ya no se puede.
    if (viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: viaje.estado });
    if (t.forma !== 'consumo') return conflicto('viaje_ticket_not_selectable', { forma: t.forma });
    const { rowCount: soyPersona } = await client.query(
      `SELECT 1 FROM viaje_ticket_personas WHERE ticket_id=$1 AND user_id=$2`, [t.id, userId]);
    if (!soyPersona) return conflicto('viaje_ticket_not_in_snapshot');
    const { rows: items } = await client.query(`SELECT id FROM viaje_ticket_items WHERE ticket_id=$1`, [t.id]);
    const delTicket = new Set(items.map((i) => i.id));
    const desconocido = v.data.items.find((i) => !delTicket.has(i.item_id));
    if (desconocido) return respuesta(422, { error: 'viaje_ticket_item_unknown', item_id: desconocido.item_id });
    const { rows: previas } = await client.query(
      `SELECT s.item_id, s.fraction_bps FROM viaje_selecciones s JOIN viaje_ticket_items i ON i.id = s.item_id
        WHERE i.ticket_id=$1 AND s.user_id=$2`, [t.id, userId]);
    const previa = new Map(previas.map((p) => [p.item_id, p.fraction_bps]));
    // Nunca por encima del entero (decisión 81, como la mesa): sólo se mira lo que esta persona SUBE.
    const suben = v.data.items.filter((i) => i.fraction_bps > (previa.get(i.item_id) || 0));
    if (suben.length) {
      const { rows: ajenas } = await client.query(
        `SELECT item_id, SUM(fraction_bps)::int AS ajeno FROM viaje_selecciones
          WHERE item_id = ANY($1::uuid[]) AND user_id <> $2 GROUP BY item_id`, [suben.map((i) => i.item_id), userId]);
      const ajeno = new Map(ajenas.map((a) => [a.item_id, a.ajeno]));
      for (const i of suben) {
        const otros = ajeno.get(i.item_id) || 0;
        if (otros + i.fraction_bps > 10000) {
          return conflicto('viaje_fraction_exceeds_item', { item_id: i.item_id, remaining_bps: restanteDe(otros) });
        }
      }
    }
    await bloquearCuentas(client, [userId]);
    await client.query(
      `DELETE FROM viaje_selecciones s USING viaje_ticket_items i
        WHERE i.id = s.item_id AND i.ticket_id=$1 AND s.user_id=$2 AND NOT (s.item_id = ANY($3::uuid[]))`,
      [t.id, userId, v.data.items.map((i) => i.item_id)]);
    for (const i of v.data.items) {
      await client.query(
        `INSERT INTO viaje_selecciones (item_id, user_id, fraction_bps) VALUES ($1, $2, $3)
         ON CONFLICT (item_id, user_id) DO UPDATE SET fraction_bps = EXCLUDED.fraction_bps`,
        [i.item_id, userId, i.fraction_bps]);
    }
    await client.query(
      `UPDATE viaje_ticket_personas SET listo_en = CASE WHEN $3 THEN COALESCE(listo_en, clock_timestamp()) END
        WHERE ticket_id=$1 AND user_id=$2`, [t.id, userId, v.data.listo]);
    return respuesta(200, null);
  });
  if (r.status !== 200) return r;
  const { d, t } = await ticketDe(userId, viajeId, ticketId);
  return respuesta(200, { contract: CONTRATO, ticket: vistaTicket(t, d, userId) });
}

/** PUT /api/viajes/:id/tickets/:tid/presentes — D242-6: quien pagó destilda a quien no estuvo. */
async function marcarPresentes(userId, viajeId, ticketId, body) {
  const v = validar(cuerpoPresentes, body);
  if (!v.ok) return v.res;
  const r = await enViaje(viajeId, userId, async (client, viaje) => {
    const t = await ticketBloqueado(client, viajeId, ticketId);
    if (!t) return respuesta(404, { error: 'viaje_ticket_not_found' });
    if (viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: viaje.estado });
    if (t.forma !== 'iguales') return conflicto('viaje_ticket_not_equal_split', { forma: t.forma });
    if (t.pagado_por !== userId) return conflicto('viaje_ticket_not_yours');
    const { rows: personas } = await client.query(
      `SELECT p.user_id, m.id AS miembro_id FROM viaje_ticket_personas p
         JOIN viaje_miembros m ON m.viaje_id=$2 AND m.user_id = p.user_id
        WHERE p.ticket_id=$1`, [t.id, viajeId]);
    const porMiembro = new Map(personas.map((p) => [p.miembro_id, p.user_id]));
    const desconocido = v.data.presentes.find((id) => !porMiembro.has(id));
    if (desconocido) return respuesta(422, { error: 'viaje_ticket_persona_unknown', miembro_id: desconocido });
    const presentes = v.data.presentes.map((id) => porMiembro.get(id));
    await client.query(
      `UPDATE viaje_ticket_personas SET presente = (user_id = ANY($2::uuid[])) WHERE ticket_id=$1`, [t.id, presentes]);
    return respuesta(200, null);
  });
  if (r.status !== 200) return r;
  const { d, t } = await ticketDe(userId, viajeId, ticketId);
  return respuesta(200, { contract: CONTRATO, ticket: vistaTicket(t, d, userId) });
}

// ─── Cierre y transferencias ───────────────────────────────────────────────────────────────────────────────────

/** Lo que pasaría al cerrar: a quién se le asigna lo no elegido (D242-4) y las transferencias. */
function planDeCierre(d) {
  const b = calc.balanceDelViaje(d.miembros.map((m) => m.user_id), d.tickets.map(paraCalculo), { cierre: true });
  const transferencias = calc.transferenciasMinimas(d.miembros.map((m) => ({ id: m.user_id, cents: b.balance.get(m.user_id) || 0 })));
  return { b, transferencias };
}

/** GET /api/viajes/:id/cierre — la hoja 1m, antes de cerrar. */
async function vistaPreviaCierre(userId, viajeId) {
  if (!esUuid(viajeId)) return noEncontrado();
  const d = await cargar(pool, viajeId);
  if (!d || !esActivo(d, userId)) return noEncontrado();
  if (d.viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: estadoEfectivo(d) });
  const { b, transferencias } = planDeCierre(d);
  const idPublico = new Map(d.miembros.map((m) => [m.user_id, m.id]));
  const asignaciones = [];
  for (const t of d.tickets) {
    for (const [u, c] of b.porTicket.get(t.id).asignado) {
      asignaciones.push({ ticket_id: t.id, lugar: t.lugar, fecha_ticket: fechaDe(t.fecha_ticket),
        miembro_id: idPublico.get(u), monto_cents: c });
    }
  }
  return respuesta(200, { contract: CONTRATO,
    todos_eligieron: asignaciones.length === 0, tickets: d.tickets.length, asignaciones,
    balances: d.miembros.filter((m) => m.estado === 'activo').map((m) => ({ miembro_id: m.id, balance_cents: b.balance.get(m.user_id) || 0 })),
    transferencias: transferencias.map((x) => ({ de: idPublico.get(x.de), a: idPublico.get(x.a), monto_cents: x.monto_cents })) });
}

/**
 * Bajo el lock del viaje: si no queda ninguna transferencia por pagar (las anuladas por baja no cuentan), pasa a
 * Cerrados y avisa una sola vez.
 */
async function terminarSiCorresponde(client, viajeId) {
  const { rows: [{ quedan }] } = await client.query(
    `SELECT COUNT(*)::int AS quedan FROM viaje_transferencias t
       JOIN users ud ON ud.id = t.de_user JOIN users ua ON ua.id = t.a_user
      WHERE t.viaje_id=$1 AND t.estado <> 'pagada' AND ud.status <> 'deleted' AND ua.status <> 'deleted'`, [viajeId]);
  if (quedan > 0) return false;
  const { rows: [v] } = await client.query(
    `UPDATE viajes SET estado='cerrado', terminado_en=clock_timestamp()
      WHERE id=$1 AND estado='esperando_pagos' RETURNING nombre`, [viajeId]);
  if (!v) return false;
  const { rows: miembros } = await client.query(
    `SELECT m.user_id FROM viaje_miembros m JOIN users u ON u.id = m.user_id
      WHERE m.viaje_id=$1 AND m.estado='activo' AND u.status <> 'deleted' ORDER BY m.user_id`, [viajeId]);
  await bloquearCuentas(client, miembros.map((m) => m.user_id));
  for (const m of miembros) {
    await avisar(client, { userId: m.user_id, type: 'viaje_finished', viajeId,
      body: `${v.nombre} quedó cerrado. Todos pagaron y ya está en Cerrados.`, payload: { viaje_id: viajeId } });
  }
  return true;
}

/** POST /api/viajes/:id/cerrar — D242-3: cualquier miembro, con aviso a todos. */
async function cerrar(userId, viajeId) {
  const r = await enViaje(viajeId, userId, async (client, viaje) => {
    if (viaje.estado !== 'abierto') return conflicto('viaje_not_open', { estado: viaje.estado });
    const d = await cargar(client, viajeId);
    const { b, transferencias } = planDeCierre(d);
    for (const t of d.tickets) {
      const r2 = b.porTicket.get(t.id);
      for (const p of t.personas) {
        await client.query(
          `UPDATE viaje_ticket_personas SET consumo_final_cents=$3, asignado_cierre_cents=$4 WHERE ticket_id=$1 AND user_id=$2`,
          [t.id, p.user_id, r2.consumo.get(p.user_id) || 0, r2.asignado.get(p.user_id) || 0]);
      }
      const fuera = [...r2.consumo.keys()].filter((u) => !t.personas.some((p) => p.user_id === u));
      if (fuera.length) throw new Error('viaje_cierre_consumo_fuera_del_ticket');
    }
    const activos = d.miembros.filter((m) => m.estado === 'activo' && vivo(m));
    await bloquearCuentas(client, [userId, ...activos.map((m) => m.user_id)]);
    for (const [k, x] of transferencias.entries()) {
      await client.query(
        `INSERT INTO viaje_transferencias (viaje_id, orden, de_user, a_user, monto_cents) VALUES ($1, $2, $3, $4, $5)`,
        [viajeId, k, x.de, x.a, x.monto_cents]);
    }
    await client.query(
      `UPDATE viajes SET estado='esperando_pagos', cerrado_por=$2, cerrado_en=clock_timestamp() WHERE id=$1`,
      [viajeId, userId]);
    const nombre = d.viaje.nombre;
    for (const m of activos) {
      if (m.user_id === userId) continue;
      const bal = b.balance.get(m.user_id) || 0;
      const texto = bal < 0 ? { body: `Se cerró ${nombre}. Debes ${montoEnTexto(-bal)}.` }
        : bal > 0 ? { body: `Se cerró ${nombre}. Te deben ${montoEnTexto(bal)}.` }
          : { body: `Se cerró ${nombre}. Estás a mano.` };
      await avisar(client, { userId: m.user_id, type: 'viaje_closed', viajeId, ...texto, payload: { viaje_id: viajeId } });
    }
    // Sin transferencias (o sólo con cuentas dadas de baja), pasa directo a Cerrados.
    await terminarSiCorresponde(client, viajeId);
    return respuesta(200, null);
  });
  if (r.status !== 200) return r;
  logger.audit('viaje_closed', { viaje_id: viajeId });
  return respuesta(200, { contract: CONTRATO, viaje: vistaViaje(await cargar(pool, viajeId), userId) });
}

const ACCIONES = Object.freeze({
  // acción: [quién la hace, de qué estados, a qué estado]
  pague: { rol: 'de', desde: ['pendiente'], a: 'marcada', igual: ['marcada'] },
  deshacer: { rol: 'de', desde: ['marcada'], a: 'pendiente', igual: ['pendiente'] },
  recibi: { rol: 'a', desde: ['pendiente', 'marcada'], a: 'pagada', igual: ['pagada'] },
  'no-llego': { rol: 'a', desde: ['marcada'], a: 'pendiente', igual: ['pendiente'] },
});

/** POST /api/viajes/:id/transferencias/:trid/{pague|deshacer|recibi|no-llego} — D242-1. */
async function marcarTransferencia(userId, viajeId, transferenciaId, accion) {
  const a = ACCIONES[accion];
  if (!a) return respuesta(404, { error: 'not_found' });
  const r = await enViaje(viajeId, userId, async (client, viaje) => {
    if (viaje.estado !== 'esperando_pagos') return conflicto('viaje_not_waiting_payments', { estado: viaje.estado });
    const { rows: [tr] } = esUuid(transferenciaId) ? await client.query(
      `SELECT t.*, ud.status AS de_status, ua.status AS a_status
         FROM viaje_transferencias t JOIN users ud ON ud.id = t.de_user JOIN users ua ON ua.id = t.a_user
        WHERE t.id=$1 AND t.viaje_id=$2 FOR UPDATE OF t`, [transferenciaId, viajeId]) : { rows: [] };
    if (!tr) return respuesta(404, { error: 'viaje_transfer_not_found' });
    const mio = a.rol === 'de' ? tr.de_user : tr.a_user;
    if (mio !== userId) return conflicto('viaje_transfer_not_yours');
    if (tr.de_status === 'deleted' || tr.a_status === 'deleted') return conflicto('viaje_transfer_voided');
    if (a.igual.includes(tr.estado)) return respuesta(200, { cambio: false });
    if (!a.desde.includes(tr.estado)) return conflicto('viaje_transfer_state', { estado: tr.estado });
    const otro = a.rol === 'de' ? tr.a_user : tr.de_user;
    await bloquearCuentas(client, [userId, otro]);
    await client.query(
      `UPDATE viaje_transferencias SET estado=$2::text,
              marcada_en = CASE WHEN $2::text = 'marcada' THEN clock_timestamp() WHEN $2::text = 'pendiente' THEN NULL
                                ELSE marcada_en END,
              pagada_en = CASE WHEN $2::text = 'pagada' THEN clock_timestamp() ELSE NULL END
        WHERE id=$1`, [tr.id, a.a]);
    const { rows: [yo] } = await client.query(
      `SELECT u.first_name, u.last_name, u.status AS user_status, v.nombre FROM users u, viajes v WHERE u.id=$1 AND v.id=$2`,
      [userId, viajeId]);
    const monto = Number(tr.monto_cents);
    if (accion === 'pague') {
      await avisar(client, { userId: otro, type: 'viaje_transfer_marked', porPersona: userId, viajeId,
        body: `${nombreDe(yo)} marcó que te pagó ${montoEnTexto(monto)} en ${yo.nombre}.`,
        payload: { viaje_id: viajeId, transferencia_id: tr.id } });
    } else if (accion === 'no-llego') {
      await avisar(client, { userId: otro, type: 'viaje_transfer_not_received', porPersona: userId, viajeId,
        body: `${nombreDe(yo)} dice que no le llegó tu pago de ${montoEnTexto(monto)} en ${yo.nombre}.`,
        payload: { viaje_id: viajeId, transferencia_id: tr.id } });
    }
    if (a.a === 'pagada') await terminarSiCorresponde(client, viajeId);
    return respuesta(200, { cambio: true });
  });
  if (r.status !== 200) return r;
  const d = await cargar(pool, viajeId);
  const idPublico = new Map(d.miembros.map((m) => [m.user_id, m.id]));
  const tr = d.transferencias.find((x) => x.id === transferenciaId);
  return respuesta(200, { contract: CONTRATO, transferencia: vistaTransferencia(tr, idPublico, userId),
    viaje_estado: estadoEfectivo(d), transferencias_pendientes: pendientes(d).length });
}

/** GET /api/viajes/:id/resumen — Cerrados (D240-17): sólo lo propio. */
async function resumen(userId, viajeId) {
  const det = await detalle(userId, viajeId);
  if (det.status !== 200) return det;
  const d = await cargar(pool, viajeId);
  if (estadoEfectivo(d) !== 'cerrado') return conflicto('viaje_not_closed', { estado: estadoEfectivo(d) });
  const b = balance(d);
  const porTipo = new Map(TIPOS_LUGAR.map((t) => [t, 0]));
  const lugares = [];
  for (const t of d.tickets) {
    const mio = b.porTicket.get(t.id).consumo.get(userId) || 0;
    const pague = t.pagado_por === userId;
    if (!mio && !pague) continue;
    porTipo.set(t.tipo_lugar, porTipo.get(t.tipo_lugar) + mio);
    const { mio: platos } = mioPorPlato(t, userId);
    lugares.push({
      ticket_id: t.id, lugar: t.lugar, tipo_lugar: t.tipo_lugar, fecha_ticket: fechaDe(t.fecha_ticket),
      forma: t.forma, pagaste_tu: pague, mi_monto_cents: mio,
      asignado_al_cierre_cents: b.porTicket.get(t.id).asignado.get(userId) || 0,
      items: t.forma === 'consumo' ? t.items.filter((i) => platos.has(i.id)).map((i) => ({
        name: i.nombre, fraction_bps: platos.get(i.id).bps, amount_cents: platos.get(i.id).monto })) : [],
    });
  }
  const mias = d.transferencias.filter((tr) => tr.estado === 'pagada');
  const suma = (xs) => xs.reduce((s, tr) => s + tr.monto_cents, 0);
  return respuesta(200, { contract: CONTRATO, resumen: {
    viaje_id: viajeId, nombre: d.viaje.nombre, fecha_desde: fechaDe(d.viaje.fecha_desde),
    fecha_hasta: fechaDe(d.viaje.fecha_hasta), personas: d.miembros.filter((m) => m.estado === 'activo').length,
    consumiste_cents: b.consumido.get(userId) || 0,
    pagaste_en_tickets_cents: b.pagado.get(userId) || 0,
    te_transfirieron_cents: suma(mias.filter((tr) => tr.a_user === userId)),
    transferiste_cents: suma(mias.filter((tr) => tr.de_user === userId)),
    por_tipo_de_lugar: TIPOS_LUGAR.filter((t) => porTipo.get(t) > 0).map((t) => ({ tipo_lugar: t, monto_cents: porTipo.get(t) })),
    lugares,
  } });
}

module.exports = {
  CONTRATO, MAX_MIEMBROS, MAX_TICKETS, FORMAS, TIPOS_LUGAR, ESTADOS, ESTADOS_TRANSFERENCIA, ETIQUETA_HUELLA,
  habilitado, forzarParaTests, capacidad, huellaDelTicket, huellaDeLectura, NO_ENCONTRADO,
  listar, invitaciones, crear, detalle, invitar, aceptar, rechazar, salir,
  revisarTicket, cargarTicket, verTicket, elegir, marcarPresentes,
  vistaPreviaCierre, cerrar, marcarTransferencia, resumen,
};
