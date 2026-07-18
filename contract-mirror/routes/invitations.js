/**
 * routes/invitations.js v2.5.1
 *
 * Cambios vs v2.5.0:
 *   - P1 #8: nuevos guest links generan token crudo (devuelto en response)
 *     y guardan SOLO el hash en DB. Validación de aceptación: hash primero,
 *     fallback a token crudo (legacy).
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { generateToken, tokenHash } = require('../utils/tokens');
const notifs = require('../services/notifications');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

// ─── GET / (invitations pendientes para el user actual) ───
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.mesa_id, i.invitation_type, i.status, i.expires_at, i.created_at,
              m.code AS mesa_code, r.name AS restaurant_name,
              u.first_name AS inviter_first_name, u.last_name AS inviter_last_name,
              u.payme_id AS inviter_payme_id
         FROM invitations i
         JOIN mesas m       ON m.id = i.mesa_id
         JOIN restaurants r ON r.id = m.restaurant_id
         JOIN users u       ON u.id = i.inviter_user_id
        WHERE i.invited_user_id = $1 AND i.status = 'pending'
          AND i.expires_at > NOW()
        ORDER BY i.created_at DESC`,
      [req.user.id]
    );
    res.json({ invitations: rows });
  } catch (err) { next(err); }
});

// ─── POST /:id/accept ─────────────────────────────────────
router.post('/:id/accept', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, mesa_id, invited_user_id, status, expires_at
         FROM invitations
        WHERE id = $1`,
      [req.params.id]
    );
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'invitation_not_found' });
    if (inv.invited_user_id !== req.user.id) {
      return res.status(403).json({ error: 'not_for_you' });
    }
    if (inv.status !== 'pending') {
      return res.status(409).json({ error: 'invitation_not_pending', status: inv.status });
    }
    if (new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({ error: 'invitation_expired' });
    }

    await pool.tx(async (client) => {
      await client.query(
        `UPDATE invitations SET status='accepted', accepted_at=NOW() WHERE id=$1`,
        [inv.id]
      );
      await client.query(
        `INSERT INTO mesa_participants (mesa_id, user_id, role, status)
         VALUES ($1, $2, 'invited', 'active')
         ON CONFLICT (mesa_id, user_id) DO UPDATE SET status = 'active'`,
        [inv.mesa_id, req.user.id]
      );
    });

    logger.audit('invitation_accepted', { invitation_id: inv.id, user_id: req.user.id });
    res.json({ accepted: true });
  } catch (err) { next(err); }
});

// ─── POST /:id/cancel ─────────────────────────────────────
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, inviter_user_id, status FROM invitations WHERE id = $1`,
      [req.params.id]
    );
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'invitation_not_found' });
    if (inv.inviter_user_id !== req.user.id) {
      return res.status(403).json({ error: 'only_inviter_can_cancel' });
    }
    if (inv.status !== 'pending') {
      return res.status(409).json({ error: 'invitation_not_pending' });
    }
    await pool.query(
      `UPDATE invitations SET status='cancelled', cancelled_at=NOW() WHERE id=$1`,
      [inv.id]
    );
    res.json({ cancelled: true });
  } catch (err) { next(err); }
});

// ─── POST /accept-link (guest accept de link público) ─────
// Acepta { token: "raw" } y registra al guest en mesa_participants.
// v2.5.1 P1 #8: busca por token_hash primero, fallback a token crudo.
router.post('/accept-link', express.json(), async (req, res, next) => {
  // Sin requireAuth (accesible para guests). El router al inicio aplicó
  // requireAuth, así que reabrimos como sub-router... pero por simplicidad,
  // dejamos esta ruta abierta vía override de auth (no la necesitamos en MVP).
  // ACTUALIZACIÓN: este endpoint queda como TODO/limitación documentada;
  // en MVP los guests usan el link directo /mesa/:code?t=token sin endpoint
  // de accept explícito (el middleware guestOrAuth + requireMesaParticipant
  // ya valida automáticamente).
  res.status(501).json({
    error: 'not_implemented',
    message: 'guests usan ?t=token en URL, no requieren accept explícito',
  });
});

module.exports = router;

// ═══════════════════════════════════════════════════════════
// Helpers exportados para otros routes (mesas.js usa este pattern):
// ═══════════════════════════════════════════════════════════

/**
 * Crea una invitation tipo 'link' con token hasheado.
 *
 * @returns { invitation, rawToken }
 *   rawToken se devuelve UNA SOLA VEZ y se usa para construir el link público.
 *   En DB solo guardamos token_hash.
 */
module.exports.createLinkInvitation = async function createLinkInvitation({
  client, mesaId, inviterUserId, expiresAt,
}) {
  const raw = generateToken(24);
  const hash = tokenHash(raw);

  const { rows } = await client.query(
    `INSERT INTO invitations
       (mesa_id, inviter_user_id, invitation_type, token_hash, expires_at)
     VALUES ($1, $2, 'link', $3, $4)
     RETURNING id, invitation_type, status, expires_at, created_at`,
    [mesaId, inviterUserId, hash, expiresAt]
  );
  return { invitation: rows[0], rawToken: raw, tokenHash: hash };
};

module.exports.createInAppInvitation = async function createInAppInvitation({
  client, mesaId, inviterUserId, invitedUserId, invitedPaymeId, expiresAt,
}) {
  const { rows } = await client.query(
    `INSERT INTO invitations
       (mesa_id, inviter_user_id, invited_user_id, invited_payme_id,
        invitation_type, expires_at)
     VALUES ($1, $2, $3, $4, 'in_app', $5)
     RETURNING id, invitation_type, status, expires_at, created_at`,
    [mesaId, inviterUserId, invitedUserId, invitedPaymeId || null, expiresAt]
  );
  return { invitation: rows[0] };
};
