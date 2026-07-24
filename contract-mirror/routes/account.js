/**
 * routes/account.js — Saldo, movimientos, historial, stats
 *
 * FIX m6: limit validado con Zod (no Number manual).
 * Incluye /wallet-transactions unificado (B3).
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { movementsQuery, historyQuery, walletTxQuery, validateQuery } = require('../schemas');
const { centsToDisplay } = require('../utils/money');

const router = express.Router();
router.use(requireAuth);

// ─── GET /me — perfil propio (G-02, v2.20) ─────────────────────────────────
// SELECT propio con ALLOWLIST explícita en el punto de exposición: no se
// reusa req.user (el middleware no trae phone/created_at y no queremos
// engordar una query que corre en CADA request autenticado). Jamás exponer
// password_hash / stripe_customer_id / email_normalized / kyc_status.
// Mismo shape que register (+ phone/created_at); wrapper { user } idéntico.
router.get('/me', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, payme_id, email, first_name, last_name, phone, created_at
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'user_not_found' });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

router.get('/balance', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT balance_cents, held_balance_cents, clabe FROM wallets WHERE user_id = $1`,
      [req.user.id]
    );
    const w = rows[0] || { balance_cents: 0, held_balance_cents: 0, clabe: null };
    const balance = Number(w.balance_cents);
    // G-03 (v2.21): retenido en garantías + disponible computado server-side —
    // misma resta que placeWalletHold, el 402 de pago wallet y transfers.
    // chk_wallets_held_balance garantiza 0 ≤ held ≤ balance en la fila.
    const held = Number(w.held_balance_cents || 0);
    const available = balance - held;
    res.json({
      balance_cents: balance,
      balance_display: centsToDisplay(balance),
      held_balance_cents: held,
      held_balance_display: centsToDisplay(held),
      available_cents: available,
      available_display: centsToDisplay(available),
      clabe: w.clabe,
      currency: 'mxn',
    });
  } catch (err) { next(err); }
});

router.get('/movements', validateQuery(movementsQuery), async (req, res, next) => {
  try {
    const { limit, offset } = req.validatedQuery;
    const { rows } = await pool.query(
      `SELECT pa.id, pa.gross_amount_cents, pa.tip_amount_cents,
              pa.payment_type, pa.status, pa.created_at,
              m.code AS mesa_code,
              r.name AS restaurant_name, r.category AS restaurant_category,
              pm.brand, pm.bank_name, pm.last_four
         FROM payment_attempts pa
         JOIN mesas m ON m.id = pa.mesa_id
         JOIN restaurants r ON r.id = m.restaurant_id
    LEFT JOIN payment_methods pm ON pm.id = pa.payment_method_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        ORDER BY pa.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({
      movements: rows.map(r => ({
        id: r.id,
        amount_cents: Number(r.gross_amount_cents),
        amount_display: centsToDisplay(Number(r.gross_amount_cents)),
        tip_cents: Number(r.tip_amount_cents),
        payment_type: r.payment_type,
        status: r.status,
        date: r.created_at,
        mesa: { code: r.mesa_code, restaurant: r.restaurant_name, category: r.restaurant_category },
        method: r.brand ? {
          brand: r.brand, bank: r.bank_name, last_four: r.last_four,
          display: `${r.brand === 'visa' ? 'Visa' : r.brand === 'mastercard' ? 'MC' : 'Amex'} ••${r.last_four}`,
        } : null,
      })),
      limit, offset,
    });
  } catch (err) { next(err); }
});

router.get('/movements/:id', async (req, res, next) => {
  try {
    const { rows: aRows } = await pool.query(
      `SELECT pa.*, m.code AS mesa_code, r.name AS restaurant_name, r.category,
              pm.brand, pm.bank_name, pm.last_four
         FROM payment_attempts pa
         JOIN mesas m ON m.id = pa.mesa_id
         JOIN restaurants r ON r.id = m.restaurant_id
    LEFT JOIN payment_methods pm ON pm.id = pa.payment_method_id
        WHERE pa.id = $1 AND pa.user_id = $2`,
      [req.params.id, req.user.id]
    );
    const a = aRows[0];
    if (!a) return res.status(404).json({ error: 'movement_not_found' });

    const { rows: items } = await pool.query(
      `SELECT mi.name, mi.price_cents, mi.quantity, mi.category
         FROM payment_attempt_items pai
         JOIN mesa_items mi ON mi.id = pai.mesa_item_id
        WHERE pai.payment_attempt_id = $1`, [a.id]
    );

    res.json({
      id: a.id,
      restaurant: { name: a.restaurant_name, category: a.category },
      mesa: { code: a.mesa_code },
      date: a.created_at,
      payment_type: a.payment_type,
      method: a.brand ? { brand: a.brand, bank: a.bank_name, last_four: a.last_four } : null,
      items: items.map(i => ({
        name: i.name, price_cents: Number(i.price_cents),
        quantity: i.quantity, category: i.category,
      })),
      items_amount_cents: Number(a.items_amount_cents),
      tip_amount_cents: Number(a.tip_amount_cents),
      gross_amount_cents: Number(a.gross_amount_cents),
      fee_amount_cents: Number(a.fee_amount_cents),
      status: a.status,
    });
  } catch (err) { next(err); }
});

// ─── /wallet-transactions: TODO unificado ──────────────────
router.get('/wallet-transactions', validateQuery(walletTxQuery), async (req, res, next) => {
  try {
    const { type, from, to, limit, offset } = req.validatedQuery;
    const params = [req.user.id];
    let where = `user_id = $1`;
    if (type) { params.push(type); where += ` AND type = $${params.length}`; }
    if (from) { params.push(from); where += ` AND created_at >= $${params.length}`; }
    if (to)   { params.push(to);   where += ` AND created_at <= $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT id, type, amount_cents, balance_after_cents,
              related_entity_type, related_entity_id,
              description, metadata, created_at
         FROM wallet_transactions
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      transactions: rows.map(t => ({
        id: t.id,
        type: t.type,
        amount_cents: Number(t.amount_cents),
        amount_display: centsToDisplay(Math.abs(Number(t.amount_cents))),
        sign: Number(t.amount_cents) >= 0 ? 'credit' : 'debit',
        balance_after_cents: Number(t.balance_after_cents),
        balance_after_display: centsToDisplay(Number(t.balance_after_cents)),
        related: t.related_entity_type
          ? { type: t.related_entity_type, id: t.related_entity_id } : null,
        description: t.description,
        metadata: t.metadata,
        date: t.created_at,
      })),
      limit, offset,
    });
  } catch (err) { next(err); }
});

router.get('/history', validateQuery(historyQuery), async (req, res, next) => {
  try {
    const { category, from, to, limit, offset } = req.validatedQuery;
    const params = [req.user.id];
    let where = `pa.user_id = $1 AND pa.status IN ('succeeded','processed')`;
    if (category) { params.push(category); where += ` AND r.category = $${params.length}`; }
    if (from)     { params.push(from);     where += ` AND pa.created_at >= $${params.length}`; }
    if (to)       { params.push(to);       where += ` AND pa.created_at <= $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT pa.id, pa.gross_amount_cents, pa.created_at,
              m.code AS mesa_code, r.name AS restaurant_name, r.category
         FROM payment_attempts pa
         JOIN mesas m ON m.id = pa.mesa_id
         JOIN restaurants r ON r.id = m.restaurant_id
        WHERE ${where}
        ORDER BY pa.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({
      history: rows.map(r => ({
        id: r.id,
        amount_cents: Number(r.gross_amount_cents),
        date: r.created_at,
        mesa_code: r.mesa_code,
        restaurant: r.restaurant_name,
        category: r.category,
      })),
      limit, offset,
    });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const { rows: month } = await pool.query(
      `SELECT COALESCE(SUM(gross_amount_cents), 0) AS spent,
              COUNT(*)::int AS visits,
              CASE WHEN COUNT(*) > 0
                   THEN COALESCE(SUM(gross_amount_cents), 0) / COUNT(*) ELSE 0 END AS avg_per_visit
         FROM payment_attempts
        WHERE user_id = $1 AND status IN ('succeeded','processed')
          AND created_at >= date_trunc('month', NOW())`, [req.user.id]
    );
    const { rows: topR } = await pool.query(
      `SELECT r.name, COUNT(*)::int AS visits
         FROM payment_attempts pa JOIN mesas m ON m.id = pa.mesa_id JOIN restaurants r ON r.id = m.restaurant_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        GROUP BY r.id, r.name ORDER BY visits DESC LIMIT 3`, [req.user.id]
    );
    const { rows: topD } = await pool.query(
      `SELECT mi.name, COUNT(*)::int AS times
         FROM payment_attempt_items pai
         JOIN payment_attempts pa ON pa.id = pai.payment_attempt_id
         JOIN mesa_items mi ON mi.id = pai.mesa_item_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        GROUP BY mi.name ORDER BY times DESC LIMIT 1`, [req.user.id]
    );
    const { rows: topCat } = await pool.query(
      `SELECT r.category, COUNT(*)::int AS visits
         FROM payment_attempts pa JOIN mesas m ON m.id = pa.mesa_id JOIN restaurants r ON r.id = m.restaurant_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        GROUP BY r.category ORDER BY visits DESC LIMIT 1`, [req.user.id]
    );
    res.json({
      month: {
        spent_cents: Number(month[0].spent),
        spent_display: centsToDisplay(Number(month[0].spent)),
        visits: month[0].visits,
        avg_per_visit_cents: Number(month[0].avg_per_visit),
        avg_per_visit_display: centsToDisplay(Number(month[0].avg_per_visit)),
      },
      top_restaurants: topR,
      top_dish: topD[0] || null,
      favorite_category: topCat[0]?.category || null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
