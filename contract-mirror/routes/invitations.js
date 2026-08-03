/**
 * Mutaciones de la autoridad canónica de invitaciones.
 *
 * Accept/cancel resuelven IDs legacy supersedidos, bloquean siempre
 * mesa → invitación canónica y terminalizan expiraciones bajo el mismo lock.
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uuidIdParam, validateParams } = require('../schemas');
const invitationAuthority = require('../services/invitationAuthority');
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
          AND i.superseded_by_id IS NULL
          AND i.expires_at > NOW()
        ORDER BY i.created_at DESC`,
      [req.user.id]
    );
    res.json({ invitations: rows });
  } catch (err) { next(err); }
});

// ─── POST /:id/accept ─────────────────────────────────────
router.post('/:id/accept', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    const outcome = await pool.tx(async (client) => {
      const current = await invitationAuthority.lockCanonical(client, req.params.id);
      if (!current) return { httpStatus: 404, error: 'invitation_not_found' };
      if (current.invited_user_id !== req.user.id) {
        return { httpStatus: 403, error: 'not_for_you' };
      }
      if (current.source_expired) {
        if (current.source_id === current.id && current.status === 'pending') {
          await client.query(
            `UPDATE invitations SET status='expired' WHERE id=$1 AND status='pending'`,
            [current.id]
          );
        }
        return { httpStatus: 410, error: 'invitation_expired' };
      }
      if (current.status === 'expired') {
        return { httpStatus: 410, error: 'invitation_expired' };
      }
      if (current.status !== 'pending') {
        return {
          httpStatus: 409,
          error: 'invitation_not_pending',
          status: current.status,
        };
      }
      if (current.expired) {
        await client.query(
          `UPDATE invitations SET status='expired' WHERE id=$1 AND status='pending'`,
          [current.id]
        );
        return { httpStatus: 410, error: 'invitation_expired' };
      }

      const { rows: accepted } = await client.query(
        `UPDATE invitations
            SET status='accepted', accepted_at=clock_timestamp()
          WHERE id=$1
            AND invited_user_id=$2
            AND status='pending'
            AND expires_at > clock_timestamp()
          RETURNING id, mesa_id`,
        [current.id, req.user.id]
      );

      const inv = accepted[0];
      if (!inv) {
        // Con la fila bloqueada, el único predicado que puede cambiar entre la
        // lectura y este UPDATE es el reloj.
        await client.query(
          `UPDATE invitations SET status='expired'
            WHERE id=$1 AND status='pending'
              AND expires_at <= clock_timestamp()`,
          [current.id]
        );
        return { httpStatus: 410, error: 'invitation_expired' };
      }

      await client.query(
        `INSERT INTO mesa_participants (mesa_id, user_id, role, status)
         VALUES ($1, $2, 'invited', 'active')
         -- uq_mesa_participants_user es un indice unico PARCIAL: sin repetir su
         -- predicado, Postgres no infiere arbitro y aborta con 42P10 SIEMPRE.
         ON CONFLICT (mesa_id, user_id) WHERE user_id IS NOT NULL
           DO UPDATE SET status = 'active'`,
        [inv.mesa_id, req.user.id]
      );

      return { accepted: true, invitationId: inv.id };
    });

    if (!outcome.accepted) {
      return res.status(outcome.httpStatus).json({
        error: outcome.error,
        ...(outcome.status && { status: outcome.status }),
      });
    }

    logger.audit('invitation_accepted', {
      invitation_id: outcome.invitationId,
      user_id: req.user.id,
    });
    res.json({ accepted: true });
  } catch (err) { next(err); }
});

// ─── POST /:id/cancel ─────────────────────────────────────
// v2.28.6: una pending ya vencida es terminal y responde 410
// invitation_expired; no se reescribe artificialmente a cancelled.
router.post('/:id/cancel', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    const outcome = await pool.tx(async (client) => {
      const current = await invitationAuthority.lockCanonical(client, req.params.id);
      if (!current) return { httpStatus: 404, error: 'invitation_not_found' };
      if (current.inviter_user_id !== req.user.id) {
        return { httpStatus: 403, error: 'only_inviter_can_cancel' };
      }
      if (current.source_expired) {
        if (current.source_id === current.id && current.status === 'pending') {
          await client.query(
            `UPDATE invitations SET status='expired' WHERE id=$1 AND status='pending'`,
            [current.id]
          );
        }
        return { httpStatus: 410, error: 'invitation_expired' };
      }
      if (current.status === 'expired') {
        return { httpStatus: 410, error: 'invitation_expired' };
      }
      if (current.status !== 'pending') {
        return { httpStatus: 409, error: 'invitation_not_pending' };
      }
      if (current.expired) {
        await client.query(
          `UPDATE invitations SET status='expired' WHERE id=$1 AND status='pending'`,
          [current.id]
        );
        return { httpStatus: 410, error: 'invitation_expired' };
      }

      const { rows: cancelled } = await client.query(
        `UPDATE invitations
            SET status='cancelled', cancelled_at=clock_timestamp()
          WHERE id=$1
            AND inviter_user_id=$2
            AND status='pending'
            AND expires_at > clock_timestamp()
          RETURNING id`,
        [current.id, req.user.id]
      );
      if (cancelled[0]) return { cancelled: true };
      await client.query(
        `UPDATE invitations SET status='expired'
          WHERE id=$1 AND status='pending'
            AND expires_at <= clock_timestamp()`,
        [current.id]
      );
      return { httpStatus: 410, error: 'invitation_expired' };
    });

    if (!outcome.cancelled) {
      return res.status(outcome.httpStatus).json({ error: outcome.error });
    }
    res.json({ cancelled: true });
  } catch (err) { next(err); }
});

// ─── POST /accept-link (guest accept de link público) ─────
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
