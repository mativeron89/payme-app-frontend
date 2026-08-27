/**
 * APP-BE-SOCIAL-AUTH-01 · wrapper estrecho para Google Identity.
 *
 * La biblioteca oficial vive detrás de `verifier`. El adapter runtime sólo usa
 * claves públicas mediante `verifyIdToken`; en tests no se instala por default
 * para impedir red accidental. Aun cuando el adapter valida firma, PayMe vuelve
 * a validar las claims de autoridad y descarta todo salvo namespace+subject.
 */
'use strict';

const { tokenHash } = require('../utils/tokens');
const authRecovery = require('./authRecovery');
const { runtimeGoogleIdentityVerifier } = require('./googleIdentityVerifier');

const PROVIDER = 'google';
const NAMESPACE = 'https://accounts.google.com';
const VALID_ISSUERS = new Set([NAMESPACE, 'accounts.google.com']);
const TRANSIENT_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'google_keys_unavailable',
]);
let verifier = process.env.NODE_ENV === 'test' ? null : runtimeGoogleIdentityVerifier;

function codedError(code) {
  return Object.assign(new Error(code), { code });
}

function parseClientIds(env = process.env) {
  if (typeof env.SOCIAL_GOOGLE_CLIENT_IDS !== 'string') return null;
  const values = env.SOCIAL_GOOGLE_CLIENT_IDS.split(',').map((v) => v.trim()).filter(Boolean);
  if (values.length === 0 || values.length > 10 || new Set(values).size !== values.length) return null;
  if (values.some((v) => !/^[A-Za-z0-9._:-]{3,200}$/.test(v))) return null;
  return values;
}

function parseWebClientId(env = process.env, clientIds = parseClientIds(env)) {
  const value = typeof env.SOCIAL_GOOGLE_WEB_CLIENT_ID === 'string'
    ? env.SOCIAL_GOOGLE_WEB_CLIENT_ID.trim() : '';
  if (!clientIds || !value || !clientIds.includes(value)) return null;
  return value;
}

function capability(env = process.env) {
  const clientIds = parseClientIds(env);
  const webClientId = parseWebClientId(env, clientIds);
  const enabled = env.SOCIAL_GOOGLE_ENABLED === 'true'
    && clientIds !== null && webClientId !== null
    && typeof verifier === 'function';
  return {
    enabled,
    registration: enabled && authRecovery.capability(env).enabled,
    login: enabled,
    linking: enabled,
    web_client_id: enabled ? webClientId : null,
  };
}

function installVerifierForTests(candidate) {
  if (process.env.NODE_ENV !== 'test' || typeof candidate !== 'function') {
    throw new Error('google_identity_test_verifier_forbidden');
  }
  verifier = candidate;
}

function resetVerifierForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('google_identity_test_verifier_forbidden');
  verifier = null;
}

function credentialHash(idToken) {
  return tokenHash(idToken);
}

async function verifyIdToken(idToken, { env = process.env, nowSeconds } = {}) {
  const clientIds = parseClientIds(env);
  if (!capability(env).enabled || !clientIds) throw codedError('social_auth_not_available');
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 8192) {
    throw codedError('social_auth_failed');
  }

  let verified;
  try {
    verified = await verifier({ idToken, audience: [...clientIds] });
  } catch (error) {
    if (TRANSIENT_CODES.has(error?.code)) {
      throw codedError('social_auth_temporarily_unavailable');
    }
    throw codedError('social_auth_failed');
  }
  const claims = verified?.payload;
  const checkedAt = Number.isSafeInteger(nowSeconds)
    ? nowSeconds : Math.floor(Date.now() / 1000);
  if (verified?.signature_verified !== true || !claims || typeof claims !== 'object'
      || !VALID_ISSUERS.has(claims.iss)
      || typeof claims.aud !== 'string' || !clientIds.includes(claims.aud)
      || !Number.isSafeInteger(claims.exp) || claims.exp <= checkedAt
      || typeof claims.sub !== 'string'
      || !/^[A-Za-z0-9._:-]{1,255}$/.test(claims.sub)) {
    throw codedError('social_auth_failed');
  }

  return {
    provider: PROVIDER,
    subject_namespace: NAMESPACE,
    subject: claims.sub,
    credential_hash: credentialHash(idToken),
    credential_expires_at: new Date(claims.exp * 1000),
  };
}

module.exports = {
  capability,
  verifyIdToken,
  credentialHash,
  installVerifierForTests,
  resetVerifierForTests,
  PROVIDER,
  NAMESPACE,
};
