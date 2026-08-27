/**
 * APP-BE-GOOGLE-RUNTIME-01 · adapter mínimo de Google Identity Services.
 *
 * Esta es la única superficie que importa `google-auth-library`. No configura
 * ADC, service accounts, scopes ni secretos: `OAuth2Client.verifyIdToken`
 * obtiene/verifica las claves públicas de Google y el wrapper neutral vuelve a
 * validar las claims que constituyen autoridad para PayMe.
 */
'use strict';

const { OAuth2Client } = require('google-auth-library');

const GOOGLE_CERT_FETCH_TIMEOUT_MS = 5_000;

const TRANSIENT_NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'TIMEOUTERROR',
]);

function verifierError(code) {
  return Object.assign(new Error(code), { code });
}

function transientGoogleFailure(error) {
  const visited = new Set();
  let current = error;
  for (let depth = 0; current && typeof current === 'object' && depth < 4; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);

    const code = typeof current.code === 'string' ? current.code.toUpperCase() : '';
    if (TRANSIENT_NETWORK_CODES.has(code) || code.startsWith('ERR_TLS_')) return true;

    const status = Number(current.response?.status ?? current.status ?? current.statusCode);
    if (Number.isInteger(status)
        && (status === 408 || status === 429 || (status >= 500 && status <= 599))) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function createGoogleIdentityVerifier({ client } = {}) {
  const oauthClient = client === undefined
    ? new OAuth2Client({
      transporterOptions: { timeout: GOOGLE_CERT_FETCH_TIMEOUT_MS },
    })
    : client;
  if (!oauthClient || typeof oauthClient.verifyIdToken !== 'function') {
    throw verifierError('google_verifier_client_invalid');
  }

  return async function verifyGoogleIdentity({ idToken, audience }) {
    try {
      const ticket = await oauthClient.verifyIdToken({ idToken, audience });
      const payload = ticket?.getPayload?.();
      return { signature_verified: true, payload };
    } catch (error) {
      if (transientGoogleFailure(error)) throw verifierError('google_keys_unavailable');
      throw verifierError('google_token_invalid');
    }
  };
}

const runtimeGoogleIdentityVerifier = createGoogleIdentityVerifier();

module.exports = {
  createGoogleIdentityVerifier,
  runtimeGoogleIdentityVerifier,
};
