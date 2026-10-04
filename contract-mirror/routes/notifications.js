/**
 * routes/notifications.js — Inbox + push devices
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { notificationsQuery, validateQuery } = require('../schemas');
const notifs = require('../services/notifications');

const router = express.Router();
router.use(requireAuth);

router.get('/', validateQuery(notificationsQuery), async (req, res, next) => {
  try {
    const { unread_only, limit, offset } = req.validatedQuery;
    const params = [req.user.id, limit, offset];
    let where = `user_id = $1`;
    if (unread_only) where += ` AND read_at IS NULL`;
    const { rows } = await pool.query(
      `SELECT id, type, title, body, payload,
              related_entity_type, related_entity_id, read_at, created_at
         FROM notifications WHERE ${where}
        ORDER BY created_at DESC LIMIT $2 OFFSET $3`, params
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [req.user.id]
    );
    res.json({
      notifications: rows,
      unread_count: countRows[0].unread,
      limit, offset,
    });
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await notifs.unreadCount(req.user.id);
    res.json({ unread_count: count });
  } catch (err) { next(err); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const updated = await notifs.markRead(req.params.id, req.user.id);
    if (!updated) return res.status(404).json({ error: 'notification_not_found_or_already_read' });
    res.json({ read: true });
  } catch (err) { next(err); }
});

router.patch('/read-all', async (req, res, next) => {
  try {
    const count = await notifs.markAllRead(req.user.id);
    res.json({ marked_read: count });
  } catch (err) { next(err); }
});

/**
 * v2.148.0 · E174-2 · decisión 174 («Una por una y todas»): borra TODAS las notificaciones propias.
 * Responde `{ deleted_count }`, también 0. Nunca toca las de otro usuario.
 */
router.delete('/', async (req, res, next) => {
  try {
    const count = await notifs.borrarTodas(req.user.id);
    res.json({ deleted_count: count });
  } catch (err) { next(err); }
});

/**
 * v2.148.0 · E174-3 · decisión 174: la foto de quien te invitó, para TU notificación
 * `invitation_received`. Mismas reglas que las fotos de participantes (n164): nunca la de un
 * menor ni la de una cuenta sin fecha conocida. 🔴 No oracular: id inválido, notificación ajena
 * o de otro tipo, invitación inexistente, cuenta eliminada, sin foto, menor o sin fecha responden
 * EXACTAMENTE el mismo 404. Bytes privados: `private, no-store`, `Vary: Authorization`, sin ETag.
 */
const ID_NOTIFICACION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get('/:id/inviter-avatar', async (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Vary, ETag');
  const absent = () => res.status(404).type('application/json')
    .end(JSON.stringify({ error: 'avatar_not_found' }));
  try {
    if (!ID_NOTIFICACION.test(req.params.id)) return absent();
    const avatar = await notifs.fotoDeQuienInvita(req.params.id, req.user.id);
    if (!avatar) return absent();
    res.type(avatar.mimeType);
    res.setHeader('Content-Length', String(avatar.bytes.length));
    return res.end(avatar.bytes);
  } catch (err) { return next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'notification_not_found' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

/**
 * v2.129.0 · AB1 · decisión 43 de Mati («Dejar de guardarlos y vaciarlos»): los
 * tokens de notificación push no se guardan más. No hay emisor de push y el front
 * no registra dispositivos; la migración v2.129.0 vació la tabla. 410 sin mirar
 * el cuerpo. El DELETE de abajo se conserva: sobre la tabla vacía responde 404.
 */
router.post('/push-devices', (_req, res) => res.status(410).json({ error: 'push_devices_retired' }));

router.delete('/push-devices/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM push_devices WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'device_not_found' });
    res.json({ removed: true });
  } catch (err) { next(err); }
});

module.exports = router;
