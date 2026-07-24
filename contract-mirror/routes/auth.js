/**
 * routes/auth.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P2 #10: POST /refresh AHORA ROTA el refresh_token + reuse detection.
 *     · Cada refresh genera un nuevo raw refresh token, guarda su hash en
 *       refresh_token_hash y mueve el hash anterior a prev_refresh_token_hash.
 *     · El refresh token viejo deja de servir (ya no matchea refresh_token_hash).
 *     · REUSE DETECTION (1 nivel): si llega un token cuyo hash matchea
 *       prev_refresh_token_hash (el inmediatamente anterior, ya rotado), se
 *       interpreta como replay → se revoca la session
 *       (status='revoked', revoked_reason='refresh_reuse_detected') → 401.
 *
 * v2.5.1 (se mantiene):
 *   - P1 #6: login/register crean session con jti; logout revoca.
 *   - P1 #7: email normalizado (ahora además normalizado en el schema, P1 #4).
 */
'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const schemas = require('../schemas');
const { generateToken, tokenHash, normalizeEmail, hashIp } = require('../utils/tokens');
const { generatePaymeId } = require('../utils/userId');
const logger = require('../utils/logger');

const router = express.Router();
const { validateBody } = schemas;

const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS) || (7 * 24 * 60 * 60);   // 7d
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS) || (30 * 24 * 60 * 60); // 30d
const JWT_ISS = process.env.JWT_ISSUER || 'payme.mx';
const JWT_AUD = process.env.JWT_AUDIENCE || 'payme-app';

async function createSession({ userId, userAgent, ip }) {
  const jti = randomUUID();
  const rawRefresh = generateToken(32);
  const refreshHash = tokenHash(rawRefresh);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

  await pool.query(
    `INSERT INTO user_sessions
       (user_id, jti, refresh_token_hash, user_agent, ip_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, jti, refreshHash, (userAgent || '').slice(0, 500), hashIp(ip), expiresAt]
  );

  return { jti, rawRefresh, expiresAt };
}

function issueAccessToken({ userId, jti }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, jti, iss: JWT_ISS, aud: JWT_AUD, nbf: now, iat: now },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL_SECONDS }
  );
}

// ─── POST /register ────────────────────────────────────────
router.post('/register', validateBody(schemas.register), async (req, res, next) => {
  try {
    // req.body.email ya viene normalizado por el schema (P1 #4), pero
    // normalizeEmail es idempotente y lo dejamos por claridad.
    const { email, phone, password, first_name, last_name } = req.body;
    const normalized = normalizeEmail(email);

    const { rowCount } = await pool.query(
      `SELECT 1 FROM users WHERE email_normalized = $1 OR LOWER(email) = $1`,
      [normalized]
    );
    if (rowCount > 0) return res.status(409).json({ error: 'email_already_registered' });

    const hash = await bcrypt.hash(password, 10);
    const paymeId = await generatePaymeId();

    const { rows } = await pool.query(
      `INSERT INTO users (payme_id, email, email_normalized, phone, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, payme_id, email, first_name, last_name`,
      [paymeId, email, normalized, phone || null, hash, first_name, last_name]
    );
    const user = rows[0];

    await pool.query(`INSERT INTO wallets (user_id, balance_cents) VALUES ($1, 0)`, [user.id]);

    const session = await createSession({
      userId: user.id, userAgent: req.headers['user-agent'], ip: req.ip,
    });
    const accessToken = issueAccessToken({ userId: user.id, jti: session.jti });

    logger.audit('user_registered', { user_id: user.id, payme_id: user.payme_id });

    res.status(201).json({
      user,
      access_token: accessToken,
      refresh_token: session.rawRefresh,
      expires_in: JWT_TTL_SECONDS,
    });
  } catch (err) { next(err); }
});

// ─── POST /login ───────────────────────────────────────────
router.post('/login', validateBody(schemas.login), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalized = normalizeEmail(email);

    const { rows } = await pool.query(
      `SELECT id, payme_id, email, first_name, last_name, password_hash, status
         FROM users
        WHERE email_normalized = $1 OR LOWER(email) = $1
        LIMIT 1`,
      [normalized]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'invalid_credentials' });

    const user = rows[0];
    if (user.status !== 'active') return res.status(403).json({ error: 'user_suspended' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

    await pool.query(
      `UPDATE users SET email_normalized = $1 WHERE id = $2 AND email_normalized IS NULL`,
      [normalized, user.id]
    );

    const session = await createSession({
      userId: user.id, userAgent: req.headers['user-agent'], ip: req.ip,
    });
    const accessToken = issueAccessToken({ userId: user.id, jti: session.jti });

    logger.audit('user_login', { user_id: user.id });

    res.json({
      // G-02 (v2.20): mismo shape de user que register — quien se loguea (no
      // registra) también conoce su nombre/payme_id sin round-trip extra.
      user: {
        id: user.id, payme_id: user.payme_id, email: user.email,
        first_name: user.first_name, last_name: user.last_name,
      },
      access_token: accessToken,
      refresh_token: session.rawRefresh,
      expires_in: JWT_TTL_SECONDS,
    });
  } catch (err) { next(err); }
});

// ─── POST /refresh (v2.5.2 P2 #10: rotación + reuse detection) ──
router.post('/refresh', validateBody(schemas.refreshToken), async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    const incomingHash = tokenHash(refresh_token);

    // 1) Buscar por el refresh_token_hash ACTUAL.
    const { rows } = await pool.query(
      `SELECT id, user_id, jti, status, expires_at
         FROM user_sessions
        WHERE refresh_token_hash = $1
        LIMIT 1`,
      [incomingHash]
    );
    const session = rows[0];

    if (!session) {
      // 2) ¿Matchea un token YA ROTADO (prev_refresh_token_hash)?
      //    Eso es reuse de un token viejo → replay → revocar la session.
      const { rows: reuseRows } = await pool.query(
        `SELECT id, user_id, status
           FROM user_sessions
          WHERE prev_refresh_token_hash = $1
          LIMIT 1`,
        [incomingHash]
      );
      const reused = reuseRows[0];
      if (reused) {
        if (reused.status === 'active') {
          await pool.query(
            `UPDATE user_sessions
                SET status='revoked', revoked_at=NOW(),
                    revoked_reason='refresh_reuse_detected'
              WHERE id = $1`,
            [reused.id]
          );
        }
        logger.warn('refresh_reuse_detected', {
          session_id: reused.id, user_id: reused.user_id,
        });
        return res.status(401).json({ error: 'refresh_reuse_detected' });
      }
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }

    if (session.status !== 'active') {
      return res.status(401).json({ error: 'session_revoked' });
    }
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: 'session_expired' });
    }
    if (!session.jti) {
      return res.status(500).json({ error: 'session_missing_jti' });
    }

    // 3) ROTAR: nuevo raw refresh, mover el actual a prev_refresh_token_hash.
    const newRawRefresh = generateToken(32);
    const newRefreshHash = tokenHash(newRawRefresh);

    await pool.query(
      `UPDATE user_sessions
          SET prev_refresh_token_hash = refresh_token_hash,
              refresh_token_hash = $2,
              last_seen_at = NOW()
        WHERE id = $1`,
      [session.id, newRefreshHash]
    );

    const accessToken = issueAccessToken({ userId: session.user_id, jti: session.jti });

    logger.audit('token_refreshed', { session_id: session.id, user_id: session.user_id });

    res.json({
      access_token: accessToken,
      refresh_token: newRawRefresh,  // rotado
      expires_in: JWT_TTL_SECONDS,
    });
  } catch (err) { next(err); }
});

// ─── POST /logout ──────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'auth_required' });
    }
    const token = header.slice(7);

    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); }
    catch (err) { return res.status(401).json({ error: 'invalid_token' }); }

    if (!payload.jti) {
      return res.json({ revoked: false, reason: 'legacy_token_no_session' });
    }

    const { rowCount } = await pool.query(
      `UPDATE user_sessions
          SET status='revoked', revoked_at=NOW(),
              revoked_reason = COALESCE(revoked_reason, 'user_logout')
        WHERE jti = $1 AND status = 'active'`,
      [payload.jti]
    );

    logger.audit('user_logout', {
      user_id: payload.sub, jti: payload.jti, revoked: rowCount > 0,
    });

    res.json({ revoked: rowCount > 0 });
  } catch (err) { next(err); }
});

module.exports = router;
