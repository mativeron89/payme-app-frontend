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
const { topupOxxo, topupCard, validateBody } = require('../schemas');
const stripeOxxo = require('../services/stripe-oxxo');
const notifs = require('../services/notifications');
const { centsToDisplay } = require('../utils/money');
const { payloadHash, hashesMatch, PAYLOAD_KEYS } = require('../utils/idempotency');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

async function findExistingTopup(user_id, idempotency_key) {
  const { rows } = await pool.query(
    `SELECT id, method, amount_cents, status, idempotency_payload_hash,
            stripe_voucher_url, voucher_reference, voucher_expires_at
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

async function creditWalletForTopup(topupId) {
  await pool.tx(async (client) => {
    const { rows: tRows } = await client.query(
      `SELECT id, user_id, method, amount_cents, status FROM topups WHERE id = $1 FOR UPDATE`,
      [topupId]
    );
    const t = tRows[0];
    if (!t) return;
    if (t.status === 'succeeded') return;

    const { rows: wRows } = await client.query(
      `SELECT id, balance_cents FROM wallets WHERE user_id = $1 FOR UPDATE`, [t.user_id]
    );
    let wallet = wRows[0];
    if (!wallet) {
      const { rows: newW } = await client.query(
        `INSERT INTO wallets (user_id, balance_cents) VALUES ($1, 0) RETURNING id, balance_cents`,
        [t.user_id]
      );
      wallet = newW[0];
    }
    const newBalance = Number(wallet.balance_cents) + Number(t.amount_cents);
    await client.query(`UPDATE topups SET status='succeeded', updated_at=NOW() WHERE id=$1`, [t.id]);
    await client.query(`UPDATE wallets SET balance_cents=$1, updated_at=NOW() WHERE id=$2`, [newBalance, wallet.id]);
    await client.query(
      `INSERT INTO wallet_transactions
         (wallet_id, user_id, type, amount_cents, balance_after_cents,
          related_entity_type, related_entity_id, description)
       VALUES ($1,$2,$3,$4,$5,'topup',$6,$7)`,
      [wallet.id, t.user_id,
       t.method === 'oxxo' ? 'topup_oxxo' : 'topup_card',
       t.amount_cents, newBalance, t.id,
       `Carga de saldo vía ${t.method.toUpperCase()}`]
    );
    await notifs.create({
      client, user_id: t.user_id, type: 'topup_succeeded',
      body: `Se acreditaron ${centsToDisplay(Number(t.amount_cents))} a tu saldo PayMe`,
      payload: {
        amount_cents: Number(t.amount_cents),
        method: t.method, new_balance: newBalance,
      },
      related_entity_type: 'topup', related_entity_id: t.id,
    });
  });
}

// ─── POST /oxxo ───────────────────────────────────────────
router.post('/oxxo', validateBody(topupOxxo), async (req, res, next) => {
  try {
    const { amount_cents, idempotency_key } = req.body;
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' });
    }

    const reqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.topup_oxxo });

    const idemCheck = await checkTopupIdempotency(req.user.id, idempotency_key, reqHash);
    if (idemCheck?.conflict) {
      return res.status(409).json({
        error: 'idempotency_conflict',
        message: 'Same idempotency_key used with different payload',
      });
    }
    if (idemCheck?.existing) {
      return res.json({ topup: idemCheck.existing, idempotent: true });
    }

    let topupId;
    try {
      const { rows } = await pool.query(
        `INSERT INTO topups
           (user_id, method, amount_cents, fee_cents, net_cents,
            idempotency_key, idempotency_payload_hash, status)
         VALUES ($1,'oxxo',$2,0,$2,$3,$4,'pending')
         RETURNING id`,
        [req.user.id, amount_cents, idempotency_key, reqHash]
      );
      topupId = rows[0].id;
    } catch (err) {
      if (err.code === '23505') {
        const recheck = await checkTopupIdempotency(req.user.id, idempotency_key, reqHash);
        if (recheck?.conflict) return res.status(409).json({ error: 'idempotency_conflict' });
        if (recheck?.existing) return res.json({ topup: recheck.existing, idempotent: true });
        return res.status(409).json({ error: 'idempotency_conflict' });
      }
      throw err;
    }

    let voucher;
    try {
      voucher = await stripeOxxo.createOxxoVoucher({
        amount_cents,
        customer_id: req.user.stripe_customer_id,
        email: req.user.email,
        name: `${req.user.first_name} ${req.user.last_name}`,
        idempotency_key,
        metadata: { payme_user_id: req.user.id, topup_id: topupId },
      });
    } catch (stripeErr) {
      await pool.query(
        `UPDATE topups SET status='failed', failure_reason=$1 WHERE id=$2`,
        [stripeErr.message, topupId]
      );
      throw stripeErr;
    }

    await pool.query(
      `UPDATE topups
          SET stripe_payment_intent_id = $1,
              stripe_voucher_url = $2,
              voucher_reference = $3,
              voucher_expires_at = $4,
              status = 'processing'
        WHERE id = $5`,
      [voucher.intent_id, voucher.voucher_url, voucher.voucher_number,
       voucher.expires_at, topupId]
    );

    await notifs.create({
      user_id: req.user.id, type: 'topup_pending',
      body: `Tenés hasta el ${voucher.expires_at.toLocaleDateString('es-MX')} para pagar ${centsToDisplay(Number(amount_cents))} en cualquier OXXO`,
      payload: { amount_cents, voucher_number: voucher.voucher_number },
      related_entity_type: 'topup', related_entity_id: topupId,
    });

    logger.audit('topup_oxxo_created', {
      user_id: req.user.id, amount: amount_cents, topup_id: topupId,
    });

    res.status(201).json({
      topup: {
        id: topupId, status: 'processing',
        amount_cents, amount_display: centsToDisplay(Number(amount_cents)),
        voucher_reference: voucher.voucher_number,
        stripe_voucher_url: voucher.voucher_url,
        voucher_expires_at: voucher.expires_at,
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /card ───────────────────────────────────────────
router.post('/card', validateBody(topupCard), async (req, res, next) => {
  try {
    const { amount_cents, payment_method_id, idempotency_key } = req.body;
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' });
    }

    const reqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.topup_card });

    const idemCheck = await checkTopupIdempotency(req.user.id, idempotency_key, reqHash);
    if (idemCheck?.conflict) {
      return res.status(409).json({
        error: 'idempotency_conflict',
        message: 'Same idempotency_key used with different payload',
      });
    }
    if (idemCheck?.existing) {
      return res.json({ topup: idemCheck.existing, idempotent: true });
    }

    const { rows: pmRows } = await pool.query(
      `SELECT stripe_payment_method_id FROM payment_methods
        WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [payment_method_id, req.user.id]
    );
    const pm = pmRows[0];
    if (!pm) return res.status(404).json({ error: 'payment_method_not_found' });

    let topupId;
    try {
      const { rows } = await pool.query(
        `INSERT INTO topups
           (user_id, method, amount_cents, fee_cents, net_cents,
            payment_method_id, idempotency_key, idempotency_payload_hash, status)
         VALUES ($1,'card',$2,0,$2,$3,$4,$5,'pending')
         RETURNING id`,
        [req.user.id, amount_cents, payment_method_id, idempotency_key, reqHash]
      );
      topupId = rows[0].id;
    } catch (err) {
      if (err.code === '23505') {
        const recheck = await checkTopupIdempotency(req.user.id, idempotency_key, reqHash);
        if (recheck?.conflict) return res.status(409).json({ error: 'idempotency_conflict' });
        if (recheck?.existing) return res.json({ topup: recheck.existing, idempotent: true });
        return res.status(409).json({ error: 'idempotency_conflict' });
      }
      throw err;
    }

    let charge;
    try {
      charge = await stripeOxxo.createCardTopup({
        amount_cents,
        customer_id: req.user.stripe_customer_id,
        payment_method_id: pm.stripe_payment_method_id,
        idempotency_key,
        metadata: { payme_user_id: req.user.id, topup_id: topupId },
      });
    } catch (stripeErr) {
      await pool.query(
        `UPDATE topups SET status='failed', failure_reason=$1 WHERE id=$2`,
        [stripeErr.message, topupId]
      );
      throw stripeErr;
    }

    await pool.query(
      `UPDATE topups SET stripe_payment_intent_id = $1, status = 'processing' WHERE id = $2`,
      [charge.intent_id, topupId]
    );

    if (charge.succeeded) {
      try { await creditWalletForTopup(topupId); }
      catch (err) {
        logger.error('inline_topup_credit_failed', { topup_id: topupId, error: err.message });
      }
    }

    logger.audit('topup_card_created', {
      user_id: req.user.id, amount: amount_cents, topup_id: topupId,
      requires_action: charge.requires_action,
      succeeded_inline: charge.succeeded,
    });

    const { rows: refreshed } = await pool.query(
      `SELECT status FROM topups WHERE id = $1`, [topupId]
    );
    res.status(201).json({
      topup: {
        id: topupId,
        status: refreshed[0].status,
        amount_cents, amount_display: centsToDisplay(Number(amount_cents)),
      },
      requires_action: charge.requires_action,
      client_secret: charge.requires_action ? charge.client_secret : undefined,
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
