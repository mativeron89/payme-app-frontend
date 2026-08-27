/** Facebook Login BFF dark: code/state server-side y evidencia reducida al subject app-scoped. */
'use strict';

const authRecovery = require('./authRecovery');
const intents = require('./socialAuthIntents');
const { tokenHash } = require('../utils/tokens');
const { createHmac } = require('crypto');

const PROVIDER = 'facebook';
const TRANSIENT_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'facebook_temporarily_unavailable',
]);
let adapter = null;

function codedError(code, status = 401) {
  return Object.assign(new Error(code), { code, status });
}

function exactHttpsUrl(value, predicate = () => true) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash
        || parsed.search || parsed.port
        || !predicate(parsed)) return null;
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function parseConfig(env = process.env) {
  const appId = typeof env.SOCIAL_FACEBOOK_APP_ID === 'string'
    && /^[0-9]{5,32}$/.test(env.SOCIAL_FACEBOOK_APP_ID)
    ? env.SOCIAL_FACEBOOK_APP_ID : null;
  const appSecret = typeof env.SOCIAL_FACEBOOK_APP_SECRET === 'string'
    && Buffer.byteLength(env.SOCIAL_FACEBOOK_APP_SECRET, 'utf8') >= 32
    && Buffer.byteLength(env.SOCIAL_FACEBOOK_APP_SECRET, 'utf8') <= 256
    ? env.SOCIAL_FACEBOOK_APP_SECRET : null;
  const controlSecret = typeof env.SOCIAL_IDENTITY_CONTROL_HMAC_SECRET === 'string'
    && Buffer.byteLength(env.SOCIAL_IDENTITY_CONTROL_HMAC_SECRET, 'utf8') >= 32
    && Buffer.byteLength(env.SOCIAL_IDENTITY_CONTROL_HMAC_SECRET, 'utf8') <= 256
    ? env.SOCIAL_IDENTITY_CONTROL_HMAC_SECRET : null;
  const authorizationUrl = exactHttpsUrl(
    env.SOCIAL_FACEBOOK_AUTHORIZATION_URL,
    (url) => url.hostname === 'www.facebook.com'
      && /^\/v[0-9]+\.[0-9]+\/dialog\/oauth\/?$/.test(url.pathname)
  );
  const redirectUri = exactHttpsUrl(
    env.SOCIAL_FACEBOOK_REDIRECT_URI,
    (url) => url.hostname === 'app.paymemx.com'
  );
  const deletionStatusBaseUrl = exactHttpsUrl(
    env.SOCIAL_FACEBOOK_DATA_DELETION_STATUS_BASE_URL,
    (url) => url.hostname === 'app.paymemx.com' && url.pathname.endsWith('/')
  );
  if (!appId || !appSecret || !controlSecret
      || !authorizationUrl || !redirectUri || !deletionStatusBaseUrl) {
    return null;
  }
  return {
    appId, appSecret, controlSecret, authorizationUrl, redirectUri, deletionStatusBaseUrl,
  };
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
