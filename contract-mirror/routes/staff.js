/**
 * routes/staff.js — Camareros y staff
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { addStaff, updateStaff, setStaffShift, validateBody } = require('../schemas');
const { centsToDisplay } = require('../utils/money');
const logger = require('../utils/logger');

const router = express.Router();

async function requireManager(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM restaurant_staff
        WHERE restaurant_id = $1 AND user_id = $2
          AND role IN ('manager','owner') AND status = 'active'`,
      [req.params.rid, req.user.id]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'not_restaurant_manager' });
    next();
  } catch (err) { next(err); }
}

router.get('/:rid/staff', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.role, s.display_name, s.shift_status, s.hired_at,
              u.payme_id, u.first_name, u.last_name
         FROM restaurant_staff s JOIN users u ON u.id = s.user_id
        WHERE s.restaurant_id = $1 AND s.status = 'active'
        ORDER BY s.display_name ASC`, [req.params.rid]
    );
    res.json({ staff: rows });
  } catch (err) { next(err); }
});

router.get('/:rid/staff/active', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, role, display_name FROM restaurant_staff
        WHERE restaurant_id = $1 AND status = 'active' AND shift_status = 'on'
        ORDER BY display_name ASC`, [req.params.rid]
    );
    res.json({ active_staff: rows });
  } catch (err) { next(err); }
});

router.post('/:rid/staff', requireAuth, requireManager, validateBody(addStaff), async (req, res, next) => {
  try {
    const { payme_id, email, display_name, role } = req.body;
    const lookup = payme_id
      ? await pool.query(`SELECT id, payme_id, first_name, last_name FROM users WHERE payme_id = $1 AND status = 'active'`, [payme_id])
      : await pool.query(`SELECT id, payme_id, first_name, last_name FROM users WHERE email = $1 AND status = 'active'`, [email]);
    const user = lookup.rows[0];
    if (!user) return res.status(404).json({ error: 'user_not_found' });

    const { rows } = await pool.query(
      `INSERT INTO restaurant_staff (restaurant_id, user_id, display_name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (restaurant_id, user_id) DO UPDATE
         SET status='active', display_name=EXCLUDED.display_name,
             role=EXCLUDED.role, removed_at=NULL
       RETURNING id, role, display_name, shift_status, hired_at`,
      [req.params.rid, user.id, display_name, role]
    );
    logger.audit('staff_added', {
      restaurant_id: req.params.rid, user_id: user.id, role, by: req.user.id,
    });
    res.status(201).json({
      staff: {
        ...rows[0], payme_id: user.payme_id,
        first_name: user.first_name, last_name: user.last_name,
      },
    });
  } catch (err) { next(err); }
});

router.patch('/:rid/staff/:sid', requireAuth, requireManager, validateBody(updateStaff), async (req, res, next) => {
  try {
    const fields = [], values = [req.params.sid, req.params.rid];
    if (req.body.display_name) { fields.push(`display_name = $${values.length + 1}`); values.push(req.body.display_name); }
    if (req.body.role) { fields.push(`role = $${values.length + 1}`); values.push(req.body.role); }
    if (fields.length === 0) return res.status(400).json({ error: 'no_changes' });
    const { rows } = await pool.query(
      `UPDATE restaurant_staff SET ${fields.join(', ')}
        WHERE id = $1 AND restaurant_id = $2 AND status = 'active'
    RETURNING id, role, display_name, shift_status`, values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'staff_not_found' });
    res.json({ staff: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:rid/staff/:sid', requireAuth, requireManager, async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE restaurant_staff SET status='removed', removed_at=NOW()
        WHERE id = $1 AND restaurant_id = $2`,
      [req.params.sid, req.params.rid]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'staff_not_found' });
    res.json({ removed: true });
  } catch (err) { next(err); }
});

router.patch('/:rid/staff/:sid/shift', requireAuth, validateBody(setStaffShift), async (req, res, next) => {
  try {
    const { rows: rRows } = await pool.query(
      `SELECT user_id FROM restaurant_staff WHERE id = $1 AND restaurant_id = $2`,
      [req.params.sid, req.params.rid]
    );
    const staff = rRows[0];
    if (!staff) return res.status(404).json({ error: 'staff_not_found' });
    if (staff.user_id !== req.user.id) {
      const { rowCount: mOk } = await pool.query(
        `SELECT 1 FROM restaurant_staff
          WHERE restaurant_id = $1 AND user_id = $2
            AND role IN ('manager','owner') AND status = 'active'`,
        [req.params.rid, req.user.id]
      );
      if (mOk === 0) return res.status(403).json({ error: 'not_authorized' });
    }
    await pool.query(
      `UPDATE restaurant_staff SET shift_status = $1 WHERE id = $2`,
      [req.body.shift_status, req.params.sid]
    );
    res.json({ updated: true, shift_status: req.body.shift_status });
  } catch (err) { next(err); }
});

// ─── /api/me/staff-earnings (montado aparte como earningsRouter) ─
const earningsRouter = express.Router();
earningsRouter.use(requireAuth);

earningsRouter.get('/staff-earnings', async (req, res, next) => {
  try {
    const { rows: monthRows } = await pool.query(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*)::int AS count
         FROM tip_distributions td
         JOIN restaurant_staff s ON s.id = td.staff_id
        WHERE s.user_id = $1 AND td.status = 'credited'
          AND td.credited_at >= date_trunc('month', NOW())`, [req.user.id]
    );
    const { rows: tips } = await pool.query(
      `SELECT td.id, td.amount_cents, td.status, td.credited_at, td.created_at,
              r.name AS restaurant_name, m.code AS mesa_code
         FROM tip_distributions td
         JOIN restaurant_staff s ON s.id = td.staff_id
         JOIN mesas m ON m.id = td.mesa_id
         JOIN restaurants r ON r.id = s.restaurant_id
        WHERE s.user_id = $1
        ORDER BY td.created_at DESC LIMIT 20`, [req.user.id]
    );
    res.json({
      month: {
        total_cents: Number(monthRows[0].total),
        total_display: centsToDisplay(Number(monthRows[0].total)),
        tips_count: monthRows[0].count,
      },
      recent_tips: tips.map(t => ({
        ...t,
        amount_cents: Number(t.amount_cents),
        amount_display: centsToDisplay(Number(t.amount_cents)),
      })),
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.earningsRouter = earningsRouter;
