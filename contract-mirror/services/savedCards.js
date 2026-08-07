/**
 * services/savedCards.js — D4 (v2.16) · Tarjeta guardada (G-04/G-05)
 *
 * Dos helpers chicos alrededor del guardado de tarjetas al pagar/garantizar:
 *
 *   - ensureStripeCustomer(user): crea el customer de Stripe LAZY si el usuario
 *     no lo tiene (mismo patrón que POST /payment-methods/setup-intent). Lo
 *     necesita setup_future_usage: Stripe solo adjunta tarjetas a un customer.
 *
 *   - mirrorSavedPaymentMethod(userId, stripePmId): espeja en payment_methods
 *     la tarjeta que Stripe acaba de adjuntar (setup_future_usage confirmado).
 *     GET /payment-methods lee la tabla local, así que sin espejo la tarjeta
 *     quedaría guardada en Stripe pero invisible para el usuario.
 *     Idempotente por el UNIQUE de stripe_payment_method_id.
 *
 * BEST-EFFORT deliberado: el espejo loguea y sigue — JAMÁS rompe el pago, el
 * hold ni el webhook que lo llama. La tarjeta del cliente y su plata valen más
 * que la fila espejo; si el espejo falla, el pago ya salió y la tarjeta se
 * re-espeja en el próximo uso (o vía POST /payment-methods).
 */
'use strict';

const pool = require('../db/pool');
const stripeService = require('./stripe');
const cardEligibility = require('./cardEligibility');
const logger = require('../utils/logger');
const { createHash } = require('crypto');

const customerCreationInFlight = new Map();

function customerIdempotencyKey(userId) {
  const digest = createHash('sha256').update(String(userId)).digest('hex');
  return `payme_customer_${digest}`;
}

/** Crea el customer de Stripe si falta; devuelve el stripe_customer_id. */
async function ensureStripeCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  if (customerCreationInFlight.has(user.id)) return customerCreationInFlight.get(user.id);

  // Stripe queda siempre fuera de una tx/lock PG. La clave estable hace que un
  // timeout ambiguo o dos procesos obtengan el mismo customer en Stripe.
  const operation = (async () => {
    const { rows: beforeRows } = await pool.query(
      `SELECT stripe_customer_id, email, first_name, last_name FROM users WHERE id=$1`, [user.id]
    );
    const current = beforeRows[0];
    if (!current) throw new Error('user_not_found');
    if (current.stripe_customer_id) return current.stripe_customer_id;

    const customer = await stripeService.createCustomer({
      user_id: user.id, email: current.email, name: `${current.first_name} ${current.last_name}`,
      idempotency_key: customerIdempotencyKey(user.id),
    });
    const { rows: updatedRows } = await pool.query(
      `UPDATE users SET stripe_customer_id=$1 WHERE id=$2 AND stripe_customer_id IS NULL
       RETURNING stripe_customer_id`,
      [customer.id, user.id]
    );
    if (updatedRows[0]) return updatedRows[0].stripe_customer_id;
    const { rows: afterRows } = await pool.query(
      `SELECT stripe_customer_id FROM users WHERE id=$1`, [user.id]
    );
    if (!afterRows[0]?.stripe_customer_id) throw new Error('stripe_customer_persist_failed');
    return afterRows[0].stripe_customer_id;
  })();
  customerCreationInFlight.set(user.id, operation);
  try { return await operation; }
  finally { customerCreationInFlight.delete(user.id); }
}

/**
 * Espeja la tarjeta adjunta en la tabla local. Devuelve
 * { mirrored } | { skipped: razón }. Nunca lanza.
 */
async function mirrorSavedPaymentMethod(userId, stripePmId) {
  if (!userId || !stripePmId) return { skipped: 'missing_args' };
  try {
    const { rows: userRows } = await pool.query(
      `SELECT stripe_customer_id FROM users WHERE id=$1`, [userId]
    );
    const customerId = userRows[0]?.stripe_customer_id;
    if (!customerId) return { skipped: 'missing_customer' };
    const { rows: existingRows } = await pool.query(
      `SELECT user_id,status,card_policy_version,card_verified_brand,
              card_verified_funding,card_verified_at
         FROM payment_methods WHERE stripe_payment_method_id = $1`,
      [stripePmId]
    );
    const existing = existingRows[0];
    if (existing && (existing.user_id !== userId || existing.status !== 'active')) {
      logger.warn('payment_method_mirror_local_conflict', { stripe_pm: stripePmId });
      return { skipped: 'local_conflict' };
    }

    const pm = await stripeService.retrievePaymentMethod(stripePmId);
    const expectedSnapshot = Number(existing?.card_policy_version) === 1
      ? {
        policyVersion: 1,
        brand: existing.card_verified_brand,
        funding: existing.card_verified_funding,
        walletType: null,
        verifiedAt: existing.card_verified_at,
      }
      : null;
    let snapshot;
    try {
      snapshot = cardEligibility.assertEligibleCard(pm, {
        expectedPaymentMethodId: stripePmId,
        expectedCustomerId: customerId,
        ownership: 'saved',
        expectedSnapshot,
        reconciliationCode: 'payment_method_mirror_verification_unavailable',
      });
    } catch (error) {
      logger.warn('payment_method_mirror_verification_failed', {
        stripe_pm: stripePmId, reason: error.code || 'unknown',
      });
      return { skipped: error.code === 'payment_method_owner_conflict'
        ? 'remote_owner_mismatch'
        : 'ineligible_or_unverified' };
    }
    const card = pm.card;
    const bankName = card.issuer || pm.billing_details?.name || null;
    if (typeof card.last4 !== 'string' || !/^\d{4}$/.test(card.last4)
        || (card.exp_month != null
          && (!Number.isInteger(card.exp_month) || card.exp_month < 1 || card.exp_month > 12))
        || (card.exp_year != null
          && (!Number.isInteger(card.exp_year) || card.exp_year < 1 || card.exp_year > 32767))
        || (bankName != null && (typeof bankName !== 'string' || bankName.length > 100))) {
      return { skipped: 'invalid_card_data' };
    }

    if (existing) {
      if (Number(existing.card_policy_version) === 0) {
        await pool.query(
          `UPDATE payment_methods
              SET card_policy_version=$2,card_verified_brand=$3,
                  card_verified_funding=$4,card_verified_at=$5
            WHERE stripe_payment_method_id=$1 AND user_id=$6
              AND status='active' AND card_policy_version=0`,
          [stripePmId, snapshot.policyVersion, snapshot.brand,
           snapshot.funding, snapshot.verifiedAt, userId]
        );
      }
      return { skipped: 'already_mirrored' };
    }

    const inserted = await pool.query(
      `INSERT INTO payment_methods
         (user_id, stripe_payment_method_id, brand, bank_name, type,
          last_four, exp_month, exp_year, is_default, status,
          card_policy_version,card_verified_brand,card_verified_funding,
          card_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'active',$9,$10,$11,$12)
       ON CONFLICT (stripe_payment_method_id) DO NOTHING
       RETURNING id`,
      [userId, pm.id, snapshot.brand, bankName, snapshot.funding,
       card.last4, card.exp_month ?? null, card.exp_year ?? null,
       snapshot.policyVersion, snapshot.brand, snapshot.funding,
       snapshot.verifiedAt]
    );
    if (inserted.rowCount !== 1) {
      const { rows: racedRows } = await pool.query(
        `SELECT user_id,status,card_policy_version,card_verified_brand,
                card_verified_funding,card_verified_at
           FROM payment_methods WHERE stripe_payment_method_id=$1`, [stripePmId]
      );
      const raced = racedRows[0];
      if (raced?.user_id === userId && raced.status === 'active') {
        if (Number(raced.card_policy_version) === 0) {
          await pool.query(
            `UPDATE payment_methods
                SET card_policy_version=$2,card_verified_brand=$3,
                    card_verified_funding=$4,card_verified_at=$5
              WHERE stripe_payment_method_id=$1 AND user_id=$6
                AND status='active' AND card_policy_version=0`,
            [stripePmId, snapshot.policyVersion, snapshot.brand,
             snapshot.funding, snapshot.verifiedAt, userId]
          );
        } else {
          cardEligibility.assertEligibleCard(pm, {
            expectedPaymentMethodId: stripePmId,
            expectedCustomerId: customerId,
            ownership: 'saved',
            expectedSnapshot: {
              policyVersion: raced.card_policy_version,
              brand: raced.card_verified_brand,
              funding: raced.card_verified_funding,
              walletType: null,
              verifiedAt: raced.card_verified_at,
            },
            reconciliationCode: 'payment_method_mirror_verification_unavailable',
          });
        }
        return { skipped: 'already_mirrored' };
      }
      logger.warn('payment_method_mirror_local_conflict', { stripe_pm: stripePmId });
      return { skipped: 'local_conflict' };
    }
    logger.audit('payment_method_mirrored', {
      user_id: userId, brand: snapshot.brand, last_four: card.last4,
    });
    return { mirrored: true };
  } catch (err) {
    logger.warn('payment_method_mirror_failed', {
      user_id: userId, stripe_pm: stripePmId, error: err.message,
    });
    return { skipped: 'error' };
  }
}

/**
 * G-11 (ORDEN 1-A · 2026-08-06) — guardado REAL de la tarjeta manual bajo
 * direct charges, para pago y garantía.
 *
 * ARQUITECTURA ELEGIDA (y por qué, contra la alternativa SetupIntent):
 * el guardado es un artefacto de PLATAFORMA con la MISMA semántica que el
 * vault durable ratificado (`POST /payment-methods`): attach del pm_ FUENTE
 * al Customer de PayMe + espejo verificado en `payment_methods`. El cargo no
 * se toca: sigue siendo direct charge del CLON sobre la cuenta conectada.
 *
 *   1. UNA sola definición de "tarjeta guardada" en el sistema. Una tarjeta
 *      guardada al pagar es indistinguible de una guardada por el vault: el
 *      mismo attach, el mismo espejo, la misma elegibilidad, la misma
 *      reutilización (clon por cobro + off_session con fallback 3DS que
 *      /pay ya maneja y ya está testeado).
 *   2. CERO superficie nueva de contrato y cero hojas extra: el guardado es
 *      determinístico server-side tras el éxito del cobro; el front lo ve en
 *      GET /payment-methods.
 *   3. Un SetupIntent de plataforma daría un mandato off_session más fuerte,
 *      pero al precio de un leg asíncrono (requires_action → client_secret →
 *      confirmación del front → webhook setup_intent.*) que crea DOS calidades
 *      de tarjeta guardada y un contrato nuevo. Si el negocio algún día exige
 *      mandato fuerte, se migra el vault ENTERO en una orden propia — no se
 *      bifurca acá.
 *
 * Los guards que la orden exige viven en capas que ya existían:
 *   - pm_ efímero de Apple/Google Pay: `cardEligibility` rechaza CUALQUIER
 *     wallet (walletPresent → ineligible), y el espejo verifica elegibilidad.
 *     Además el caller gatea por payment_type/auth_method === 'card'.
 *   - identidad ante el restaurante: el attach es en PLATAFORMA; a la cuenta
 *     conectada solo viaja el clon sin customer, como siempre.
 *   - fuente durable: SIEMPRE el pm_ FUENTE sellado en la fila
 *     (stripe_source_payment_method_id / auth_source_payment_method_id) —
 *     jamás `intent.payment_method`, que bajo direct charge es el CLON de la
 *     cuenta del restaurante y no pertenece a la bóveda de PayMe.
 *
 * Best-effort deliberado, como el espejo: el cobro ya salió y vale más que el
 * guardado; un fallo se loguea y la tarjeta se puede guardar por el vault.
 */
const OWNER_TYPES = { attempt: 'payment_attempt', guarantee: 'mesa_guarantee' };
const RETRY_BACKOFF_MIN = Number(process.env.CARD_SAVE_RETRY_MIN) || 5;
const SAVE_SWEEP_BATCH = Number(process.env.CARD_SAVE_SWEEP_BATCH) || 25;

/** Re-deriva los HECHOS desde la fila de dinero. Nunca desde la intención. */
async function loadSaveOwner(kind, id) {
  if (kind === 'attempt') {
    const { rows: [row] } = await pool.query(
      `SELECT user_id, payment_type AS method, status,
              stripe_save_payment_method AS wants_save,
              stripe_source_payment_method_id AS source_pm,
              stripe_customer_id_snapshot AS customer_id
         FROM payment_attempts WHERE id=$1`, [id]
    );
    return row
      ? { ...row, succeeded: ['succeeded', 'processed', 'refunded'].includes(row.status) }
      : null;
  }
  if (kind === 'guarantee') {
    const { rows: [row] } = await pool.query(
      `SELECT opener_user_id AS user_id, auth_method AS method, status,
              auth_payment_intent_id,
              auth_save_payment_method AS wants_save,
              auth_source_payment_method_id AS source_pm,
              auth_stripe_customer_id AS customer_id
         FROM mesas WHERE id=$1`, [id]
    );
    return row
      ? {
        ...row,
        succeeded: !!row.auth_payment_intent_id
          && !['pending_auth', 'auth_failed', 'cancelled'].includes(row.status),
      }
      : null;
  }
  return null;
}

async function recordIntent(kind, id, status, lastError = null) {
  const terminal = status !== 'pending';
  await pool.query(
    `INSERT INTO card_save_intents
       (owner_type, owner_id, status, attempts, last_error, next_attempt_at, resolved_at)
     VALUES ($1,$2,$3,1,LEFT($4,300),
             NOW() + ($5 || ' minutes')::interval,
             CASE WHEN $6::boolean THEN NOW() ELSE NULL END)
     ON CONFLICT (owner_type, owner_id) DO UPDATE
        SET status=EXCLUDED.status,
            attempts=card_save_intents.attempts + 1,
            last_error=EXCLUDED.last_error,
            next_attempt_at=EXCLUDED.next_attempt_at,
            resolved_at=CASE WHEN $6::boolean
                             THEN COALESCE(card_save_intents.resolved_at, NOW())
                             ELSE NULL END,
            updated_at=NOW()
      WHERE card_save_intents.status = 'pending'`,
    [OWNER_TYPES[kind], id, status, lastError, String(RETRY_BACKOFF_MIN), terminal]
  );
}

/**
 * Resuelve la intención de guardar de UNA fila de dinero. Idempotente y
 * seguro de invocar desde cualquier camino (eager) y desde el sweep.
 *
 * ORDEN R1-A.1 · la elegibilidad se verifica ANTES de tocar Stripe. La versión
 * de v2.46.0 adjuntaba y recién después validaba en el espejo: un `pm_` de
 * wallet nativa quedaba ADJUNTADO al Customer de plataforma y sólo entonces se
 * rechazaba (medido: `attaches_remotos: 1, filas_locales: 0`). Rechazar
 * después de mutar no es rechazar.
 *
 * Nunca lanza: el éxito monetario no puede fallar porque falle el guardado.
 * Pero tampoco pierde la intención: todo resultado no terminal queda `pending`
 * en `card_save_intents` y el sweep lo hace converger.
 */
async function resolveCardSaveIntent({ kind, id }) {
  if (!OWNER_TYPES[kind]) return { skipped: 'unknown_kind' };
  try {
    const row = await loadSaveOwner(kind, id);
    if (!row) return { skipped: 'row_missing' };
    // Sin opt-in no se registra intención: no hay nada que converger.
    if (row.wants_save !== true) return { skipped: 'no_opt_in' };
    if (row.method !== 'card') {
      // Riel que no admite bóveda (wallet nativa declarada como tal): terminal.
      await recordIntent(kind, id, 'rejected', `method:${row.method}`);
      return { skipped: 'not_card' };
    }
    if (!row.succeeded) return { skipped: 'not_succeeded_yet' };
    if (!row.user_id || !row.source_pm || !row.customer_id) {
      await recordIntent(kind, id, 'pending', 'incomplete_snapshot');
      return { skipped: 'incomplete_snapshot' };
    }

    // ── 1) ELEGIBILIDAD ANTES DE CUALQUIER MUTACIÓN REMOTA ────────────────
    // `typed_user` admite la fuente sin adjuntar (tarjeta recién tipeada) o ya
    // adjunta a NUESTRO customer (retry, o reuso de una guardada); rechaza la
    // adjunta a un tercero. Y rechaza CUALQUIER wallet tokenizada, que es el
    // caso que la orden exige cerrar con cero attach remoto.
    let verified;
    try {
      verified = await cardEligibility.retrieveEligibleCard({
        paymentMethodId: row.source_pm,
        expectedCustomerId: row.customer_id,
        ownership: 'typed_user',
        reconciliationCode: 'card_save_verification_unavailable',
      });
    } catch (error) {
      const terminal = error.status === 422 || error.status === 409;
      await recordIntent(
        kind, id,
        terminal ? (error.status === 422 ? 'rejected' : 'manual_review') : 'pending',
        error.code || error.message
      );
      logger[terminal ? 'warn' : 'error']('card_save_ineligible_or_unverified', {
        kind, id, code: error.code || null, status: error.status || null,
      });
      return { skipped: error.code || 'ineligible_or_unverified' };
    }

    // ── 2) ATTACH idempotente (sólo sobre una fuente ya probada elegible) ──
    // La key es estable por dueño: un reintento del sweep no puede duplicar
    // ownership. Si Stripe la reporta ya adjunta a NUESTRO customer, el
    // ownership ya es el correcto y se sigue al espejo.
    const yaEsNuestra = cardEligibility.remoteId(verified.remote.customer) === row.customer_id;
    if (!yaEsNuestra) {
      try {
        await stripeService.attachPaymentMethod(
          row.customer_id, row.source_pm, `attach_save_${kind}_${id}`
        );
      } catch (error) {
        await recordIntent(kind, id, 'pending', error.code || error.message);
        logger.error('card_save_attach_failed', {
          kind, id, error: error.message, code: error.code || null,
        });
        return { skipped: 'attach_failed' };
      }
    }

    // ── 3) ESPEJO local (vuelve a verificar ownership ya adjunto) ─────────
    const mirror = await mirrorSavedPaymentMethod(row.user_id, row.source_pm);
    if (mirror.mirrored || mirror.skipped === 'already_mirrored') {
      await recordIntent(kind, id, 'saved');
      logger.audit('card_save_completed', { kind, id, user_id: row.user_id });
      return { saved: true };
    }
    const terminalMirror = ['ineligible_or_unverified', 'remote_owner_mismatch', 'local_conflict']
      .includes(mirror.skipped);
    await recordIntent(
      kind, id,
      terminalMirror ? 'manual_review' : 'pending',
      `mirror:${mirror.skipped}`
    );
    logger.warn('card_save_not_completed', { kind, id, reason: mirror.skipped });
    return { skipped: mirror.skipped };
  } catch (error) {
    // Fallo inesperado: la intención queda pendiente, jamás se pierde.
    try { await recordIntent(kind, id, 'pending', error.message); } catch (_) { /* noop */ }
    logger.error('card_save_failed', { kind, id, error: error.message });
    return { skipped: 'error' };
  }
}

/**
 * Convergencia. 🔴 DERIVA sus candidatos del ESTADO MONETARIO, no de
 * `card_save_intents`: un camino de éxito nuevo que nadie se acuerde de
 * cablear queda cubierto igual, porque su fila de dinero ya lo delata. Ésa es
 * la diferencia entre "hay que acordarse de llamarlo" y "es imposible de
 * saltear" (condición 3 de la orden R1-A).
 */
async function sweepCardSaveIntents({ limit = SAVE_SWEEP_BATCH } = {}) {
  const { rows } = await pool.query(
    `SELECT 'attempt' AS kind, pa.id
       FROM payment_attempts pa
       LEFT JOIN card_save_intents csi
         ON csi.owner_type='payment_attempt' AND csi.owner_id=pa.id
      WHERE pa.stripe_save_payment_method = true
        AND pa.payment_type = 'card'
        -- 'refunded' INCLUIDO a propósito (enumeración exhaustiva R1-A):
        -- el cobro OCURRIÓ y el opt-in fue explícito; una devolución
        -- posterior no retira el consentimiento de guardar la tarjeta. Y hay
        -- un camino —connectRefundProcessor.applyNetZeroFull— que lleva la
        -- fila cancelling→succeeded→refunded en UNA SOLA transacción: nunca
        -- es visible en 'succeeded' desde afuera, así que sin este estado se
        -- perdería para siempre.
        AND pa.status IN ('succeeded','processed','refunded')
        AND (csi.id IS NULL
             OR (csi.status='pending' AND csi.next_attempt_at <= NOW()))
      UNION ALL
     SELECT 'guarantee' AS kind, m.id
       FROM mesas m
       LEFT JOIN card_save_intents csi
         ON csi.owner_type='mesa_guarantee' AND csi.owner_id=m.id
      WHERE m.auth_save_payment_method = true
        AND m.auth_method = 'card'
        AND m.auth_payment_intent_id IS NOT NULL
        -- El PI se sella TAMBIÉN cuando el hold quedó en requires_action
        -- (3DS sin completar): ahí la mesa sigue en 'pending_auth' y todavía
        -- no hay autorización. Guardar entonces sería adjuntar por un hold
        -- que puede no existir nunca. auth_failed/cancelled son el mismo caso
        -- ya resuelto en contra.
        AND m.status NOT IN ('pending_auth','auth_failed','cancelled')
        AND (csi.id IS NULL
             OR (csi.status='pending' AND csi.next_attempt_at <= NOW()))
      LIMIT $1`,
    [limit]
  );
  let saved = 0; let pending = 0;
  for (const row of rows) {
    const result = await resolveCardSaveIntent({ kind: row.kind, id: row.id });
    if (result.saved) saved += 1; else pending += 1;
  }
  if (rows.length > 0) {
    logger.info('card_save_sweep', { revisados: rows.length, saved, pending });
  }
  return { revisados: rows.length, saved, pending };
}

module.exports = {
  ensureStripeCustomer, mirrorSavedPaymentMethod, customerIdempotencyKey,
  resolveCardSaveIntent,
  sweepCardSaveIntents,
  // Alias histórico de G-11 (v2.46.0): los callers ya cableados lo invocan.
  saveDurableSourceCard: resolveCardSaveIntent,
};
