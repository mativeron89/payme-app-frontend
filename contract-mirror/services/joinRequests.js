/**
 * services/joinRequests.js — unirse a una mesa escribiendo su código (v2.166.0).
 *
 * Decisión 219 de Mati («Sí, aprobado (Recomendada)») y respuestas del Bibliotecario al plan:
 *   · quien escribe el código PIDE; el titular de la mesa (`mesas.opener_user_id`) acepta o
 *     rechaza. Aceptar lo suma como participante `invited`, igual que una invitación;
 *   · sólo mesas `open` y `partially_paid`. Una mesa inexistente, pagada o cerrada contestan
 *     EXACTAMENTE lo mismo (`join_code_not_found`): el código no revela en qué estado está;
 *   · quien ya está en la mesa (titular o participante activo) entra directo, aunque esté pagada;
 *   · un pedido vence a los 15 minutos; como mucho 10 pendientes por mesa y 5 pedidos creados
 *     por persona en la última hora (el tope en memoria de la ruta cuenta además los intentos
 *     con un código equivocado, que no se guardan);
 *   · quien fue rechazado no puede volver a pedir en esa mesa;
 *   · quien pide no recibe datos de la mesa: sólo el estado de su pedido, y el código cuando lo
 *     aceptan.
 *
 * Bloqueo, siempre en este orden: (al pedir, el turno de la cuenta) → la mesa (`FOR UPDATE`, el
 * mismo lock que la fase 1 del cierre) → las cuentas que se van a escribir (`FOR SHARE`, por id)
 * → el pedido (`FOR UPDATE`). Así la mesa no puede cerrarse entre el control y el alta del
 * participante, y dos decisiones sobre el mismo pedido se ordenan.
 *   · Las cuentas van ANTES que el pedido por la eliminación de cuenta (auditoría Codex, R1): ella
 *     bloquea `users FOR UPDATE` y después cancela los pedidos. Si aceptar bloqueara el pedido
 *     primero, la FK del participante (o de `decided_by_user_id`) pediría la cuenta con el pedido
 *     tomado y quedaría un ciclo. Con este orden, aceptar espera a la eliminación o la eliminación
 *     espera a aceptar, nunca las dos.
 *   · `FOR SHARE` y no `FOR KEY SHARE`: además de ordenar, deja estable el `status` que se lee
 *     (una cuenta que dejó de estar activa no entra ni pide).
 *
 * Vigencia (auditoría Codex, H1): todo control de vencimiento hecho después de esperar un lock usa
 * `clock_timestamp()`, no `NOW()`, que es la hora del BEGIN. La decisión es un UPDATE atómico
 * `… AND expires_at > clock_timestamp()` antes de sumar al participante, como al aceptar una
 * invitación (`routes/invitations.js`).
 *
 * Cada función devuelve `{ status, body }`; la ruta sólo lo escribe. Los registros llevan el id
 * del pedido y códigos cerrados: nunca nombres, usuarios ni el código de la mesa.
 */
'use strict';

const pool = require('../db/pool');
const notifs = require('./notifications');
const usernameSvc = require('./username');
const logger = require('../utils/logger');

const VIGENCIA_MINUTOS = 15;
const TOPE_PENDIENTES_POR_MESA = 10;
const TOPE_POR_HORA = 5;
const ESTADOS_ADMITIDOS = Object.freeze(['open', 'partially_paid']);
// El mismo formato que valida el contrato (`schemas/index.js`); `generateMesaCode` da PA-#####.
const RE_CODIGO = /^[A-Z]{2}-\d{3,5}$/;

const respuesta = (status, body) => ({ status, body });
// Un solo objeto para «no existe» y «no admite»: el mismo cuerpo, byte por byte.
const NO_ENCONTRADA = Object.freeze({ error: 'join_code_not_found' });

function normalizarCodigo(valor) {
  if (typeof valor !== 'string' || valor.length > 20) return null;
  const code = valor.trim().toUpperCase();
  return RE_CODIGO.test(code) ? code : null;
}

async function esParticipanteActivo(client, mesaId, userId) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM mesa_participants WHERE mesa_id=$1 AND user_id=$2 AND status='active'`,
    [mesaId, userId]
  );
  return rowCount > 0;
}

/** Vencimiento perezoso, bajo el lock de la mesa: las pendientes pasadas de hora quedan `expired`. */
async function vencerPendientes(client, mesaId) {
  await client.query(
    `UPDATE mesa_join_requests SET status='expired'
      WHERE mesa_id=$1 AND status='pending' AND expires_at <= clock_timestamp()`,
    [mesaId]
  );
}

/**
 * Bloquea las cuentas que el pedido va a escribir (quien pide y, al decidir, el titular), por id,
 * ANTES que el pedido. Devuelve su `status` por id.
 */
async function bloquearCuentas(client, ids) {
  const { rows } = await client.query(
    `SELECT id, status FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE`,
    [[...new Set(ids)]]
  );
  return new Map(rows.map((u) => [u.id, u.status]));
}

/**
 * La decisión, atómica y con el reloj real: cierra el pedido sólo si sigue pendiente y vigente.
 * Si no, lo marca `expired` (con el pedido bloqueado, lo único que puede haber cambiado es el
 * reloj) y devuelve false.
 */
async function cerrarSiVigente(client, id, status, decididoPor) {
  const { rowCount } = await client.query(
    `UPDATE mesa_join_requests SET status=$2, decided_at=clock_timestamp(), decided_by_user_id=$3
      WHERE id=$1 AND status='pending' AND expires_at > clock_timestamp()`,
    [id, status, decididoPor]
  );
  if (rowCount === 1) return true;
  await client.query(
    `UPDATE mesa_join_requests SET status='expired'
      WHERE id=$1 AND status='pending' AND expires_at <= clock_timestamp()`,
    [id]
  );
  return false;
}

const VENCIDA = () => respuesta(410, { error: 'join_request_expired' });

function nombreVisible(u) {
  const nombre = [u.first_name, u.last_name].filter(Boolean).join(' ');
  const arroba = usernameSvc.habilitado() && u.username ? ` (@${u.username})` : '';
  return `${nombre}${arroba}`;
}

/** POST /api/join-requests — pedir unirse con el código. */
async function pedir(userId, valor) {
  const code = normalizarCodigo(valor);
  if (!code) return respuesta(400, { error: 'join_code_invalid' });

  const r = await pool.tx(async (client) => {
    // El tope por persona se cuenta y se respeta de a un pedido por vez: dos pedidos simultáneos
    // a mesas distintas no pueden pasar los dos con 4 en la cuenta. Va antes que la mesa: el
    // orden es siempre persona → mesa.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`payme/join-requests/${userId}`]);
    const { rows: [mesa] } = await client.query(
      `SELECT id, code, status, opener_user_id FROM mesas WHERE code=$1 FOR UPDATE`, [code]
    );
    if (!mesa) return { refused: 'not_found', out: respuesta(404, NO_ENCONTRADA) };
    // La cuenta que pide, después de la mesa (el orden de arriba). La ruta ya exige una cuenta
    // activa; esto cubre la que dejó de estarlo mientras su pedido esperaba.
    const cuentas = await bloquearCuentas(client, [userId]);
    if (cuentas.get(userId) !== 'active') {
      return { refused: 'account_not_active', out: respuesta(403, { error: 'user_suspended' }) };
    }

    if (mesa.opener_user_id === userId || await esParticipanteActivo(client, mesa.id, userId)) {
      return { out: respuesta(200, { status: 'already_participant', mesa_code: mesa.code }) };
    }
    if (!ESTADOS_ADMITIDOS.includes(mesa.status)) {
      return { refused: 'not_found', out: respuesta(404, NO_ENCONTRADA) };
    }

    await vencerPendientes(client, mesa.id);

    const { rowCount: rechazada } = await client.query(
      `SELECT 1 FROM mesa_join_requests WHERE mesa_id=$1 AND requester_user_id=$2 AND status='rejected'`,
      [mesa.id, userId]
    );
    if (rechazada > 0) {
      return { refused: 'rejected_before', out: respuesta(409, { error: 'join_request_not_allowed' }) };
    }

    const { rows: [pendiente] } = await client.query(
      `SELECT id, expires_at FROM mesa_join_requests
        WHERE mesa_id=$1 AND requester_user_id=$2 AND status='pending'`,
      [mesa.id, userId]
    );
    if (pendiente) {
      return { out: respuesta(200, { id: pendiente.id, status: 'pending', expires_at: pendiente.expires_at }) };
    }

    const { rows: [{ n: enLaHora }] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM mesa_join_requests
        WHERE requester_user_id=$1 AND created_at > clock_timestamp() - interval '1 hour'`,
      [userId]
    );
    if (enLaHora >= TOPE_POR_HORA) {
      return { refused: 'rate_limited', out: respuesta(429, { error: 'join_requests_rate_limited' }) };
    }

    const { rows: [{ n: enLaMesa }] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM mesa_join_requests WHERE mesa_id=$1 AND status='pending'`,
      [mesa.id]
    );
    if (enLaMesa >= TOPE_PENDIENTES_POR_MESA) {
      return { refused: 'mesa_full', out: respuesta(409, { error: 'join_requests_full' }) };
    }

    // Los 15 minutos cuentan desde ahora, no desde el BEGIN: este pedido pudo esperar locks.
    const { rows: [creada] } = await client.query(
      `INSERT INTO mesa_join_requests (mesa_id, requester_user_id, created_at, expires_at)
       VALUES ($1, $2, clock_timestamp(), clock_timestamp() + make_interval(mins => $3))
       RETURNING id, expires_at`,
      [mesa.id, userId, VIGENCIA_MINUTOS]
    );

    const { rows: [quien] } = await client.query(
      `SELECT first_name, last_name, username FROM users WHERE id=$1`, [userId]
    );
    await notifs.create({
      user_id: mesa.opener_user_id,
      type: 'join_request_received',
      body: `${nombreVisible(quien)} quiere unirse a tu mesa ${mesa.code}`,
      payload: { mesa_code: mesa.code, join_request_id: creada.id },
      related_entity_type: 'join_request',
      related_entity_id: creada.id,
      client,
    });

    return {
      created: creada.id,
      out: respuesta(201, { id: creada.id, status: 'pending', expires_at: creada.expires_at }),
    };
  });

  if (r.created) logger.audit('join_request_created', { request_id: r.created });
  if (r.refused) logger.info('join_request_refused', { reason: r.refused });
  return r.out;
}

/** GET /api/join-requests/:id — el estado del pedido propio. */
async function estado(userId, id) {
  const { rows: [p] } = await pool.query(
    `SELECT r.id, r.status, r.expires_at, m.code AS mesa_code,
            (r.status='pending' AND r.expires_at <= clock_timestamp()) AS vencida
       FROM mesa_join_requests r
       JOIN mesas m ON m.id = r.mesa_id
      WHERE r.id=$1 AND r.requester_user_id=$2`,
    [id, userId]
  );
  if (!p) return respuesta(404, { error: 'join_request_not_found' });
  const status = p.vencida ? 'expired' : p.status;
  return respuesta(200, {
    id: p.id,
    status,
    expires_at: p.expires_at,
    ...(status === 'accepted' && { mesa_code: p.mesa_code }),
  });
}

/**
 * Bloquea el pedido (la mesa y las cuentas ya están bloqueadas) y corta si no está pendiente o ya
 * venció. La decisión misma vuelve a mirar el reloj en `cerrarSiVigente`.
 */
async function pedidoPendiente(client, id, mesaId, filtro, params) {
  const { rows: [p] } = await client.query(
    `SELECT id, requester_user_id, status, (expires_at <= clock_timestamp()) AS vencida
       FROM mesa_join_requests WHERE id=$1 AND mesa_id=$2 ${filtro} FOR UPDATE`,
    [id, mesaId, ...params]
  );
  if (!p) return { out: respuesta(404, { error: 'join_request_not_found' }) };
  if (p.status === 'pending' && p.vencida) {
    await client.query(`UPDATE mesa_join_requests SET status='expired' WHERE id=$1`, [id]);
    return { out: VENCIDA() };
  }
  if (p.status !== 'pending') return { out: respuesta(409, { error: 'join_request_not_pending' }) };
  return { pedido: p };
}

/** POST /api/join-requests/:id/cancel — quien pidió lo retira. */
async function cancelar(userId, id) {
  const r = await pool.tx(async (client) => {
    const { rows: [dueno] } = await client.query(
      `SELECT mesa_id FROM mesa_join_requests WHERE id=$1 AND requester_user_id=$2`, [id, userId]
    );
    if (!dueno) return { out: respuesta(404, { error: 'join_request_not_found' }) };
    await client.query(`SELECT id FROM mesas WHERE id=$1 FOR UPDATE`, [dueno.mesa_id]);
    await bloquearCuentas(client, [userId]);
    const { pedido, out } = await pedidoPendiente(client, id, dueno.mesa_id, 'AND requester_user_id=$3', [userId]);
    if (!pedido) return { out };
    if (!(await cerrarSiVigente(client, id, 'cancelled', userId))) return { out: VENCIDA() };
    return { decided: 'cancelled', out: respuesta(200, { id, status: 'cancelled' }) };
  });
  if (r.decided) logger.audit('join_request_decided', { request_id: id, outcome: r.decided });
  return r.out;
}

/**
 * GET /api/mesas/:code/join-requests — las pendientes vigentes, para el titular. Sólo de cuentas
 * activas: la de una cuenta suspendida o eliminada no se puede aceptar, así que no se muestra.
 */
async function listar(mesaId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.created_at, r.expires_at, u.first_name, u.last_name, u.username
       FROM mesa_join_requests r
       JOIN users u ON u.id = r.requester_user_id
      WHERE r.mesa_id=$1 AND r.status='pending' AND r.expires_at > clock_timestamp()
        AND u.status='active'
      ORDER BY r.created_at ASC, r.id ASC`,
    [mesaId]
  );
  const conArroba = usernameSvc.habilitado();
  return respuesta(200, {
    join_requests: rows.map((r) => ({
      id: r.id,
      requester: {
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        username: conArroba ? (r.username ?? null) : null,
      },
      created_at: r.created_at,
      expires_at: r.expires_at,
    })),
  });
}

/** POST /api/mesas/:code/join-requests/:id/accept|reject — decide el titular. */
async function decidir(openerId, mesaId, id, decision) {
  const r = await pool.tx(async (client) => {
    const { rows: [mesa] } = await client.query(
      `SELECT id, code, status, opener_user_id FROM mesas WHERE id=$1 FOR UPDATE`, [mesaId]
    );
    if (!mesa || mesa.opener_user_id !== openerId) {
      return { out: respuesta(403, { error: 'not_mesa_organizer' }) };
    }
    // Quién pidió, sin bloquear todavía el pedido (`requester_user_id` no cambia nunca): primero
    // van las cuentas, después el pedido.
    const { rows: [fila] } = await client.query(
      `SELECT requester_user_id FROM mesa_join_requests WHERE id=$1 AND mesa_id=$2`, [id, mesa.id]
    );
    if (!fila) return { out: respuesta(404, { error: 'join_request_not_found' }) };
    const cuentas = await bloquearCuentas(client, [fila.requester_user_id, openerId]);
    const { pedido, out } = await pedidoPendiente(client, id, mesa.id, '', []);
    if (!pedido) return { out };

    if (decision === 'reject') {
      if (!(await cerrarSiVigente(client, id, 'rejected', openerId))) return { out: VENCIDA() };
      return { decided: 'rejected', out: respuesta(200, { id, status: 'rejected' }) };
    }

    // La misma regla que para pedir: sólo una mesa abierta o con pagos parciales suma gente.
    if (!ESTADOS_ADMITIDOS.includes(mesa.status)) {
      return { out: respuesta(410, { error: 'mesa_not_joinable' }) };
    }
    // Una cuenta que dejó de estar activa (suspendida o eliminada) no entra: el pedido ya no es
    // aceptable y no se toca.
    if (cuentas.get(pedido.requester_user_id) !== 'active') {
      return { out: respuesta(409, { error: 'join_request_not_pending' }) };
    }
    // Primero la decisión con el reloj real; recién después el participante y el aviso.
    if (!(await cerrarSiVigente(client, id, 'accepted', openerId))) return { out: VENCIDA() };
    await client.query(
      `INSERT INTO mesa_participants (mesa_id, user_id, role, status)
       VALUES ($1, $2, 'invited', 'active')
       -- Mismo árbitro parcial que aceptar una invitación: sin el predicado, Postgres no infiere
       -- el índice y aborta con 42P10.
       ON CONFLICT (mesa_id, user_id) WHERE user_id IS NOT NULL
         DO UPDATE SET status = 'active'`,
      [mesa.id, pedido.requester_user_id]
    );
    await notifs.create({
      user_id: pedido.requester_user_id,
      type: 'join_request_accepted',
      body: `Ya estás en la mesa ${mesa.code}`,
      payload: { mesa_code: mesa.code },
      related_entity_type: 'join_request',
      related_entity_id: id,
      client,
    });
    return { decided: 'accepted', out: respuesta(200, { id, status: 'accepted' }) };
  });
  if (r.decided) logger.audit('join_request_decided', { request_id: id, outcome: r.decided });
  return r.out;
}

module.exports = {
  VIGENCIA_MINUTOS, TOPE_PENDIENTES_POR_MESA, TOPE_POR_HORA, ESTADOS_ADMITIDOS, RE_CODIGO,
  normalizarCodigo, pedir, estado, cancelar, listar, decidir,
};
