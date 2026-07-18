/**
 * routes/payment-methods.js — Tarjetas guardadas
 *
 * Fixes:
 *   - F2: endpoint POST /setup-intent para que el frontend cree SetupIntent
 *     y use Stripe Elements para agregar tarjetas nuevas sin cobrar.
 *   - M15: compensación: si falla el INSERT local, detacheamos de Stripe.
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { attachPaymentMethod, validateBody } = require('../schemas');
const stripeService = require('../services/stripe');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

// ─── POST /setup-intent ───────────────────────────────────
router.post('/setup-intent', async (req, res, next) => {
  try {
    if (!req.user.stripe_customer_id) {
      // Lazy: crear customer ahora si no existe
      const customer = await stripeService.createCustomer({
        user_id: req.user.id,
        email: req.user.email,
        name: `${req.user.first_name} ${req.user.last_name}`,
      });
      await pool.query(
        `UPDATE users SET stripe_customer_id = $1 WHERE id = $2`,
        [customer.id, req.user.id]
      );
      req.user.stripe_customer_id = customer.id;
    }
    const intent = await stripeService.createSetupIntent(req.user.stripe_customer_id);
    res.json(intent);
  } catch (err) { next(err); }
});

// ─── GET / ────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, brand, bank_name, type, last_four, exp_month, exp_year, is_default, status, created_at
         FROM payment_methods
        WHERE user_id = $1 AND status = 'active'
        ORDER BY is_default DESC, created_at DESC`, [req.user.id]
    );
    res.json({
      payment_methods: rows.map(r => ({
        id: r.id, brand: r.brand, bank_name: r.bank_name, type: r.type,
        last_four: r.last_four, exp_month: r.exp_month, exp_year: r.exp_year,
        is_default: r.is_default,
        display: `${r.bank_name || r.brand} · ${r.type === 'credit' ? 'Crédito' : 'Débito'} · •••• ${r.last_four}`,
      })),
    });
  } catch (err) { next(err); }
});

// ─── POST / (attach Stripe → insertar local con compensación) ─
router.post('/', validateBody(attachPaymentMethod), async (req, res, next) => {
  try {
    const { stripe_payment_method_id, set_as_default } = req.body;
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' });
    }

    // PASO 1: attach a Stripe
    const pm = await stripeService.attachPaymentMethod(
      req.user.stripe_customer_id, stripe_payment_method_id
    );
    const card = pm.card || {};
    const brand = ['visa','mastercard','amex'].includes(card.brand) ? card.brand : 'other';
    const type = card.funding === 'debit' ? 'debit' : 'credit';
    const bankName = card.issuer || pm.billing_details?.name || null;

    // PASO 2: insert local (con compensación si falla)
    let result;
    try {
      result = await pool.tx(async (client) => {
        if (set_as_default) {
          await client.query(
            `UPDATE payment_methods SET is_default = false WHERE user_id = $1`, [req.user.id]
          );
        }
        const { rows } = await client.query(
          `INSERT INTO payment_methods
             (user_id, stripe_payment_method_id, brand, bank_name, type,
              last_four, exp_month, exp_year, is_default, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')
           RETURNING id, brand, bank_name, type, last_four, exp_month, exp_year, is_default`,
          [req.user.id, pm.id, brand, bankName, type, card.last4,
           card.exp_month, card.exp_year, !!set_as_default]
        );
        return rows[0];
      });
    } catch (dbErr) {
      // M15: compensación — detacheamos de Stripe
      logger.error('payment_method_db_insert_failed_detaching', {
        user_id: req.user.id, stripe_pm: pm.id, error: dbErr.message,
      });
      try { await stripeService.detachPaymentMethod(pm.id); }
      catch (compErr) {
        logger.error('compensation_detach_failed', { stripe_pm: pm.id, error: compErr.message });
      }
      throw dbErr;
    }

    logger.audit('payment_method_attached', {
      user_id: req.user.id, brand, last_four: card.last4,
    });
    res.status(201).json({ payment_method: result });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT stripe_payment_method_id FROM payment_methods
        WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.id]
    );
    const pm = rows[0];
    if (!pm) return res.status(404).json({ error: 'payment_method_not_found' });

    try { await stripeService.detachPaymentMethod(pm.stripe_payment_method_id); }
    catch (e) { logger.warn('stripe_detach_failed', { error: e.message }); }

    await pool.query(`UPDATE payment_methods SET status='removed' WHERE id = $1`, [req.params.id]);
    res.json({ removed: true });
  } catch (err) { next(err); }
});

router.patch('/:id/default', async (req, res, next) => {
  try {
    await pool.tx(async (client) => {
      const { rowCount } = await client.query(
        `SELECT 1 FROM payment_methods WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [req.params.id, req.user.id]
      );
      if (rowCount === 0) {
        const e = new Error('payment_method_not_found'); e.status = 404; throw e;
      }
      await client.query(`UPDATE payment_methods SET is_default = false WHERE user_id = $1`, [req.user.id]);
      await client.query(`UPDATE payment_methods SET is_default = true WHERE id = $1`, [req.params.id]);
    });
    res.json({ updated: true });
  } catch (err) { next(err); }
});

module.exports = router;
