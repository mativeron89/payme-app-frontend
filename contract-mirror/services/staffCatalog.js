/**
 * v2.79.0 · Autoridad de dominio para el roster canónico de App Backend.
 *
 * Las rutas públicas y el canal S2S oscuro llaman estas mismas operaciones.
 * El SQL de altas, reactivaciones, cambios y bajas no se duplica en routers.
 */
'use strict';

const pool = require('../db/pool');

const INTERNAL_STAFF_FIELDS = Object.freeze([
  'id', 'display_name', 'role', 'status', 'shift_status',
]);

function internalStaffDto(row) {
  if (!row) return null;
  return Object.fromEntries(INTERNAL_STAFF_FIELDS.map((field) => [field, row[field]]));
}

async function activeRestaurantExists(restaurantId, { db = pool } = {}) {
  const { rowCount } = await db.query(
    `SELECT 1 FROM restaurants WHERE id = $1 AND status = 'active'`,
    [restaurantId]
  );
  return rowCount === 1;
}

async function listAdministrativeStaff(restaurantId, { db = pool } = {}) {
  const { rows } = await db.query(
    `SELECT s.id, s.role, s.display_name, s.shift_status, s.hired_at,
            u.payme_id, u.first_name, u.last_name
       FROM restaurant_staff s JOIN users u ON u.id = s.user_id
      WHERE s.restaurant_id = $1 AND s.status = 'active'
      ORDER BY s.display_name ASC`,
    [restaurantId]
  );
  return rows;
}

async function listActiveSelector(restaurantId, { db = pool } = {}) {
  const { rows } = await db.query(
    `SELECT id, role, display_name FROM restaurant_staff
      WHERE restaurant_id = $1 AND status = 'active' AND shift_status = 'on'
      ORDER BY display_name ASC`,
    [restaurantId]
  );
  return rows;
}

async function listInternalStaff(restaurantId, { db = pool } = {}) {
  const { rows } = await db.query(
    `SELECT id, display_name, role, status, shift_status
       FROM restaurant_staff
      WHERE restaurant_id = $1 AND status = 'active'
      ORDER BY display_name ASC, id ASC`,
    [restaurantId]
  );
  return rows.map(internalStaffDto);
}

async function createOrReactivateStaff({ restaurantId, paymeId, displayName, role }, {
  db = pool,
} = {}) {
  const { rows: users } = await db.query(
    `SELECT id, payme_id, first_name, last_name FROM users
      WHERE payme_id = $1 AND status = 'active'`,
    [paymeId]
  );
  const user = users[0];
  if (!user) return null;

  const { rows } = await db.query(
    `INSERT INTO restaurant_staff (restaurant_id, user_id, display_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (restaurant_id, user_id) DO UPDATE
       SET status='active', display_name=EXCLUDED.display_name,
           role=EXCLUDED.role, removed_at=NULL
     RETURNING id, role, display_name, shift_status, hired_at, status`,
    [restaurantId, user.id, displayName, role]
  );
  return { row: rows[0], user };
}

async function updateStaff({ restaurantId, staffId, displayName, role }, { db = pool } = {}) {
  const fields = [];
  const values = [staffId, restaurantId];
  if (displayName !== undefined) {
    fields.push(`display_name = $${values.length + 1}`);
    values.push(displayName);
  }
  if (role !== undefined) {
    fields.push(`role = $${values.length + 1}`);
    values.push(role);
  }
  if (fields.length === 0) return null;
  const { rows } = await db.query(
    `UPDATE restaurant_staff SET ${fields.join(', ')}
      WHERE id = $1 AND restaurant_id = $2 AND status = 'active'
  RETURNING id, role, display_name, shift_status, status`,
    values
  );
  return rows[0] || null;
}

async function removeStaff({ restaurantId, staffId }, { db = pool } = {}) {
  const { rows } = await db.query(
    `UPDATE restaurant_staff SET status='removed', removed_at=NOW()
      WHERE id = $1 AND restaurant_id = $2
  RETURNING id`,
    [staffId, restaurantId]
  );
  return rows[0] || null;
}

module.exports = {
  INTERNAL_STAFF_FIELDS,
  internalStaffDto,
  activeRestaurantExists,
  listAdministrativeStaff,
  listActiveSelector,
  listInternalStaff,
  createOrReactivateStaff,
  updateStaff,
  removeStaff,
};
