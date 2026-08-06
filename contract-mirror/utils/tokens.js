/**
 * utils/tokens.js v2.5.1 — Helpers de tokens (P1 #8 + P1 #6)
 *
 * Centraliza:
 *   - generateToken(bytes): token crudo random (base64url)
 *   - tokenHash(token): SHA-256 hex de un token
 *   - normalizeEmail(email): trim + lowercase (P1 #7)
 *   - hashIp(ip): SHA-256 hex de IP para almacenar sin exponer
 */
'use strict';

const {
  createHash, createHmac, randomBytes, timingSafeEqual,
} = require('crypto');

const INVITATION_TOKEN_PREFIX = 'v2';
const INVITATION_TOKEN_DOMAIN = 'payme/invitation-link/v2';
const UUID_CANONICAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function generateToken(byteLen = 24) {
  return randomBytes(byteLen).toString('base64url');
}

function tokenHash(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  return createHash('sha256').update(token).digest('hex');
}

function invitationSigningKey() {
  const master = process.env.INVITATION_LINK_SECRET || process.env.JWT_SECRET;
  if (typeof master !== 'string' || Buffer.byteLength(master, 'utf8') < 32) {
    const err = new Error('invitation_link_secret_invalid');
    err.code = 'invitation_link_secret_invalid';
    throw err;
  }
  // Separación de dominio: aun usando JWT_SECRET como fallback compatible, una
  // firma de invitación nunca es intercambiable con un JWT ni con otro HMAC.
  return createHmac('sha256', master).update(INVITATION_TOKEN_DOMAIN).digest();
}

function invitationLinkToken(invitationId) {
  const id = String(invitationId || '').toLowerCase();
  if (!UUID_CANONICAL.test(id)) {
    const err = new Error('invitation_id_invalid');
    err.code = 'invitation_id_invalid';
    throw err;
  }
  const mac = createHmac('sha256', invitationSigningKey())
    .update(`invitation:${id}`)
    .digest('base64url');
  return `${INVITATION_TOKEN_PREFIX}.${id}.${mac}`;
}

/**
 * Verifica tokens v2 deterministas. Devuelve el UUID canónico o null para una
 * firma/forma inválida. Los tokens legacy (sin prefijo v2) se resuelven por hash
 * en DB y no pasan por este helper.
 */
function verifyInvitationLinkToken(raw) {
  if (typeof raw !== 'string' || !raw.startsWith(`${INVITATION_TOKEN_PREFIX}.`)) return null;
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== INVITATION_TOKEN_PREFIX) return null;
  const id = parts[1].toLowerCase();
  // Una invitación debe tener UNA sola representación textual: el raw token
  // también se hashea para derivar la identidad guest. Aceptar el mismo UUID
  // en mayúsculas fracturaría una autoridad lógica en varios guest hashes.
  if (!UUID_CANONICAL.test(id) || parts[1] !== id) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(parts[2])) return null;
  const expected = createHmac('sha256', invitationSigningKey())
    .update(`invitation:${id}`)
    .digest();
  let received;
  try {
    received = Buffer.from(parts[2], 'base64url');
  } catch (_) {
    return null;
  }
  // Buffer.from(base64url) tolera bits de padding no canónicos. Aunque varias
  // strings decodifiquen al mismo HMAC, sólo la codificación emitida vale.
  if (received.length !== expected.length
      || !timingSafeEqual(received, expected)
      || parts[2] !== expected.toString('base64url')) return null;
  return id;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

function hashIp(ip) {
  if (typeof ip !== 'string' || ip.length === 0) return null;
  const pepper = process.env.IP_HASH_PEPPER || process.env.JWT_SECRET;
  // Sin una clave secreta, almacenar un digest enumerable sería peor que no
  // persistirlo. JWT_SECRET es fallback compatible; IP_HASH_PEPPER permite
  // rotación y separación explícitas en entornos que lo configuren.
  if (typeof pepper !== 'string' || pepper.length < 16) return null;
  return createHmac('sha256', pepper).update(ip).digest('hex');
}

module.exports = {
  generateToken,
  tokenHash,
  // Se exporta para que nadie vuelva a escribir el literal 'v2.' en otro
  // archivo: quién decide si un token es versionado tiene que ser uno solo.
  INVITATION_TOKEN_PREFIX,
  invitationLinkToken,
  verifyInvitationLinkToken,
  normalizeEmail,
  hashIp,
};
