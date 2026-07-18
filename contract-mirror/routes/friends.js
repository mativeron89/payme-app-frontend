/**
 * routes/friends.js — Gestión de amigos
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { addFriend, searchFriends, validateBody, validateQuery } = require('../schemas');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.payme_id, u.first_name, u.last_name, u.email, f.created_at
         FROM friendships f
         JOIN users u ON u.id = f.friend_user_id
        WHERE f.user_id = $1 AND f.status = 'accepted' AND u.status = 'active'
        ORDER BY u.first_name ASC`, [req.user.id]
    );
    res.json({
      friends: rows.map(f => ({
        id: f.id, payme_id: f.payme_id,
        first_name: f.first_name, last_name: f.last_name,
        full_name: `${f.first_name} ${f.last_name}`,
        email: f.email, added_at: f.created_at,
      })),
    });
  } catch (err) { next(err); }
});

router.post('/', validateBody(addFriend), async (req, res, next) => {
  try {
    const { email, payme_id } = req.body;
    const lookup = email
      ? await pool.query(`SELECT id, payme_id, first_name, last_name, email FROM users WHERE email = $1 AND status = 'active'`, [email])
      : await pool.query(`SELECT id, payme_id, first_name, last_name, email FROM users WHERE payme_id = $1 AND status = 'active'`, [payme_id]);
    const friend = lookup.rows[0];
    if (!friend) return res.status(404).json({ error: 'user_not_found' });
    if (friend.id === req.user.id) return res.status(400).json({ error: 'cannot_friend_self' });

    await pool.tx(async (client) => {
      await client.query(
        `INSERT INTO friendships (user_id, friend_user_id, status)
         VALUES ($1, $2, 'accepted'), ($2, $1, 'accepted')
         ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
        [req.user.id, friend.id]
      );
    });
    logger.audit('friend_added', { user_id: req.user.id, friend_id: friend.id });
    res.status(201).json({
      friend: {
        id: friend.id, payme_id: friend.payme_id,
        first_name: friend.first_name, last_name: friend.last_name,
        full_name: `${friend.first_name} ${friend.last_name}`,
        email: friend.email,
      },
    });
  } catch (err) { next(err); }
});

router.delete('/:friendId', async (req, res, next) => {
  try {
    await pool.tx(async (client) => {
      await client.query(
        `DELETE FROM friendships
          WHERE (user_id = $1 AND friend_user_id = $2)
             OR (user_id = $2 AND friend_user_id = $1)`,
        [req.user.id, req.params.friendId]
      );
    });
    res.json({ removed: true });
  } catch (err) { next(err); }
});

router.get('/search', validateQuery(searchFriends), async (req, res, next) => {
  try {
    const q = `%${req.validatedQuery.q.toLowerCase()}%`;
    const { rows } = await pool.query(
      `SELECT u.id, u.payme_id, u.first_name, u.last_name, u.email
         FROM friendships f
         JOIN users u ON u.id = f.friend_user_id
        WHERE f.user_id = $1 AND f.status = 'accepted'
          AND (LOWER(u.first_name) LIKE $2 OR LOWER(u.last_name) LIKE $2
            OR LOWER(u.payme_id)   LIKE $2 OR LOWER(u.email)     LIKE $2)
        LIMIT 50`, [req.user.id, q]
    );
    res.json({
      results: rows.map(u => ({
        id: u.id, payme_id: u.payme_id,
        full_name: `${u.first_name} ${u.last_name}`, email: u.email,
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
