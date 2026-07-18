/**
 * routes/groups.js — Grupos personalizados (Familia, Trabajo, custom)
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { createGroup, updateGroup, addGroupMember, validateBody } = require('../schemas');
const logger = require('../utils/logger');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.icon, g.created_at,
              COUNT(m.friend_user_id)::int AS member_count
         FROM friend_groups g
    LEFT JOIN friend_group_members m ON m.group_id = g.id
        WHERE g.user_id = $1
        GROUP BY g.id ORDER BY g.created_at ASC`, [req.user.id]
    );
    res.json({ groups: rows });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, icon FROM friend_groups WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    const group = rows[0];
    if (!group) return res.status(404).json({ error: 'group_not_found' });
    const { rows: members } = await pool.query(
      `SELECT u.id, u.payme_id, u.first_name, u.last_name, u.email
         FROM friend_group_members m JOIN users u ON u.id = m.friend_user_id
        WHERE m.group_id = $1`, [group.id]
    );
    res.json({ group, members });
  } catch (err) { next(err); }
});

router.post('/', validateBody(createGroup), async (req, res, next) => {
  try {
    const { name, icon } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO friend_groups (user_id, name, icon)
       VALUES ($1, $2, $3) RETURNING id, name, icon, created_at`,
      [req.user.id, name, icon || '👥']
    );
    logger.audit('group_created', { user_id: req.user.id, group_id: rows[0].id });
    res.status(201).json({ group: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'group_name_exists' });
    next(err);
  }
});

router.patch('/:id', validateBody(updateGroup), async (req, res, next) => {
  try {
    const fields = [], values = [req.params.id, req.user.id];
    if (req.body.name) { fields.push(`name = $${values.length + 1}`); values.push(req.body.name); }
    if (req.body.icon) { fields.push(`icon = $${values.length + 1}`); values.push(req.body.icon); }
    if (fields.length === 0) return res.status(400).json({ error: 'no_changes' });
    const { rows } = await pool.query(
      `UPDATE friend_groups SET ${fields.join(', ')}
        WHERE id = $1 AND user_id = $2 RETURNING id, name, icon`, values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'group_not_found' });
    res.json({ group: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM friend_groups WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'group_not_found' });
    res.json({ removed: true });
  } catch (err) { next(err); }
});

router.post('/:id/members', validateBody(addGroupMember), async (req, res, next) => {
  try {
    const { rowCount: gOk } = await pool.query(
      `SELECT 1 FROM friend_groups WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (gOk === 0) return res.status(404).json({ error: 'group_not_found' });
    const { rowCount: fOk } = await pool.query(
      `SELECT 1 FROM friendships WHERE user_id = $1 AND friend_user_id = $2 AND status = 'accepted'`,
      [req.user.id, req.body.friend_user_id]
    );
    if (fOk === 0) return res.status(400).json({ error: 'not_a_friend' });
    await pool.query(
      `INSERT INTO friend_group_members (group_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.body.friend_user_id]
    );
    res.status(201).json({ added: true });
  } catch (err) { next(err); }
});

router.delete('/:id/members/:fid', async (req, res, next) => {
  try {
    const { rowCount: gOk } = await pool.query(
      `SELECT 1 FROM friend_groups WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (gOk === 0) return res.status(404).json({ error: 'group_not_found' });
    await pool.query(
      `DELETE FROM friend_group_members WHERE group_id = $1 AND friend_user_id = $2`,
      [req.params.id, req.params.fid]
    );
    res.json({ removed: true });
  } catch (err) { next(err); }
});

module.exports = router;
