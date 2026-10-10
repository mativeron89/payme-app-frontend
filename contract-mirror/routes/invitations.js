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
const notifs = require('../services/notifications');
const profileIdentity = require('../services/profileIdentity');
const stateMachine = require('../utils/stateMachine');
const { displayRestaurantName } = require('../services/mesaPresentation');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

// ─── GET / (invitations pendientes para el user actual) ───
// 🔴 v2.166.2 · decisión 228 de Mati («Que desaparezca sola (Recomendada)»): una invitación cuya
// mesa ya no admite gente SALE del listado, para todos los invitados, también las que ya estaban.
// Supersede la tercera puerta del 2026-08-06 («el listado MARCA, no filtra»): Mati vio la tarjeta
// trabada con «Esta mesa ya cerró» y sin nada que hacer con ella.
//
// Se filtra al leer, sin escribir: la fila sigue `pending` en la base porque una invitación
// pendiente también da acceso a la mesa (`requireMesaParticipant`), a la selección informativa
// propia (`informativeSelections`) y al historial (`GET /mesas/mine`) de quien declaró con ella.
// Aceptarla ya da 410 `mesa_not_joinable` bajo el lock de la mesa.
//
// La regla es EL MISMO `mesaViva()` que gatea las dos puertas de entrar, en JS y no en SQL, que
// sería una segunda expresión de la regla desincronizándose sola. `mesa_joinable` sigue en la
// respuesta (ahora siempre true): el front lo conserva como defensa para la carrera, una mesa que
// cierra entre este listado y el toque. `mesa_status` acompaña para el copy.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.mesa_id, i.invitation_type, i.status, i.expires_at, i.created_at,
              m.code AS mesa_code, m.status AS mesa_status,
              r.name AS restaurant_name,
              -- AB-NOMBRE-RESTO · sólo para displayRestaurantName; se quitan abajo.
              r.status AS nombre_restaurant_status,
              m.metadata->>'restaurant_label' AS nombre_restaurant_label,
              -- v2.93.0 · G-31 · categoría del restaurante para la tarjeta.
              -- Enum cerrado de restaurants.category, NOT NULL en la base.
              r.category AS restaurant_category,
              u.first_name AS inviter_first_name, u.last_name AS inviter_last_name,
              u.payme_id AS inviter_payme_id,
              -- v2.149.0 · E174-3B · sólo para has_inviter_avatar; se quitan abajo.
              i.inviter_user_id AS foto_inviter_id, u.status AS foto_inviter_status,
              EXISTS (SELECT 1 FROM user_avatars a WHERE a.user_id = i.inviter_user_id) AS foto_tiene
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
    // v2.149.0 · E174-3B · `has_inviter_avatar`: GET /api/invitations/:id/inviter-avatar le
    // respondería 200 a este usuario. La misma regla n164 (`profileIdentity.fotoVisibleN164`) que la
    // ruta y que la pista de la notificación. El listado sólo trae invitaciones RECIBIDAS, así que
    // la clave va siempre. El id del invitador no sale: es sólo para calcularla.
    const vivas = rows.filter((r) => stateMachine.mesaViva(r.mesa_status));
    const conFoto = await Promise.all(vivas.map((r) => profileIdentity.fotoVisibleN164(
      { userId: r.foto_inviter_id, status: r.foto_inviter_status, tieneFoto: r.foto_tiene })));
    res.json({
      // AB-NOMBRE-RESTO (2026-09-25) · `restaurant_name` con la MISMA regla que
      // GET /mesas/:code (el nombre que se le puso a la mesa si el restaurante es
      // privado). Cambia el VALOR, no las claves: las dos columnas auxiliares no
      // salen en la respuesta.
      invitations: vivas.map(({
        nombre_restaurant_status, nombre_restaurant_label, foto_inviter_id: _id, foto_inviter_status: _st,
        foto_tiene: _tf, ...row
      }, i) => ({
        ...row,
        restaurant_name: displayRestaurantName({ metadata: { restaurant_label: nombre_restaurant_label } },
          row.restaurant_name, nombre_restaurant_status),
        mesa_joinable: stateMachine.mesaViva(row.mesa_status),
        has_inviter_avatar: conFoto[i],
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /:id/inviter-avatar · v2.149.0 · E174-3B (decisión 174) ───
// La foto de quien te invitó, para una invitación cuyo destinatario sos vos. La MISMA función
// interna que /api/notifications/:id/inviter-avatar (`notifs.fotoDelInvitador`, regla n164).
// 🔴 No oracular: id inválido o inexistente, invitación ajena, de link (sin destinatario), cuenta
// eliminada, sin foto, menor o sin fecha responden EXACTAMENTE el mismo 404. `private, no-store`,
// `Vary: Authorization`, sin ETag. Un id mal formado es 404 y no 400: no se distingue el porqué.
const ID_INVITACION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.get('/:id/inviter-avatar', async (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Vary, ETag');
  const absent = () => res.status(404).type('application/json')
    .end(JSON.stringify({ error: 'avatar_not_found' }));
  try {
    if (!ID_INVITACION.test(req.params.id)) return absent();
    const avatar = await notifs.fotoDeQuienInvitaPorInvitacion(req.params.id, req.user.id);
    if (!avatar) return absent();
    res.type(avatar.mimeType);
    res.setHeader('Content-Length', String(avatar.bytes.length));
    return res.end(avatar.bytes);
  } catch (err) { return next(err); }
});

// v2.174.1 · C-02 de la auditoría Codex completa (n333, D237): a quien no es ni el invitado ni quien invitó, aceptar o
// cancelar le responde lo mismo que un id que no existe, antes de decir si está vencida, aceptada o cancelada. Los 403
// quedan sólo para las dos personas de la invitación, que ya saben que existe.
const INVITACION_NO_ENCONTRADA = Object.freeze({ httpStatus: 404, error: 'invitation_not_found' });
const esParte = (inv, userId) => inv.invited_user_id === userId || inv.inviter_user_id === userId;

// ─── POST /:id/accept ─────────────────────────────────────
router.post('/:id/accept', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    const outcome = await pool.tx(async (client) => {
      const current = await invitationAuthority.lockCanonical(client, req.params.id);
      if (!current || !esParte(current, req.user.id)) return INVITACION_NO_ENCONTRADA;
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
      if (!current || !esParte(current, req.user.id)) return INVITACION_NO_ENCONTRADA;
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
