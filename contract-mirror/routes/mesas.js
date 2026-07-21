/**
 * routes/mesas.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P1 #2: guest token hashing en tablas OPERATIVAS.
 *     · payment_attempts.guest_token_hash
 *     · mesa_items.locked_by_guest_token_hash
 *     · mesa_division_slots.claimed_by_guest_token_hash
 *     Para flows NUEVOS de guest: se guarda SOLO el hash (raw = NULL).
 *     Validación/ownership: hash primero, fallback a token crudo (filas legacy).
 *     findExistingAttempt busca por guest_token_hash con fallback a guest_token.
 *
 * v2.5.1 (se mantiene):
 *   - P0 #3: PAYLOAD_KEYS.mesa_pay sin lock_tokens.
 *   - P1 #8: invitación link guarda solo token_hash; raw devuelto una sola vez.
 */
'use strict';

const express = require('express');
const { randomBytes } = require('crypto');
const pool = require('../db/pool');
const {
  requireAuth, guestOrAuth, requireMesaParticipant,
} = require('../middleware/auth');
const schemas = require('../schemas');
const stateMachine = require('../utils/stateMachine');
const stripeService = require('../services/stripe');
const settlement = require('../services/settlement');
const paymentProcessor = require('../services/paymentProcessor');
const notifs = require('../services/notifications');
const { centsToDisplay, sumCents, calculateFee, splitEqual } = require('../utils/money');
const { payloadHash, hashesMatch, PAYLOAD_KEYS } = require('../utils/idempotency');
const { generateToken, tokenHash } = require('../utils/tokens');
const logger = require('../utils/logger');

const router = express.Router();
const { validateBody } = schemas;
const ITEM_LOCK_SECONDS = Number(process.env.ITEM_LOCK_SECONDS) || 600;

async function generateMesaCode() {
  for (let i = 0; i < 10; i++) {
    const code = `PA-${Math.floor(Math.random() * 9000 + 1000)}`;
    const { rowCount } = await pool.query(`SELECT 1 FROM mesas WHERE code = $1`, [code]);
    if (rowCount === 0) return code;
  }
  throw new Error('Could not generate unique mesa code');
}

function generateLockToken() {
  return randomBytes(18).toString('base64url');
}

// Helper: hash de guest token (o null si no es guest)
function guestHashOf(req) {
  const tok = req.isGuest ? req.guestToken : null;
  return tok ? (req.guestTokenHash || tokenHash(tok)) : null;
}

// ─── POST / (crear mesa) ───────────────────────────────────
router.post('/', requireAuth, validateBody(schemas.createMesa), async (req, res, next) => {
  try {
    const {
      restaurant_id, total_cents, division_mode, expected_participants, items,
      guarantee_method, stripe_payment_method_id,   // v2.11 (parche §1/§2 · garantía)
    } = req.body;
    const { rowCount: rOk } = await pool.query(
      `SELECT 1 FROM restaurants WHERE id = $1 AND status = 'active'`, [restaurant_id]
    );
    if (rOk === 0) return res.status(404).json({ error: 'restaurant_not_found' });

    const sum = items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
    if (sum !== total_cents) {
      return res.status(400).json({ error: 'total_mismatch', expected: sum, received: total_cents });
    }

    const code = await generateMesaCode();
    const expiresAt = new Date(Date.now() + (Number(process.env.MESA_HOLD_SECONDS) || 1800) * 1000);

    const mesa = await pool.tx(async (client) => {
      // v2.11 (parche §1 · garantía Modelo B): la mesa nace 'pending_auth' y solo
      // pasa a 'open' cuando el hold del organizador queda autorizado.
      const { rows } = await client.query(
        `INSERT INTO mesas (code, restaurant_id, opener_user_id, total_cents,
                            division_mode, expected_participants, expires_at, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_auth')
         RETURNING id, code, total_cents, division_mode, expected_participants,
                   status, expires_at, created_at`,
        [code, restaurant_id, req.user.id, total_cents, division_mode,
         expected_participants, expiresAt]
      );
      const m = rows[0];
      await client.query(
        `INSERT INTO state_transitions
           (entity_type, entity_id, from_state, to_state, reason, triggered_by)
         VALUES ('mesa', $1, NULL, 'pending_auth', 'mesa_created_guarantee', 'user')`,
        [m.id]
      );
      for (const it of items) {
        await client.query(
          `INSERT INTO mesa_items (mesa_id, name, category, price_cents, quantity)
           VALUES ($1,$2,$3,$4,$5)`,
          [m.id, it.name, it.category || 'other', it.price_cents, it.quantity]
        );
      }
      await client.query(
        `INSERT INTO mesa_participants (mesa_id, user_id, role, status)
         VALUES ($1, $2, 'opener', 'active')`,
        [m.id, req.user.id]
      );
      if (division_mode === 'igual') {
        const parts = splitEqual(total_cents, expected_participants);
        for (let i = 0; i < parts.length; i++) {
          await client.query(
            `INSERT INTO mesa_division_slots (mesa_id, slot_index, amount_cents, status)
             VALUES ($1, $2, $3, 'available')`,
            [m.id, i, parts[i]]
          );
        }
      }
      return m;
    });

    // ── v2.11 (parche §1): hold de garantía FUERA de la tx (nunca Stripe en tx) ──
    const { rows: uRows } = await pool.query(
      `SELECT id, stripe_customer_id FROM users WHERE id = $1`, [req.user.id]
    );
    const organizer = uRows[0] || { id: req.user.id };

    const hold = await settlement.placeGuaranteeHold({
      mesaId: mesa.id,
      organizer,
      method: guarantee_method,
      stripePaymentMethodId: stripe_payment_method_id,
      amountCents: total_cents,
    });

    if (hold.status === 'failed') {
      // la mesa quedó 'auth_failed' (lo marca settlement); D1: no se activa sin garantía
      logger.warn('mesa_guarantee_failed', { mesa_id: mesa.id, reason: hold.reason });
      return res.status(402).json({
        error: 'guarantee_failed',
        reason: hold.reason,
        ...(hold.available !== undefined && { available: hold.available, required: hold.required }),
      });
    }

    logger.audit('mesa_created', {
      mesa_id: mesa.id, code: mesa.code, opener: req.user.id,
      guarantee_method, guarantee_status: hold.status,
    });
    res.status(201).json({
      mesa: { ...mesa, status: hold.status === 'open' ? 'open' : 'pending_auth' },
      guarantee: {
        method: guarantee_method,
        status: hold.status,                       // 'open' | 'requires_action' (3DS)
        ...(hold.clientSecret && { client_secret: hold.clientSecret }),
      },
    });
  } catch (err) { next(err); }
});

router.get('/open', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.code, m.total_cents, m.paid_amount_cents, m.status, m.expires_at,
              r.name AS restaurant_name, r.category
         FROM mesas m JOIN restaurants r ON r.id = m.restaurant_id
        WHERE m.opener_user_id = $1 AND m.status IN ('open','partially_paid')
        ORDER BY m.created_at DESC`, [req.user.id]
    );
    res.json({
      mesas: rows.map(m => ({
        id: m.id, code: m.code,
        full_name: `Mesa ${m.code} - ${m.restaurant_name}`,
        restaurant: { name: m.restaurant_name, category: m.category },
        total_cents: Number(m.total_cents),
        paid_amount_cents: Number(m.paid_amount_cents),
        pct_paid: Number(m.total_cents) > 0
          ? Math.round((Number(m.paid_amount_cents) / Number(m.total_cents)) * 100) : 0,
        status: m.status, expires_at: m.expires_at,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/:code', guestOrAuth, requireMesaParticipant, async (req, res, next) => {
  try {
    const mesa = req.mesa;
    const { rows: items } = await pool.query(
      `SELECT id, name, category, price_cents, quantity, status,
              locked_at, lock_expires_at, locked_by_user_id,
              locked_by_guest_token, locked_by_guest_token_hash
         FROM mesa_items WHERE mesa_id = $1 ORDER BY created_at ASC`, [mesa.id]
    );
    const { rows: activeStaff } = await pool.query(
      `SELECT id, display_name, role FROM restaurant_staff
        WHERE restaurant_id = $1 AND status = 'active' AND shift_status = 'on'
        ORDER BY display_name ASC`, [mesa.restaurant_id]
    );
    const { rows: rRow } = await pool.query(
      `SELECT name, category, address FROM restaurants WHERE id = $1`, [mesa.restaurant_id]
    );
    const r = rRow[0] || {};

    let slots = null;
    if (mesa.division_mode === 'igual') {
      const { rows: sRows } = await pool.query(
        `SELECT slot_index, amount_cents, status FROM mesa_division_slots
          WHERE mesa_id = $1 ORDER BY slot_index ASC`, [mesa.id]
      );
      slots = sRows.map(s => ({
        slot_index: s.slot_index,
        amount_cents: Number(s.amount_cents),
        amount_display: centsToDisplay(Number(s.amount_cents)),
        status: s.status,
      }));
    }

    // v2.5.2 P1 #2: ownership de lock por hash (nuevo) o raw (legacy)
    const myHash = guestHashOf(req);
    const myToken = req.isGuest ? req.guestToken : null;
    const lockedByMe = (i) => {
      if (i.status !== 'locked') return false;
      if (req.isGuest) {
        return (myHash && i.locked_by_guest_token_hash === myHash) ||
               (myToken && i.locked_by_guest_token === myToken);
      }
      return i.locked_by_user_id === req.user.id;
    };

    res.json({
      mesa: {
        id: mesa.id, code: mesa.code,
        full_name: `Mesa ${mesa.code} - ${r.name}`,
        restaurant: { id: mesa.restaurant_id, name: r.name, category: r.category, address: r.address },
        total_cents: Number(mesa.total_cents),
        total_display: centsToDisplay(Number(mesa.total_cents)),
        paid_amount_cents: Number(mesa.paid_amount_cents),
        tip_amount_cents: Number(mesa.tip_amount_cents),
        division_mode: mesa.division_mode,
        expected_participants: mesa.expected_participants,
        status: mesa.status, expires_at: mesa.expires_at,
        items: items.map(i => ({
          id: i.id, name: i.name, category: i.category,
          price_cents: Number(i.price_cents), quantity: i.quantity, status: i.status,
          locked_by_me: lockedByMe(i),
          lock_expires_at: i.lock_expires_at,
        })),
        ...(slots && { division_slots: slots }),
        active_staff: activeStaff,
        my_role: req.mesaRole || (req.isGuest ? 'guest' : null),
      },
    });
  } catch (err) { next(err); }
});

router.post('/:code/items/lock', guestOrAuth, requireMesaParticipant,
  validateBody(schemas.lockItems), async (req, res, next) => {
  try {
    const mesa = req.mesa;
    if (!['open','partially_paid'].includes(mesa.status)) {
      return res.status(409).json({ error: 'mesa_not_active' });
    }
    const lockToken = generateLockToken();
    const lockExpiresAt = new Date(Date.now() + ITEM_LOCK_SECONDS * 1000);
    const userId = req.user?.id || null;
    const guestTok = req.isGuest ? req.guestToken : null;
    const guestTokHash = guestHashOf(req);  // v2.5.2 P1 #2

    const locked = await pool.tx(async (client) => {
      const result = [];
      for (const itemId of req.body.item_ids) {
        const { rows } = await client.query(
          `SELECT id, status, locked_by_user_id, locked_by_guest_token,
                  locked_by_guest_token_hash, lock_expires_at
             FROM mesa_items WHERE id = $1 AND mesa_id = $2 FOR UPDATE`,
          [itemId, mesa.id]
        );
        const item = rows[0];
        if (!item) throw Object.assign(new Error('item_not_found'), { status: 404, item_id: itemId });

        if (item.status === 'locked') {
          const isOwner = (userId && item.locked_by_user_id === userId)
                       || (guestTokHash && item.locked_by_guest_token_hash === guestTokHash)
                       || (guestTok && item.locked_by_guest_token === guestTok);
          if (isOwner) {
            await client.query(
              `UPDATE mesa_items
                  SET lock_token = $2, lock_expires_at = $3, locked_at = NOW()
                WHERE id = $1`,
              [itemId, lockToken, lockExpiresAt]
            );
            result.push(itemId);
            continue;
          }
          throw Object.assign(new Error('item_already_locked'), { status: 409, item_id: itemId });
        }
        if (!['available','released'].includes(item.status)) {
          throw Object.assign(new Error('item_not_available'), { status: 409, item_id: itemId });
        }

        // v2.5.2 P1 #2: flow nuevo → guardamos SOLO el hash (raw = NULL)
        await client.query(
          `UPDATE mesa_items
              SET status='locked', locked_at=NOW(),
                  lock_token=$2, lock_expires_at=$3,
                  locked_by_user_id=$4,
                  locked_by_guest_token=NULL,
                  locked_by_guest_token_hash=$5
            WHERE id=$1`,
          [itemId, lockToken, lockExpiresAt, userId, guestTokHash]
        );
        await stateMachine.transition({
          client, entityType: 'mesa_item', entityId: itemId,
          fromState: item.status, toState: 'locked',
          triggeredBy: req.isGuest ? 'guest' : 'user',
        });
        result.push(itemId);
      }
      return result;
    });

    res.json({ locked, lock_token: lockToken, lock_expires_at: lockExpiresAt });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message, ...(err.item_id && { item_id: err.item_id }),
      });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// POST /:code/pay
// PAYLOAD_KEYS.mesa_pay NO incluye lock_tokens (P0 #3 v2.5.1);
// item_ids/slot_ids se ordenan al hashear (P1 #3 v2.5.2 vía idempotency.js).
// guest token hashing en tablas operativas (P1 #2 v2.5.2).
// ═══════════════════════════════════════════════════════════
router.post('/:code/pay', guestOrAuth, requireMesaParticipant,
  validateBody(schemas.payMesa), async (req, res, next) => {
  try {
    const mesa = req.mesa;
    const {
      payment_method_id, stripe_payment_method_id, payment_type,
      item_ids, lock_tokens, tip_cents, tip_to_staff_id, idempotency_key,
    } = req.body;

    if (payment_type === 'wallet' && req.isGuest) {
      return res.status(401).json({ error: 'wallet_requires_auth' });
    }
    if (!['open','partially_paid'].includes(mesa.status)) {
      return res.status(409).json({ error: 'mesa_not_payable', status: mesa.status });
    }
    const userId = req.user?.id || null;
    const guestTok = req.isGuest ? req.guestToken : null;
    const guestTokHash = guestHashOf(req);  // v2.5.2 P1 #2

    if (tip_to_staff_id) {
      const { rowCount: sOk } = await pool.query(
        `SELECT 1 FROM restaurant_staff
          WHERE id = $1 AND restaurant_id = $2 AND status = 'active'`,
        [tip_to_staff_id, mesa.restaurant_id]
      );
      if (sOk === 0) return res.status(400).json({ error: 'staff_not_in_restaurant' });
    }

    // hash sin lock_tokens; arrays ordenados (idempotency.js v2.5.2)
    const reqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.mesa_pay });

    const idemExisting = await findExistingAttempt({
      user_id: userId, guest_token_hash: guestTokHash, guest_token: guestTok,
      mesa_id: mesa.id, idempotency_key,
    });
    if (idemExisting) {
      if (!hashesMatch(idemExisting.idempotency_payload_hash, reqHash)) {
        logger.warn('idempotency_conflict_mesa_pay', {
          mesa_id: mesa.id, idem_key: idempotency_key,
          existing_hash: idemExisting.idempotency_payload_hash?.slice(0, 12),
          new_hash: reqHash.slice(0, 12),
        });
        return res.status(409).json({
          error: 'idempotency_conflict',
          message: 'Same idempotency_key used with different payload',
        });
      }
      return res.json({ attempt: idemExisting, idempotent: true });
    }

    let attempt;
    try {
      attempt = await pool.tx(async (client) => {
        let validatedItemsAmount = 0;
        const itemsForLock = [];
        let claimedSlotIndex = null;

        if (mesa.division_mode === 'consumo') {
          if (item_ids.length === 0) {
            throw Object.assign(new Error('no_items_selected'), { status: 400 });
          }
          const { rows: itemRows } = await client.query(
            `SELECT id, price_cents, quantity, status,
                    locked_by_user_id, locked_by_guest_token, locked_by_guest_token_hash,
                    lock_token, lock_expires_at
               FROM mesa_items
              WHERE id = ANY($1::uuid[]) AND mesa_id = $2
              FOR UPDATE`,
            [item_ids, mesa.id]
          );
          if (itemRows.length !== item_ids.length) {
            throw Object.assign(new Error('invalid_item_ids'), { status: 400 });
          }
          const ownsLockTokens = (tok) => Array.isArray(lock_tokens) && lock_tokens.includes(tok);
          for (const it of itemRows) {
            if (it.status === 'paid') {
              throw Object.assign(new Error('item_already_paid'), { status: 409, item_id: it.id });
            }
            if (it.status === 'locked') {
              const isOwner = (userId && it.locked_by_user_id === userId)
                           || (guestTokHash && it.locked_by_guest_token_hash === guestTokHash)
                           || (guestTok && it.locked_by_guest_token === guestTok)
                           || ownsLockTokens(it.lock_token);
              const expired = it.lock_expires_at && new Date(it.lock_expires_at) < new Date();
              if (!isOwner && !expired) {
                throw Object.assign(new Error('item_already_locked'), { status: 409, item_id: it.id });
              }
            }
            validatedItemsAmount += Number(it.price_cents) * it.quantity;
            itemsForLock.push(it.id);
          }
        } else {
          const { rows: slotRows } = await client.query(
            `SELECT slot_index, amount_cents FROM mesa_division_slots
              WHERE mesa_id = $1 AND status = 'available'
              ORDER BY slot_index ASC
              LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [mesa.id]
          );
          if (slotRows.length === 0) {
            throw Object.assign(new Error('no_slots_available'), { status: 409 });
          }
          claimedSlotIndex = slotRows[0].slot_index;
          validatedItemsAmount = Number(slotRows[0].amount_cents);
        }

        const grossAmount = sumCents(validatedItemsAmount, tip_cents);
        const feeAmount = calculateFee(validatedItemsAmount, Number(mesa.fee_pct || 0.02));

        // v2.5.2 P1 #2: payment_attempts guarda guest_token_hash (raw = NULL)
        const { rows: aRows } = await client.query(
          `INSERT INTO payment_attempts
             (mesa_id, user_id, guest_token, guest_token_hash, payment_method_id,
              items_amount_cents, tip_amount_cents, gross_amount_cents,
              fee_amount_cents, net_amount_cents,
              idempotency_key, idempotency_payload_hash,
              operation_type, status, payment_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'mesa_pay','pending',$13)
           RETURNING id, gross_amount_cents`,
          [mesa.id, userId, null, guestTokHash, payment_method_id || null,
           validatedItemsAmount, tip_cents, grossAmount,
           feeAmount, grossAmount - feeAmount,
           idempotency_key, reqHash, payment_type]
        );
        const a = aRows[0];

        if (mesa.division_mode === 'consumo') {
          for (const itemId of itemsForLock) {
            await client.query(
              `INSERT INTO payment_attempt_items (payment_attempt_id, mesa_item_id)
               VALUES ($1, $2)`,
              [a.id, itemId]
            );
            // v2.5.2 P1 #2: lock por hash; WHERE acepta hash (nuevo) o raw (legacy)
            await client.query(
              `UPDATE mesa_items
                  SET status='locked', locked_at=NOW(),
                      locked_by_attempt=$2,
                      locked_by_user_id=$3,
                      locked_by_guest_token=NULL,
                      locked_by_guest_token_hash=$4,
                      lock_expires_at = NOW() + INTERVAL '${ITEM_LOCK_SECONDS} seconds'
                WHERE id=$1
                  AND (status = 'available' OR status = 'released'
                       OR (status = 'locked'
                           AND (($3::uuid IS NOT NULL AND locked_by_user_id = $3::uuid)
                                OR ($4::text IS NOT NULL AND locked_by_guest_token_hash = $4::text)
                                OR ($5::text IS NOT NULL AND locked_by_guest_token = $5::text))))`,
              [itemId, a.id, userId, guestTokHash, guestTok]
            );
          }
        } else {
          await client.query(
            `UPDATE mesa_division_slots
                SET status='claimed',
                    claimed_by_attempt_id=$2,
                    claimed_by_user_id=$3,
                    claimed_by_guest_token=NULL,
                    claimed_by_guest_token_hash=$4,
                    claimed_at=NOW()
              WHERE mesa_id = $1 AND slot_index = $5`,
            [mesa.id, a.id, userId, guestTokHash, claimedSlotIndex]
          );
        }

        if (tip_cents > 0) {
          await client.query(
            `INSERT INTO tip_distributions (payment_attempt_id, mesa_id, staff_id, amount_cents)
             VALUES ($1, $2, $3, $4)`,
            [a.id, mesa.id, tip_to_staff_id || null, tip_cents]
          );
        }
        return { ...a, grossAmount, validatedItemsAmount, claimedSlotIndex };
      });
    } catch (err) {
      if (err.code === '23505') {
        const existing = await findExistingAttempt({
          user_id: userId, guest_token_hash: guestTokHash, guest_token: guestTok,
          mesa_id: mesa.id, idempotency_key,
        });
        if (existing) {
          if (!hashesMatch(existing.idempotency_payload_hash, reqHash)) {
            return res.status(409).json({ error: 'idempotency_conflict' });
          }
          return res.json({ attempt: existing, idempotent: true });
        }
        return res.status(409).json({ error: 'concurrent_conflict' });
      }
      if (err.status) {
        return res.status(err.status).json({
          error: err.message, ...(err.item_id && { item_id: err.item_id }),
        });
      }
      throw err;
    }

    if (payment_type === 'wallet') {
      try {
        await pool.tx(async (client) => {
          const { rows: wRows } = await client.query(
            `SELECT id, balance_cents, held_balance_cents FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]
          );
          const wallet = wRows[0];
          // v2.11 (A5): el saldo RESERVADO como garantía (held_balance_cents) no es
          // gastable. Sin este cálculo, el CHECK chk_wallets_held_balance frenaba
          // el UPDATE con un 500 en vez de un 402, y el usuario veía saldo
          // "disponible" que en realidad estaba congelado.
          const availableBal = wallet
            ? Number(wallet.balance_cents) - Number(wallet.held_balance_cents || 0)
            : 0;
          if (!wallet || availableBal < attempt.grossAmount) {
            throw Object.assign(new Error('insufficient_funds'), {
              status: 402,
              available: availableBal,
              required: attempt.grossAmount,
            });
          }
          const newBal = Number(wallet.balance_cents) - attempt.grossAmount;
          await client.query(`UPDATE wallets SET balance_cents=$1, updated_at=NOW() WHERE id=$2`, [newBal, wallet.id]);
          await client.query(
            `INSERT INTO wallet_transactions
               (wallet_id, user_id, type, amount_cents, balance_after_cents,
                related_entity_type, related_entity_id, description)
             VALUES ($1,$2,'payment_mesa',$3,$4,'mesa',$5,$6)`,
            [wallet.id, userId, -attempt.grossAmount, newBal, mesa.id, `Pago mesa ${mesa.code}`]
          );
          await client.query(`UPDATE payment_attempts SET status='succeeded' WHERE id=$1`, [attempt.id]);
          await stateMachine.transition({
            client, entityType: 'payment_attempt', entityId: attempt.id,
            fromState: 'pending', toState: 'succeeded',
            reason: 'wallet_payment', triggeredBy: 'user',
          });
          await paymentProcessor.processSuccessfulPayment(client, attempt.id, { triggeredBy: 'system' });
        });
        return res.status(201).json({
          attempt: {
            id: attempt.id,
            gross_amount_cents: Number(attempt.grossAmount),
            gross_display: centsToDisplay(Number(attempt.grossAmount)),
            status: 'processed',
            payment_type: 'wallet',
          },
        });
      } catch (err) {
        if (err.status === 402) {
          await releaseAttemptItems(attempt.id, 'insufficient_funds');
          return res.status(402).json({
            error: 'insufficient_funds',
            available: err.available, required: err.required,
          });
        }
        throw err;
      }
    }

    let stripePmId = stripe_payment_method_id || null;
    if (!stripePmId && payment_method_id) {
      const { rows: pmRows } = await pool.query(
        `SELECT stripe_payment_method_id FROM payment_methods
          WHERE id = $1 AND user_id = $2 AND status = 'active'`,
        [payment_method_id, userId]
      );
      stripePmId = pmRows[0]?.stripe_payment_method_id;
      if (!stripePmId) {
        await releaseAttemptItems(attempt.id, 'pm_not_found');
        return res.status(404).json({ error: 'payment_method_not_found' });
      }
    }
    if (!stripePmId) {
      await releaseAttemptItems(attempt.id, 'no_payment_source');
      return res.status(400).json({ error: 'no_payment_source' });
    }

    try {
      const stripeIntent = await stripeService.createPaymentIntent({
        amount_cents: attempt.grossAmount,
        customer_id: req.user?.stripe_customer_id,
        payment_method_id: stripePmId,
        idempotency_key: `pay_${attempt.id}`,
        metadata: {
          mesa_id: mesa.id, mesa_code: mesa.code,
          user_id: userId || 'guest',
          attempt_id: attempt.id,
          tip_to_staff_id: tip_to_staff_id || '',
        },
      });

      const newStatus = stateMachine.mapStripeStatus(stripeIntent.status);
      await pool.query(
        `UPDATE payment_attempts
            SET stripe_payment_intent_id = $1,
                stripe_client_secret = $2,
                status = $3
          WHERE id = $4`,
        [stripeIntent.id, stripeIntent.client_secret, newStatus, attempt.id]
      );

      logger.audit('payment_attempt_created', {
        mesa_id: mesa.id, attempt_id: attempt.id,
        gross_amount: attempt.grossAmount, payment_type, stripe_status: stripeIntent.status,
      });

      res.status(201).json({
        attempt: {
          id: attempt.id,
          gross_amount_cents: Number(attempt.grossAmount),
          client_secret: stripeIntent.client_secret,
          status: newStatus,
          stripe_status: stripeIntent.status,
          requires_action: stripeIntent.status === 'requires_action',
        },
      });
    } catch (stripeErr) {
      logger.error('stripe_payment_intent_failed', {
        attempt_id: attempt.id, error: stripeErr.message,
      });
      await releaseAttemptItems(attempt.id, stripeErr.message);
      return res.status(502).json({ error: 'payment_provider_error', message: stripeErr.message });
    }
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message, ...(err.item_id && { item_id: err.item_id }),
      });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// POST /:code/invitations  (v2.5.1 P1 #8: token hashing)
// ═══════════════════════════════════════════════════════════
router.post('/:code/invitations', requireAuth, validateBody(schemas.createInvitation),
  async (req, res, next) => {
  try {
    const { invited_user_id, invited_payme_id, type } = req.body;
    const { rows: mRows } = await pool.query(
      `SELECT id, opener_user_id, status FROM mesas WHERE code = $1`, [req.params.code]
    );
    const mesa = mRows[0];
    if (!mesa) return res.status(404).json({ error: 'mesa_not_found' });
    if (mesa.opener_user_id !== req.user.id) return res.status(403).json({ error: 'only_opener_can_invite' });
    if (!['open','partially_paid'].includes(mesa.status)) {
      return res.status(409).json({ error: 'mesa_not_invitable', status: mesa.status });
    }

    let invitedUserId = invited_user_id || null;
    let invitedPaymeIdSnapshot = invited_payme_id || null;
    if (type === 'in_app' && !invitedUserId && invited_payme_id) {
      const { rows } = await pool.query(
        `SELECT id, payme_id FROM users WHERE payme_id = $1 AND status = 'active'`, [invited_payme_id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'invited_user_not_found' });
      invitedUserId = rows[0].id;
      invitedPaymeIdSnapshot = rows[0].payme_id;
    }

    const expiresAt = new Date(Date.now() + (Number(process.env.INVITATION_EXPIRY_SECONDS) || 86400) * 1000);

    let rawToken = null;
    let tokHash = null;
    if (type === 'link') {
      rawToken = generateToken(24);
      tokHash = tokenHash(rawToken);
    }

    const inv = await pool.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO invitations
           (mesa_id, inviter_user_id, invited_user_id, invited_payme_id,
            invitation_type, token, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, invitation_type, status, expires_at, created_at`,
        [mesa.id, req.user.id, invitedUserId, invitedPaymeIdSnapshot, type,
         null, tokHash, expiresAt]
      );
      const i = rows[0];
      if (type === 'in_app' && invitedUserId) {
        await client.query(
          `INSERT INTO mesa_participants (mesa_id, user_id, role, status)
           VALUES ($1, $2, 'invited', 'pending')
           -- uq_mesa_participants_user es PARCIAL (WHERE user_id IS NOT NULL):
           -- sin repetir el predicado, Postgres aborta con 42P10 SIEMPRE.
           ON CONFLICT (mesa_id, user_id) WHERE user_id IS NOT NULL DO NOTHING`,
          [mesa.id, invitedUserId]
        );
      }
      if (type === 'link' && tokHash) {
        // P1 #8: SOLO guardamos el hash, NO el token crudo
        await client.query(
          `INSERT INTO mesa_participants (mesa_id, guest_token_hash, role, status)
           VALUES ($1, $2, 'guest', 'pending')`,
          [mesa.id, tokHash]
        );
      }
      return i;
    });

    if (type === 'in_app' && invitedUserId) {
      await notifs.create({
        user_id: invitedUserId, type: 'invitation_received',
        body: `${req.user.first_name} ${req.user.last_name} te invitó a una mesa`,
        payload: { mesa_code: req.params.code,
                   inviter_name: `${req.user.first_name} ${req.user.last_name}`,
                   inviter_payme_id: req.user.payme_id },
        related_entity_type: 'invitation', related_entity_id: inv.id,
      });
    }

    const publicUrl = process.env.FRONTEND_PUBLIC_URL || 'http://localhost:5173';
    res.status(201).json({
      invitation: inv,
      // rawToken se devuelve UNA SOLA VEZ (no se persiste crudo en DB)
      ...(type === 'link' && rawToken && {
        link: `${publicUrl}/mesa/${req.params.code}?t=${rawToken}`,
      }),
    });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════
// v2.5.2 P1 #2: busca por guest_token_hash con fallback a guest_token (legacy)
async function findExistingAttempt({ user_id, guest_token_hash, guest_token, mesa_id, idempotency_key }) {
  const SELECT = `SELECT id, status, stripe_client_secret, gross_amount_cents, idempotency_payload_hash
                    FROM payment_attempts
                   WHERE %COL% = $1 AND mesa_id = $2
                     AND operation_type = 'mesa_pay' AND idempotency_key = $3`;

  if (user_id) {
    const { rows } = await pool.query(SELECT.replace('%COL%', 'user_id'),
      [user_id, mesa_id, idempotency_key]);
    return rows[0] || null;
  }
  if (guest_token_hash) {
    const { rows } = await pool.query(SELECT.replace('%COL%', 'guest_token_hash'),
      [guest_token_hash, mesa_id, idempotency_key]);
    if (rows[0]) return rows[0];
  }
  if (guest_token) {
    const { rows } = await pool.query(SELECT.replace('%COL%', 'guest_token'),
      [guest_token, mesa_id, idempotency_key]);
    return rows[0] || null;
  }
  return null;
}

async function releaseAttemptItems(attemptId, reason) {
  try {
    await pool.tx(async (client) => {
      await paymentProcessor.processFailedPayment(client, attemptId, reason);
    });
  } catch (err) {
    logger.error('release_attempt_items_failed', { attempt_id: attemptId, error: err.message });
  }
}

module.exports = router;
