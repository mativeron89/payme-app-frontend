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

module.exports = { ensureStripeCustomer, mirrorSavedPaymentMethod, customerIdempotencyKey };
