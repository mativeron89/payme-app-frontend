/** Facebook Login BFF dark: code/state server-side y evidencia reducida al subject app-scoped. */
'use strict';

const authRecovery = require('./authRecovery');
const intents = require('./socialAuthIntents');
const { tokenHash } = require('../utils/tokens');
const { createHmac } = require('crypto');
const {
  runtimeFacebookIdentityAdapter,
  parseMetaConfig,
  graphVersion,
} = require('./facebookIdentityAdapter');

const PROVIDER = 'facebook';
const TRANSIENT_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'facebook_temporarily_unavailable',
]);
/**
 * APP-BE-FACEBOOK-RUNTIME-ADAPTER-01 · acá estaba el hueco.
 *
 * Hasta esta versión era `let adapter = null` y el ÚNICO instalador era
 * `installAdapterForTests`, que lanza fuera de `NODE_ENV=test`. O sea que
 * `capability().enabled` —que exige `typeof adapter === 'function'`— no podía
 * ser `true` en producción con NINGUNA combinación de variables: la superficie
 * era oscura por construcción, no por configuración. Google no tenía ese hueco
 * (`googleIdentity.js:21`), y la asimetría entre los dos proveedores era el gap.
 *
 * Se cierra espejando exactamente aquella línea: instancia runtime al cargar,
 * `null` bajo test para que ninguna suite alcance la red por accidente.
 *
 * ⚠️ Cerrar el hueco NO prende nada. `runtimeReady` sigue exigiendo
 * `SOCIAL_FACEBOOK_ENABLED='true'`, config exacta y recovery operativo; sin las
 * tres, la capability queda OFF igual que antes.
 */
let adapter = process.env.NODE_ENV === 'test' ? null : runtimeFacebookIdentityAdapter;

function codedError(code, status = 401) {
  return Object.assign(new Error(code), { code, status });
}

/**
 * ÚNICA puerta de validación de la config de Meta.
 *
 * El parser vive en `services/facebookIdentityAdapter.js` y NO acá: lo
 * necesita también `middleware/envValidation.js`, que corre antes de que se
 * cargue nada más y no puede arrastrar `db/pool` importando este archivo.
 * Duplicarlo eran dos verdades que con el tiempo se separan, y la que se
 * separara decidiría si una superficie de AUTENTICACIÓN queda prendida.
 */
function parseConfig(env = process.env) {
  return parseMetaConfig(env);
}

function capability(env = process.env) {
  const config = parseConfig(env);
  const recoveryReady = authRecovery.capability(env).enabled;
  const runtimeReady = env.SOCIAL_FACEBOOK_ENABLED === 'true'
    && config !== null && typeof adapter === 'function' && recoveryReady;
  const login = runtimeReady;
  const registration = runtimeReady;
  return {
    enabled: login || registration,
    registration,
    login,
    app_id: runtimeReady ? config.appId : null,
    redirect_uri: runtimeReady ? config.redirectUri : null,
  };
}

function callbacksCapability(env = process.env) {
  const config = parseConfig(env);
  return {
    enabled: config !== null,
    deletion_status_base_url: config?.deletionStatusBaseUrl ?? null,
  };
}

function installAdapterForTests(candidate) {
  if (process.env.NODE_ENV !== 'test' || typeof candidate !== 'function') {
    throw new Error('facebook_identity_test_adapter_forbidden');
  }
  adapter = candidate;
}

function resetAdapterForTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('facebook_identity_test_adapter_forbidden');
  adapter = null;
}

function actionEnabled(purpose, env) {
  const current = capability(env);
  return purpose === 'register' ? current.registration : current.login;
}

async function startAuthorization(purpose, { env = process.env, registration = null } = {}) {
  const config = parseConfig(env);
  if (!config || !actionEnabled(purpose, env)) {
    throw codedError('social_auth_not_available', 404);
  }
  const { state, expiresAt } = await intents.issueIntent({
    provider: PROVIDER, purpose, registration,
  });
  const authorization = new URL(config.authorizationUrl);
  authorization.searchParams.set('client_id', config.appId);
  authorization.searchParams.set('redirect_uri', config.redirectUri);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('state', state);
  return {
    authorization_url: authorization.toString(),
    expires_at: expiresAt.toISOString(),
  };
}

async function completeAuthorization(purpose, { state, code }, {
  env = process.env, nowSeconds,
} = {}) {
  const config = parseConfig(env);
  if (!config || !actionEnabled(purpose, env)) {
    throw codedError('social_auth_not_available', 404);
  }
  if (typeof code !== 'string' || code.length < 1 || code.length > 4096) {
    throw codedError('social_auth_failed');
  }
  const intent = await intents.consumeIntent({ provider: PROVIDER, purpose, state });

  let result;
  try {
    result = await adapter({
      code,
      appId: config.appId,
      appSecret: config.appSecret,
      redirectUri: config.redirectUri,
      // Derivada de `authorizationUrl`, que ya está validada contra
      // www.facebook.com: una sola fuente para la versión de la API.
      apiVersion: graphVersion(config),
    });
  } catch (error) {
    if (TRANSIENT_CODES.has(error?.code)) {
      throw codedError('social_auth_temporarily_unavailable', 503);
    }
    throw codedError('social_auth_failed');
  }

  const debug = result?.debug;
  const checkedAt = Number.isSafeInteger(nowSeconds)
    ? nowSeconds : Math.floor(Date.now() / 1000);
  if (typeof result?.access_token !== 'string' || result.access_token.length < 1
      || result.access_token.length > 8192 || !debug || debug.is_valid !== true
      || debug.app_id !== config.appId
      || !Number.isSafeInteger(debug.expires_at) || debug.expires_at <= checkedAt
      || typeof debug.user_id !== 'string'
      || !/^[A-Za-z0-9._:-]{1,255}$/.test(debug.user_id)) {
    throw codedError('social_auth_failed');
  }

  const evidence = {
    provider: PROVIDER,
    subject_namespace: `facebook:${config.appId}`,
    subject: debug.user_id,
    subject_control_digest: createHmac('sha256', config.controlSecret)
      .update(`payme/external-subject-control/v1/facebook:${config.appId}/${debug.user_id}`)
      .digest('hex'),
    credential_hash: tokenHash(`payme/facebook-code/v1/${code}`),
    credential_expires_at: new Date(debug.expires_at * 1000),
  };
  return { evidence, registration: intent.registration };
}

function configForCallbacks(env = process.env) {
  const config = parseConfig(env);
  if (!config) throw codedError('social_auth_not_available', 404);
  return config;
}

function subjectControl(config, subject) {
  return {
    provider: PROVIDER,
    subject_namespace: `facebook:${config.appId}`,
    subject_digest: createHmac('sha256', config.controlSecret)
      .update(`payme/external-subject-control/v1/facebook:${config.appId}/${subject}`)
      .digest('hex'),
  };
}

module.exports = {
  capability,
  callbacksCapability,
  startAuthorization,
  completeAuthorization,
  configForCallbacks,
  subjectControl,
  installAdapterForTests,
  resetAdapterForTests,
  PROVIDER,
};
