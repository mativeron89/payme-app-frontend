/** Sesiones PayMe compartidas por password y credenciales externas. */
'use strict';

const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const { generateToken, tokenHash } = require('../utils/tokens');

const JWT_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS) || (7 * 24 * 60 * 60);
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS) || (30 * 24 * 60 * 60);
const JWT_ISS = process.env.JWT_ISSUER || 'payme.mx';
const JWT_AUD = process.env.JWT_AUDIENCE || 'payme-app';

async function createSession({ userId, client = pool }) {
  const jti = randomUUID();
  const rawRefresh = generateToken(32);
  const refreshHash = tokenHash(rawRefresh);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await client.query(
    `INSERT INTO user_sessions (user_id,jti,refresh_token_hash,expires_at)
     VALUES ($1,$2,$3,$4)`,
    [userId, jti, refreshHash, expiresAt]
  );
  return { jti, rawRefresh, expiresAt };
}

function issueAccessToken({ userId, jti }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { sub: userId, jti, iss: JWT_ISS, aud: JWT_AUD, nbf: now, iat: now },
    process.env.JWT_SECRET,
    { expiresIn: JWT_TTL_SECONDS, algorithm: 'HS256' }
  );
}

function sessionResponse(user, session) {
  return {
    user,
    access_token: issueAccessToken({ userId: user.id, jti: session.jti }),
    refresh_token: session.rawRefresh,
    expires_in: JWT_TTL_SECONDS,
  };
}

module.exports = {
  createSession,
  issueAccessToken,
  sessionResponse,
  JWT_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  JWT_ISS,
  JWT_AUD,
};
