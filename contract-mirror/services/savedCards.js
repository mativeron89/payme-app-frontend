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
async function saveDurableSourceCard({ kind, id }) {
  try {
    let row;
    if (kind === 'attempt') {
      ({ rows: [row] } = await pool.query(
        `SELECT user_id, payment_type AS method,
                stripe_save_payment_method AS wants_save,
                stripe_source_payment_method_id AS source_pm,
                stripe_customer_id_snapshot AS customer_id
           FROM payment_attempts WHERE id=$1`, [id]
      ));
    } else if (kind === 'guarantee') {
      ({ rows: [row] } = await pool.query(
        `SELECT opener_user_id AS user_id, auth_method AS method,
                auth_save_payment_method AS wants_save,
                auth_source_payment_method_id AS source_pm,
                auth_stripe_customer_id AS customer_id
           FROM mesas WHERE id=$1`, [id]
      ));
    } else {
      return { skipped: 'unknown_kind' };
    }
    if (!row) return { skipped: 'row_missing' };
    // El flag durable manda; el efímero de wallet nativa jamás entra (method
    // 'card' + elegibilidad del espejo, que rechaza cualquier wallet).
    if (row.method !== 'card') return { skipped: 'not_card' };
    if (row.wants_save !== true) return { skipped: 'no_opt_in' };
    if (!row.user_id || !row.source_pm || !row.customer_id) {
      return { skipped: 'incomplete_snapshot' };
    }

    try {
      await stripeService.attachPaymentMethod(
        row.customer_id, row.source_pm, `attach_save_${kind}_${id}`
      );
    } catch (err) {
      // El attach de un pm_ ya adjunto falla; si quedó adjunto AL MISMO
      // customer (retry con otra key, carrera con el vault), el espejo de
      // abajo lo verifica y sigue. Adjunto a OTRO customer → el espejo lo
      // rechaza por ownership. Cualquier otro fallo: best-effort, se loguea.
      logger.warn('save_source_card_attach_failed', {
        kind, id, error: err.message, code: err.code || null,
      });
    }
    const mirror = await mirrorSavedPaymentMethod(row.user_id, row.source_pm);
    if (mirror.mirrored || mirror.skipped === 'already_mirrored') {
      logger.audit('save_source_card_saved', { kind, id, user_id: row.user_id });
      return { saved: true };
    }
    logger.warn('save_source_card_not_saved', { kind, id, reason: mirror.skipped });
    return { skipped: mirror.skipped };
  } catch (err) {
    logger.warn('save_source_card_failed', { kind, id, error: err.message });
    return { skipped: 'error' };
  }
}

module.exports = {
  ensureStripeCustomer, mirrorSavedPaymentMethod, customerIdempotencyKey,
  saveDurableSourceCard,
};
