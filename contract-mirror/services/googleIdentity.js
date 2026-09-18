/**
 * APP-BE-SOCIAL-AUTH-01 · wrapper estrecho para Google Identity.
 *
 * La biblioteca oficial vive detrás de `verifier`. El adapter runtime sólo usa
 * claves públicas mediante `verifyIdToken`; en tests no se instala por default
 * para impedir red accidental. Aun cuando el adapter valida firma, PayMe vuelve
 * a validar las claims de autoridad y descarta todo salvo namespace+subject.
 * v2.92.0 · la única excepción es `verifyIdTokenWithProfile`, que usa sólo
 * «Continuar con Google» para la copia única al crear la cuenta.
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

/**
 * Verifica firma y claims de autoridad. Devuelve las claims crudas SÓLO a las
 * dos funciones de este módulo; nunca salen tal cual.
 */
async function verifyClaims(idToken, { env = process.env, nowSeconds } = {}) {
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
  return claims;
}

function neutralEvidence(idToken, claims) {
  return {
    provider: PROVIDER,
    subject_namespace: NAMESPACE,
    subject: claims.sub,
    credential_hash: credentialHash(idToken),
    credential_expires_at: new Date(claims.exp * 1000),
  };
}

async function verifyIdToken(idToken, options = {}) {
  return neutralEvidence(idToken, await verifyClaims(idToken, options));
}

/** Un claim de texto del proveedor: string acotado o null. Nunca otro tipo. */
function claimDeTexto(value, maximo) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximo
    ? value : null;
}

/**
 * v2.92.0 · APP-GOOGLE-CONTINUE-AB-07 · raíz v2.43, enmienda acotada a la
 * guarda 8 del acta de identidad social del 26/08.
 *
 * Igual que `verifyIdToken`, más un `profile` con lo ÚNICO que el alta en un
 * toque puede copiar UNA vez: nombre, apellido y correo. `email_verified` se
 * exige estrictamente booleano `true` (un string "true" no cuenta). No se toma
 * foto, locale ni ninguna otra claim. Quien llama decide si usa el perfil; el
 * login no lo mira nunca.
 */
async function verifyIdTokenWithProfile(idToken, options = {}) {
  const claims = await verifyClaims(idToken, options);
  return {
    evidence: neutralEvidence(idToken, claims),
    profile: {
      given_name: claimDeTexto(claims.given_name, 400),
      family_name: claimDeTexto(claims.family_name, 400),
      name: claimDeTexto(claims.name, 800),
      email: claimDeTexto(claims.email, 320),
      email_verified: claims.email_verified === true,
    },
  };
}

module.exports = {
  capability,
  verifyIdToken,
  verifyIdTokenWithProfile,
  credentialHash,
  installVerifierForTests,
  resetVerifierForTests,
  PROVIDER,
  NAMESPACE,
};
