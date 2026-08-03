/**
 * middleware/auth.js v2.5.1
 *
 * Cambios vs v2.5.0:
 *   - P1 #6: si el JWT tiene `session_id`, valida que la session esté activa
 *     en `user_sessions` (revocable). Tokens viejos sin session_id siguen
 *     funcionando hasta que expiren (backward compat).
 *   - P1 #6: valida iss/aud si están en el token.
 *   - P1 #8: guestOrAuth resuelve guest token por hash si existe, con fallback
 *     a token crudo legacy.
 *   - requireMesaParticipant también soporta guest_token_hash.
 */
'use strict';

const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { tokenHash, verifyInvitationLinkToken } = require('../utils/tokens');
const logger = require('../utils/logger');

const JWT_ISS = process.env.JWT_ISSUER || 'payme.mx';
const JWT_AUD = process.env.JWT_AUDIENCE || 'payme-app';

function verifyJwt(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    // Estos verifiers fallan si el claim ESTÁ en el token y no matchea.
    // Si el token no tiene iss/aud (tokens viejos pre-v2.5.1), no falla.
    issuer: undefined,
    audience: undefined,
    algorithms: ['HS256'],
  });
}

async function loadActiveSession({ jti, sessionId }) {
  if (jti) {
    const { rows: [session] } = await pool.query(
      `SELECT id, user_id, jti, status, expires_at, revoked_at
         FROM user_sessions
        WHERE jti = $1`,
      [jti]
    );
    if (!session) return null;
    // Un token que trae ambos claims no puede hacer que cada uno apunte a una
    // sesión distinta. `session_id` legacy pudo representar id o jti.
    if (sessionId && sessionId !== session.id && sessionId !== session.jti) return null;
    return session;
  }
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 100) {
    return null;
  }
  const { rows } = await pool.query(
    `SELECT id, user_id, jti, status, expires_at, revoked_at
       FROM user_sessions
      WHERE id::text = $1 OR jti = $1
      LIMIT 2`,
    [sessionId]
  );
  // Fail-closed ante una colisión teórica id↔jti: un claim nunca elige entre
  // dos sesiones por orden físico de PostgreSQL.
  return rows.length === 1 ? rows[0] : null;
}

async function loadUser(userId) {
  const { rows } = await pool.query(
    `SELECT id, payme_id, email, first_name, last_name, status,
            kyc_status, stripe_customer_id
       FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'auth_required' });
    }
    const token = header.slice(7);
    let payload;
    try {
      payload = verifyJwt(token);
    } catch (err) {
      return res.status(401).json({ error: 'invalid_token' });
    }

    // Validación de claims opcionales (si están presentes deben matchear)
    if (payload.iss && payload.iss !== JWT_ISS) {
      return res.status(401).json({ error: 'invalid_issuer' });
    }
    if (payload.aud && payload.aud !== JWT_AUD) {
      return res.status(401).json({ error: 'invalid_audience' });
    }
    if (payload.nbf && Date.now() < payload.nbf * 1000) {
      return res.status(401).json({ error: 'token_not_yet_valid' });
    }

    // v2.5.1 P1 #6: si el JWT tiene session_id, validar que esté activa
    if (payload.jti || payload.session_id) {
      const session = await loadActiveSession({
        jti: payload.jti,
        sessionId: payload.session_id,
      });
      if (!session) {
        // Si el token DICE tener jti pero no existe en DB → revocada/inexistente
        return res.status(401).json({ error: 'session_not_found' });
      }
      if (session.status !== 'active') {
        return res.status(401).json({ error: 'session_revoked' });
      }
      if (session.expires_at && new Date(session.expires_at) < new Date()) {
        return res.status(401).json({ error: 'session_expired' });
      }
      const subject = payload.sub || payload.user_id;
      if (!subject || session.user_id !== subject) {
        return res.status(401).json({ error: 'session_subject_mismatch' });
      }
      // Refrescar last_seen async (no bloquea)
      pool.query(
        `UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1`,
        [session.id]
      ).catch((e) => logger.warn('last_seen_update_failed', { error: e.message }));
    }

    const user = await loadUser(payload.sub || payload.user_id);
    if (!user) return res.status(401).json({ error: 'user_not_found' });
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'user_suspended' });
    }

    req.user = user;
    req.jwtPayload = payload;
    next();
  } catch (err) {
    logger.error('auth_middleware_error', { error: err.message });
    res.status(500).json({ error: 'auth_error' });
  }
}

/**
 * Para endpoints que aceptan auth o guest_token.
 *
 * Guest token sources (en orden):
 *   1. ?t=xxx en query
 *   2. X-Guest-Token header
 */
async function guestOrAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return requireAuth(req, res, next);

  const guestTok = req.query.t || req.headers['x-guest-token'];
  if (!guestTok) {
    return res.status(401).json({ error: 'auth_or_guest_token_required' });
  }
  if (typeof guestTok !== 'string' || guestTok.length < 8 || guestTok.length > 200) {
    return res.status(401).json({ error: 'invalid_guest_token' });
  }

  req.isGuest = true;
  req.guestToken = guestTok;
  req.guestTokenHash = tokenHash(guestTok);
  next();
}

/**
 * Verifica que el caller sea participante de la mesa.
 *
 * v2.5.1 P1 #8: para guests, valida por token_hash primero (nuevos links)
 *               con fallback a token crudo (legacy).
 */
async function requireMesaParticipant(req, res, next) {
  try {
    const code = req.params.code;
    const { rows: mRows } = await pool.query(
      // Todas las columnas van calificadas: 'id', 'status' y 'created_at' existen
      // en mesas Y en restaurants, y una referencia sin alias hace que Postgres
      // aborte la query entera con 42702 (column reference is ambiguous).
      `SELECT m.id, m.code, m.restaurant_id, m.opener_user_id, m.total_cents, m.paid_amount_cents,
              m.tip_amount_cents, m.division_mode, m.expected_participants,
              m.status, m.expires_at, m.metadata, r.fee_pct
         FROM mesas m
         LEFT JOIN restaurants r ON r.id = m.restaurant_id
        WHERE m.code = $1`,
      [code]
    );
    if (mRows.length === 0 || !mRows[0].id) {
      // re-fetch sin join (sin fee_pct)
      const { rows: m2 } = await pool.query(
        `SELECT id, code, restaurant_id, opener_user_id, total_cents, paid_amount_cents,
                tip_amount_cents, division_mode, expected_participants,
                status, expires_at, metadata
           FROM mesas WHERE code = $1`,
        [code]
      );
      if (m2.length === 0) return res.status(404).json({ error: 'mesa_not_found' });
      req.mesa = m2[0];
    } else {
      req.mesa = mRows[0];
    }

    if (req.isGuest) {
      // Validar guest token: hash o legacy
      const hash = req.guestTokenHash;
      const raw  = req.guestToken;
      const looksV2 = raw.startsWith('v2.');
      let versionedInvitationId = null;
      if (looksV2) {
        try {
          versionedInvitationId = verifyInvitationLinkToken(raw);
        } catch (err) {
          logger.error('invitation_link_verification_unavailable', { error: err.code || err.message });
          return res.status(503).json({ error: 'invitation_link_unavailable' });
        }
        if (!versionedInvitationId) {
          return res.status(403).json({ error: 'not_a_mesa_participant' });
        }
      }

      const { rowCount } = await pool.query(
        `SELECT 1 FROM (
           SELECT 1 FROM mesa_participants
            WHERE mesa_id = $1
              AND (
                ($2::text IS NOT NULL AND guest_token_hash = $2::text)
                OR ($3::text IS NOT NULL AND guest_token = $3::text)
              )
              AND status = 'active'
           UNION ALL
           SELECT 1 FROM invitations canonical
            WHERE $4::uuid IS NOT NULL
              AND canonical.id = $4::uuid
              AND canonical.mesa_id = $1
              AND canonical.invitation_type = 'link'
              AND canonical.superseded_by_id IS NULL
              AND canonical.status = 'pending'
              AND canonical.expires_at > NOW()
           UNION ALL
           SELECT 1
             FROM invitations source
             JOIN invitations canonical
               ON canonical.id = COALESCE(source.superseded_by_id, source.id)
              AND canonical.mesa_id = source.mesa_id
              AND canonical.inviter_user_id = source.inviter_user_id
              AND canonical.invitation_type = source.invitation_type
              AND (canonical.invitation_type <> 'in_app'
                   OR canonical.invited_user_id IS NOT DISTINCT FROM source.invited_user_id)
            WHERE $4::uuid IS NULL
              AND source.mesa_id = $1
              AND canonical.mesa_id = $1
              AND canonical.invitation_type = 'link'
              AND canonical.superseded_by_id IS NULL
              AND (
                ($2::text IS NOT NULL AND source.token_hash = $2::text)
                OR ($3::text IS NOT NULL AND source.token = $3::text)
              )
              AND canonical.status = 'pending'
              AND source.expires_at > NOW()
              AND canonical.expires_at > NOW()
         ) sub LIMIT 1`,
        [req.mesa.id, hash, raw, versionedInvitationId]
      );
      if (rowCount === 0) {
        return res.status(403).json({ error: 'not_a_mesa_participant' });
      }
      req.mesaRole = 'guest';
      return next();
    }

    // Auth user
    const u = req.user.id;
    if (req.mesa.opener_user_id === u) {
      req.mesaRole = 'opener';
      return next();
    }
    const { rowCount } = await pool.query(
      `SELECT 1 FROM (
         SELECT 1 FROM mesa_participants
          WHERE mesa_id = $1 AND user_id = $2 AND status = 'active'
         UNION ALL
         SELECT 1 FROM invitations
          WHERE mesa_id = $1 AND invited_user_id = $2 AND status = 'pending'
            AND superseded_by_id IS NULL
            AND expires_at > NOW()
       ) sub LIMIT 1`,
      [req.mesa.id, u]
    );
    if (rowCount === 0) {
      return res.status(403).json({ error: 'not_a_mesa_participant' });
    }
    req.mesaRole = 'participant';
    next();
  } catch (err) {
    logger.error('mesa_participant_check_error', { error: err.message });
    res.status(500).json({ error: 'mesa_check_failed' });
  }
}

module.exports = {
  requireAuth,
  guestOrAuth,
  requireMesaParticipant,
  verifyJwt,
  // Compartido con /auth/logout: aceptar una forma legacy en el middleware
  // pero no poder revocarla dejaría una sesión activa tras un logout exitoso.
  loadActiveSession,
};
