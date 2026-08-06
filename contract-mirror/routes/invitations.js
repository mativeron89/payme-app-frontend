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
const stateMachine = require('../utils/stateMachine');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

// ─── GET / (invitations pendientes para el user actual) ───
// Tercera puerta del gate de admisión (ratificado 2026-08-06): el listado
// MARCA, no filtra. Una invitación cuya mesa murió sigue apareciendo —
// desaparecerla parecería un bug y la persona no entendería qué pasó — pero
// viaja con `mesa_joinable: false` para que el front la muestre apagada
// ("Esta mesa ya cerró") sin que nadie toque un camino muerto.
//
// `mesa_joinable` se computa acá en JS con EL MISMO `mesaViva()` que gatea
// las dos puertas de entrar — no en SQL, que sería una segunda expresión de
// la regla desincronizándose sola. `mesa_status` acompaña para el copy. El
// front lee `mesa_joinable` directo, sin inferir ni reimplementar la regla.
// Ambos campos son aditivos: un front que los ignora ve lo mismo que ayer.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.mesa_id, i.invitation_type, i.status, i.expires_at, i.created_at,
              m.code AS mesa_code, m.status AS mesa_status,
              r.name AS restaurant_name,
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
    res.json({
      invitations: rows.map((row) => ({
        ...row,
        mesa_joinable: stateMachine.mesaViva(row.mesa_status),
      })),
    });
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

      // ─── Gate de admisión (ratificado 2026-08-06) ─────────────────────────
      // La invitación está viva; ahora la MESA tiene que estarlo. Cierra la
      // ventana crear-viva → aceptar-muerta medida en
      // docs/VENTANA_INVITACION_MESA_MUERTA_2026-08-06.md.
      //
      // Carrera resuelta por el lock que YA tenemos: lockCanonical bloqueó la
      // fila de la mesa FOR UPDATE (orden mesa → invitación), y settleMesa
      // toma ese mismo lock en su Fase 1 — la mesa no puede morir entre esta
      // lectura y el INSERT del participante; muere antes (y acá se ve) o
      // después del commit (y el participante entró con la mesa viva).
      //
      // El gate es sobre ACEPTAR, no sobre ESTAR: cero retroactividad — a
      // ninguna fila existente de mesa_participants la toca nadie.
      const { rows: [mesaRow] } = await client.query(
        `SELECT status FROM mesas WHERE id=$1`, [current.mesa_id]
      );
      if (!mesaRow || !stateMachine.mesaViva(mesaRow.status)) {
        // 410 mesa_not_joinable ≠ 409 mesa_not_invitable (crear) ni 410
        // invitation_expired: el front necesita copys distintos. La invitación
        // queda pending y vence sola — la mesa no revive, no hay replay útil.
        return {
          httpStatus: 410,
          error: 'mesa_not_joinable',
          mesaStatus: mesaRow?.status || null,
        };
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
        ...(outcome.mesaStatus && { mesa_status: outcome.mesaStatus }),
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

// ─── POST /accept-link ────────────────────────────────────
// Canjea el token de un link por una INSCRIPCIÓN, para un usuario con sesión.
//
// Antes esto era un 501 y los invitados operaban la mesa con `?t=` crudo, sin
// cuenta. Ése es el pago sin cuenta que se está cerrando: el token deja de ser
// autorización para pagar y pasa a ser una CREDENCIAL para sumarse. Sobrevive
// al alta porque el front lo conserva y lo canjea acá una vez que hay sesión.
//
// El link es MULTIUSO: varios comensales entran por el mismo. Por eso esto NO
// marca la invitación como `accepted` —eso la consumiría para todos los demás—;
// inscribe y la deja `pending`. Es lo que hace coherente la ratificación del
// 2026-08-04: mientras el link viva sigue admitiendo, y cancelarlo corta la
// admisión sin tocar a quien ya entró.
//
// Idempotente por el índice parcial de mesa_participants: canjear dos veces
// deja exactamente una fila activa.
router.post('/accept-link', async (req, res, next) => {
  try {
    const token = req.body?.token;
    if (typeof token !== 'string' || token.length < 8 || token.length > 200) {
      return res.status(400).json({ error: 'invitation_token_required' });
    }

    const outcome = await pool.tx(async (client) => {
      let link;
      try {
        link = await invitationAuthority.resolveLinkToken(client, token);
      } catch (err) {
        // Sin secreto de firma no se puede decidir si un token v2 es válido.
        // Fallar cerrado y 503: un 403 afirmaría que el token no sirve.
        if (err.code === 'invitation_link_secret_invalid') {
          logger.error('invitation_link_verification_unavailable', { error: err.code });
          return { httpStatus: 503, error: 'invitation_link_unavailable' };
        }
        throw err;
      }
      // Un token vencido, cancelado, supersedido o inexistente se contestan
      // IGUAL: distinguirlos le diría a un desconocido si una mesa existe.
      if (!link) return { httpStatus: 403, error: 'invitation_link_not_valid' };

      // FOR UPDATE: mismo criterio de carrera que /:id/accept — settleMesa
      // toma este lock en su Fase 1, así que la mesa no puede morir entre el
      // gate y el INSERT del participante.
      const { rows: [mesa] } = await client.query(
        `SELECT id, code, status FROM mesas WHERE id=$1 FOR UPDATE`, [link.mesa_id]
      );
      if (!mesa) return { httpStatus: 403, error: 'invitation_link_not_valid' };

      // ─── Gate de admisión (ratificado 2026-08-06 · decisión C) ────────────
      // "Una sola regla, aplicada igual en las dos puertas": el MISMO
      // predicado mesaViva() que /:id/accept. El 410 revela el estado de la
      // mesa sólo a quien ya probó tener un token VÁLIDO — el 403 uniforme de
      // arriba sigue cubriendo al desconocido. Cortar la admisión no toca a
      // quien ya entró por este link: cero retroactividad.
      if (!stateMachine.mesaViva(mesa.status)) {
        return {
          httpStatus: 410,
          error: 'mesa_not_joinable',
          mesaStatus: mesa.status,
        };
      }

      await client.query(
        `INSERT INTO mesa_participants (mesa_id, user_id, role, status)
         VALUES ($1, $2, 'invited', 'active')
         -- Mismo árbitro parcial que /:id/accept: sin repetir el predicado,
         -- Postgres no infiere el índice y aborta con 42P10.
         ON CONFLICT (mesa_id, user_id) WHERE user_id IS NOT NULL
           DO UPDATE SET status = 'active'`,
        [link.mesa_id, req.user.id]
      );

      return { joined: true, invitationId: link.id, mesaCode: mesa.code };
    });

    if (!outcome.joined) {
      return res.status(outcome.httpStatus).json({
        error: outcome.error,
        ...(outcome.mesaStatus && { mesa_status: outcome.mesaStatus }),
      });
    }

    logger.audit('invitation_link_joined', {
      invitation_id: outcome.invitationId,
      user_id: req.user.id,
    });
    res.json({ joined: true, mesa_code: outcome.mesaCode });
  } catch (err) { next(err); }
});

module.exports = router;
