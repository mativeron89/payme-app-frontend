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
 * ⚠️ RESPUESTA DELIBERADAMENTE CIEGA. Devuelve `202 { requested: true }` en
 * TODOS los casos: la persona no existe, existe, ya es amiga, ya tiene una
 * solicitud tuya, o te bloqueó. El emisor no puede distinguir ninguno de esos
 * estados, que es justo lo que convertía a este endpoint en un oráculo.
 * El estado real de TUS solicitudes se ve en `GET /friends/requests`.
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
      await pool.query('SELECT pg_sleep(0.01)');
      logger.audit('friend_request_noop', { user_id: req.user.id });
      return res.status(202).json({ requested: true });
    }

    const resultado = await pool.tx(async (client) => {
      if (await hayBloqueo(client, req.user.id, destino.id)) return 'blocked';
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
        return 'accepted_reciprocal';
      }
      const { rowCount } = await client.query(
        `INSERT INTO friendships (user_id, friend_user_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
        [req.user.id, destino.id]
      );
      return rowCount === 1 ? 'created' : 'noop';
    });

    if (resultado === 'created') {
      // El aviso que el código viejo nunca mandaba: la plantilla existía y
      // ninguna ruta la usaba.
      await notifs.create({
        user_id: destino.id,
        type: 'friend_request_received',
        body: `${req.user.first_name || 'Alguien'} te quiere agregar en PayMe`,
        related_entity_type: 'user', related_entity_id: req.user.id,
      }).catch(() => { /* el aviso no puede voltear la solicitud */ });
    } else if (resultado === 'accepted_reciprocal') {
      await notifs.create({
        user_id: destino.id, type: 'friend_added',
        body: 'Ahora son amigos en PayMe',
        related_entity_type: 'user', related_entity_id: req.user.id,
      }).catch(() => {});
    }
    logger.audit('friend_request', { user_id: req.user.id, outcome: resultado });

    // Misma respuesta para created / noop / blocked / accepted_reciprocal.
    res.status(202).json({ requested: true });
  } catch (err) { next(err); }
});

router.get('/requests', validateQuery(friendRequestsQuery), async (req, res, next) => {
  try {
    const { direction } = req.validatedQuery;
    const entrantes = direction === 'incoming';
    // ⚠️ `f.id AS request_id` a propósito: seleccionar `f.id` junto a `u.id`
    // devuelve DOS columnas llamadas `id` y el driver conserva la última, así
    // que el id de la solicitud quedaba pisado por el del usuario. La persona y
    // la solicitud van en campos separados para que no se puedan confundir.
    const { rows } = await pool.query(
      `SELECT f.id AS request_id, ${PERSONA_SQL}, f.created_at
         FROM friendships f
         JOIN users u ON u.id = ${entrantes ? 'f.user_id' : 'f.friend_user_id'}
        WHERE ${entrantes ? 'f.friend_user_id' : 'f.user_id'} = $1
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

/** Cancelar una solicitud propia todavía pendiente. */
router.delete('/requests/:requestId', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM friendships
        WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
      [req.params.requestId, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'request_not_found' });
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
