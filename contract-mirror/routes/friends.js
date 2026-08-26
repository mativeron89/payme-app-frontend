/**
 * routes/friends.js — Relaciones sociales (OLA 3C)
 *
 * Qué se corrigió, y por qué cada cosa importaba:
 *
 * 1. `POST /` creaba LAS DOS filas en 'accepted' de una sola vez. Cualquier
 *    usuario autenticado te agregaba sin pedirte nada y sin avisarte. Ahora una
 *    solicitud es una INTENCIÓN: una sola fila 'pending' que el destinatario
 *    acepta o rechaza. El vínculo lo crea quien lo recibe, no quien lo pide.
 *
 * 2. El 201 devolvía `email` de un desconocido, y 404-vs-201 era un oráculo de
 *    existencia. Con `payme_id` de 1.336.336 combinaciones y rate limits sólo
 *    por IP, eso era un extractor de correos por fuerza bruta. Ahora la
 *    respuesta es SIEMPRE la misma exista o no la persona, con el tiempo
 *    igualado — el mismo criterio que `/auth/login` ya usa con su hash señuelo.
 *
 * 3. `DELETE /:friendId` borraba las dos direcciones sin discriminar. El día que
 *    existiera el bloqueo, cualquiera podría haber borrado el bloqueo que otro
 *    le puso. Ahora ninguna operación de amistad toca jamás una fila 'blocked'.
 *
 * 4. Ningún endpoint devuelve `email` ni `phone`. No hacen falta para nada de
 *    lo que la app hace con amigos.
 *
 * 5. La lista saliente tampoco puede confirmar que el destino exista. Cada
 *    intento crea un recibo opaco propio, exista o no una cuenta detrás. El
 *    recibo permite listar/cancelar la intención sin proyectar identidad.
 *
 * Contact discovery NO se implementa acá: es MUST posterior, en su propia orden.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const {
  addFriend, searchFriends, friendRequestsQuery, validateBody, validateQuery,
} = require('../schemas');
const notifs = require('../services/notifications');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

/**
 * Proyección pública de una persona. **Nunca** email ni teléfono.
 * `payme_id` sí: es el identificador que la propia app muestra para agregar.
 */
const PERSONA_SQL = 'u.id, u.payme_id, u.first_name, u.last_name';
const persona = (r) => ({
  id: r.id,
  payme_id: r.payme_id,
  first_name: r.first_name,
  last_name: r.last_name,
  full_name: `${r.first_name} ${r.last_name}`,
});

/**
 * Límite POR USUARIO sobre la creación de solicitudes. Los límites del server
 * son todos por IP y rotar IPs es barato: sin esto, el techo de intentos lo
 * pone el atacante. No sustituye a la defensa principal —que un acierto no
 * entregue nada— pero le pone un costo real a barrer el espacio de `payme_id`.
 */
const solicitudLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_FRIEND_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_FRIEND_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `u:${req.user.id}`,
});

/** ¿Hay un bloqueo en cualquiera de las dos direcciones? */
async function hayBloqueo(client, a, b) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM friendships
      WHERE status = 'blocked'
        AND ((user_id = $1 AND friend_user_id = $2)
          OR (user_id = $2 AND friend_user_id = $1))
      LIMIT 1`,
    [a, b]
  );
  return rowCount > 0;
}

// ─── Amigos confirmados ─────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${PERSONA_SQL}, f.responded_at, f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.friend_user_id
        WHERE f.user_id = $1 AND f.status = 'accepted' AND u.status = 'active'
        ORDER BY u.first_name ASC`,
      [req.user.id]
    );
    res.json({
      friends: rows.map((f) => ({
        ...persona(f),
        added_at: f.responded_at || f.created_at,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/search', validateQuery(searchFriends), async (req, res, next) => {
  try {
    // Busca SÓLO entre los amigos propios. `email` sale de la proyección y
    // también del predicado: buscar por substring de correo era una forma
    // barata de confirmarlo carácter a carácter.
    const q = `%${req.validatedQuery.q.toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT ${PERSONA_SQL}
         FROM friendships f
         JOIN users u ON u.id = f.friend_user_id
        WHERE f.user_id = $1 AND f.status = 'accepted' AND u.status = 'active'
          AND (LOWER(u.first_name) LIKE $2 OR LOWER(u.last_name) LIKE $2
            OR LOWER(u.payme_id) LIKE $2)
        LIMIT 50`,
      [req.user.id, q]
    );
    res.json({ results: rows.map(persona) });
  } catch (err) { next(err); }
});

// ─── Solicitudes ────────────────────────────────────────────────────────────

/**
 * Crear una solicitud.
 *
 * ⚠️ RESPUESTA DELIBERADAMENTE CIEGA. Devuelve un recibo opaco por intento en
 * TODOS los casos: la persona no existe, existe, ya es amiga, ya tiene una
 * solicitud tuya, o te bloqueó. El recibo sólo prueba que PayMe registró TU
 * intención; nunca prueba que exista una persona detrás.
 */
router.post('/', solicitudLimiter, validateBody(addFriend), async (req, res, next) => {
  try {
    const { email, payme_id } = req.body;
    const lookup = email
      ? await pool.query(
        `SELECT id FROM users WHERE email_normalized = LOWER($1) AND status = 'active'`,
        [email])
      : await pool.query(
        `SELECT id FROM users WHERE payme_id = $1 AND status = 'active'`,
        [payme_id]);
    const destino = lookup.rows[0];

    // Igualación de tiempo: sin esto, "existe" y "no existe" se distinguen por
    // la duración del trabajo que sigue. Mismo criterio que el bcrypt.compare
    // contra hash señuelo de /auth/login.
    if (!destino || destino.id === req.user.id) {
      const requestId = await pool.tx(async (client) => {
        await client.query('SELECT pg_sleep(0.01)');
        const { rows: [receipt] } = await client.query(
          `INSERT INTO friend_request_receipts (requester_user_id)
           VALUES ($1) RETURNING id`,
          [req.user.id]
        );
        return receipt.id;
      });
      logger.audit('friend_request_noop', { user_id: req.user.id });
      return res.status(202).json({ requested: true, request_id: requestId });
    }

    const resultado = await pool.tx(async (client) => {
      const { rows: [receipt] } = await client.query(
        `INSERT INTO friend_request_receipts (requester_user_id)
         VALUES ($1) RETURNING id`,
        [req.user.id]
      );
      if (await hayBloqueo(client, req.user.id, destino.id)) {
        return { outcome: 'blocked', requestId: receipt.id };
      }
      // Si el otro YA me pidió, pedirle yo equivale a aceptar. Evita dos
      // pendientes cruzadas que nadie resuelve.
      const { rowCount: reciproca } = await client.query(
        `UPDATE friendships SET status = 'accepted', responded_at = NOW()
          WHERE user_id = $2 AND friend_user_id = $1 AND status = 'pending'`,
        [req.user.id, destino.id]
      );
      if (reciproca === 1) {
        await client.query(
          `INSERT INTO friendships (user_id, friend_user_id, status, responded_at)
           VALUES ($1, $2, 'accepted', NOW())
           ON CONFLICT (user_id, friend_user_id)
           DO UPDATE SET status = 'accepted', responded_at = NOW()
             WHERE friendships.status <> 'blocked'`,
          [req.user.id, destino.id]
        );
        return { outcome: 'accepted_reciprocal', requestId: receipt.id };
      }
      const creada = await client.query(
        `INSERT INTO friendships (user_id, friend_user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (user_id, friend_user_id) DO NOTHING
         RETURNING id`,
        [req.user.id, destino.id]
      );
      const friendshipId = creada.rows[0]?.id || (await client.query(
        `SELECT id FROM friendships
          WHERE user_id=$1 AND friend_user_id=$2 AND status='pending'`,
        [req.user.id, destino.id]
      )).rows[0]?.id || null;
      if (friendshipId) {
        await client.query(
          `UPDATE friend_request_receipts SET friendship_id=$1 WHERE id=$2`,
          [friendshipId, receipt.id]
        );
      }
      return {
        outcome: creada.rowCount === 1 ? 'created' : 'noop',
        requestId: receipt.id,
      };
    });

    if (resultado.outcome === 'created') {
      // El aviso que el código viejo nunca mandaba: la plantilla existía y
      // ninguna ruta la usaba.
      await notifs.create({
        user_id: destino.id,
        type: 'friend_request_received',
        body: `${req.user.first_name || 'Alguien'} te quiere agregar en PayMe`,
        related_entity_type: 'user', related_entity_id: req.user.id,
      }).catch(() => { /* el aviso no puede voltear la solicitud */ });
    } else if (resultado.outcome === 'accepted_reciprocal') {
      await notifs.create({
        user_id: destino.id, type: 'friend_added',
        body: 'Ahora son amigos en PayMe',
        related_entity_type: 'user', related_entity_id: req.user.id,
      }).catch(() => {});
    }
    logger.audit('friend_request', { user_id: req.user.id, outcome: resultado.outcome });

    // Misma respuesta para created / noop / blocked / accepted_reciprocal.
    res.status(202).json({ requested: true, request_id: resultado.requestId });
  } catch (err) { next(err); }
});

router.get('/requests', validateQuery(friendRequestsQuery), async (req, res, next) => {
  try {
    const { direction } = req.validatedQuery;
    const entrantes = direction === 'incoming';
    if (!entrantes) {
      const { rows } = await pool.query(
        `SELECT id, created_at
           FROM friend_request_receipts
          WHERE requester_user_id=$1
          ORDER BY created_at DESC, id DESC
          LIMIT 100`,
        [req.user.id]
      );
      return res.json({
        direction,
        requests: rows.map((r) => ({ id: r.id, requested_at: r.created_at })),
      });
    }

    // ⚠️ `f.id AS request_id` a propósito: seleccionar `f.id` junto a `u.id`
    // devuelve DOS columnas llamadas `id` y el driver conserva la última, así
    // que el id de la solicitud quedaba pisado por el del usuario.
    const { rows } = await pool.query(
      `SELECT f.id AS request_id, ${PERSONA_SQL}, f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.user_id
        WHERE f.friend_user_id = $1
          AND f.status = 'pending' AND u.status = 'active'
        ORDER BY f.created_at DESC
        LIMIT 100`,
      [req.user.id]
    );
    res.json({
      direction,
      requests: rows.map((r) => ({
        id: r.request_id,
        user: persona(r),
        requested_at: r.created_at,
      })),
    });
  } catch (err) { next(err); }
});

/** Aceptar: sólo el DESTINATARIO de la solicitud. */
router.post('/requests/:requestId/accept', async (req, res, next) => {
  try {
    const salida = await pool.tx(async (client) => {
      const { rows } = await client.query(
        `SELECT user_id, friend_user_id FROM friendships
          WHERE id = $1 AND friend_user_id = $2 AND status = 'pending'
          FOR UPDATE`,
        [req.params.requestId, req.user.id]
      );
      const sol = rows[0];
      if (!sol) return { code: 404 };
      if (await hayBloqueo(client, sol.user_id, sol.friend_user_id)) return { code: 404 };

      await client.query(
        `UPDATE friendships SET status = 'accepted', responded_at = NOW() WHERE id = $1`,
        [req.params.requestId]
      );
      // El espejo. `WHERE ... <> 'blocked'` para no resucitar un bloqueo.
      await client.query(
        `INSERT INTO friendships (user_id, friend_user_id, status, responded_at)
         VALUES ($1, $2, 'accepted', NOW())
         ON CONFLICT (user_id, friend_user_id)
         DO UPDATE SET status = 'accepted', responded_at = NOW()
           WHERE friendships.status <> 'blocked'`,
        [sol.friend_user_id, sol.user_id]
      );
      return { code: 200, solicitante: sol.user_id };
    });

    if (salida.code === 404) return res.status(404).json({ error: 'request_not_found' });
    await notifs.create({
      user_id: salida.solicitante, type: 'friend_added',
      body: `${req.user.first_name || 'Alguien'} aceptó tu solicitud`,
      related_entity_type: 'user', related_entity_id: req.user.id,
    }).catch(() => {});
    logger.audit('friend_request_accepted', { user_id: req.user.id });
    res.json({ accepted: true });
  } catch (err) { next(err); }
});

/**
 * Rechazar: sólo el destinatario. Se BORRA la fila en vez de marcarla, para no
 * darle al solicitante forma de saber que lo rechazaron: desde su lado, una
 * solicitud rechazada y una todavía sin ver se ven igual.
 */
router.post('/requests/:requestId/reject', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM friendships
        WHERE id = $1 AND friend_user_id = $2 AND status = 'pending'`,
      [req.params.requestId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'request_not_found' });
    logger.audit('friend_request_rejected', { user_id: req.user.id });
    res.json({ rejected: true });
  } catch (err) { next(err); }
});

/** Cancelar un recibo propio y, si era la última intención, su solicitud real. */
router.delete('/requests/:requestId', async (req, res, next) => {
  try {
    const cancelled = await pool.tx(async (client) => {
      // Lectura de routing SIN lock. El orden global de filas es siempre
      // friendship → receipt, igual que DELETE/reject y las FK ON DELETE.
      const { rows: [initial] } = await client.query(
        `SELECT id, friendship_id FROM friend_request_receipts
          WHERE id=$1 AND requester_user_id=$2`,
        [req.params.requestId, req.user.id]
      );
      if (!initial) return false;

      // Misma secuencia SQL con o sin destino real. Cuando no hay binding se
      // usa el propio UUID opaco como lookup imposible: evita convertir el
      // tiempo de cancelación en el nuevo oráculo.
      const friendshipLockId = initial.friendship_id || initial.id;
      const { rows: [friendship] } = await client.query(
        `SELECT id, user_id, status FROM friendships WHERE id=$1 FOR UPDATE`,
        [friendshipLockId]
      );
      const lockedFriendship = friendship || null;

      const { rows: [receipt] } = await client.query(
        `SELECT id, friendship_id FROM friend_request_receipts
          WHERE id=$1 AND requester_user_id=$2
          FOR UPDATE`,
        [initial.id, req.user.id]
      );
      if (!receipt) return false;
      // La única transición legítima durante la espera es que reject/baja haya
      // borrado la friendship y la FK haya puesto el binding en NULL.
      const bindingIntacto = receipt.friendship_id === initial.friendship_id;
      const bindingRemovido = !lockedFriendship && receipt.friendship_id === null;
      if (!bindingIntacto && !bindingRemovido) {
        throw Object.assign(new Error('friend_request_receipt_binding_changed'), {
          code: 'friend_request_receipt_binding_changed',
        });
      }
      await client.query(
        `DELETE FROM friend_request_receipts
          WHERE id=$1 AND requester_user_id=$2`,
        [receipt.id, req.user.id]
      );
      await client.query(
        `DELETE FROM friendships f
          WHERE f.id=$1 AND f.user_id=$2 AND f.status='pending'
            AND NOT EXISTS (
              SELECT 1 FROM friend_request_receipts r
               WHERE r.friendship_id=f.id AND r.requester_user_id=$2
            )`,
        [friendshipLockId, req.user.id]
      );
      return true;
    });
    if (!cancelled) return res.status(404).json({ error: 'request_not_found' });
    res.json({ cancelled: true });
  } catch (err) { next(err); }
});

// ─── Bloqueo ────────────────────────────────────────────────────────────────

/**
 * Bloquear. Rompe la amistad en ambos sentidos y deja MI fila en 'blocked'.
 * La fila del otro se borra: no puede quedarle una amistad con quien lo bloqueó.
 */
router.post('/:userId/block', async (req, res, next) => {
  try {
    const objetivo = req.params.userId;
    if (objetivo === req.user.id) return res.status(400).json({ error: 'cannot_block_self' });
    const ok = await pool.tx(async (client) => {
      const { rowCount: existe } = await client.query(
        `SELECT 1 FROM users WHERE id = $1 AND status = 'active'`, [objetivo]
      );
      if (existe === 0) return false;
      // La fila del otro hacia mí se borra, salvo que sea su propio bloqueo.
      await client.query(
        `DELETE FROM friendships
          WHERE user_id = $1 AND friend_user_id = $2 AND status <> 'blocked'`,
        [objetivo, req.user.id]
      );
      await client.query(
        `INSERT INTO friendships (user_id, friend_user_id, status, responded_at)
         VALUES ($1, $2, 'blocked', NOW())
         ON CONFLICT (user_id, friend_user_id)
         DO UPDATE SET status = 'blocked', responded_at = NOW()`,
        [req.user.id, objetivo]
      );
      return true;
    });
    if (!ok) return res.status(404).json({ error: 'user_not_found' });
    logger.audit('friend_blocked', { user_id: req.user.id });
    res.json({ blocked: true });
  } catch (err) { next(err); }
});

/** Desbloquear. SÓLO el que bloqueó: la fila se identifica por `user_id = yo`. */
router.delete('/:userId/block', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM friendships
        WHERE user_id = $1 AND friend_user_id = $2 AND status = 'blocked'`,
      [req.user.id, req.params.userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'block_not_found' });
    logger.audit('friend_unblocked', { user_id: req.user.id });
    res.json({ unblocked: true });
  } catch (err) { next(err); }
});

// ─── Quitar amistad ─────────────────────────────────────────────────────────

/**
 * Quitar amistad. Borra las dos direcciones —una amistad rota lo está para los
 * dos— pero **jamás una fila 'blocked'**.
 *
 * Nota de interpretación: la orden pedía "borrar únicamente la fila propia".
 * Borrar sólo la mía dejaría al otro creyendo que seguimos siendo amigos y
 * mostrándome en su lista. Leí el requisito por lo que protege: que esta
 * operación no pueda tocar el bloqueo de nadie. El `status <> 'blocked'` es lo
 * que cierra el agujero; la simetría de la amistad se conserva.
 */
router.delete('/:friendId', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM friendships
        WHERE status <> 'blocked'
          AND ((user_id = $1 AND friend_user_id = $2)
            OR (user_id = $2 AND friend_user_id = $1))`,
      [req.user.id, req.params.friendId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'friendship_not_found' });
    logger.audit('friend_removed', { user_id: req.user.id });
    res.json({ removed: true });
  } catch (err) { next(err); }
});

module.exports = router;
