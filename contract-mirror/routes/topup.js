/**
 * routes/topup.js v2.5.0
 *
 * Cambios vs v2.4:
 *   - P0 #3: idempotency_payload_hash. Misma key + distinto hash → 409.
 *            Misma key + mismo hash → 200 idempotent.
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireWalletRail } = require('../services/walletRail');
const { topupOxxo, topupCard, validateBody } = require('../schemas');
const stripeOxxo = require('../services/stripe-oxxo');
const topupProcessor = require('../services/topupProcessor');
const notifs = require('../services/notifications');
const { centsToDisplay } = require('../utils/money');
const { payloadHash, hashesMatch, PAYLOAD_KEYS } = require('../utils/idempotency');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

async function findExistingTopup(user_id, idempotency_key) {
  const { rows } = await pool.query(
    `SELECT id, method, amount_cents, status, idempotency_payload_hash,
            stripe_payment_intent_id, stripe_client_secret, stripe_status,
            stripe_voucher_url, voucher_reference,
            voucher_expires_at, failure_reason, payment_method_id,
            stripe_contract_prepared_at, stripe_customer_id_snapshot,
            stripe_payment_method_id_snapshot, billing_email_snapshot,
            billing_name_snapshot, user_id
       FROM topups WHERE user_id = $1 AND idempotency_key = $2`,
    [user_id, idempotency_key]
  );
  return rows[0] || null;
}

/**
 * Checa idempotencia + hash. Devuelve:
 *   { existing, conflict: true }  → 409 si hash distinto
 *   { existing }                  → 200 idempotent si hash igual
 *   null                          → no existe, proceder
 */
async function checkTopupIdempotency(user_id, idempotency_key, reqHash) {
  const existing = await findExistingTopup(user_id, idempotency_key);
  if (!existing) return null;
  if (!hashesMatch(existing.idempotency_payload_hash, reqHash)) {
    logger.warn('idempotency_conflict_topup', {
      user_id, idem_key: idempotency_key,
      existing_hash: existing.idempotency_payload_hash?.slice(0, 12),
      new_hash: reqHash.slice(0, 12),
    });
    return { existing, conflict: true };
  }
  return { existing };
}

function publicTopup(topup) {
  return {
    id: topup.id,
    method: topup.method,
    status: topup.status,
    amount_cents: Number(topup.amount_cents),
    amount_display: centsToDisplay(Number(topup.amount_cents)),
    ...(topup.method === 'oxxo' && {
      voucher_reference: topup.voucher_reference || null,
      stripe_voucher_url: topup.stripe_voucher_url || null,
      voucher_expires_at: topup.voucher_expires_at || null,
    }),
  };
}

function intentFromError(err) {
  return err?.raw?.payment_intent || err?.payment_intent || null;
}

function needsProviderRedrive(topup) {
  return !!topup?.stripe_contract_prepared_at
    && ['pending', 'processing'].includes(topup.status)
    && (!topup.stripe_payment_intent_id
      || (topup.method === 'oxxo'
        && (!topup.stripe_voucher_url || !topup.voucher_reference || !topup.voucher_expires_at))
      || (topup.method === 'card'
        && topup.stripe_status === 'requires_action' && !topup.stripe_client_secret));
}

function idempotentTopupResponse(res, topup) {
  const requiresAction = topup.method === 'card'
    && topup.stripe_status === 'requires_action';
  return res.json({
    topup: publicTopup(topup),
    idempotent: true,
    ...(topup.method === 'card' && {
      requires_action: requiresAction,
      client_secret: requiresAction ? topup.stripe_client_secret : undefined,
    }),
  });
}

function reconciliationPending(res) {
  return res.status(503).json({
    error: 'topup_reconciliation_pending',
    retry_with_same_idempotency_key: true,
  });
}

async function applyIntentFromProviderError(topup, stripeErr) {
  const intent = intentFromError(stripeErr);
  if (!intent) return null;
  // Un voucher activo sin sus datos públicos todavía no es un resultado útil:
  // conservar el row unbound permite que el retry idempotente recupere el PI
  // completo. Los terminales sí se aplican para no esconder un rechazo real.
  if (topup.method === 'oxxo' && ['requires_action', 'processing'].includes(intent.status)) {
    try { topupProcessor.assertTopupIntentContract(topup, intent); }
    catch (contractErr) {
      logger.error('topup_provider_error_contract_rejected', {
        topup_id: topup.id, intent_id: intent.id || null,
        error: contractErr.message, mismatches: contractErr.details?.mismatches || null,
      });
    }
    return null;
  }
  try {
    return await topupProcessor.applyTopupIntent({ topupId: topup.id, intent });
  } catch (contractErr) {
    logger.error('topup_provider_error_contract_rejected', {
      topup_id: topup.id, intent_id: intent.id || null,
      error: contractErr.message, mismatches: contractErr.details?.mismatches || null,
    });
    return null;
  }
}

async function prepareOxxoTopup(req, amountCents, idempotencyKey, reqHash) {
  const billingName = `${req.user.first_name || ''} ${req.user.last_name || ''}`.trim().slice(0, 200);
  try {
    await pool.query(
      `INSERT INTO topups
         (user_id, method, amount_cents, fee_cents, net_cents,
          idempotency_key, idempotency_payload_hash, status,
          stripe_contract_prepared_at, stripe_customer_id_snapshot,
          billing_email_snapshot, billing_name_snapshot)
       VALUES ($1,'oxxo',$2,0,$2,$3,$4,'pending',NOW(),$5,$6,$7)
       RETURNING id`,
      [req.user.id, amountCents, idempotencyKey, reqHash,
       req.user.stripe_customer_id, req.user.email, billingName]
    );
    return { topup: await findExistingTopup(req.user.id, idempotencyKey), created: true };
  } catch (err) {
    if (err.code !== '23505') throw err;
    const replay = await checkTopupIdempotency(req.user.id, idempotencyKey, reqHash);
    return { topup: replay?.existing || null, conflict: replay?.conflict || false, created: false };
  }
}

async function prepareCardTopup(req, amountCents, paymentMethodId, idempotencyKey, reqHash) {
  const { rows: [paymentMethod] } = await pool.query(
    `SELECT stripe_payment_method_id FROM payment_methods
      WHERE id=$1 AND user_id=$2 AND status='active'`,
    [paymentMethodId, req.user.id]
  );
  if (!paymentMethod) return { notFound: true };
  try {
    await pool.query(
      `INSERT INTO topups
         (user_id, method, amount_cents, fee_cents, net_cents,
          payment_method_id, idempotency_key, idempotency_payload_hash, status,
          stripe_contract_prepared_at, stripe_customer_id_snapshot,
          stripe_payment_method_id_snapshot)
       VALUES ($1,'card',$2,0,$2,$3,$4,$5,'pending',NOW(),$6,$7)`,
      [req.user.id, amountCents, paymentMethodId, idempotencyKey, reqHash,
       req.user.stripe_customer_id, paymentMethod.stripe_payment_method_id]
    );
    return { topup: await findExistingTopup(req.user.id, idempotencyKey), created: true };
  } catch (err) {
    if (err.code !== '23505') throw err;
    const replay = await checkTopupIdempotency(req.user.id, idempotencyKey, reqHash);
    return { topup: replay?.existing || null, conflict: replay?.conflict || false, created: false };
  }
}

// ─── POST /oxxo ───────────────────────────────────────────
router.post('/oxxo', requireWalletRail, validateBody(topupOxxo), async (req, res, next) => {
  try {
    const { amount_cents, idempotency_key } = req.body;
    const reqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.topup_oxxo });

    const idemCheck = await checkTopupIdempotency(req.user.id, idempotency_key, reqHash);
    if (idemCheck?.conflict) {
      return res.status(409).json({
        error: 'idempotency_conflict',
        message: 'Same idempotency_key used with different payload',
      });
    }
    if (idemCheck?.existing?.method !== undefined && idemCheck.existing.method !== 'oxxo') {
      return res.status(409).json({ error: 'idempotency_conflict' });
    }
    if (idemCheck?.existing
        && ['pending', 'processing'].includes(idemCheck.existing.status)
        && !idemCheck.existing.stripe_contract_prepared_at) {
      return reconciliationPending(res);
    }
    if (idemCheck?.existing && !needsProviderRedrive(idemCheck.existing)) {
      return idempotentTopupResponse(res, idemCheck.existing);
    }
    if (!idemCheck?.existing && !req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' });
    }

    const prepared = idemCheck?.existing
      ? { topup: idemCheck.existing, created: false }
      : await prepareOxxoTopup(req, amount_cents, idempotency_key, reqHash);
    if (prepared.conflict || !prepared.topup) {
      return res.status(409).json({ error: 'idempotency_conflict' });
    }
    const topup = prepared.topup;
    if (!topup.stripe_contract_prepared_at) return reconciliationPending(res);

    let voucher;
    try {
      voucher = await stripeOxxo.createOxxoVoucher({
        amount_cents: Number(topup.amount_cents),
        customer_id: topup.stripe_customer_id_snapshot,
        email: topup.billing_email_snapshot,
        name: topup.billing_name_snapshot,
        idempotency_key: topupProcessor.providerKey(topup),
        metadata: { payme_user_id: topup.user_id, topup_id: topup.id },
      });
    } catch (stripeErr) {
      const applied = await applyIntentFromProviderError(topup, stripeErr);
      if (applied?.topup?.status === 'failed' || applied?.topup?.status === 'cancelled') {
        return res.status(502).json({
          error: 'topup_provider_error', status: applied.topup.status,
        });
      }
      logger.error('topup_oxxo_result_ambiguous', {
        topup_id: topup.id, error: stripeErr.message,
      });
      return reconciliationPending(res);
    }

    let applied;
    try {
      applied = await topupProcessor.applyTopupIntent({
        topupId: topup.id,
        intent: voucher.intent,
        voucher,
      });
    } catch (err) {
      logger.error('topup_oxxo_binding_failed', {
        topup_id: topup.id, intent_id: voucher.intent_id || null, error: err.message,
      });
      return reconciliationPending(res);
    }
    if (applied.topup.status === 'failed' || applied.topup.status === 'cancelled') {
      return res.status(502).json({ error: 'topup_provider_error', status: applied.topup.status });
    }

    if (!applied.idempotent) {
      await notifs.create({
        user_id: topup.user_id, type: 'topup_pending',
        body: `Tenés hasta el ${voucher.expires_at.toLocaleDateString('es-MX')} para pagar ${centsToDisplay(Number(topup.amount_cents))} en cualquier OXXO`,
        payload: { amount_cents: Number(topup.amount_cents), voucher_number: voucher.voucher_number },
        related_entity_type: 'topup', related_entity_id: topup.id,
      });
    }

    logger.audit('topup_oxxo_created', {
      user_id: topup.user_id, amount: Number(topup.amount_cents), topup_id: topup.id,
    });

    const refreshed = await findExistingTopup(topup.user_id, idempotency_key);
    return res.status(prepared.created ? 201 : 200).json({
      topup: publicTopup(refreshed),
      ...(!prepared.created && { idempotent: true }),
    });
  } catch (err) { next(err); }
});

// ─── POST /card ───────────────────────────────────────────
router.post('/card', requireWalletRail, validateBody(topupCard), async (req, res, next) => {
  try {
    const { amount_cents, payment_method_id, idempotency_key } = req.body;
    const reqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.topup_card });

    const idemCheck = await checkTopupIdempotency(req.user.id, idempotency_key, reqHash);
    if (idemCheck?.conflict) {
      return res.status(409).json({
        error: 'idempotency_conflict',
        message: 'Same idempotency_key used with different payload',
      });
    }
    if (idemCheck?.existing?.method !== undefined && idemCheck.existing.method !== 'card') {
      return res.status(409).json({ error: 'idempotency_conflict' });
    }
    if (idemCheck?.existing
        && ['pending', 'processing'].includes(idemCheck.existing.status)
        && !idemCheck.existing.stripe_contract_prepared_at) {
      return reconciliationPending(res);
    }
    if (idemCheck?.existing && !needsProviderRedrive(idemCheck.existing)) {
      return idempotentTopupResponse(res, idemCheck.existing);
    }
    if (!idemCheck?.existing && !req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' });
    }

    const prepared = idemCheck?.existing
      ? { topup: idemCheck.existing, created: false }
      : await prepareCardTopup(
        req, amount_cents, payment_method_id, idempotency_key, reqHash
      );
    if (prepared.notFound) return res.status(404).json({ error: 'payment_method_not_found' });
    if (prepared.conflict || !prepared.topup) {
      return res.status(409).json({ error: 'idempotency_conflict' });
    }
    const topup = prepared.topup;
    if (!topup.stripe_contract_prepared_at) return reconciliationPending(res);

    let charge;
    try {
      charge = await stripeOxxo.createCardTopup({
        amount_cents: Number(topup.amount_cents),
        customer_id: topup.stripe_customer_id_snapshot,
        payment_method_id: topup.stripe_payment_method_id_snapshot,
        idempotency_key: topupProcessor.providerKey(topup),
        metadata: { payme_user_id: topup.user_id, topup_id: topup.id },
      });
    } catch (stripeErr) {
      const applied = await applyIntentFromProviderError(topup, stripeErr);
      if (!applied) {
        logger.error('topup_card_result_ambiguous', {
          topup_id: topup.id, error: stripeErr.message, type: stripeErr.type,
        });
        return reconciliationPending(res);
      }
      if (applied.topup.status === 'failed' || applied.topup.status === 'cancelled') {
        return res.status(502).json({
          error: 'topup_provider_error', status: applied.topup.status,
        });
      }
      const refreshed = await findExistingTopup(topup.user_id, idempotency_key);
      return res.status(prepared.created ? 201 : 200).json({
        topup: publicTopup(refreshed),
        requires_action: refreshed.stripe_status === 'requires_action',
        client_secret: refreshed.stripe_status === 'requires_action'
          ? refreshed.stripe_client_secret : undefined,
        ...(!prepared.created && { idempotent: true }),
      });
    }

    let applied;
    try {
      applied = await topupProcessor.applyTopupIntent({
        topupId: topup.id, intent: charge.intent,
      });
    } catch (err) {
      logger.error('topup_card_binding_failed', {
        topup_id: topup.id, intent_id: charge.intent_id || null, error: err.message,
      });
      return reconciliationPending(res);
    }
    if (applied.topup.status === 'failed' || applied.topup.status === 'cancelled') {
      return res.status(502).json({ error: 'topup_provider_error', status: applied.topup.status });
    }

    logger.audit('topup_card_created', {
      user_id: topup.user_id, amount: Number(topup.amount_cents), topup_id: topup.id,
      requires_action: charge.intent.status === 'requires_action',
      succeeded_inline: applied.topup.status === 'succeeded',
    });

    const refreshed = await findExistingTopup(topup.user_id, idempotency_key);
    return res.status(prepared.created ? 201 : 200).json({
      topup: publicTopup(refreshed),
      requires_action: refreshed.stripe_status === 'requires_action',
      client_secret: refreshed.stripe_status === 'requires_action'
        ? refreshed.stripe_client_secret : undefined,
      ...(!prepared.created && { idempotent: true }),
    });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, method, amount_cents, status, stripe_voucher_url, voucher_reference,
              voucher_expires_at, failure_reason, created_at, updated_at
         FROM topups WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'topup_not_found' });
    res.json({
      topup: { ...rows[0], amount_display: centsToDisplay(Number(rows[0].amount_cents)) },
    });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const { rows } = await pool.query(
      `SELECT id, method, amount_cents, status, voucher_expires_at, created_at
         FROM topups WHERE user_id = $1
        ORDER BY created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({
      topups: rows.map(t => ({ ...t, amount_display: centsToDisplay(Number(t.amount_cents)) })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
