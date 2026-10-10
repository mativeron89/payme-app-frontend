/**
 * services/ocultamientos.js — v2.169.0 · AB-OCULTAR-MESAS · decisiones 238 y 239 de Mati.
 *
 * Cada persona puede borrar de SU app una mesa terminada (y, si quiere, «su historial») o un pago suelto. Es
 * OCULTAR por persona, nunca borrar: ninguna fila existente se toca. Las dos tablas (db/migrate_ocultamientos_
 * v2.169.0.sql) guardan la preferencia; deshacer borra esa fila y nada más.
 *
 * 🔴 QUIÉN LEE ESTO Y QUIÉN NO. Sólo las superficies del PROPIO usuario filtran lo oculto: Tus mesas, el
 * historial y los movimientos, Estadísticas (y lo que deriva: Tus restaurantes, Qué comés, Evolución, el tope
 * 413), el historial informativo y los avisos. NUNCA el agente (D142/D206), OPS, el outbox, la liquidación, la
 * garantía, la conciliación, la idempotencia de dinero ni lo que ven los demás participantes: «para los patrones
 * de consumo» (D238) el servidor sigue viendo todo. tests/ocultamientos.test.js fija qué archivos pueden
 * requerir este módulo.
 *
 * La matriz (plan OK 2026-10-09, D2). M = mesa oculta sin historial, MH = con su historial, P = pago suelto:
 *   · Tus mesas e historial informativo: sale la mesa en M y MH;
 *   · historial y movimientos (y su detalle): sale el pago en MH y en P; en M el historial queda («No» a
 *     «¿Borrar también su historial?»);
 *   · Estadísticas y derivadas: sale en M, MH y P (lo borrado deja de contar, D238 elección 3);
 *   · avisos: sale todo aviso cuya mesa esté oculta (M o MH), lista y campana con el mismo fragmento.
 * Excepción declarada (D4): el acceso directo por código (`GET /api/mesas/:code` y sus satélites, «Unirme con
 * código» de quien ya participa) NO filtra: es una regla de acceso, no un listado, y deja n325 intacto.
 */
'use strict';

const { z } = require('zod');
const pool = require('../db/pool');

/**
 * «Terminada» (D1): lo que muestra «Tus mesas», la lectura literal de D238 («pagadas, cerradas, vencidas,
 * canceladas o que cerraron sin cobro»). Son los 12 estados de la FSM menos los tres en curso: exactamente el
 * complemento de `TU_MESA_EN_CURSO` de App Frontend, así el front nunca ofrece deslizar una tarjeta que el
 * servidor rechaza. Ocultar no toca la liquidación ni la garantía: nada del servidor lee estas tablas. Lo único
 * que revive es `fully_paid` (un reembolso la devuelve a `open`, services/paymentProcessor.js); si pasa,
 * reaparece en Inicio porque `GET /mesas/open` nunca filtra.
 * Un estado desconocido no se oculta (fail-closed). El test lo contrasta contra `TRANSITIONS.mesa`.
 */
const MESA_ESTADOS_EN_CURSO = Object.freeze(['pending_auth', 'open', 'partially_paid']);
const MESA_ESTADOS_OCULTABLES = Object.freeze([
  'fully_paid', 'expired', 'settling', 'settled', 'dispersing', 'completed', 'auth_failed', 'cancelled', 'dispersed',
]);
function mesaOcultable(status) {
  return typeof status === 'string' && MESA_ESTADOS_OCULTABLES.includes(status);
}

/** La capacidad que publica `GET /api/config` en `features.hide_from_app`. */
function capacidad() {
  return { supported: true, enabled: true, hideable_mesa_statuses: [...MESA_ESTADOS_OCULTABLES] };
}

/** `PUT /api/mesas/:code/hidden`: la pregunta de D239 siempre se hace, así que el booleano es obligatorio. */
const cuerpoOcultarMesa = z.object({ include_history: z.boolean() }).strict();

// ─── Los fragmentos SQL: UNA definición por regla de la matriz ───────────────────────────────────────────────
// Reciben expresiones SQL (columnas o parámetros), nunca valores: no hay interpolación de datos.

/** La mesa NO está oculta para el usuario (M o MH). Tus mesas, Estadísticas en base consumo, informativo. */
function mesaVisibleSql(mesaId, userId) {
  return `NOT EXISTS (SELECT 1 FROM mesas_ocultas mo WHERE mo.user_id = ${userId} AND mo.mesa_id = ${mesaId})`;
}

/** El pago sigue en el historial: ni suelto oculto (P) ni de una mesa oculta con su historial (MH). */
function pagoEnHistorialSql(pa, userId) {
  return `NOT EXISTS (SELECT 1 FROM pagos_ocultos po WHERE po.user_id = ${userId} AND po.payment_attempt_id = ${pa}.id)
          AND NOT EXISTS (SELECT 1 FROM mesas_ocultas mo WHERE mo.user_id = ${userId} AND mo.mesa_id = ${pa}.mesa_id
                           AND mo.include_history)`;
}

/** El pago cuenta en Estadísticas: ni suelto oculto (P) ni de una mesa oculta, con o sin historial (M, MH). */
function pagoEnEstadisticasSql(pa, userId) {
  return `NOT EXISTS (SELECT 1 FROM pagos_ocultos po WHERE po.user_id = ${userId} AND po.payment_attempt_id = ${pa}.id)
          AND ${mesaVisibleSql(`${pa}.mesa_id`, userId)}`;
}

/**
 * El aviso sigue a la vista: su mesa no está oculta por su destinatario. La mesa sale de `related_entity_*` por
 * los cuatro caminos que usan los emisores (todas columnas NOT NULL, por PK); el payload no sirve, porque 4 de
 * los 5 avisos de tipo «mesa» no traen el código. Los demás tipos (amistad, wallet, propinas) no tienen mesa.
 */
function avisoVisibleSql(n) {
  return `NOT EXISTS (
            SELECT 1 FROM mesas_ocultas mo
             WHERE mo.user_id = ${n}.user_id
               AND mo.mesa_id = CASE ${n}.related_entity_type
                     WHEN 'mesa' THEN ${n}.related_entity_id
                     WHEN 'payment_attempt' THEN (SELECT pa.mesa_id FROM payment_attempts pa WHERE pa.id = ${n}.related_entity_id)
                     WHEN 'invitation' THEN (SELECT i.mesa_id FROM invitations i WHERE i.id = ${n}.related_entity_id)
                     WHEN 'join_request' THEN (SELECT j.mesa_id FROM mesa_join_requests j WHERE j.id = ${n}.related_entity_id)
                   END)`;
}

// ─── Las rutas ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * La mesa por código, sólo si la persona tiene HUELLA en ella: quien la ve en alguna superficie propia. Es la
 * unión de titular, participante activo, claim propio (cualquier estado), casillero propio, selección
 * informativa propia y pago propio. No se reusa `requireMesaParticipant`: deja afuera a quien eligió
 * con una invitación que después venció, que ve la mesa en `/mine` pero recibiría 404. Cualquier otro caso —
 * el código no existe o no hay huella— vuelve `null` y la ruta responde el 404 de n325, byte por byte.
 */
async function mesaConHuella(code, userId, db = pool) {
  const { rows } = await db.query(
    `SELECT m.id, m.code, m.status
       FROM mesas m
      WHERE m.code = $1
        AND (m.opener_user_id = $2
             OR EXISTS (SELECT 1 FROM mesa_participants p WHERE p.mesa_id = m.id AND p.user_id = $2 AND p.status = 'active')
             OR EXISTS (SELECT 1 FROM mesa_item_claims c WHERE c.mesa_id = m.id AND c.locked_by_user_id = $2)
             OR EXISTS (SELECT 1 FROM mesa_division_slots s WHERE s.mesa_id = m.id AND s.claimed_by_user_id = $2)
             OR EXISTS (SELECT 1 FROM mesa_informative_selections si WHERE si.mesa_id = m.id AND si.user_id = $2)
             OR EXISTS (SELECT 1 FROM payment_attempts pa WHERE pa.mesa_id = m.id AND pa.user_id = $2))`,
    [code, userId]
  );
  return rows[0] || null;
}

/**
 * Ocultar una mesa. Idempotente, y el alcance sólo se amplía: `include_history` queda en `viejo OR nuevo`, en una
 * sola sentencia. Pasar a «sin historial» sólo se logra deshaciendo.
 * @returns {{estado:'no_encontrada'}|{estado:'en_curso', mesaStatus:string}|{estado:'oculta', mesaCode:string, includeHistory:boolean}}
 */
async function ocultarMesa({ code, userId, includeHistory }, db = pool) {
  const m = await mesaConHuella(code, userId, db);
  if (!m) return { estado: 'no_encontrada' };
  if (!mesaOcultable(m.status)) return { estado: 'en_curso', mesaStatus: m.status };
  const { rows: [f] } = await db.query(
    `INSERT INTO mesas_ocultas (user_id, mesa_id, include_history) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, mesa_id)
       DO UPDATE SET include_history = mesas_ocultas.include_history OR EXCLUDED.include_history
     RETURNING include_history`,
    [userId, m.id, includeHistory]
  );
  return { estado: 'oculta', mesaCode: m.code, includeHistory: f.include_history };
}

/** Deshacer: borra sólo la fila de preferencia. Idempotente, también si no estaba oculta. */
async function mostrarMesa({ code, userId }, db = pool) {
  const m = await mesaConHuella(code, userId, db);
  if (!m) return { estado: 'no_encontrada' };
  await db.query('DELETE FROM mesas_ocultas WHERE user_id = $1 AND mesa_id = $2', [userId, m.id]);
  return { estado: 'visible', mesaCode: m.code };
}

/** El pago, sólo si es propio (el mismo predicado que `GET /api/account/movements/:id`). */
async function pagoPropio(id, userId, db = pool) {
  const { rows } = await db.query(
    `SELECT pa.id, m.status AS mesa_status
       FROM payment_attempts pa JOIN mesas m ON m.id = pa.mesa_id
      WHERE pa.id = $1 AND pa.user_id = $2`,
    [id, userId]
  );
  return rows[0] || null;
}

/** Ocultar un pago propio de una mesa terminada (la misma regla que la mesa). Idempotente. */
async function ocultarPago({ id, userId }, db = pool) {
  const p = await pagoPropio(id, userId, db);
  if (!p) return { estado: 'no_encontrado' };
  if (!mesaOcultable(p.mesa_status)) return { estado: 'en_curso', mesaStatus: p.mesa_status };
  await db.query(
    `INSERT INTO pagos_ocultos (user_id, payment_attempt_id) VALUES ($1, $2)
     ON CONFLICT (user_id, payment_attempt_id) DO NOTHING`,
    [userId, p.id]
  );
  return { estado: 'oculto', id: p.id };
}

/** Deshacer el pago. Idempotente. */
async function mostrarPago({ id, userId }, db = pool) {
  const p = await pagoPropio(id, userId, db);
  if (!p) return { estado: 'no_encontrado' };
  await db.query('DELETE FROM pagos_ocultos WHERE user_id = $1 AND payment_attempt_id = $2', [userId, p.id]);
  return { estado: 'visible', id: p.id };
}

module.exports = {
  MESA_ESTADOS_EN_CURSO, MESA_ESTADOS_OCULTABLES, mesaOcultable, capacidad, cuerpoOcultarMesa,
  mesaVisibleSql, pagoEnHistorialSql, pagoEnEstadisticasSql, avisoVisibleSql,
  ocultarMesa, mostrarMesa, ocultarPago, mostrarPago,
};
