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
const staffCatalog = require('../services/staffCatalog');

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

// El roster administrativo contiene identidad, fecha de alta y estado de
// turno. No es el selector público de propina: ese contrato mínimo vive en
// /:rid/staff/active. Exigir manager evita enumerar PII usando los UUID
// públicos del catálogo de restaurantes.
router.get('/:rid/staff', requireAuth, requireManager, async (req, res, next) => {
  try {
    const staff = await staffCatalog.listAdministrativeStaff(req.params.rid);
    res.json({ staff });
  } catch (err) { next(err); }
});

router.get('/:rid/staff/active', async (req, res, next) => {
  try {
    const staff = await staffCatalog.listActiveSelector(req.params.rid);
    res.json({ active_staff: staff });
  } catch (err) { next(err); }
});

router.post('/:rid/staff', requireAuth, requireManager, validateBody(addStaff), async (req, res, next) => {
  try {
    // 🔴 El alta por CORREO se retiró. Resolvía cualquier email registrado a
    // `payme_id + nombre + apellido`, para cualquier manager, sin relación
    // previa con esa persona: un oráculo correo→identidad sobre TODA la base.
    // Y no hacía falta ni mirar el cuerpo — el 404 contra el 201 ya delataba
    // si un correo estaba registrado.
    //
    // Queda sólo `payme_id`, que es el identificador que la persona comparte a
    // propósito. Es el mismo criterio con el que `routes/friends.js:127-152`
    // resolvió su propio oráculo, y el que sostiene la frase del aviso sobre
    // el correo. Echar el nombre en la respuesta sigue siendo legítimo: quien
    // lo agrega ya tenía su identificador.
    const { payme_id, display_name, role } = req.body;
    const created = await staffCatalog.createOrReactivateStaff({
      restaurantId: req.params.rid,
      paymeId: payme_id,
      displayName: display_name,
      role,
    });
    if (!created) return res.status(404).json({ error: 'user_not_found' });
    const { row, user } = created;
    logger.audit('staff_added', {
      restaurant_id: req.params.rid, user_id: user.id, role, by: req.user.id,
    });
    res.status(201).json({
      staff: {
        id: row.id, role: row.role, display_name: row.display_name,
        shift_status: row.shift_status, hired_at: row.hired_at,
        payme_id: user.payme_id,
        first_name: user.first_name, last_name: user.last_name,
      },
    });
  } catch (err) { next(err); }
});

router.patch('/:rid/staff/:sid', requireAuth, requireManager, validateBody(updateStaff), async (req, res, next) => {
  try {
    if (req.body.display_name === undefined && req.body.role === undefined) {
      return res.status(400).json({ error: 'no_changes' });
    }
    const staff = await staffCatalog.updateStaff({
      restaurantId: req.params.rid,
      staffId: req.params.sid,
      displayName: req.body.display_name,
      role: req.body.role,
    });
    if (!staff) return res.status(404).json({ error: 'staff_not_found' });
    res.json({
      staff: {
        id: staff.id, role: staff.role, display_name: staff.display_name,
        shift_status: staff.shift_status,
      },
    });
  } catch (err) { next(err); }
});

router.delete('/:rid/staff/:sid', requireAuth, requireManager, async (req, res, next) => {
  try {
    const removed = await staffCatalog.removeStaff({
      restaurantId: req.params.rid,
      staffId: req.params.sid,
    });
    if (!removed) return res.status(404).json({ error: 'staff_not_found' });
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
