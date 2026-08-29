'use strict';

const { createHash } = require('crypto');

const ENDPOINT = 'https://api.resend.com/emails';
const FROM = 'PayMe Seguridad <seguridad@mail.paymemx.com>';
const SUBJECT = 'Recupera el acceso a tu cuenta PayMe';
const APP_ORIGIN = 'https://app.paymemx.com';
const DEADLINE_MS = 5_000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PROVIDER_ID_CHARS = 256;
const MAX_API_KEY_CHARS = 256;
const TOKEN_HASH_RE = /^[a-f0-9]{64}$/;
const PLACEHOLDER_RE = /(?:placeholder|example|change.?me|mock|demo)/i;

function resendApiKeyUsable(value) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 8
    && value.length <= MAX_API_KEY_CHARS
    && value.startsWith('re_')
    && !/\s/.test(value)
    && !PLACEHOLDER_RE.test(value);
}

function runtimeConfigReady(env = process.env) {
  return env.AUTH_RECOVERY_EMAIL_ENABLED === 'true'
    && resendApiKeyUsable(env.RESEND_API_KEY)
    && env.AUTH_RECOVERY_RESEND_TRACKING_DISABLED_ACK === 'true';
}

function deliveryError() {
  return Object.assign(new Error('auth_recovery_delivery_failed'), {
    code: 'auth_recovery_delivery_failed',
  });
}

function idempotencyKey(tokenHash) {
  if (!TOKEN_HASH_RE.test(tokenHash)) throw deliveryError();
  const digest = createHash('sha256')
    .update('payme/auth-recovery/resend-idempotency/v1\0', 'utf8')
    .update(tokenHash, 'ascii')
    .digest('hex');
  return `payme-recovery-${digest}`;
}

function recoveryText(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) throw deliveryError();
  const link = `${APP_ORIGIN}/#/recovery?token=${encodeURIComponent(token)}`;
  return `Recibimos una solicitud para recuperar tu cuenta PayMe.\n\n`
    + `Usá este enlace dentro de los próximos 15 minutos:\n${link}\n\n`
    + 'Si no solicitaste este cambio, ignorá este mensaje.';
}

function waitWithAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(deliveryError());
  return new Promise((resolve, reject) => {
    const aborted = () => reject(deliveryError());
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(
      (value) => { signal.removeEventListener('abort', aborted); resolve(value); },
      () => { signal.removeEventListener('abort', aborted); reject(deliveryError()); }
    );
  });
}

async function readBoundedJson(response, signal) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw deliveryError();
  if (!response.body || typeof response.body.getReader !== 'function') throw deliveryError();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await waitWithAbort(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw deliveryError();
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw deliveryError();
      chunks.push(value);
    }
  } catch (_) {
    try {
      Promise.resolve(reader.cancel()).catch(() => undefined);
    } catch (_) {
      // Best-effort: un reader hostil no puede extender el deadline.
    }
    throw deliveryError();
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  } catch (_) {
    throw deliveryError();
  }
  if (typeof parsed?.id !== 'string' || parsed.id.length === 0
      || parsed.id.length > MAX_PROVIDER_ID_CHARS) throw deliveryError();
  return parsed;
}

function createResendTransport({
  apiKey,
  fetchImpl = globalThis.fetch,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (!resendApiKeyUsable(apiKey) || typeof fetchImpl !== 'function') throw deliveryError();
  return async function resendRecovery({ email, token, token_hash: tokenHash }) {
    if (typeof email !== 'string' || email.length === 0 || email.length > 320 || /[\r\n]/.test(email)) {
      throw deliveryError();
    }
    const controller = new AbortController();
    const timer = setTimeoutImpl(() => controller.abort(), DEADLINE_MS);
    try {
      const payload = {
        from: FROM,
        to: [email],
        subject: SUBJECT,
        text: recoveryText(token),
      };
      const response = await waitWithAbort(fetchImpl(ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey(tokenHash),
        },
        body: JSON.stringify(payload),
      }), controller.signal);
      if (!response || response.status < 200 || response.status >= 300) throw deliveryError();
      await readBoundedJson(response, controller.signal);
    } catch (_) {
      controller.abort();
      throw deliveryError();
    } finally {
      clearTimeoutImpl(timer);
    }
  };
}

module.exports = {
  createResendTransport,
  resendApiKeyUsable,
  runtimeConfigReady,
  ENDPOINT,
  FROM,
  SUBJECT,
  APP_ORIGIN,
  DEADLINE_MS,
  MAX_BODY_BYTES,
};
