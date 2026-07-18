/**
 * routes/transfers.js v2.5.0
 *
 * Cambios vs v2.4:
 *   - P0 #3: idempotency_payload_hash. Misma key + distinto hash → 409.
 *            Misma key + mismo hash → 200 idempotent.
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createTransfer, validateBody } = require('../schemas');
const notifs = require('../services/notifications');
const { centsToDisplay } = require('../utils/money');
const { payloadHash, hashesMatch, PAYLOAD_KEYS } = require('../utils/idempotency');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

async function findExistingTransfer(from_user_id, idempotency_key) {
  const { rows } = await pool.query(
    `SELECT id, amount_cents, concept, status, completed_at, to_user_id, created_at,
            idempotency_payload_hash
       FROM transfers
      WHERE from_user_id = $1 AND idempotency_key = $2`,
    [from_user_id, idempotency_key]
  );
  return rows[0] || null;
}

async function checkTransferIdempotency(from_user_id, idempotency_key, reqHash) {
  const existing = await findExistingTransfer(from_user_id, idempotency_key);
  if (!existing) return null;
  if (!hashesMatch(existing.idempotency_payload_hash, reqHash)) {
    logger.warn('idempotency_conflict_transfer', {
      from_user_id, idem_key: idempotency_key,
      existing_hash: existing.idempotency_payload_hash?.slice(0, 12),
      new_hash: reqHash.slice(0, 12),
    });
    return { existing, conflict: true };
  }
  return { existing };
}

router.post('/', validateBody(createTransfer), async (req, res, next) => {
  try {
    const { amount_cents, to_payme_id, to_email, to_user_id, concept, idempotency_key } = req.body;

    // P0 #3: payload hash check
    const reqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.transfer });

    const idemCheck = await checkTransferIdempotency(req.user.id, idempotency_key, reqHash);
    if (idemCheck?.conflict) {
      return res.status(409).json({
        error: 'idempotency_conflict',
        message: 'Same idempotency_key used with different payload',
      });
    }
    if (idemCheck?.existing) {
      return res.json({
        transfer: { ...idemCheck.existing, amount_display: centsToDisplay(Number(idemCheck.existing.amount_cents)) },
        idempotent: true,
      });
    }

    // Resolver destinatario
    let lookup;
    if (to_user_id) {
      lookup = await pool.query(
        `SELECT id, payme_id, first_name, last_name, email FROM users
          WHERE id = $1 AND status = 'active'`, [to_user_id]);
    } else if (to_payme_id) {
      lookup = await pool.query(
        `SELECT id, payme_id, first_name, last_name, email FROM users
          WHERE payme_id = $1 AND status = 'active'`, [to_payme_id]);
    } else {
      lookup = await pool.query(
        `SELECT id, payme_id, first_name, last_name, email FROM users
          WHERE email = $1 AND status = 'active'`, [to_email]);
    }
    const recipient = lookup.rows[0];
    if (!recipient) return res.status(404).json({ error: 'recipient_not_found' });
    if (recipient.id === req.user.id) return res.status(400).json({ error: 'cannot_transfer_to_self' });

    const { rows: ensureFrom } = await pool.query(
      `INSERT INTO wallets (user_id, balance_cents) VALUES ($1, 0)
       ON CONFLICT (user_id) DO UPDATE SET user_id = wallets.user_id
       RETURNING id, balance_cents`, [req.user.id]
    );
    const { rows: ensureTo } = await pool.query(
      `INSERT INTO wallets (user_id, balance_cents) VALUES ($1, 0)
       ON CONFLICT (user_id) DO UPDATE SET user_id = wallets.user_id
       RETURNING id, balance_cents`, [recipient.id]
    );
    const fromWalletId = ensureFrom[0].id;
    const toWalletId   = ensureTo[0].id;
    const [firstId, secondId] = [fromWalletId, toWalletId].sort();

    let result;
    try {
      result = await pool.tx(async (client) => {
        const { rows: locked } = await client.query(
          `SELECT id, user_id, balance_cents, held_balance_cents FROM wallets
            WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
          [firstId, secondId]
        );
        const byId = new Map(locked.map(w => [w.id, w]));
        const fromW = byId.get(fromWalletId);
        const toW   = byId.get(toWalletId);

        if (!fromW || !toW) throw Object.assign(new Error('wallet_not_found'), { status: 500 });
        // v2.11 (A5): el saldo reservado como garantía no es transferible.
        const fromAvailable = Number(fromW.balance_cents) - Number(fromW.held_balance_cents || 0);
        if (fromAvailable < amount_cents) {
          throw Object.assign(new Error('insufficient_funds'), {
            status: 402,
            available: fromAvailable, required: amount_cents,
          });
        }

        // v2.5.0 P0 #3: persistir payload hash
        const { rows: tRows } = await client.query(
          `INSERT INTO transfers
             (from_user_id, to_user_id, amount_cents, concept, status, completed_at,
              idempotency_key, idempotency_payload_hash)
           VALUES ($1,$2,$3,$4,'completed',NOW(),$5,$6)
           RETURNING id, amount_cents, concept, completed_at`,
          [req.user.id, recipient.id, amount_cents, concept || null, idempotency_key, reqHash]
        );
        const transfer = tRows[0];

        const newFromBal = Number(fromW.balance_cents) - amount_cents;
        const newToBal   = Number(toW.balance_cents)   + amount_cents;
        await client.query(`UPDATE wallets SET balance_cents=$1, updated_at=NOW() WHERE id=$2`, [newFromBal, fromW.id]);
        await client.query(`UPDATE wallets SET balance_cents=$1, updated_at=NOW() WHERE id=$2`, [newToBal, toW.id]);

        await client.query(
          `INSERT INTO wallet_transactions
             (wallet_id, user_id, type, amount_cents, balance_after_cents,
              related_entity_type, related_entity_id, description)
           VALUES ($1,$2,'transfer_out',$3,$4,'transfer',$5,$6)`,
          [fromW.id, req.user.id, -amount_cents, newFromBal, transfer.id,
           concept || `Transferencia a ${recipient.first_name}`]
        );
        await client.query(
          `INSERT INTO wallet_transactions
             (wallet_id, user_id, type, amount_cents, balance_after_cents,
              related_entity_type, related_entity_id, description)
           VALUES ($1,$2,'transfer_in',$3,$4,'transfer',$5,$6)`,
          [toW.id, recipient.id, amount_cents, newToBal, transfer.id,
           concept || `Transferencia de ${req.user.first_name}`]
        );

        await notifs.create({
          client, user_id: req.user.id, type: 'transfer_sent',
          body: `Le enviaste ${centsToDisplay(Number(amount_cents))} a ${recipient.first_name} ${recipient.last_name}`,
          payload: {
            amount_cents, recipient_name: `${recipient.first_name} ${recipient.last_name}`,
            recipient_payme_id: recipient.payme_id, concept,
          },
          related_entity_type: 'transfer', related_entity_id: transfer.id,
        });
        await notifs.create({
          client, user_id: recipient.id, type: 'transfer_received',
          body: `${req.user.first_name} ${req.user.last_name} te envió ${centsToDisplay(Number(amount_cents))}`,
          payload: {
            amount_cents, sender_name: `${req.user.first_name} ${req.user.last_name}`,
            sender_payme_id: req.user.payme_id, concept,
          },
          related_entity_type: 'transfer', related_entity_id: transfer.id,
        });

        return transfer;
      });
    } catch (err) {
      if (err.code === '23505') {
        const recheck = await checkTransferIdempotency(req.user.id, idempotency_key, reqHash);
        if (recheck?.conflict) return res.status(409).json({ error: 'idempotency_conflict' });
        if (recheck?.existing) {
          return res.json({
            transfer: { ...recheck.existing, amount_display: centsToDisplay(Number(recheck.existing.amount_cents)) },
            idempotent: true,
          });
        }
        return res.status(409).json({ error: 'idempotency_conflict' });
      }
      if (err.status === 402) {
        return res.status(402).json({
          error: 'insufficient_funds',
          available: err.available, required: err.required,
        });
      }
      throw err;
    }

    logger.audit('transfer_completed', {
      from: req.user.id, to: recipient.id, amount: amount_cents, transfer_id: result.id,
    });

    res.status(201).json({
      transfer: {
        ...result,
        amount_display: centsToDisplay(Number(result.amount_cents)),
        to: {
          payme_id: recipient.payme_id,
          full_name: `${recipient.first_name} ${recipient.last_name}`,
        },
      },
    });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const { rows } = await pool.query(
      `SELECT t.id, t.amount_cents, t.concept, t.status, t.completed_at, t.created_at,
              CASE WHEN t.from_user_id = $1 THEN 'sent' ELSE 'received' END AS direction,
              CASE WHEN t.from_user_id = $1
                   THEN to_u.payme_id ELSE from_u.payme_id END AS counterparty_payme_id,
              CASE WHEN t.from_user_id = $1
                   THEN CONCAT(to_u.first_name, ' ', to_u.last_name)
                   ELSE CONCAT(from_u.first_name, ' ', from_u.last_name) END AS counterparty_name
         FROM transfers t
         JOIN users from_u ON from_u.id = t.from_user_id
         JOIN users to_u   ON to_u.id   = t.to_user_id
        WHERE t.from_user_id = $1 OR t.to_user_id = $1
        ORDER BY t.created_at DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json({
      transfers: rows.map(t => ({
        ...t, amount_cents: Number(t.amount_cents),
        amount_display: centsToDisplay(Number(t.amount_cents)),
      })),
    });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT t.*, from_u.payme_id AS from_payme_id, to_u.payme_id AS to_payme_id,
              CONCAT(from_u.first_name, ' ', from_u.last_name) AS from_name,
              CONCAT(to_u.first_name, ' ', to_u.last_name) AS to_name
         FROM transfers t
         JOIN users from_u ON from_u.id = t.from_user_id
         JOIN users to_u   ON to_u.id   = t.to_user_id
        WHERE t.id = $1 AND (t.from_user_id = $2 OR t.to_user_id = $2)`,
      [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'transfer_not_found' });
    const t = rows[0];
    res.json({
      transfer: {
        ...t, amount_cents: Number(t.amount_cents),
        amount_display: centsToDisplay(Number(t.amount_cents)),
        direction: t.from_user_id === req.user.id ? 'sent' : 'received',
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
