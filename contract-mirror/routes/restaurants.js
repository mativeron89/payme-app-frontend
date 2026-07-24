/**
 * routes/restaurants.js — Restaurantes de cara al COMENSAL (G-01, v2.21)
 *
 * Público sin auth (mismo criterio que el listado de staff): el comensal
 * resuelve el restaurant_id que le llegó por el QR de la mesa ANTES del
 * POST /mesas. Convive con routes/staff.js en el mismo mount
 * /api/restaurants — paths disjuntos ('/' y '/:id' vs '/:rid/staff...').
 *
 * WHITELIST estricta { id, name, category, address } — espeja el shape ya
 * público en GET /mesas/:code. JAMÁS exponer rfc / fee_pct /
 * fixed_monthly_cents / stripe_account_id / clabe (pineado en test).
 */
'use strict';

const express = require('express');
const { validate: isUuid } = require('uuid');
const pool = require('../db/pool');
const { restaurantSearchQuery, validateQuery } = require('../schemas');

const router = express.Router();

// ─── GET / — búsqueda por nombre (picker manual / demo) ────────────────────
router.get('/', validateQuery(restaurantSearchQuery), async (req, res, next) => {
  try {
    const { q } = req.validatedQuery;
    const params = [];
    let where = `status = 'active'`;
    if (q) {
      // wildcards escapados: q busca texto literal, no patrones ILIKE
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      where += ` AND name ILIKE $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, name, category, address FROM restaurants
        WHERE ${where} ORDER BY name ASC LIMIT 20`,
      params
    );
    res.json({ restaurants: rows });
  } catch (err) { next(err); }
});

// ─── GET /:id — resolver el uuid del QR (cierra G-01) ──────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    // Un :id que no es uuid (QR roto, basura en la URL) es, para el comensal,
    // lo mismo que un restaurante inexistente: 404 — no un 22P02 de pg → 500.
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'restaurant_not_found' });
    }
    const { rows } = await pool.query(
      `SELECT id, name, category, address FROM restaurants
        WHERE id = $1 AND status = 'active'`,
      [req.params.id]
    );
    // suspendido/borrado = mismo 404 que inexistente (no filtrar el motivo)
    if (!rows[0]) return res.status(404).json({ error: 'restaurant_not_found' });
    res.json({ restaurant: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
